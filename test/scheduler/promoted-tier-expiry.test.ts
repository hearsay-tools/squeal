import { describe, expect, it } from "vitest";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { B, E, heldWide, holdsP, P, paths, standings } from "./promoted-tier-fixture.js";
import { CUT_WITHIN_MS, holds, pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Review `reviews/0.1.377.md` B1 (row 011-265, spec 011 C4 step 5 and C15
 * Rank): a tier of promoted files only runs on for an edit's work only
 * while a file of it that has not ended has an open promotion, since its
 * cut files would then go back promoted and run first. Once the last such
 * promotion passes its deadline, it is a backlog tier as any: an edit's
 * work cancels it, and a later wait's file makes it yield as it would
 * without the edit. P is promoted for `SHORT_MS`, so the bound at that
 * deadline fires on the host's clock while the scheduler's stands still;
 * the test moves the scheduler's past it (`advance`).
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

describe("a promoted-only tier runs on for an edit only while a file of it has an open promotion (review 0.1.377 B1)", {
  timeout: 120_000,
}, () => {
  it.each([false, true])(
    "after P's promotion ends, a later wait's B099 cuts it (an edit's work queued: %s)",
    async (withEdit) => {
      const { side, gate, wide } = await heldWide({ promoteMs: SHORT_MS });
      if (withEdit) {
        // E is no input of the tier; while P's wait is open, it waits for the tier.
        await side.edit("watch", "src/e.ts");
        await pause(SETTLE_MS);
        expect(wide.cancelled).toBe(false);
        expect(standings(side)).toEqual(["named"]);
      }
      side.advance(SHORT_MS + 1);
      await side.scheduler.promote([ref(B099)], 60_000);
      // On db838e714, with the edit: the tier stood `named` and ran on.
      await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
      expect(standings(side)).not.toContain("named");

      gate.stop();
      side.advance(BACKLOG_QUIET_MS);
      await side.scheduler.idle();
      expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
      // B099 starts before any file of P runs again.
      const later = runsAfter(side, wide);
      const b = later.findIndex((run) => holds(run, B099));
      const p = later.findIndex(holdsP);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(p);
    },
  );

  it("with an edit's work alone, it stands named while P's wait is open, then an edit cancels it at the deadline", async () => {
    const { side, gate, wide } = await heldWide({ promoteMs: SHORT_MS });
    await side.edit("watch", "src/e.ts");
    await pause(SETTLE_MS);
    expect(wide.cancelled).toBe(false);
    const open = runningLine(side);
    expect(open.standing).toMatchObject({ kind: "running", yields: { kind: "named" } });
    expect(open.reason).toContain(
      "; the tier does not yield: it runs a file this wait or an earlier one selected",
    );

    // No event after this: the check at P's deadline cancels it, as any backlog tier an edit's work waits for.
    side.advance(SHORT_MS + 1);
    await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(standings(side)).not.toContain("named");
    expect(runningLine(side).standing).not.toMatchObject({ yields: { kind: "named" } });

    gate.stop();
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
    // The lane waited for quiet after the cancel; the edit's file was not held.
    expect(paths(runsAfter(side, wide)[0] as CatchUpRun)).toContain(E);
  });

  /*
   * Review `reviews/0.1.377.md` S1: the edit's file starts in the next tier
   * only when no promoted file that ranks before it is left and no turn of
   * the backlog is due. At 4 slots the wide tier takes 12 of P within the
   * wall budget. The 44 left rank before E (C15 Rank) and run in edit tiers
   * of `runner.tierSize`, with the backlog's turn after each four of them.
   * The edit's check does not cut the tier for P012: it is of the same
   * wait, and a promoted-only tier has its rank to beat from its start
   * (coordinator, reply to request 8b69856d). Without that, P012 tied with
   * the tier's files, the cut started it first (row 011-263), 12 files ran
   * again after the other 44, and E started in the 18th tier.
   */
  it("at 4 slots, an edit's file starts after the promoted files left and the turns between them, with no cut (S1)", async () => {
    const { side, gate, wide } = await heldWide({ hostSlots: 4, takes: 12 });
    await side.edit("watch", "src/e.ts");
    await pause(SETTLE_MS);
    expect(wide.cancelled).toBe(false);
    expect(standings(side)).toEqual(["named"]);
    gate.stop();
    await side.scheduler.idle();

    const later = runsAfter(side, wide);
    expect(later.some((run) => run.cancelled)).toBe(false);
    expect(paths(later[0] as CatchUpRun)).toEqual(P.slice(12, 16));
    const e = later.findIndex((run) => holds(run, E));
    // The 14th tier after the wide tier: 11 of P and the backlog's turn after the 4th and the 8th.
    expect(e).toBe(13);
    const before = later.slice(0, e);
    const ranP = before.flatMap(paths).filter((path) => P.includes(path));
    expect(ranP.toSorted()).toEqual(P.slice(12));
    expect(before.filter(holdsP)).toHaveLength(11);
    const turns = before.filter((run) => !holdsP(run));
    expect(turns.every((run) => run.files.every((f) => B.includes(f.path)))).toBe(true);
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
  });
});
