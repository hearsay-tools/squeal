import { describe, expect, it, onTestFinished } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13l, S1 (task 001-202): the scheduler kept only a file's last
 * discharge, so a second move of the file resolved by a cached result while
 * the wait's sync awaited an unrelated refinement replaced the first; the
 * answer, bounded by the captured revision, no longer named the file, and
 * the wait ended quiet with the edit's failure counted as another check's.
 * The scheduler, adapter, store and sink are real; the sync is the daemon's
 * sequence: capture the revision, `refined()`, then `rekeyedSince`. The
 * control differs only in the second, cached edit.
 */

const MATH = "src/math.ts";
const CACHED = "export const add = (a: number, b: number) => a - b; // cached\n";
const PASSING = "export const add = (a: number, b: number) => a + b;\n";
const TARGET = "export const add = (a: number, b: number) => a - b; // target\n";

describe("status --wait over a later cached discharge of its file (task 001-202)", () => {
  it.each([
    { name: "a later cached discharge", cached: true },
    { name: "the one-discharge control", cached: false },
  ])("returns on the edit's own news with $name", SLOW, async ({ cached }) => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      runnerPartBesideRun: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    // A live daemon record: without one a wait never reports quiet (D7).
    h.store.worktrees.upsert({
      id: h.worktreeId,
      root: h.root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: Date.now(),
      daemon: {
        socketPath: "/tmp/squeal-test.sock",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 600_000,
        squealVersion: "0.0.0-test",
      },
    });
    // Revisions 1 and 2: math's failure under CACHED is stored, then it passes again.
    h.write(MATH, CACHED);
    await h.batch(MATH);
    await h.scheduler.idle();
    h.write(MATH, PASSING);
    await h.batch(MATH);
    await h.scheduler.idle();
    const mathFails = () =>
      h.store.knownStates
        .list(h.worktreeId)
        .some((state) => state.check.testPath === "test/math.test.ts" && state.outcome === "fail");
    expect(mathFails()).toBe(false);

    // Revision 3 breaks math; its run starts and is held.
    let releaseRun = () => {};
    const run = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let started = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.runner.beforeRun = () => {
      started();
      return run;
    };
    onTestFinished(releaseRun);
    h.write(MATH, TARGET);
    await h.batch(MATH);
    const target = h.scheduler.status().revision;
    await running;

    // Revision 4 edits strings; its refinement is held before the real `invalidate`.
    let releaseRefinement = () => {};
    const refinement = new Promise<void>((resolve) => {
      releaseRefinement = resolve;
    });
    onTestFinished(releaseRefinement);
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) => {
      if (paths.some((path) => path.path === "src/strings.ts")) await refinement;
      return invalidate(paths);
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 4\n");
    await h.batch("src/strings.ts");

    let state: SyncState = { state: "pending" };
    const sync = (
      _root: unknown,
      _pollMs: number,
      after: RevisionNumber,
      resolvedSince: EpochMs,
    ): DaemonSync => {
      void (async () => {
        const revision = h.scheduler.status().revision;
        const refined = h.scheduler.refined();
        // Math's failure lands while the pass waits for strings' refinement.
        releaseRun();
        await expect.poll(mathFails, { timeout: 60_000 }).toBe(true);
        expect(h.scheduler.rekeyedSince(0, revision, resolvedSince)).toContainEqual(
          expect.objectContaining({ revision: target, resolved: true }),
        );
        if (cached) {
          // Revision 5 restores CACHED: its stored failure discharges the move without a run.
          h.write(MATH, CACHED);
          await h.batch(MATH);
          const latest = h.scheduler.status().revision;
          expect(latest).toBe(revision + 1);
          await expect
            .poll(() => h.scheduler.rekeyedSince(revision, latest, resolvedSince), {
              timeout: 60_000,
            })
            .toContainEqual(expect.objectContaining({ revision: latest, resolved: true }));
        }
        releaseRefinement();
        await refined;
        state = {
          state: "synced",
          revision,
          rekeyed: h.scheduler.rekeyedSince(after, revision, resolvedSince),
        };
      })();
      return { current: () => state, stop: () => {} };
    };

    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    expect(wait.outcome).toBe("news");
    expect(wait).toMatchObject({
      transitions: 1,
      edit: { testFiles: 3, otherTransitions: 0 },
    });
  });
});
