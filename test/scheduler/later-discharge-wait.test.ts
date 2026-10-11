import { describe, expect, it, onTestFinished } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { testFileId } from "../../src/core/keys/index.js";
import {
  MOVES_GRACE_MS,
  MOVES_RETENTION_MS,
  recordMoves,
  rekeyedMovesMetaKey,
} from "../../src/core/scheduler/rekeyed-moves.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { captureSync, HARNESS_INCARNATION, liveDaemon } from "./store-wait.js";

/*
 * Review wave 13l, S1 (task 001-202): a second move of the file resolved by
 * a cached result while the wait awaited an unrelated refinement replaced
 * the first, and the wait ended quiet with the edit's failure counted as
 * another check's. Review wave 13q, S1 (task 001-214): later discharges past
 * a count cap, or one past the hour, evicted the first the same way. Review
 * wave-13s B2 and 13t S1: a hold outlived its hour, or a late timer kept a
 * younger one. Since task 001-258 the store's moves keep one entry per file
 * and revision with no count cap, and prune by age only once refinement has
 * been caught up for a grace, so none of these drops the wait's own entry;
 * a wait whose entry was pruned anyway falls back, never quiet. The
 * scheduler, adapter, store and sink are real; a commit's record is
 * `recordMoves` at the scheduler's clock, which the test shifts.
 * Revisions: 1 and 2 warm math's cache, 3 breaks math (run held), 4 edits
 * strings (runner part held); the wait captures 4.
 */

const MATH = "src/math.ts";
const MATH_ID = testFileId({ project: "", path: "test/math.test.ts" });
const CACHED = "export const add = (a: number, b: number) => a - b; // cached\n";
const PASSING = "export const add = (a: number, b: number) => a + b;\n";
const TARGET = "export const add = (a: number, b: number) => a - b; // target\n";
const HOUR = 60 * 60_000;
/** As the harness's ledger writes its moves. */
const BY = { writer: HARNESS_INCARNATION };

interface Case {
  readonly name: string;
  readonly cached?: boolean;
  /** Later resolved moves of other files, at the next revision. */
  readonly flood?: number;
  /** Shift the scheduler's clock by this much while the runner part is held. */
  readonly clock?: number;
  /** Then a commit, which may prune. */
  readonly commit?: boolean;
  /** Once refined, caught up for the grace and an hour past it: a prune drops math's entry. */
  readonly prune?: boolean;
}

const CASES: Case[] = [
  { name: "a later cached discharge (13l S1)", cached: true },
  { name: "the one-discharge control" },
  { name: "10,050 later resolved moves (13q S1, count)", flood: 10_050 },
  { name: "two hours with no commit while held (13s B2)", clock: 2 * HOUR },
  { name: "a commit past the hour while held (13q S1 age, 13t S1)", clock: HOUR + 1, commit: true },
  { name: "a prune of its entry after the catch-up (falls back)", prune: true },
];

describe("status --wait over later discharges of its file (tasks 001-202, 001-258)", () => {
  it.each(CASES)("$name", SLOW, async (c) => {
    let shift = 0;
    const clock = () => Date.now() + shift;
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      runnerPartBesideRun: true,
      now: clock,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
    // As `Ledger.commit` records the moves when nothing else changed.
    const commit = () =>
      h.store.transaction(() =>
        recordMoves(h.store, h.worktreeId, [], [], h.scheduler.status().revision, clock(), BY),
      );
    const math = (): Record<string, unknown> => {
      const raw = h.store.meta.get(rekeyedMovesMetaKey(h.worktreeId));
      return raw === null ? {} : (JSON.parse(raw).files[MATH_ID]?.resolved ?? {});
    };
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

    const sync = captureSync(
      () => h.scheduler.status().revision,
      async (upTo) => {
        // Math's failure lands while strings' refinement is held.
        releaseRun();
        await expect.poll(mathFails, { timeout: 60_000 }).toBe(true);
        await expect.poll(() => math()[String(target)] ?? null).not.toBeNull();
        if (c.cached === true) {
          // Revision 5 restores CACHED: its stored failure resolves the move without a run.
          h.write(MATH, CACHED);
          await h.batch(MATH);
          expect(h.scheduler.status().revision).toBe(upTo + 1);
          await expect
            .poll(() => math()[String(upTo + 1)] ?? null, { timeout: 60_000 })
            .not.toBeNull();
        }
        if (c.flood !== undefined) {
          const marks = Array.from({ length: c.flood }, (_, n) => ({
            id: `later-${n}`,
            open: null,
            moved: upTo + 1,
          }));
          h.store.transaction(() =>
            recordMoves(h.store, h.worktreeId, marks, [], upTo, clock(), BY),
          );
        }
        if (c.clock !== undefined) {
          shift = c.clock;
          if (c.commit === true) commit();
          expect(math()[String(target)]).toBeDefined();
        }
        releaseRefinement();
        if (c.prune === true) {
          const refined = () => Number(h.store.meta.get(refinedMetaKey(h.worktreeId)));
          await expect.poll(refined, { timeout: 60_000 }).toBeGreaterThanOrEqual(upTo);
          await h.scheduler.idle();
          commit();
          shift = MOVES_RETENTION_MS + MOVES_GRACE_MS + 1;
          commit();
          expect(math()).toEqual({});
        }
      },
    );

    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    expect(mathFails()).toBe(true);
    expect(wait.outcome).toBe("news");
    if (c.prune === true) {
      // Never quiet: without the edit's files, any check's news ends the wait.
      expect(wait).toMatchObject({ transitions: 1 });
      expect(wait).not.toHaveProperty("edit");
      return;
    }
    expect(wait).toMatchObject({
      transitions: 1,
      edit: { testFiles: 3, otherTransitions: 0 },
    });
  });
});
