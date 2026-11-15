import type { EpochMs } from "../types/common.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * scheduler's one clock. Every reading under `src/core/scheduler/` comes from
 * the clock in `SchedulerOptions.clock`; this file is the only one that reads
 * the host's. The arm/disarm is the one timer the wake loop (row 011-352,
 * `wakes.ts`) arms at the earliest wake.
 */

/** Cancels an armed timer; a second call, or one after it fired, does nothing. */
export type Disarm = () => void;

/** Time as an input: a reading and one timer. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): EpochMs;
  /** Calls `fire` once, `ms` from now (at least 0); the returned function cancels it. */
  arm(ms: number, fire: () => void): Disarm;
  /**
   * Row 011-352: the steady time `arm` counts its delay in, in milliseconds
   * from any origin; absent, `now`. The wake loop measures when a wake is
   * due on it, so a `now` that does not follow the host's time (a test's
   * fixed reading) still fires each wake after its delay, as each owner's
   * own timer did.
   */
  ticks?(): number;
}

/** A timer's largest delay: a longer one fires at once in Node, so it fires early and is read again. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** The host's wall clock, read at each call (a fake `Date` installed later is read). */
export const hostNow = (): EpochMs => Date.now();

/**
 * The host adapter: readings from `now`, by default the host's wall clock;
 * `setTimeout` looked up at each arm, so `vi.useFakeTimers` still works; the
 * delay clamped to 0..2^31-1 ms; the timer unref'd, so it never holds the process.
 */
export function hostClock(now: () => EpochMs = hostNow): Clock {
  return {
    now,
    ticks: () => performance.now(),
    arm(ms, fire) {
      const timer = globalThis.setTimeout(fire, Math.min(Math.max(0, ms), MAX_TIMER_MS));
      timer.unref?.();
      return () => globalThis.clearTimeout(timer);
    },
  };
}

/** The clock `options` give: `clock`, else the host adapter over `now` (its shorthand). */
export function clockOf(options: {
  readonly clock?: Clock | undefined;
  readonly now?: (() => EpochMs) | undefined;
}): Clock {
  return options.clock ?? hostClock(options.now);
}

/** `later - earlier`, at least 0: a difference once read on a steady clock never goes back. */
export function elapsed(earlier: EpochMs, later: EpochMs): number {
  return Math.max(0, later - earlier);
}
