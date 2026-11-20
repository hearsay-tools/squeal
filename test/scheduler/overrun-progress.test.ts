import { describe, expect, it } from "vitest";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import type { VirtualClock } from "../helpers/virtual-clock.js";
import { besideRuns, H, hungTier, MATES, overrunsOf, pathsOf } from "./overrun-fixture.js";
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
});
