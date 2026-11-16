import { describe, expect, it } from "vitest";
import {
  CALENDAR_STEP_MS,
  CalendarSteps,
  steppedClock,
} from "../../src/core/scheduler/calendar-steps.js";
import { Claims, claimBoundMs } from "../../src/core/scheduler/claims.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { FocusedEntries } from "../../src/core/scheduler/focused-entries.js";
import { Promotions } from "../../src/core/scheduler/promotions.js";
import type { PublishedPromotion } from "../../src/core/scheduler/promotions-row.js";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  CATCHUP_QUIET_MS,
} from "../../src/core/scheduler/quiet.js";
import { SLOW_RELEASE_MS, SlowRelease } from "../../src/core/scheduler/slow-release.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import { remainder } from "../../src/core/scheduler/yield-waits.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { virtualClock } from "../helpers/virtual-clock.js";

/*
 * Row 011-377 (`tasks/011-377/notes.md`, "Design"): a wait that compares a
 * calendar time counts on elapsed time inside one daemon. The scheduler's
 * clock tells `CalendarSteps` each change of `calendar - elapsed`; each
 * owner moves the times it keeps by it (`shift`), and a stored stamp counts
 * from first sight (`local`, `since`). One case per owner, on the virtual
 * clock, the calendar set back 1 h and forward 1 h after its wait began:
 * each ends after its delay, not 1 ms sooner. Until 0.1.523 a set-back held
 * each about 1 h more and a set-forward ended it at once. The scheduler's
 * own wiring is `clock-port.test.ts` (the `edit` group) and
 * `calendar-steps-scheduler.test.ts`.
 */

const HOUR = 3_600_000;
const SHIFTS = [
  { shift: -HOUR, row: "set back 1 h" },
  { shift: HOUR, row: "set forward 1 h" },
];

/** A virtual clock under `CalendarSteps`, as the scheduler wraps its own; read once. */
function stepped() {
  const virtual = virtualClock(Date.now());
  const steps = new CalendarSteps();
  const clock = steppedClock(virtual, steps);
  clock.now();
  return { virtual, steps, clock };
}

const ref: TestFileRef = { project: "", path: "test/a.test.ts" };

describe("calendar steps (row 011-377)", () => {
  it("tells a change of calendar minus elapsed time of at least 100 ms, once, with the reading", () => {
    const { virtual, steps, clock } = stepped();
    const told: [number, number][] = [];
    steps.onStep((ms, at) => told.push([ms, at]));
    virtual.shiftCalendar(CALENDAR_STEP_MS - 1);
    virtual.advance(5_000);
    clock.now();
    expect(told).toEqual([]);
    virtual.shiftCalendar(-(CALENDAR_STEP_MS - 1) - HOUR);
    const at = clock.now();
    clock.now();
    expect(told).toEqual([[-HOUR, at]]);
    expect(steps.total).toBe(-HOUR);
  });

  it("moves a stored stamp by the steps since this daemon first saw it", () => {
    const { virtual, steps, clock } = stepped();
    expect(steps.local("revision", "1", 1_000 as EpochMs)).toBe(1_000);
    virtual.shiftCalendar(-HOUR);
    clock.now();
    expect(steps.local("revision", "1", 1_000 as EpochMs)).toBe(1_000 - HOUR);
    // A revision first seen after the step is in today's calendar already.
    expect(steps.local("revision", "2", 2_000 as EpochMs)).toBe(2_000);
    expect(steps.since(3_000 as EpochMs, 0)).toBe(3_000 - HOUR);
  });
});

