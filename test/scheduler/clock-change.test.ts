import { describe, expect, it } from "vitest";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { RunnerPartBound } from "../../src/core/scheduler/runner-work-bound.js";
import { SlotRecords } from "../../src/core/scheduler/slot-records.js";
import { WAKE_ORDER } from "../../src/core/scheduler/step-events.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import { virtualClock } from "../helpers/virtual-clock.js";

/*
 * Row 011-369 (the human, 2026-11-16, "Timers: D: name both by purpose";
 * review `0.1.520.md` S1): every wake is kept on elapsed time, so a change
 * of the calendar clock, either way, moves no wait. S1's probe: a runner
 * call with a 400 ms bound and a finished slot's 25 ms gather, across a
 * calendar set back 1 h; the one-calendar-clock candidate held both for
 * about 1 h.
 */

const HOUR = 3_600_000;

/** Lets the work started so far reach its next wait. */
const turns = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("a calendar change moves no wait (row 011-369, review 0.1.520 S1)", () => {
  it.each([
    { shift: -HOUR, row: "set back 1 h" },
    { shift: HOUR, row: "set forward 1 h" },
  ])(
    "a held runner call's 400 ms bound ends after 400 ms, the calendar $row",
    async ({ shift }) => {
      const clock = virtualClock(Date.now());
      const bound = new RunnerPartBound(400, new Wakes(clock));
      const outcome = bound.call(() => new Promise<never>(() => {})).catch((e: Error) => e.message);
      clock.shiftCalendar(shift);
      clock.advance(399);
      await turns();
      let ended = false;
      void outcome.then(() => {
        ended = true;
      });
      await turns();
      expect(ended).toBe(false);
      clock.advance(1);
      await expect(outcome).resolves.toBe("no answer within 400 ms; the call was abandoned");
      expect(clock.armed).toBe(0);
    },
  );

  it.each([
    { shift: -HOUR, row: "set back 1 h" },
    { shift: HOUR, row: "set forward 1 h" },
  ])(
    "a finished slot is committed after its 25 ms gather, the calendar $row",
    async ({ shift }) => {
      const clock = virtualClock(Date.now());
      const wakes = new Wakes(clock);
      const commits: string[][] = [];
      let open: string[] = [];
      const slots = new SlotRecords<string, string>({
        lock: new Mutex(() => clock.now()),
        record: async (ended) => {
          open.push(ended);
          return `recorded ${ended}`;
        },
        commit: () => {
          commits.push(open);
          open = [];
        },
        wakes,
      });
      const recorded = slots.record(Promise.resolve("a"));
      // The gather waits for its wake, a named wait: the loop rests with it stated.
      const rest = await wakes.rest();
      expect(rest.next?.reason).toBe("slot-gather");
      clock.shiftCalendar(shift);
      clock.advance(24);
      await turns();
      expect(commits).toEqual([]);
      clock.advance(1);
      await expect(recorded).resolves.toBe("recorded a");
      expect(commits).toEqual([["a"]]);
    },
  );

  it.each([
    { shift: -HOUR, row: "set back 1 h" },
    { shift: HOUR, row: "set forward 1 h" },
  ])(
    "every owner's wake fires after its delay, once, on one timer; the calendar $row",
    ({ shift }) => {
      const clock = virtualClock(Date.now());
      let arms = 0;
      const counted = {
        now: () => clock.now(),
        elapsed: () => clock.elapsed(),
        arm: (ms: number, fire: () => void) => {
          arms += 1;
          return clock.arm(ms, fire);
        },
      };
      const wakes = new Wakes(counted);
      const start = clock.elapsed();
      const fired: [string, number][] = [];
      WAKE_ORDER.forEach((reason, i) => {
        wakes
          .slot(reason, () => fired.push([reason, clock.elapsed() - start]))
          .after((i + 1) * 100);
      });
      clock.shiftCalendar(shift);
      for (let ms = 1; ms <= WAKE_ORDER.length * 100; ms++) {
        clock.advance(1);
        expect(clock.armed).toBeLessThanOrEqual(1);
      }
      expect(fired).toEqual(WAKE_ORDER.map((reason, i) => [reason, (i + 1) * 100]));
      // One arm per wake: no early pass that fires nothing and arms again, no wake lost.
      expect([arms, clock.armed]).toEqual([WAKE_ORDER.length, 0]);
    },
  );

  it("a wake stated after the calendar was set back still fires after its delay, and re-arms the timer", () => {
    const clock = virtualClock(Date.now());
    const wakes = new Wakes(clock);
    const fired: string[] = [];
    wakes.slot("pump", () => fired.push("pump")).after(1_000);
    clock.advance(100);
    clock.shiftCalendar(-HOUR);
    // An earlier wake stated now: the one timer moves to it.
    wakes.slot("claims", () => fired.push("claims")).after(250);
    expect(clock.armed).toBe(1);
    clock.advance(249);
    expect(fired).toEqual([]);
    clock.advance(1);
    expect(fired).toEqual(["claims"]);
    clock.advance(649);
    expect(fired).toEqual(["claims"]);
    clock.advance(1);
    expect(fired).toEqual(["claims", "pump"]);
    expect(clock.armed).toBe(0);
  });

  it("a rest reports each wake's calendar time from the calendar now: a reader that moves the clock by it reaches it", async () => {
    const clock = virtualClock(Date.now());
    const wakes = new Wakes(clock);
    wakes.slot("pump", () => {}).after(500);
    clock.shiftCalendar(-HOUR);
    const rest = await wakes.rest();
    expect(rest.next).toEqual({ reason: "pump", at: clock.now() + 500 });
  });
});
