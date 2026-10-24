import { describe, expect, it } from "vitest";
import { publishedQuiet } from "../../src/core/scheduler/quiet.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  BACKLOG,
  BACKLOG_SOURCES,
  backlogPath,
  backlogRuns,
  backlogStarts,
  cancelBacklog,
  EDITED,
  editedCurrent,
  holdBacklog,
  type QuietSide,
  quietSide,
} from "./backlog-quiet-fixture.js";
import type { CatchUpFile, CatchUpRun } from "./catch-up-fixture.js";
import { pause, ref, SETTLE_MS, START_WITHIN_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-94, tests 4 and 6 of `tasks/011-82/design.md` row A (spec 011 C4
 * step 5 as amended 2026-10-21): the wait for quiet holds nothing but the
 * backlog's tiers after a cancel, so a daemon's start, `run --all`, a pull's
 * catch-up, a promoted file, the backlog's turn and a lane of slots run as
 * before; and an edit that finds its lane waiting starts at once, with no
 * cancel to wait for.
 */

/** No lane waits. The scheduler's clock is never moved here: whatever starts, starts during a wait. */
const noWait = (quiet: QuietSide) =>
  publishedQuiet(quiet.side.store, quiet.side.worktreeId, 0, quiet.now()).size === 0;

describe("what the wait for quiet leaves alone (row 011-94)", { timeout: 120_000 }, () => {
  it("4a: no wait follows a daemon's start, the first backlog tier of a `run --all` or a pull's catch-up", async () => {
    const quiet = await quietSide([], { policy: RUN_MISSING });
    const { side } = quiet;
    // The start's baseline ran every file, the backlog's in its tiers.
    expect(BACKLOG.every((f) => side.current(f.path))).toBe(true);
    expect(noWait(quiet)).toBe(true);

    let base = side.runner.runs.length;
    await side.scheduler.requestFullSuite({ force: true });
    // Forced, every file is queued, `E` among them: one tier of all 51.
    await expect
      .poll(() => side.runner.runs.slice(base).some((r) => r.files.length === 51), {
        timeout: START_WITHIN_MS,
      })
      .toBe(true);
    await side.scheduler.idle();

    base = side.runner.runs.length;
    await side.edit("watch", ...BACKLOG_SOURCES);
    await backlogStarts(side, base);
    await side.scheduler.idle();
    expect(BACKLOG.every((f) => side.current(f.path))).toBe(true);
    expect(noWait(quiet)).toBe(true);
  });

  it("4b: a promoted file and the backlog's turn after four tiers of an edit start during the wait", async () => {
    // 20 files an edit queues as its work: four tiers of 4, the backlog's turn, then the fifth.
    const work: CatchUpFile[] = Array.from({ length: 20 }, (_, i) => ({
      project: "w",
      path: `w/w${i}.test.ts`,
      ms: 1_000,
      imports: ["src/w.ts"],
    }));
    const quiet = await quietSide(work);
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    await cancelBacklog(quiet);
    gate.stop();
    expect(noWait(quiet)).toBe(false);

    await side.scheduler.promote([ref(backlogPath(7))], 60_000);
    await expect.poll(() => side.current(backlogPath(7)), { timeout: START_WITHIN_MS }).toBe(true);

    const turnAfter = side.runner.runs.length;
    await side.edit("watch", "src/w.ts");
    await expect
      .poll(() => work.every((f) => side.current(f.path)), { timeout: START_WITHIN_MS })
      .toBe(true);
    await pause(SETTLE_MS);
    // The turn, of the backlog's files, and no backlog tier once the edit's work is done.
    const turns = backlogRuns(side, turnAfter);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.files.length).toBeLessThanOrEqual(4);
    expect(noWait(quiet)).toBe(false);
  });

  it("4c: a lane of slots, whose runner cannot cancel, never waits", async () => {
    const SLOTS: CatchUpFile[] = Array.from({ length: 12 }, (_, i) => ({
      project: "n",
      path: `n/n${i}.test.ts`,
      ms: 300,
      realMs: 300,
      imports: [`src/n${i}.ts`],
    }));
    const quiet = await quietSide(SLOTS, {
      lane: (f) => (f.project === "n" ? "node-test" : "vitest"),
      backlogSlot: (f) => (f.project === "n" ? 1 : null),
      besideBacklog: (f) => f.project === "n",
      cancels: false,
    });
    const { side } = quiet;
    side.runner.hold();
    await side.edit("watch", "n.config.json");
    await expect.poll(() => side.runner.active, { timeout: START_WITHIN_MS }).toBeGreaterThan(0);
    // An edit's work in the lane while its slots run, which their runner does not cancel.
    await side.edit("watch", "src/n0.ts");
    side.runner.release();
    // The slots take the rest of the lane's backlog as they free, with no clock move.
    await expect
      .poll(() => SLOTS.every((f) => side.current(f.path)), { timeout: START_WITHIN_MS })
      .toBe(true);
    expect(noWait(quiet)).toBe(true);
  });

  it("6: an edit that finds its lane waiting starts at once, with no cancel to wait for", async () => {
    const quiet = await quietSide();
    const { side } = quiet;
    // A cancelled run ends 2 s after its cancel, as Vitest's forced cancel does after 1 s.
    const run = side.runner.run.bind(side.runner);
    side.runner.run = async (files, options) => {
      const report = await run(files, options);
      if (report.failure === "cancelled") await pause(2_000);
      return report;
    };
    const gate = holdBacklog(side.runner);
    const base = side.runner.runs.length;
    await side.edit("watch", "config.json");
    await expect.poll(() => backlogRuns(side, base).length, { timeout: START_WITHIN_MS }).toBe(1);

    const behindCancel = await editLatency(quiet);
    const cancelled = side.runner.runs.filter((r) => r.cancelled).length;
    expect(cancelled).toBe(1);

    const waiting = await editLatency(quiet);
    // Red before row 011-94: the backlog had started again, and this edit cancelled it.
    expect(side.runner.runs.filter((r) => r.cancelled).length).toBe(cancelled);
    expect(waiting + 1_000).toBeLessThanOrEqual(behindCancel);
    gate.stop();
  });
});

/** Edits `E`'s source: ms from the edit to the start of `E`'s run, once it is current. */
async function editLatency({ side }: QuietSide): Promise<number> {
  const before = side.runner.runs.length;
  const at = performance.now();
  await side.edit("watch", "src/e.ts");
  await editedCurrent(side);
  const run = side.runner.runs.slice(before).find((r: CatchUpRun) => holdsEdited(r));
  if (run === undefined) throw new Error("no run of E");
  return run.startedAt - at;
}

const holdsEdited = (run: CatchUpRun) => run.files.some((f) => f.path === EDITED.path);
