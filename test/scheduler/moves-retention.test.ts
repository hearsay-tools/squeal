import { describe, expect, it, onTestFinished } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import {
  answerMoves,
  MOVES_GRACE_MS,
  MOVES_RETENTION_MS,
  movesSeq,
  recordMoves,
  rekeyedMovesMetaKey,
} from "../../src/core/scheduler/rekeyed-moves.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { captureSync, HARNESS_INCARNATION, liveDaemon } from "./store-wait.js";

/*
 * Review wave-13r B2 (task 001-226): abandoned sync requests kept retention
 * holds while a runner part stalled. Spec 001 D5 and task 001-228: a `run
 * --all` retry of a broken runner is unbounded, and a held answer queued
 * behind it ended only at the one-hour backstop. Since task 001-258 a wait
 * reads the store's moves: nothing is held per request, and a wait reads
 * its answer once the refined revision covers its capture, whatever runs
 * after it under the lock.
 */

/** Holds the runner part of a revision that changed `path`, before the real `invalidate`. */
function stallRefinement(h: Harness, path: string): () => void {
  let release = () => {};
  const refinement = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(release);
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = async (paths) => {
    if (paths.some((changed) => changed.path === path)) await refinement;
    return invalidate(paths);
  };
  return release;
}

describe("the store's re-key moves hold nothing per wait (review wave-13r B2)", () => {
  it(
    "are left as the commits wrote them by abandoned waits, and pruned once caught up",
    SLOW,
    async () => {
      let shift = 0;
      const clock = () => Date.now() + shift;
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        now: clock,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
      const raw = () => h.store.meta.get(rekeyedMovesMetaKey(h.worktreeId));
      const commit = () =>
        h.store.transaction(() =>
          recordMoves(h.store, h.worktreeId, [], [], h.scheduler.status().revision, clock(), {
            writer: HARNESS_INCARNATION,
          }),
        );
      // A math edit that resolves, then a strings edit whose runner part stalls.
      h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
      await h.batch("src/math.ts");
      await h.scheduler.idle();
      const release = stallRefinement(h, "src/strings.ts");
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 2\n");
      await h.batch("src/strings.ts");
      const revision = h.scheduler.status().revision;

      // 40 waits, abandoned at their own timeout while the runner part is held.
      const before = raw();
      const waits = await Promise.all(
        Array.from({ length: 40 }, () =>
          waitForStatus(h.root, { timeoutMs: 300, pollMs: 20, sync: captureSync(() => revision) }),
        ),
      );
      expect(waits.map((wait) => wait.outcome)).toEqual(waits.map(() => "timeout"));
      // They wrote nothing: the record is what the commits left, math's resolved move in it.
      expect(raw()).toBe(before);
      expect(JSON.parse(before ?? "{}").files).not.toEqual({});

      // Released, the runner part lands and the strings run resolves; caught up after it.
      release();
      await h.scheduler.idle();
      commit();
      expect(JSON.parse(raw() ?? "{}").caughtUpAt).toEqual(expect.any(Number));
      // Within the grace nothing goes; an hour and the grace past the catch-up, everything resolved does.
      // The ledger's first commit dropped what came before it (task 001-268).
      const adopted = JSON.parse(before ?? "{}").dropped;
      shift = MOVES_GRACE_MS - 1_000;
      commit();
      expect(JSON.parse(raw() ?? "{}").dropped).toBe(adopted);
      shift = MOVES_RETENTION_MS + MOVES_GRACE_MS + 1;
      commit();
      const after = JSON.parse(raw() ?? "{}");
      expect(after.files).toEqual({});
      expect(after.dropped).toBeGreaterThan(adopted);
    },
  );
});

describe("a wait behind an unbounded run --all retry (spec 001 D5, task 001-228)", () => {
  it(
    "reads its answer once the runner part is abandoned, while the retry hangs",
    SLOW,
    async () => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        failing: ["environment"],
        allowErrors: true,
        runnerPartMs: 2_000,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
      // From now on `environment` never answers: a wedged runner.
      h.runner.failing.clear();
      let environmentCalls = 0;
      const hung: ((error: Error) => void)[] = [];
      h.runner.environment = () => {
        environmentCalls += 1;
        return new Promise((_, reject) => hung.push(reject));
      };
      onTestFinished(() => {
        for (const reject of hung) reject(new Error("test over"));
      });

      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
      await h.batch("src/strings.ts");
      const revision = h.scheduler.status().revision;
      // The revision's runner part is in its runner phase, its `environment` hung.
      await expect.poll(() => environmentCalls, { timeout: 30_000 }).toBe(1);
      // `run --all` while the runner is broken: its retry queues behind the runner part.
      void h.scheduler.requestFullSuite().catch(() => {});
      // A wait's start, after the daemon's capture.
      const sinceSeq = movesSeq(h.store, h.worktreeId) ?? 0;

      // The runner part is abandoned at its bound and the revision recorded refined.
      await expect
        .poll(() => Number(h.store.meta.get(refinedMetaKey(h.worktreeId))), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(revision);
      // The retry has started and hangs in `environment`, under the lock.
      await expect.poll(() => environmentCalls, { timeout: 30_000 }).toBe(2);
      // The store answers now, before the retry ends.
      const answer = h.store.transaction(() =>
        answerMoves(h.store, h.worktreeId, revision, sinceSeq, HARNESS_INCARNATION),
      );
      expect(answer.state).toBe("answered");
      expect(environmentCalls).toBe(2);

      // Over: the hung calls fail, the queued run --all drains, and the scheduler can close.
      h.runner.environment = () => Promise.reject(new Error("test over"));
      for (const reject of hung) reject(new Error("test over"));
      await h.scheduler.idle();
    },
  );
});