describe("each wait counts on elapsed time across a calendar step (row 011-377)", () => {
  it.each(SHIFTS)(
    "a lane's quiet after a cancel and catch-up's quiet, the calendar $row",
    ({ shift }) => {
      const { virtual, steps, clock } = stepped();
      const published: number[][] = [];
      const quiet = new BacklogQuiet((ends, _at, catchUp) =>
        published.push([...ends.values(), ...catchUp.values()]),
      );
      steps.onStep((ms, at) => quiet.shift(ms, at));
      quiet.cancelled("a", clock.now());
      quiet.caughtUp("a", clock.now());
      const start = clock.now();
      virtual.shiftCalendar(shift);
      virtual.advance(BACKLOG_QUIET_MS - 1);
      expect(quiet.waits("a", clock.now())).toBe(true);
      // Status reads the ends again, in today's calendar.
      expect(published.at(-1)).toEqual([
        start + shift + BACKLOG_QUIET_MS,
        start + shift + CATCHUP_QUIET_MS,
      ]);
      virtual.advance(1);
      expect(quiet.waits("a", clock.now())).toBe(false);
      virtual.advance(CATCHUP_QUIET_MS - BACKLOG_QUIET_MS - 1);
      expect(quiet.catchUpWaits("a", clock.now())).toBe(true);
      virtual.advance(1);
      expect(quiet.catchUpWaits("a", clock.now())).toBe(false);
    },
  );

  it.each(SHIFTS)("a named wait's deadline, the calendar $row", ({ shift }) => {
    const { virtual, steps, clock } = stepped();
    let live: readonly PublishedPromotion[] = [];
    const promotions = new Promotions({
      now: clock.now,
      isRunning: () => false,
      publish: (batches) => {
        live = batches;
      },
    });
    const focused = new FocusedEntries();
    steps.onStep((ms) => {
      promotions.shift(ms);
      focused.shift(ms);
    });
    const until = clock.now() + 5_000;
    // Its file is not queued yet: the wait is kept until its deadline, as a new request's is.
    promotions.add([ref], until, () => false);
    focused.add(ref, ["a"], until);
    virtual.shiftCalendar(shift);
    virtual.advance(4_999);
    promotions.settle(() => false);
    expect(live.map((p) => p.until)).toEqual([until + shift]);
    expect(focused.waiting(clock.now())).toHaveLength(1);
    virtual.advance(1);
    promotions.settle(() => false);
    expect(live).toEqual([]);
    expect(focused.waiting(clock.now())).toEqual([]);
  });

  it.each(SHIFTS)(
    "the waiter's bound on another worktree's claim, the calendar $row",
    ({ shift }) => {
      const { virtual, steps, clock } = stepped();
      const context = { policy: { runner: { timeoutMs: 1_000 } } } as unknown as SchedulerContext;
      const claims = new Claims(context);
      steps.onStep((ms) => claims.shift(ms));
      const key = "k" as CheckKey;
      const bound = claimBoundMs(1_000);
      expect(claims.record(key, true, clock.now())).toBe(true);
      virtual.shiftCalendar(shift);
      virtual.advance(bound);
      expect(claims.record(key, true, clock.now())).toBe(true);
      virtual.advance(1);
      expect(claims.record(key, true, clock.now())).toBe(false);
    },
  );

  it.each(SHIFTS)("the slow release's idle bound, the calendar $row", async ({ shift }) => {
    const { virtual, steps, clock } = stepped();
    const wakes = new Wakes(clock);
    const released: string[] = [];
    const release = new SlowRelease({
      release: async (lane) => {
        released.push(lane);
      },
      lanes: () => [],
      now: () => clock.now(),
      closed: () => false,
      wakes,
    });
    steps.onStep((ms) => release.shift(ms));
    release.opened("slow:vitest");
    release.ended("slow:vitest");
    virtual.shiftCalendar(shift);
    // A re-arm after the step, as another lane's end makes, states the delay left.
    release.arm();
    await wakes.rest();
    expect(released).toEqual([]);
    virtual.advance(SLOW_RELEASE_MS - 1);
    await wakes.rest();
    expect(released).toEqual([]);
    virtual.advance(1);
    await wakes.rest();
    expect(released).toEqual(["slow:vitest"]);
  });

  it.each(SHIFTS)("a tier's estimated remainder, the calendar $row", ({ shift }) => {
    const { virtual, steps, clock } = stepped();
    const context = { now: clock.now, steps } as unknown as SchedulerContext;
    const tier = {
      files: [{ file: { id: "a", durationMs: 10_000 } }],
      ended: new Set(),
      startedAt: clock.now(),
      startedStep: steps.total,
    } as unknown as Tier;
    virtual.advance(4_000);
    virtual.shiftCalendar(shift);
    expect(remainder(context, tier)).toBe(6_000);
  });
});
