import type { EpochMs } from "../types/common.js";
import type { Clock } from "./clock.js";

/*
 * Row 011-377 (`tasks/011-377/notes.md`, "Design"): waits that compare a
 * calendar time count on elapsed time inside one daemon. The scheduler's
 * clock reads elapsed time beside each calendar reading. A change of
 * `calendar - elapsed` is a calendar step: the clock was set back or
 * forward. Each owner of a wait adds the step to the calendar times it
 * keeps for its own waits, so the calendar end minus the calendar now
 * stays the elapsed time left. A stamp an owner reads from the store (a
 * revision's `createdAt`) counts from when this daemon first saw it
 * (`local`). Stored stamps are not changed: other processes read them.
 */

/**
 * The least change of `calendar - elapsed` that is a calendar step. The two
 * host readings differ by about 1 ms (`Date.now` is whole milliseconds), and
 * NTP slews both under 128 ms and steps the calendar only above it.
 */
export const CALENDAR_STEP_MS = 100;

/** The calendar steps one scheduler's clock saw, and the owners it tells. */
export class CalendarSteps {
  /** `calendar - elapsed` as of the last step; `null` before the first reading. */
  #offset: number | null = null;
  #total = 0;
  readonly #listeners = new Set<(ms: number, at: EpochMs) => void>();
  /** What `local` saw first, by kind: the stamp's id and `total` then. */
  readonly #seen = new Map<string, { readonly id: string; readonly mark: number }>();

  /** The sum of the steps seen: a stamp kept from before a step is behind by the steps after it. */
  get total(): number {
    return this.#total;
  }

  /**
   * Tells `shift` each step, in ms (back when negative), with the calendar
   * reading that saw it, until the returned function is called.
   */
  onStep(shift: (ms: number, at: EpochMs) => void): () => void {
    this.#listeners.add(shift);
    return () => this.#listeners.delete(shift);
  }

  /** A pair of readings: a step since the last one is told to each listener before this returns. */
  observe(calendar: EpochMs, elapsed: number): void {
    const offset = calendar - elapsed;
    if (this.#offset === null) {
      this.#offset = offset;
      return;
    }
    const ms = Math.round(offset - this.#offset);
    if (Math.abs(ms) < CALENDAR_STEP_MS) return;
    this.#offset += ms;
    this.#total += ms;
    for (const shift of [...this.#listeners]) shift(ms, calendar);
  }

  /**
   * `stamp`, a stored calendar time of `kind` with `id`, in today's
   * calendar: moved by the steps since this daemon first saw `id`. One id
   * is kept for each kind; a new id is first seen now.
   */
  local(kind: string, id: string, stamp: EpochMs): EpochMs {
    let seen = this.#seen.get(kind);
    if (seen?.id !== id) {
      seen = { id, mark: this.#total };
      this.#seen.set(kind, seen);
    }
    return (stamp + this.#total - seen.mark) as EpochMs;
  }

  /** `stamp`, taken when `total` was `mark`, in today's calendar. */
  since(stamp: EpochMs, mark: number): EpochMs {
    return (stamp + this.#total - mark) as EpochMs;
  }
}

/** `clock`, whose each calendar reading reads elapsed time too and tells `steps` (row 011-377). */
export function steppedClock(clock: Clock, steps: CalendarSteps): Clock {
  return {
    now: () => {
      const at = clock.now();
      steps.observe(at, clock.elapsed());
      return at;
    },
    elapsed: () => clock.elapsed(),
    arm: (ms, fire) => clock.arm(ms, fire),
  };
}
