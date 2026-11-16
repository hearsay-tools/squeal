import { describe, expect, it } from "vitest";
import { CATCHUP_QUIET_MS, publishedWaits } from "../../src/core/scheduler/quiet.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { CatchUpFile, CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { FOUR_SHORT, importers, started, transitive } from "./edit-cut-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-153 (spec 011 C4 step 5 as amended 2026-10-23, the human,
 * `research/stored-nothing.md` finding 4): catch-up of an edit starts no
 * tier until 120 s pass with no revision that queues a file of its lane,
 * with no cancel; the edit's own tiers run at once, `squeal run --all` ends
 * the wait, and a lane of slots never waits. The edit-cut fixture: `src/a.ts`,
 * its namesake, six direct importers of which the cut keeps four, and files
 * that reach it through `src/hub.ts`. Row 011-368: the scheduler's clock
 * is virtual and moves only on `advance`, and each check reads at the
 * side's quiet point (`settle`).
 */

const A = "src/a.ts";
const OWN: CatchUpFile = { path: "src/a.test.ts", ms: 900, imports: [A] };
const DIRECT = importers("d", A, FOUR_SHORT);
const KEPT = [OWN, ...DIRECT.slice(0, 4)];
/** The two slow direct importers: only catch-up runs them, never an edit's tier. */
const DEMOTED = DIRECT.slice(4);
const FILES = [OWN, ...DIRECT, ...transitive("t", A, 12)];

/** The runs after `before` on the backlog's route: the pool's grant. */
const catchUpRuns = (side: CatchUpSide, before: number): CatchUpRun[] =>
  side.runner.runs.slice(before).filter((run) => run.workers !== undefined);

async function keptCurrent(side: CatchUpSide): Promise<void> {
  await settle(side);
  expect(KEPT.every((f) => side.current(f.path))).toBe(true);
}

const allCurrent = (side: CatchUpSide) => FILES.every((f) => side.current(f.path));

describe("catch-up of an edit waits for 120 s of quiet (row 011-153)", { timeout: 120_000 }, () => {
  it("runs the edit's own files at once and no catch-up tier until 120 s after the last edit", async () => {
    const { side } = await started(FILES, { clock: "virtual" });
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    await keptCurrent(side);
    await settle(side);
    // Red before row 011-153: the catch-up tier started right after the edit's.
    expect(catchUpRuns(side, before)).toEqual([]);
    expect(DEMOTED.some((f) => side.current(f.path))).toBe(false);
    const { catchUp } = publishedWaits(side.store, side.worktreeId as WorktreeId, 0, side.now());
    expect([...catchUp.values()]).toHaveLength(1);

    // Another edit 60 s on queues files of the lane: the wait starts again from it.
    side.advance(60_000);
    await side.edit("watch", A);
    await keptCurrent(side);
    side.advance(CATCHUP_QUIET_MS - 60_000);
    await settle(side);
    expect(catchUpRuns(side, before)).toEqual([]);

    side.advance(60_000);
    await settle(side);
    expect(catchUpRuns(side, before).length).toBeGreaterThan(0);
    expect(allCurrent(side)).toBe(true);
  });

  it("starts the catch-up at once on `run --all` during the wait", async () => {
    const { side } = await started(FILES, { clock: "virtual" });
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    await keptCurrent(side);
    await settle(side);
    expect(catchUpRuns(side, before)).toEqual([]);

    await side.scheduler.requestFullSuite();
    await settle(side);
    expect(catchUpRuns(side, before).length).toBeGreaterThan(0);
    expect(allCurrent(side)).toBe(true);
  });

  it("never holds a lane of slots, whose runner cannot cancel", async () => {
    const { side } = await started(FILES, {
      clock: "virtual",
      lane: () => "node-test",
      besideBacklog: () => true,
      backlogSlot: () => 1,
      cancels: false,
    });
    const before = side.runner.runs.length;
    await side.edit("watch", A);
    await settle(side);
    expect(catchUpRuns(side, before).length).toBeGreaterThan(0);
    expect(allCurrent(side)).toBe(true);
    expect(
      publishedWaits(side.store, side.worktreeId as WorktreeId, 0, side.now()).catchUp.size,
    ).toBe(0);
  });
});
