import type { EpochMs } from "../types/common.js";
import type { Clock, Disarm, ElapsedMs } from "./clock.js";

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

/**
 * Review 0.1.524 S1: the widest span of elapsed time around a calendar
 * reading that still gives a sure sample. A thread descheduled between the
 * readings moves elapsed time and the calendar together; with the calendar
 * read between two elapsed readings, the offset is known to half the span,
 * so two sure samples differ by less than `CALENDAR_STEP_MS` without a step.
 */
export const SURE_SAMPLE_MS = CALENDAR_STEP_MS / 2;

/** The calendar steps one scheduler's clock saw, and the owners it tells. */
export class CalendarSteps {
  /** `calendar - elapsed` as of the last step; `null` before the first reading. */
  #offset: number | null = null;
  #total = 0;
  readonly #listeners = new Set<(ms: number, at: EpochMs) => void>();
  /** What `local` saw first, by kind: the stamp's id and `total` then. */
  readonly #seen = new Map<string, { readonly id: string; readonly mark: number }>();

  /**
   * `startedAt`: the start this daemon stored on its worktree, `null` while
   * it is not known (review 0.1.524 B1, `stamp`).
   */
  constructor(private readonly startedAt: () => EpochMs | null = () => null) {}

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

  /**
   * A calendar reading taken between the elapsed readings `before` and
   * `after`: a step since the last sample is told to each listener before
   * this returns. A sample whose span is wider than `SURE_SAMPLE_MS` is
   * not sure and is left out (review 0.1.524 S1).
   */
  observe(calendar: EpochMs, before: number, after: number = before): void {
    if (after - before > SURE_SAMPLE_MS) return;
    const offset = calendar - (before + after) / 2;
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

  /**
   * Review 0.1.524 B1: the time to stamp a row this daemon publishes for
   * status, read at `at`: `at`, but never before this daemon's stored start.
   * A reader takes a row stamped before the live daemon's start as a
   * predecessor's (`publishedWaits`, `publishedBatches`); after a set-back
   * past its start, the live daemon's rows show its start instead.
   */
  stamp(at: EpochMs): EpochMs {
    const startedAt = this.startedAt();
    return startedAt === null ? at : (Math.max(at, startedAt) as EpochMs);
  }

  /** `stamp`, taken when `total` was `mark`, in today's calendar. */
  since(stamp: EpochMs, mark: number): EpochMs {
    return (stamp + this.#total - mark) as EpochMs;
  }
}

/** `clock`, whose each calendar reading reads elapsed time too and tells `steps` (row 011-377). */
export function steppedClock(clock: Clock, steps: CalendarSteps): Clock {
  return new SteppedClock(clock, steps);
}

/**
 * `steppedClock`'s clock: a frame that only passes a reading on
 * (`step-reading.test.ts`). Its readings are fields, so one taken off it
 * reads as the host adapter's do.
 */
class SteppedClock implements Clock {
  constructor(
    private readonly clock: Clock,
    private readonly steps: CalendarSteps,
  ) {}

  readonly now = (): EpochMs => {
    // The calendar between two elapsed readings: their span bounds a pause (review 0.1.524 S1).
    const before = this.clock.elapsed();
    const at = this.clock.now();
    this.steps.observe(at, before, this.clock.elapsed());
    return at;
  };

  readonly elapsed = (): ElapsedMs => this.clock.elapsed();

  readonly arm = (ms: number, fire: () => void): Disarm => this.clock.arm(ms, fire);
}
