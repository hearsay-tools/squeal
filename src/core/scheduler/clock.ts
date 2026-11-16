import type { EpochMs } from "../types/common.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * scheduler's one clock. Every reading under `src/core/scheduler/` comes from
 * the clock in `SchedulerOptions.clock`; this file is the only one that reads
 * the host's. The arm/disarm is the one timer the wake loop (row 011-352,
 * `wakes.ts`) arms at the earliest wake.
 *
 * Row 011-369 (the human, 2026-11-16, "Timers: D: name both by purpose"):
 * the clock gives two readings, each named for what it answers. Calendar
 * time (`now`) answers "what time is it": stored times and times compared
 * with other daemons. Elapsed time (`elapsed`) answers "how long has it
 * been": every wake, kept by the wake loop. A change of the calendar clock
 * moves no wake.
 */

/** Cancels an armed timer; a second call, or one after it fired, does nothing. */
export type Disarm = () => void;

/**
 * Elapsed time: milliseconds from an origin of the clock's own, which never
 * goes back and which a calendar change does not move (`GLOSSARY.md`).
 */
export type ElapsedMs = number & { readonly __elapsed: true };

/** Time as an input: two readings and one timer. */
export interface Clock {
  /** Calendar time: milliseconds since the epoch, for stored and compared times. */
  now(): EpochMs;
  /** Elapsed time, for every wait: `arm` counts its delay in it. */
  elapsed(): ElapsedMs;
  /** Calls `fire` once, `ms` of elapsed time from now (at least 0); the returned function cancels it. */
  arm(ms: number, fire: () => void): Disarm;
}

/** A timer's largest delay: a longer one fires at once in Node, so it fires early and is read again. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** The host's wall clock, read at each call (a fake `Date` installed later is read). */
export const hostNow = (): EpochMs => Date.now();

/**
 * The host adapter: calendar readings from `now`, by default the host's wall
 * clock; elapsed time from `performance.now`, monotonic; `setTimeout` looked
 * up at each arm, so `vi.useFakeTimers` still works; the delay clamped to
 * 0..2^31-1 ms; the timer unref'd, so it never holds the process.
 */
export function hostClock(now: () => EpochMs = hostNow): Clock {
  return {
    now,
    elapsed: () => performance.now() as ElapsedMs,
    arm(ms, fire) {
      const timer = globalThis.setTimeout(fire, Math.min(Math.max(0, ms), MAX_TIMER_MS));
      timer.unref?.();
      return () => globalThis.clearTimeout(timer);
    },
  };
}

/** The clock `options` give: `clock`, else the host adapter. */
export function clockOf(options: { readonly clock?: Clock | undefined }): Clock {
  return options.clock ?? hostClock();
}
