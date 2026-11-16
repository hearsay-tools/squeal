import { describe, expect, it } from "vitest";
import { CalendarSteps, steppedClock } from "../../src/core/scheduler/calendar-steps.js";
import type { Clock } from "../../src/core/scheduler/clock.js";
import { virtualClock } from "../helpers/virtual-clock.js";

/*
 * Row 011-377, review `reviews/0.1.524.md` S1: the host can deschedule the
 * thread between the calendar reading and the elapsed reading of one
 * sample, so ordinary time passes between them. The stepped clock reads
 * the calendar between two elapsed readings and leaves out a sample wider
 * than `SURE_SAMPLE_MS`: such a pause is not told as a calendar step.
 */

const HOUR = 3_600_000;

describe("S1: a pause between the two readings of one sample is not a step", () => {
  // Each sample reads elapsed time before and after the calendar: readings 2 and 4 follow a calendar reading.
  it.each([1, 2, 3, 4])("time passes inside elapsed reading %i of two samples", (nth) => {
    const virtual = virtualClock(10_000_000);
    const steps = new CalendarSteps();
    let elapsedReads = Number.NEGATIVE_INFINITY;
    const inner: Clock = {
      now: () => virtual.now(),
      elapsed: () => {
        elapsedReads += 1;
        // The host deschedules the thread for 200 ms: both readings move together.
        if (elapsedReads === nth) virtual.advance(200);
        return virtual.elapsed();
      },
      arm: (ms, fire) => virtual.arm(ms, fire),
    };
    const clock = steppedClock(inner, steps);
    clock.now();
    const told: number[] = [];
    steps.onStep((ms) => told.push(ms));
    elapsedReads = 0;
    clock.now();
    clock.now();
    expect(told).toEqual([]);
    // A real step is still told.
    virtual.shiftCalendar(-HOUR);
    clock.now();
    expect(told).toEqual([-HOUR]);
  });
});
