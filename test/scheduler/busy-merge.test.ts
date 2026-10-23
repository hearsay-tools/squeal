import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMergeHold } from "../../src/core/scheduler/hold-rows.js";
import type { SchedulerOptions } from "../../src/core/scheduler/options.js";
import { BusyWaits } from "../../src/core/store/index.js";
import type { RunReport, Store, TestFileRef } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { type CatchUpOptions, type CatchUpSide, catchUpSide } from "./catch-up-fixture.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import {
  A,
  B,
  batch,
  FILES,
  HELPER,
  heldPaths,
  helperReturning,
  mergeRepo,
  OTHER,
  outcomes,
  rows,
  unmergeIndex,
} from "./merge-hold-fixture.js";

/*
 * Review 0.1.273, B1 (011 C9, row 011-126): a record that waited for a busy
 * store wrote what it decided before the wait, merge hold included. A hold
 * that started during the wait did not keep the record from storing a
 * result at a key it names. Now the record reads the hold again before each
 * try: the held file stays queued, nothing is stored at its key, and the
 * hold's end starts it.
 */

const busyWaits = () => new BusyWaits({ now: Date.now, note: () => {} });

/**
 * Makes the first record's write transaction give up as on a busy store,
 * after `during` ran: the record waits for its retry. Returns the restore.
 */
function busyFirstWrite(store: Store, during: () => void): () => void {
  const real = store.transaction.bind(store);
  let inject = true;
  store.transaction = ((fn: () => unknown) => {
    if (inject && new Error().stack?.includes("TierScheduler.#write")) {
      inject = false;
      during();
      throw Object.assign(new Error("database is locked"), { errcode: 5 });
    }
    return real(fn);
  }) as typeof store.transaction;
  return () => {
    store.transaction = real;
  };
}

describe("a busy record and a merge hold that starts before it lands (review 0.1.273 B1)", () => {
  it(
    "stores nothing at the held key, keeps the file queued, and runs it once `git add` ends the hold",
    SLOW,
    async () => {
      const { main, commonDir } = createRepo();
      const store = openRepoStore(commonDir);
      const h = await openHarness(main, store, commonDir, {
        busyWaits: busyWaits(),
        busySliceMs: 50,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      const math = () =>
        store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === "test/math.test.ts");
      const storedAt = (key: string | null | undefined) =>
        key === null || key === undefined ? [] : store.results.byKey(key, 0);
      let beforeStore: unknown = null;
      let held: Promise<void> | null = null;
      const restore = busyFirstWrite(store, () => {
        beforeStore = storedAt(math()?.key);
        unmergeIndex(main, "src/math.ts");
        // The interval's pass reads the index, under the lock the record gave back.
        held = h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      });
      try {
        h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
        await h.batch("src/math.ts");
        await expect.poll(() => held).not.toBeNull();
        await held;
        await h.scheduler.idle();
        expect(readMergeHold(store, h.worktreeId, 0)?.paths).toEqual(["src/math.ts"]);
        expect(beforeStore).toEqual([]);
        expect(storedAt(math()?.key)).toEqual([]);
        expect(math()?.pending).toBe("queued");
      } finally {
        restore();
      }

      git(main, ["add", "src/math.ts"]);
      await expect
        .poll(() => readMergeHold(store, h.worktreeId, 0)?.paths ?? null, { timeout: 10_000 })
        .toBeNull();
      await expect.poll(() => math()?.pending, { timeout: 30_000 }).toBeNull();
      await h.scheduler.idle();
      expect(storedAt(math()?.key)).not.toEqual([]);
    },
  );

  it("a startup failure on the setup file the hold now names applies no setup outcome; the files it kept from starting stay queued", {
    timeout: 60_000,
  }, async () => {
    const repo = mergeRepo();
    const scheduler: CatchUpOptions["scheduler"] &
      Pick<SchedulerOptions, "busyWaits" | "busySliceMs"> = {
      busyWaits: busyWaits(),
      busySliceMs: 50,
    };
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 4,
      tierSize: 4,
      scheduler,
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    const failsOnce = startupFailureOnce(side, HELPER);
    let held: Promise<void> | null = null;
    const restore = busyFirstWrite(side.store, () => {
      unmergeIndex(repo.main, HELPER);
      held = side.scheduler.handleBatch({ trigger: "interval", paths: [] });
    });
    try {
      // `OTHER` imports nothing: only the startup failure on the unmerged setup file holds it.
      writeFileSync(join(repo.main, HELPER), helperReturning(7));
      appendFileSync(join(repo.main, OTHER), "\n");
      await batch(side, HELPER, OTHER);
      await expect.poll(() => held).not.toBeNull();
      await held;
      await side.scheduler.idle();
      expect(failsOnce()).toBe(0);
      expect(heldPaths(side)).toEqual([HELPER]);
      expect(setupStates(side)).toEqual([]);
      const now = rows(side);
      for (const path of [A, B, OTHER]) {
        expect(now.get(path)?.pending, path).toBe("queued");
        expect(outcomes(side, path), path).toEqual([]);
        expect(side.store.results.byKey(now.get(path)?.key ?? null, 0), path).toEqual([]);
      }
      expect(unknownOf(side, [A, B, OTHER])).toEqual([]);
    } finally {
      restore();
    }

    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [A, B, OTHER].map((path) => outcomes(side, path)), { timeout: 10_000 })
      .toEqual([["pass"], ["pass"], ["pass"]]);
    expect(setupStates(side)).toEqual([]);
  });
});

/** The next run of `A` fails to start on `setupFile` and runs nothing. Returns the failures left. */
function startupFailureOnce(side: CatchUpSide, setupFile: string): () => number {
  const run = side.runner.run.bind(side.runner);
  let left = 1;
  side.runner.run = async (files, options) => {
    if (left === 0 || !files.some((f) => f.path === A)) return run(files, options);
    left -= 1;
    const report: RunReport = {
      end: "completed",
      durationMs: 1,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: `global setup ${setupFile} failed`,
      startupFailure: {
        projects: [""],
        testFiles: files.map((f: TestFileRef) => ({ ...f })),
        setupFile,
        error: {
          name: "Error",
          message: `Transform failed with 1 error: ${setupFile}: Unexpected "<<"`,
          stack: null,
          location: null,
          diff: null,
        },
      },
    };
    return report;
  };
  return () => left;
}

const setupStates = (side: CatchUpSide) =>
  side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => s.check.kind === "setup")
    .map((s) => ({ project: s.check.project, outcome: s.outcome }));

const unknownOf = (side: CatchUpSide, paths: readonly string[]) =>
  side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => paths.includes(s.check.testPath))
    .filter((s) => s.outcome === "unknown" || s.validity === "unknown");
