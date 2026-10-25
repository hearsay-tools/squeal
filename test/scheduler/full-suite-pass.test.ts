import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDaemonLoop, type DaemonLoop } from "../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type Store, type WatcherBackend } from "../../src/core/types/index.js";
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
  readonly store: Store;
  readonly loop: DaemonLoop;
  readonly errors: Error[];
  /** The revision once the baseline ran, before the edit. */
  readonly before: number;
}

/** A loop past its baseline, `src/math.ts` edited since, which no revision holds yet. */
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
    writeFileSync(
      join(root, "src/math.ts"),
      "export const add = (a: number, b: number) => a - b;\n",
    );
    await run({ root, store, loop, errors, before });
    await loop.scheduler.idle();
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

describe("run --all and the pass before it (011-198 R1)", SLOW, () => {
  it("rejects and records no checkpoint when the pass fails other than on a busy store", async () => {
    let restore = () => {};
    await edited(
      async ({ root, store, loop, errors, before }) => {
        const worktreeId = worktreeIdFor(root);
        const last = store.checkpoints.lastCompleted(worktreeId)?.id;
        restore = breakIndex(root);
        const failure = await loop.scheduler.requestFullSuite().catch((error: unknown) => error);
        expect(errors).toHaveLength(1);
        expect(failure).toBe(errors[0]);
        expect(String(failure)).toMatch(/git --no-optional-locks status/);
        expect(store.checkpoints.lastCompleted(worktreeId)?.id).toBe(last);
        expect(loop.scheduler.status().revision).toBe(before);
        // The next request's pass reads the tree again.
        const record = await loop.scheduler.requestFullSuite();
        expect(record.revision).toBeGreaterThan(before);
        expect(record.testFiles.map((file) => file.path)).toContain("test/math.test.ts");
      },
      // Git fails for the requested pass only.
      () => restore(),
    );
  });

  it("a request that joins a pending pass learns its failure; the pass's other caller resolves", async () => {
    let restore = () => {};
    await edited(
      async ({ root, loop, errors, before }) => {
        restore = breakIndex(root);
        // Queued in the same turn: the request joins the pass `reconcile` queued.
        const joined = loop.reconcile();
        const request = loop.scheduler.requestFullSuite();
        await expect(joined).resolves.toBeUndefined();
        await expect(request).rejects.toBe(errors[0]);
        expect(errors).toHaveLength(1);
        expect(loop.scheduler.status().revision).toBe(before);
      },
      () => restore(),
    );
  });

  it("rejects when the loop closes before the request's pass ran", async () => {
    await edited(async ({ loop, errors, before }) => {
      const request = loop.scheduler.requestFullSuite();
      const closing = loop.close();
      await expect(request).rejects.toThrow("the change feed closed before its pass was delivered");
      await closing;
      expect(errors).toEqual([]);
      expect(loop.scheduler.status().revision).toBe(before);
    });
  });

  it("plans at the edit's revision when a busy store failed the pass and its retry stored it", async () => {
    await edited(async ({ store, loop, errors, before }) => {
      const real = store.transaction.bind(store);
      let thrown = 0;
      // The pass's first write gives up as on a busy store, once.
      store.transaction = ((fn: () => unknown) => {
        if (thrown > 0) return real(fn);
        thrown += 1;
        throw Object.assign(new Error("database is locked"), { errcode: 5 });
      }) as typeof store.transaction;
      try {
        const record = await loop.scheduler.requestFullSuite();
        expect(thrown).toBe(1);
        expect(record.revision).toBeGreaterThan(before);
        expect(record.testFiles.map((file) => file.path)).toContain("test/math.test.ts");
        expect(errors).toEqual([]);
      } finally {
        store.transaction = real;
      }
    });
  });
});
