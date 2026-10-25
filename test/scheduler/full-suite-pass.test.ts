import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDaemonLoop, type DaemonLoop } from "../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Store,
  type WatcherBackend,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { busyWaits } from "./busy-fixture.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

/** A feed that lags: the watcher never reports, and the idle pass is a minute away. */
const silent: WatcherBackend = {
  name: "chokidar",
  watch: async () => ({ update: async () => {}, close: async () => {} }),
};

interface Fixture {
  readonly root: string;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly loop: DaemonLoop;
  readonly errors: Error[];
  /** The revision once the baseline ran, before the edit. */
  readonly before: number;
  /** The newest completed checkpoint before the edit: the baseline's. */
  readonly baseline: string | undefined;
}

/**
 * A loop past its baseline, `src/math.ts` broken since, which no revision holds yet. `onError`
 * runs after each feed error is kept. A test that closes the loop itself awaits that close.
 */
async function edited(run: (fixture: Fixture) => Promise<void>, onError?: () => void) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const root = repo.main;
  const worktreeId = worktreeIdFor(root);
  const runner = await createVitestAdapter({ root });
  const errors: Error[] = [];
  const loop = createDaemonLoop({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: { ...DEFAULT_POLICY, ...RUN_MISSING },
    squealVersion: "0.0.0-test",
    runsDir: storePaths(repo.commonDir).runsDir,
    onError: (error) => {
      errors.push(error);
      onError?.();
    },
    busyWaits: busyWaits(),
    backend: silent,
    timings: { reconcileIntervalMs: 60_000 },
  });
  try {
    await loop.start();
    await loop.scheduler.idle();
    const before = loop.scheduler.status().revision;
    const baseline = store.checkpoints.lastCompleted(worktreeId)?.id;
    writeFileSync(
      join(root, "src/math.ts"),
      "export const add = (a: number, b: number) => a - b;\n",
    );
    await run({ root, worktreeId, store, loop, errors, before, baseline });
  } finally {
    await loop.close();
    await runner.close();
  }
}

/** Makes `git status` exit 128 until the returned restore: the index is unreadable. */
function breakIndex(root: string): () => void {
  const index = join(root, ".git/index");
  const kept = readFileSync(index);
  writeFileSync(index, "not an index");
  return () => writeFileSync(index, kept);
}

/** Makes the store's next write transaction give up as on a busy store, once. */
function busyOnce(store: Store): { thrown: () => boolean } {
  const real = store.transaction.bind(store);
  let thrown = false;
  store.transaction = ((fn: () => unknown) => {
    if (thrown) return real(fn);
    thrown = true;
    store.transaction = real;
    throw Object.assign(new Error("database is locked"), { errcode: 5 });
  }) as typeof store.transaction;
  return { thrown: () => thrown };
}

const NO_PASS = /delivered no reconciliation pass that started after the request/;

describe("run --all plans only after a pass delivered since the request (011-198)", SLOW, () => {
  it("plans at the edit's revision although the watcher never reported it", async () => {
    await edited(async ({ store, worktreeId, loop, errors, before }) => {
      const record = await loop.scheduler.requestFullSuite();
      expect(record.revision).toBeGreaterThan(before);
      expect(record.testFiles.map((file) => file.path)).toContain("test/math.test.ts");
      expect(store.revisions.latest(worktreeId)?.changes.map((c) => c.path)).toEqual([
        "src/math.ts",
      ]);
      await loop.scheduler.idle();
      expect(errors).toEqual([]);
    });
  });

  it("B1, first path: a pass that fails other than on a busy store gives no checkpoint; the next request plans", async () => {
    let restore = () => {};
    await edited(
      async ({ root, store, worktreeId, loop, errors, before, baseline }) => {
        restore = breakIndex(root);
        await expect(loop.scheduler.requestFullSuite()).rejects.toThrow(NO_PASS);
        expect(errors.map(String)).toEqual([
          expect.stringMatching(/git --no-optional-locks status/),
        ]);
        expect(store.checkpoints.lastCompleted(worktreeId)?.id).toBe(baseline);
        expect(loop.scheduler.status().revision).toBe(before);
        // Git fails for that pass only: the next request's pass reads the tree again.
        const record = await loop.scheduler.requestFullSuite();
        expect(record.revision).toBeGreaterThan(before);
        expect(record.testFiles.map((file) => file.path)).toContain("test/math.test.ts");
        await loop.scheduler.idle();
      },
      () => restore(),
    );
  });

  it("B1, second path: a close during a busy retry gives no checkpoint", async () => {
    await edited(async ({ store, worktreeId, loop, errors, before, baseline }) => {
      const busy = busyOnce(store);
      const tracked = loop.scheduler.trackedPaths.bind(loop.scheduler);
      let closing: Promise<void> | null = null;
      // The retry collects its candidates after the busy write: the close comes before delivery.
      loop.scheduler.trackedPaths = () => {
        if (busy.thrown()) closing ??= loop.close();
        return tracked();
      };
      await expect(loop.scheduler.requestFullSuite()).rejects.toThrow(NO_PASS);
      expect(closing).not.toBeNull();
      await closing;
      expect(errors).toEqual([]);
      expect(store.checkpoints.lastCompleted(worktreeId)?.id).toBe(baseline);
      expect(store.revisions.latest(worktreeId)?.number ?? 0).toBe(before);
    });
  });

  it("plans at the edit's revision when a busy store failed the pass and its retry stored it", async () => {
    await edited(async ({ store, loop, errors, before }) => {
      const busy = busyOnce(store);
      const record = await loop.scheduler.requestFullSuite();
      expect(busy.thrown()).toBe(true);
      expect(record.revision).toBeGreaterThan(before);
      expect(record.testFiles.map((file) => file.path)).toContain("test/math.test.ts");
      await loop.scheduler.idle();
      expect(errors).toEqual([]);
    });
  });

  it("a request that joins a pending pass that fails gives no checkpoint; the pass's other caller resolves", async () => {
    let restore = () => {};
    await edited(
      async ({ root, loop, errors, before }) => {
        restore = breakIndex(root);
        // Queued in the same turn: the request joins the pass `reconcile` queued.
        const joined = loop.reconcile();
        const request = loop.scheduler.requestFullSuite();
        await expect(joined).resolves.toBeUndefined();
        await expect(request).rejects.toThrow(NO_PASS);
        expect(errors).toHaveLength(1);
        expect(loop.scheduler.status().revision).toBe(before);
      },
      () => restore(),
    );
  });

  it("a close before the request's pass ran gives no checkpoint", async () => {
    await edited(async ({ store, worktreeId, loop, errors, before, baseline }) => {
      const request = loop.scheduler.requestFullSuite();
      const closing = loop.close();
      await expect(request).rejects.toThrow(NO_PASS);
      await closing;
      expect(errors).toEqual([]);
      expect(store.checkpoints.lastCompleted(worktreeId)?.id).toBe(baseline);
      expect(store.revisions.latest(worktreeId)?.number ?? 0).toBe(before);
    });
  });
});
