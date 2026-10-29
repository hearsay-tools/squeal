import { describe, expect, it } from "vitest";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { B, E, heldWide, holdsP, P, paths, standings } from "./promoted-tier-fixture.js";
import { pause, ref, SETTLE_MS, START_WITHIN_MS } from "./tier-yields-fixture.js";

/*
 * Review `reviews/0.1.377.md` B1 (row 011-265, spec 011 C4 step 5 and C15
 * Rank), as row 011-268 amended it (2026-10-29): a tier of promoted files
 * only, a batch's, runs on for an edit's work while a file of it that has
 * not ended is in its batch, since its cut files would run again in their
 * batch's tier. A batch lasts past its wait's deadline until its files
 * settle, so the deadline changes nothing: an edit's work does not cancel
 * the tier, and a later wait's file does not cut it. Before row 011-268,
 * once P's promotion passed its deadline the tier was a backlog tier as
 * any. P's wait lasts `SHORT_MS`; the test moves the scheduler's clock
 * past it (`advance`).
 */
const SHORT_MS = 100;
/** A file of the backlog still queued behind the wide tier; B000 may have run beside X. */
const B099 = B[99] ?? "";

/** The runs after `wide`, in start order. */
const runsAfter = (side: CatchUpSide, wide: CatchUpRun) =>
  side.runner.runs.slice(side.runner.runs.indexOf(wide) + 1);

/** What status says of running P000: its standing, and the line a named wait reads. */
function runningLine(side: CatchUpSide) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const [file] = standingsOf(store, worktreeId, root, daemon, now)([ref(P[0] ?? "")]);
  if (file?.standing === undefined) throw new Error("no standing for P000");
  return { standing: file.standing, reason: nextStep(file.standing).reason };
}

/** What the running line of a file of the batch says while its tier runs (row 011-268). */
const BATCH = "in batch 1 of 1 (56 files), its tier estimated to end at";

describe("a batch's tier runs on past its wait's deadline (review 0.1.377 B1, row 011-268)", {
  timeout: 120_000,
}, () => {
  it.each([false, true])(
    "past P's deadline, a later wait's B099 does not cut it (an edit's work queued: %s)",
    async (withEdit) => {
      const { side, gate, wide } = await heldWide({ promoteMs: SHORT_MS });
      if (withEdit) {
        // E is no input of the tier: it does not cancel it, and runs beside it (row 011-269).
        await side.edit("watch", "src/e.ts");
        await expect.poll(() => side.current(E), { timeout: START_WITHIN_MS }).toBe(true);
        expect(wide.cancelled).toBe(false);
      }
      side.advance(SHORT_MS + 1);
      await side.scheduler.promote([ref(B099)], 60_000);
      // Before row 011-268, P's promotion had ended and B099 cut the tier. B099's one file of
      // 1 s now runs beside it (row 011-269), so nothing waits for the tier.
      await expect.poll(() => side.current(B099), { timeout: START_WITHIN_MS }).toBe(true);
      expect(wide.cancelled).toBe(false);
      expect(wide.endedAt).toBeNull();
      expect(standings(side)).toEqual([]);

      gate.stop();
      side.advance(BACKLOG_QUIET_MS);
      await side.scheduler.idle();
      expect(wide.completed.map((f) => f.path).toSorted()).toEqual(P);
      expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
    },
  );

  it("an edit's work runs beside it before and past P's deadline, and the line names the batch", async () => {
    const { side, gate, wide } = await heldWide({ promoteMs: SHORT_MS });
    await side.edit("watch", "src/e.ts");
    // Before row 011-269 E waited for the tier, and the running line said why (`named`).
    await expect.poll(() => side.current(E), { timeout: START_WITHIN_MS }).toBe(true);
    expect(runningLine(side).reason).toContain(BATCH);

    // Before row 011-268 the check at P's deadline cancelled the tier for E's work.
    side.advance(SHORT_MS + 1);
    await side.edit("watch", "src/e.ts");
    await expect.poll(() => side.current(E), { timeout: START_WITHIN_MS }).toBe(true);
    await pause(SETTLE_MS);
    expect(wide.cancelled).toBe(false);
    expect(wide.endedAt).toBeNull();
    const past = runningLine(side);
    expect(past.standing).toMatchObject({ kind: "running", batch: { position: 1, files: 56 } });
    expect(past.reason).toContain(BATCH);

    gate.stop();
    await side.scheduler.idle();
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
    expect(paths(runsAfter(side, wide)[0] as CatchUpRun)).toContain(E);
  });

  /*
   * Review `reviews/0.1.377.md` S1, as row 011-268 amended it: at 4 slots
   * the wide tier took 12 of P within the backlog's 120 s budget, and E
   * started in the 14th tier after it. A batch's tier has no budget but the
   * run's deadline: at 4 workers, 56 files of 31 s are about 457 s, under
   * 600 s, so it takes all 56, the edit does not cut it, and E starts
   * beside it at once (row 011-269).
   */
  it("at 4 slots, the batch's tier takes all 56 within the run's deadline; the edit's file starts beside it (S1)", async () => {
    const { side, gate, wide } = await heldWide({ hostSlots: 4 });
    expect(wide.workers).toBe(4);
    await side.edit("watch", "src/e.ts");
    // Row 011-269: E starts beside the tier, at once.
    await expect.poll(() => side.current(E), { timeout: START_WITHIN_MS }).toBe(true);
    expect(wide.cancelled).toBe(false);
    expect(wide.endedAt).toBeNull();
    gate.stop();
    await side.scheduler.idle();

    const later = runsAfter(side, wide);
    expect(later.some((run) => run.cancelled)).toBe(false);
    expect(later.some(holdsP)).toBe(false);
    expect(paths(later[0] as CatchUpRun)).toContain(E);
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
  });
});
