import { describe, expect, it } from "vitest";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  CATCHUP_QUIET_MS,
  publishedWaits,
} from "../../src/core/scheduler/quiet.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { CatchUpFile, CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { FOUR_SHORT, importers, started, transitive } from "./edit-cut-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 024-01 (spec 024 D1): a named wait on a source path whose selection
 * passes the promotion cap asks the daemon to end the waits for catch-up
 * quiet (`wakeCatchUp`), so the selected files leave catch-up's 120 s wait;
 * the waits after a cancel stay. A selection within the cap is promoted,
 * catch-up files included, and runs at once. The fixture is
 * `catch-up-quiet.test.ts`'s: `src/a.ts`, its namesake, six direct
 * importers of which the cut keeps four, and twelve files through a hub.
 */

const at = (ms: number) => ms as EpochMs;

describe("BacklogQuiet.endCatchUp", () => {
  it("ends every catch-up wait and keeps the waits after a cancel", () => {
    const told: [number, number][] = [];
    const quiet = new BacklogQuiet((ends, _at, catchUp) => told.push([ends.size, catchUp.size]));
    quiet.cancelled("vitest", at(0));
    quiet.caughtUp("vitest", at(0));
    quiet.caughtUp("node-test", at(0));

    quiet.endCatchUp(at(1_000));

    expect(quiet.catchUpWaits("vitest", at(1_000))).toBe(false);
    expect(quiet.catchUpWaits("node-test", at(1_000))).toBe(false);
    expect(quiet.waits("vitest", at(1_000))).toBe(true);
    expect(quiet.ends(at(1_000)).get("vitest")).toBe(BACKLOG_QUIET_MS);
    expect(told.at(-1)).toEqual([1, 0]);
  });

  it("publishes nothing when no catch-up waits", () => {
    let told = 0;
    const quiet = new BacklogQuiet(() => told++);
    quiet.cancelled("vitest", at(0));
    const before = told;

    quiet.endCatchUp(at(1_000));

    expect(told).toBe(before);
    expect(quiet.waits("vitest", at(1_000))).toBe(true);
  });

  it("a later edit starts the catch-up wait again", () => {
    const quiet = new BacklogQuiet();
    quiet.caughtUp("vitest", at(0));
    quiet.endCatchUp(at(10));

    quiet.caughtUp("vitest", at(20));

    expect(quiet.catchUpEnds(at(20)).get("vitest")).toBe(20 + CATCHUP_QUIET_MS);
  });
});

const A = "src/a.ts";
const OWN: CatchUpFile = { path: "src/a.test.ts", ms: 900, imports: [A] };
const DIRECT = importers("d", A, FOUR_SHORT);
const KEPT = [OWN, ...DIRECT.slice(0, 4)];
/** The two slow direct importers: only catch-up runs them, never an edit's tier. */
const DEMOTED = DIRECT.slice(4);
const FILES = [OWN, ...DIRECT, ...transitive("t", A, 12)];
const ref = (file: CatchUpFile): TestFileRef => ({ project: "", path: file.path as never });

const catchUpRuns = (side: CatchUpSide, before: number): CatchUpRun[] =>
  side.runner.runs.slice(before).filter((run) => run.workers !== undefined);
const catchUpEnds = (side: CatchUpSide) =>
  publishedWaits(side.store, side.worktreeId as WorktreeId, 0, side.now()).catchUp;

/** An edit of `src/a.ts` whose catch-up waits: its kept files current, the rest held. */
async function editHeld(side: CatchUpSide): Promise<number> {
  const before = side.runner.runs.length;
  await side.edit("watch", A);
  await settle(side);
  expect(KEPT.every((f) => side.current(f.path))).toBe(true);
  expect(catchUpRuns(side, before)).toEqual([]);
  expect(DEMOTED.some((f) => side.current(f.path))).toBe(false);
  expect(catchUpEnds(side).size).toBe(1);
  return before;
}

describe("a source wait's promotion and wake (row 024-01)", { timeout: 120_000 }, () => {
  it("within the cap: the promoted catch-up files run at once, before 120 s", async () => {
    const { side } = await started(FILES, { clock: "virtual" });
    await editHeld(side);

    await side.scheduler.promote(FILES.map(ref), 60_000);
    await settle(side);

    // The daemon ran promoted catch-up files before; row 024-01 makes a source wait send them.
    expect(FILES.every((f) => side.current(f.path))).toBe(true);
  });

  it("past the cap: `wakeCatchUp` starts the held catch-up at once", async () => {
    const { side } = await started(FILES, { clock: "virtual" });
    const before = await editHeld(side);

    await side.scheduler.promote([ref(OWN)], 60_000, true);
    await settle(side);

    expect(catchUpEnds(side).size).toBe(0);
    expect(catchUpRuns(side, before).length).toBeGreaterThan(0);
    expect(FILES.every((f) => side.current(f.path))).toBe(true);
  });

  it("without `wakeCatchUp` the catch-up keeps waiting", async () => {
    const { side } = await started(FILES, { clock: "virtual" });
    const before = await editHeld(side);

    await side.scheduler.promote([ref(OWN)], 60_000);
    await settle(side);

    expect(catchUpEnds(side).size).toBe(1);
    expect(catchUpRuns(side, before)).toEqual([]);
  });
});
