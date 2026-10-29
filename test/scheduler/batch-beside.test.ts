import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { BESIDE_LANE_PREFIX, isBesideLane } from "../../src/core/types/index.js";
import {
  batchesOf,
  E,
  FEW,
  FEW_SOURCE,
  heldBatch,
  P,
  P_LONGEST,
  paths,
  S,
} from "./batch-fixture.js";
import type { CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { CUT_WITHIN_MS, pause, ref, SETTLE_MS, START_WITHIN_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-269 (spec 011 C4 step 5 and C10 as amended 2026-10-29,
 * `research/named-wait-batches.md` Recommendation 2 and 3, done-when tests 3,
 * 4 and 5's first half): beside a running batch's tier, an edit's tier and
 * a later wait of at most 30 file-seconds start in the lane's second
 * instance (`BESIDE_LANE_PREFIX`), with no permit. An edit cancels the
 * batch's tier only when it changed an input of every unfinished file; an
 * edited batch file keeps its batch place and runs beside at its new key
 * (coordinator, request e3edd85b). The setup is `batch-fixture.ts`; the
 * batch's run stays held throughout, unless a test ends it.
 */

/** The runs after the batch's, in the lane's second instance. */
const besideRuns = (side: CatchUpSide, batch: CatchUpRun) =>
  side.runner.runs
    .slice(side.runner.runs.indexOf(batch) + 1)
    .filter((run) => isBesideLane(run.lane ?? ""));

describe("an edit's tier and a small later wait run beside a named wait's batch (spec 011 C4 step 5, row 011-269)", {
  timeout: 120_000,
}, () => {
  it("3. an edit of a file outside the batch starts beside it, and its result lands before the batch ends", async () => {
    const { side, gate, batch } = await heldBatch();
    await side.edit("watch", "src/e.ts");
    // Before row 011-269 E waited for the batch's tier to end.
    await expect.poll(() => side.current(E), { timeout: START_WITHIN_MS }).toBe(true);
    expect(batch.endedAt).toBeNull();
    expect(batch.cancelled).toBe(false);
    const [beside] = besideRuns(side, batch);
    expect(beside === undefined ? [] : paths(beside)).toEqual([E]);
    expect(beside?.lane).toBe(BESIDE_LANE_PREFIX);
    // An edit's tier: no grant, so no permit; its runs go to the second instance.
    expect(beside?.workers).toBeUndefined();
    expect(side.runner.released).not.toContain(BESIDE_LANE_PREFIX);

    gate.stop();
    await side.scheduler.idle();
    expect(batch.completed.map((f) => f.path).toSorted()).toEqual(P);
    // With no batch left in the lane, its second instance closes.
    expect(side.runner.released).toContain(BESIDE_LANE_PREFIX);
  });

  it("4. an edit of some of the batch's files: the tier runs on, they keep their place and run beside at their new keys", async () => {
    const { side, gate, beside, batch } = await heldBatch();
    beside.hold();
    await side.edit("watch", FEW_SOURCE);
    await expect
      .poll(() => besideRuns(side, batch).length, { timeout: START_WITHIN_MS })
      .toBeGreaterThan(0);
    await pause(SETTLE_MS);
    expect(batch.cancelled).toBe(false);
    expect(
      besideRuns(side, batch)
        .flatMap(paths)
        .every((path) => FEW.includes(path)),
    ).toBe(true);
    // They keep their batch for rank and status.
    const places = batchesOf(side);
    for (const path of FEW) expect(places.get(path)).toMatchObject({ position: 1, of: 1 });

    // The batch's run of them, at their old keys, ends first: it never counts as current.
    gate.stop();
    await expect.poll(() => batch.endedAt !== null, { timeout: START_WITHIN_MS }).toBe(true);
    await pause(SETTLE_MS);
    expect(P.filter((path) => !FEW.includes(path)).every((path) => side.current(path))).toBe(true);
    expect(FEW.filter((path) => side.current(path))).toEqual([]);

    // Their runs at their new keys give the verdict: beside, one tier at a time, and once the
    // batch's tier ended, in the lane as any edit's work.
    beside.stop();
    await side.scheduler.idle();
    expect(P.every((path) => side.current(path))).toBe(true);
    const ranBeside = besideRuns(side, batch).flatMap((run) => run.completed.map((f) => f.path));
    expect(ranBeside.length).toBeGreaterThan(0);
    expect(ranBeside.every((path) => FEW.includes(path))).toBe(true);
  });

  it("4. an edit that changes an input of every unfinished file of the batch cancels its tier", async () => {
    const { side, gate, batch } = await heldBatch();
    await side.edit("watch", "src/p.ts");
    await expect.poll(() => batch.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(batch.completed).toEqual([]);

    gate.stop();
    await expect
      .poll(() => P.every((path) => side.current(path)), { timeout: START_WITHIN_MS })
      .toBe(true);
    // The cancel made the lane wait for quiet, as any backlog tier's; the backlog starts after it.
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
  });

  it("5. a later wait of one file of 2 s starts beside the batch's tier", async () => {
    const { side, gate, batch } = await heldBatch();
    await side.scheduler.promote([ref(S)], 60_000);
    // Before row 011-269, in strict order, S waited for the 55 files' tier to end.
    await expect.poll(() => side.current(S), { timeout: START_WITHIN_MS }).toBe(true);
    expect(batch.endedAt).toBeNull();
    expect(batch.cancelled).toBe(false);
    expect(besideRuns(side, batch).map(paths)).toEqual([[S]]);

    gate.stop();
    await side.scheduler.idle();
    expect(paths(batch)).toEqual(P_LONGEST);
    expect(batch.completed.map((f) => f.path).toSorted()).toEqual(P);
  });
});
