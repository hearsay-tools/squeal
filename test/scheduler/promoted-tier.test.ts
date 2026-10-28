import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import type { CatchUpRun } from "./catch-up-fixture.js";
import {
  B,
  E,
  heldWide,
  holdsP,
  holdX,
  P,
  paths,
  promotedBehindEdit,
  standings,
  X,
} from "./promoted-tier-fixture.js";
import { CUT_WITHIN_MS, heldRun, pause, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-265 (gh-79, gh-121; spec 011 C4 step 5 as amended 2026-10-28,
 * `research/issue-79-gate.md` option B): while no edit's work is queued, a
 * tier of promoted files only is sized as the backlog's (the wall budget at
 * the grant) instead of `runner.tierSize`. While a file of it has an open
 * promotion, only a revision that supersedes such a tier cancels it; an
 * edit's work waits for it to end (coordinator, 2026-10-28; review
 * `reviews/0.1.377.md` B1). The setup is `promoted-tier-fixture.ts`.
 */
describe("a tier of promoted files only is sized as the backlog's (spec 011 C4 step 5, row 011-265)", {
  timeout: 120_000,
}, () => {
  it("56 promoted files beside a backlog run in one wide tier at the grant", async () => {
    const { side, gate, after } = await promotedBehindEdit(holdX);
    gate.stop();
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(after);
    // On main: 14 tiers of 4 (`runner.tierSize`), each an edit's, with no grant.
    expect(runs.filter(holdsP)).toHaveLength(1);
    const [wide] = runs;
    expect(paths(wide as CatchUpRun).toSorted()).toEqual(P);
    expect(wide?.workers).toBeGreaterThan(1);
    expect([...P, ...B, X].every((path) => side.current(path))).toBe(true);
  });

  it("with an edit's work queued, promoted files still run in tiers of runner.tierSize", async () => {
    const { side, gate, after } = await promotedBehindEdit(holdX);
    await side.edit("watch", "src/e.ts");
    gate.stop();
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(after).filter(holdsP);
    expect(runs.flatMap(paths).toSorted()).toEqual(P);
    for (const run of runs) {
      expect(run.files.length).toBeLessThanOrEqual(4);
      expect(run.workers).toBeUndefined();
    }
    expect([...P, E].every((path) => side.current(path))).toBe(true);
  });

  it("an edit's work waits for it to end, then starts in the next tier", async () => {
    const { side, gate, wide } = await heldWide();
    // E is no input of the tier; on an edit's tier, its 31 s remainder would make it yield.
    await side.edit("watch", "src/e.ts");
    await pause(SETTLE_MS);
    expect(wide.cancelled).toBe(false);
    expect(wide.endedAt).toBeNull();
    // P's wait is open: the tier runs files it selected (review `reviews/0.1.377.md` B1).
    expect(standings(side)).toEqual(["named"]);

    gate.stop();
    await side.scheduler.idle();
    expect(wide.completed.map((f) => f.path).toSorted()).toEqual(P);
    const next = side.runner.runs[side.runner.runs.indexOf(wide) + 1];
    expect(next === undefined ? [] : paths(next)).toContain(E);
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
  });

  it("an edit that changes an input of every unfinished file cancels it", async () => {
    const { side, gate, wide } = await heldWide();
    await side.edit("watch", "src/p.ts");
    await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(wide.completed).toEqual([]);

    gate.stop();
    // The cancel made the lane wait for quiet; the backlog starts once it ends.
    await expect
      .poll(() => P.every((path) => side.current(path)), { timeout: CUT_WITHIN_MS })
      .toBe(true);
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
    expect([...P, ...B].every((path) => side.current(path))).toBe(true);
  });

  it("a wait for quiet after its cancel does not hold the next promoted-only tier", async () => {
    const { side, gate, wide } = await heldWide();
    // The environment changes an input of every file of the tier and queues no edit's work.
    await side.edit("watch", "config.json");
    await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    const again = await heldRun(side, P[0] ?? "", side.runner.runs.indexOf(wide) + 1);
    expect(paths(again).toSorted()).toEqual(P);
    gate.stop();
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
    expect([...P, ...B].every((path) => side.current(path))).toBe(true);
  });
});
