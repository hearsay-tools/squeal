import { describe, expect, it } from "vitest";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import type { VirtualClock } from "../helpers/virtual-clock.js";
import type { CatchUpRun } from "./catch-up-fixture.js";
import { besideRuns, H, hung, hungTier, MATES, overrunsOf, pathsOf } from "./overrun-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-419 (`research/run-width-design.md` section 3): the overrun rule
 * (row 011-399) counts from the tier's last progress, the later of its start
 * and its last ended file, not from its start. Counted from the start, a
 * narrow tier's files not yet started looked hung 60 s in, and tiers opened
 * beside backlog tiers in 9 of 10 runs. Each file was 5 ms last time, so the
 * threshold is the floor, `OVERRUN_FLOOR_MS`.
 */

const STEP_MS = 5_000;
const TIMEOUT_MS = 600_000;

/** The published overruns of the tier that holds H; the beside tier passes its own threshold too. */
const firstTier = (side: Parameters<typeof overrunsOf>[0]) =>
  overrunsOf(side).filter((o) => o.files.some((f) => f.path === H));

describe("the overrun rule counts from the tier's last progress (row 011-419)", {
  timeout: 120_000,
}, () => {
  it("a 60-file tier whose files end every 5 s runs 120 s with no overrun and no beside tier", async () => {
    const { side, hung, beside, tier, after, end } = await hungTier(5, 80, 60);
    const files = pathsOf(tier);
    expect(files).toHaveLength(60);
    for (let i = 0; i < 24; i += 1) {
      side.advance(STEP_MS);
      end(files[i] as string);
      await settle(side);
      expect(besideRuns(side, after)).toEqual([]);
      expect(overrunsOf(side)).toEqual([]);
    }
    expect(tier.endedAt).toBeNull();
    hung.stop();
    beside.stop();
  });

  it("a tier whose other files ended overruns the threshold after its last ended file", async () => {
    const { side, hung, beside, after, end } = await hungTier(5, 4);
    const start = side.now();
    side.advance(50_000);
    for (const mate of MATES) end(mate);
    await settle(side);
    const progress = side.now();
    expect(progress).toBe(start + 50_000);

    side.advance(OVERRUN_FLOOR_MS - 1);
    await settle(side);
    expect(besideRuns(side, after)).toEqual([]);
    expect(overrunsOf(side)).toEqual([]);

    side.advance(1);
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(1);
    const [overrun, ...others] = overrunsOf(side);
    expect(others).toEqual([]);
    // Its age and deadline still count from the tier's start; the threshold from its last end.
    expect(overrun).toMatchObject({ startedAt: start, at: progress + OVERRUN_FLOOR_MS });
    expect(overrun?.files.map((f) => f.path)).toEqual([H]);
    hung.stop();
    beside.stop();
  });

  it("the last end moves with a calendar step, as the start does (row 011-377)", async () => {
    const { side, hung, beside, after, end } = await hungTier(5, 4);
    const clock = side.clock as VirtualClock;
    side.advance(50_000);
    for (const mate of MATES) end(mate);
    await settle(side);
    const progress = side.now();
    const shift = -3_600_000;
    clock.shiftCalendar(shift);
    side.advance(OVERRUN_FLOOR_MS - 1);
    await settle(side);
    expect(besideRuns(side, after)).toEqual([]);

    side.advance(1);
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(1);
    expect(overrunsOf(side)[0]?.at).toBe(progress + shift + OVERRUN_FLOOR_MS);
    hung.stop();
    beside.stop();
  });

  it("review 0.1.576 B2: a file end withdraws a published overrun; it returns a threshold after the last end", async () => {
    const { side, hung: gate, beside, after, end, start } = await hung();
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(1);
    expect(overrunsOf(side).map((o) => o.at)).toEqual([start + OVERRUN_FLOOR_MS]);

    side.advance(STEP_MS);
    for (const mate of MATES) end(mate);
    await settle(side);
    const progress = side.now();
    expect(overrunsOf(side)).toEqual([]);
    // The tier beside it runs on, and no third instance opens.
    expect(besideRuns(side, after)).toHaveLength(1);
    expect(besideRuns(side, after)[0]?.endedAt).toBeNull();

    side.advance(OVERRUN_FLOOR_MS - 1);
    await settle(side);
    expect(firstTier(side)).toEqual([]);
    side.advance(1);
    await settle(side);
    const [overrun, ...others] = firstTier(side);
    expect(others).toEqual([]);
    expect(overrun).toMatchObject({
      startedAt: start,
      at: progress + OVERRUN_FLOOR_MS,
      deadline: start + TIMEOUT_MS,
      laneWaits: "either",
    });
    expect(overrun?.files.map((f) => f.path)).toEqual([H]);
    expect(besideRuns(side, after)).toHaveLength(1);
    expect(side.runner.runs.slice(after)).toHaveLength(2);
    gate.stop();
    beside.stop();
  });

  it("a progressing beside tier's overrun is withdrawn; the first tier's stays", async () => {
    const { side, hung: gate, beside, after, end } = await hung();
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const besidePaths = pathsOf(besideRuns(side, after)[0] as CatchUpRun);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(overrunsOf(side)).toHaveLength(2);

    side.advance(STEP_MS);
    for (const path of besidePaths.slice(1)) end(path);
    await settle(side);
    const progress = side.now();
    const [first, ...others] = overrunsOf(side);
    expect(others).toEqual([]);
    expect(first?.files.map((f) => f.path).toSorted()).toEqual([H, ...MATES].toSorted());

    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const back = overrunsOf(side).find((o) => o.files.some((f) => f.path === besidePaths[0]));
    expect(back?.at).toBe(progress + OVERRUN_FLOOR_MS);
    expect(back?.files.map((f) => f.path)).toEqual([besidePaths[0]]);
    expect(side.runner.runs.slice(after)).toHaveLength(2);
    gate.stop();
    beside.stop();
  });
});
