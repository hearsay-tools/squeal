import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import {
  BACKLOG,
  backlogRuns,
  backlogStarts,
  cancelBacklog,
  DOCS,
  editedCurrent,
  holdBacklog,
  quietSide,
} from "./backlog-quiet-fixture.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-94, tests 1, 2, 3 and 5 of `tasks/011-82/design.md` row A (spec
 * 011 C4 step 5 and the checkpoint paragraph as amended 2026-10-21): after
 * an edit cancels a lane's backlog tier, the lane starts no backlog tier
 * until 20 s pass with no revision that queues a file of it; `run --all`
 * ends the wait. Before it, the backlog restarted right after the edit's
 * tier, and the next edit of a burst cancelled it again (squeal: 95 such
 * tiers in 24 hours picked 9,078 files and stored 870). Row 011-368: on
 * the virtual clock, each check reads at the side's quiet point (`settle`).
 */

/** Less than the quiet. */
const WITHIN = BACKLOG_QUIET_MS / 2;

const VIRTUAL = { clock: "virtual" } as const;

describe("a lane waits for quiet after its backlog tier's cancel (row 011-94)", {
  timeout: 120_000,
}, () => {
  it("1: no backlog tier starts until 20 s pass with no revision; then one starts", async () => {
    const quiet = await quietSide([], VIRTUAL);
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    const after = await cancelBacklog(quiet);

    await settle(side);
    // Red before row 011-94: the backlog's tier started again right after the edit's.
    expect(backlogRuns(side, after)).toEqual([]);

    quiet.advance(BACKLOG_QUIET_MS);
    await backlogStarts(side, after);
    gate.stop();
    await settle(side);
    expect(BACKLOG.every((f) => side.current(f.path))).toBe(true);
  });

  it("2: a burst of edits every 10 s for 60 s runs each edit at once and no backlog tier until 20 s after the last", async () => {
    const quiet = await quietSide([], VIRTUAL);
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    const after = await cancelBacklog(quiet);

    for (let edit = 1; edit <= 6; edit++) {
      quiet.advance(10_000);
      await side.edit("watch", "src/e.ts");
      await editedCurrent(side);
      expect(backlogRuns(side, after)).toEqual([]);
    }
    quiet.advance(WITHIN);
    await settle(side);
    expect(backlogRuns(side, after)).toEqual([]);

    quiet.advance(BACKLOG_QUIET_MS - WITHIN);
    await backlogStarts(side, after);
    gate.stop();
    await settle(side);
  });

  it("3: a revision that queues no file of the lane leaves the wait; one that queues a file of it starts it again", async () => {
    const NODE: CatchUpFile = { project: "n", path: "n/n.test.ts", ms: 1, imports: ["src/n.ts"] };
    const quiet = await quietSide([NODE], {
      ...VIRTUAL,
      lane: (ref) => (ref.project === "n" ? "node-test" : "vitest"),
    });
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    const first = await cancelBacklog(quiet);

    // A `docs/` edit and a node:test file's edit in a mixed repository queue nothing in the lane.
    quiet.advance(WITHIN);
    await side.edit("watch", DOCS);
    await side.edit("watch", "src/n.ts");
    await settle(side);
    expect(side.current(NODE.path)).toBe(true);
    expect(backlogRuns(side, first)).toEqual([]);
    quiet.advance(BACKLOG_QUIET_MS - WITHIN);
    await backlogStarts(side, first);

    // The started tier, held, is cancelled by the next edit; an edit of the lane during the wait starts it again.
    const second = side.runner.runs.length;
    await side.edit("watch", "src/e.ts");
    await editedCurrent(side);
    quiet.advance(WITHIN);
    await side.edit("watch", "src/e.ts");
    await editedCurrent(side);
    quiet.advance(BACKLOG_QUIET_MS - WITHIN);
    await settle(side);
    expect(backlogRuns(side, second)).toEqual([]);
    quiet.advance(WITHIN);
    await backlogStarts(side, second);
    gate.stop();
    await settle(side);
  });

  it("5: `run --all` during a wait starts the backlog's tier at once, and a later cancel starts a new wait", async () => {
    const quiet = await quietSide([], VIRTUAL);
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    const first = await cancelBacklog(quiet);

    await side.scheduler.requestFullSuite();
    await backlogStarts(side, first);

    const base = side.runner.runs.length;
    await side.edit("watch", "src/e.ts");
    await editedCurrent(side);
    await settle(side);
    expect(backlogRuns(side, base).filter((run) => !run.cancelled)).toEqual([]);
    quiet.advance(BACKLOG_QUIET_MS);
    await settle(side);
    expect(backlogRuns(side, base).filter((run) => !run.cancelled).length).toBeGreaterThan(0);
    gate.stop();
    await settle(side);
    expect(BACKLOG.every((f) => side.current(f.path))).toBe(true);
  });
});
