import {
  type Clock,
  type Disarm,
  type ElapsedMs,
  hostClock,
} from "../../src/core/scheduler/clock.js";
import type { EpochMs } from "../../src/core/types/common.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * clock port's virtual adapter. Time moves only on `advance` or `jump`; a
 * timer fires when time reaches it, timers due together in the order they
 * were armed. Row 011-353: `prompt` fires a timer that is due once the host
 * turns, as a real 0 ms timer does, so `Scheduler.rest()` never waits on a
 * wake that is due and has no `advance` to fire it. Row 011-369: `advance`
 * and `jump` move calendar and elapsed time together; `shiftCalendar` moves
 * the calendar reading alone, as a host's clock that is set, and fires nothing.
 */

interface Armed {
  readonly at: EpochMs;
  readonly seq: number;
  readonly fire: () => void;
}

export interface VirtualClock extends Clock {
  /**
   * Moves time `ms` forward (at least 0), firing each timer due on the way,
   * at its own time. A `jump` a timer makes stays: time ends at the later.
   */
  advance(ms: number): void;
  /**
   * Row 011-353: moves time `ms` forward (at least 0) and fires nothing now,
   * as a host's clock that passes a deadline inside one decision: the timers
   * due fire at the next `advance`, or once the host turns with `prompt`.
   */
  jump(ms: number): void;
  /**
   * Row 011-369: moves the calendar reading (`now`) `ms`, back when
   * negative, and leaves elapsed time and every timer as they are.
   */
  shiftCalendar(ms: number): void;
  /** How many timers are armed and not yet fired. */
  readonly armed: number;
}

export interface VirtualClockOptions {
  /** Row 011-353: a timer due at its arm or after a `jump` fires once the host turns (`setImmediate`). */
  readonly prompt?: boolean;
}

/** A virtual clock that starts at `start`. */
export function virtualClock(start: EpochMs = 0, options: VirtualClockOptions = {}): VirtualClock {
  // The time line timers fire on, which elapsed time reads; calendar time is it plus `calendar`.
  let now = start;
  let calendar = 0;
  let seq = 0;
  let turn = false;
  const timers: Armed[] = [];
  const next = (until: EpochMs): Armed | undefined => {
    let first: Armed | undefined;
    for (const t of timers) {
      if (t.at > until) continue;
      if (first === undefined || t.at < first.at || (t.at === first.at && t.seq < first.seq))
        first = t;
    }
    return first;
  };
  const advance = (ms: number): void => {
    const until = now + Math.max(0, ms);
    for (let due = next(until); due !== undefined; due = next(until)) {
      timers.splice(timers.indexOf(due), 1);
      // A timer a `jump` passed fires at the time it came to, not before.
      now = Math.max(now, due.at);
      due.fire();
    }
    // A `jump` inside a timer stays (review 011-353 B1); the timers it passed fire once the host turns.
    now = Math.max(now, until);
  };
  /** With `prompt`, fires what is due once the host turns. */
  const soon = (): void => {
    if (options.prompt !== true || turn || next(now) === undefined) return;
    turn = true;
    globalThis.setImmediate(() => {
      turn = false;
      advance(0);
    });
  };
  return {
    now: () => now + calendar,
    elapsed: () => now as ElapsedMs,
    arm(ms: number, fire: () => void): Disarm {
      const timer = { at: now + Math.max(0, ms), seq: seq++, fire };
      timers.push(timer);
      soon();
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    advance,
    jump(ms: number): void {
      now += Math.max(0, ms);
      soon();
    },
    shiftCalendar(ms: number): void {
      calendar += ms;
    },
    get armed() {
      return timers.length;
    },
  };
}

/** Row 011-353: a harness's clock, and what it hands `SchedulerOptions`. */
export interface HarnessClock {
  /** The virtual clock; `null` on the host's. */
  readonly clock: VirtualClock | null;
  now(): EpochMs;
  /** Moves the clock `ms` ahead; a virtual one fires its timers due on the way. */
  advance(ms: number): void;
  /** `{ clock }`: the virtual clock, or the host's timer over `now` (row 011-369). */
  readonly scheduler: { readonly clock: Clock };
}

/**
 * Row 011-353: a harness's `clock` option. `"virtual"`, a prompt virtual
 * clock from the host's time now; a virtual clock, that one; absent, the
 * host's clock with `now` plus what `advance` added (row 011-153) as its
 * calendar time. Row 011-369: its wakes are kept on the host's elapsed
 * time. Row 011-377: `advance` is time that passed, so it moves elapsed
 * time too and is no calendar step (`CalendarSteps`); the host's timers
 * fire at their own times, as before.
 */
export function harnessClock(
  clock: "virtual" | VirtualClock | undefined,
  now: () => EpochMs = Date.now,
): HarnessClock {
  if (clock === undefined) {
    let offset = 0;
    const read = () => now() + offset;
    const advance = (ms: number) => {
      offset += ms;
    };
    const host = hostClock(read);
    const elapsed = () => (host.elapsed() + offset) as ElapsedMs;
    return { clock: null, now: read, advance, scheduler: { clock: { ...host, elapsed } } };
  }
  const virtual = clock === "virtual" ? virtualClock(Date.now(), { prompt: true }) : clock;
  return {
    clock: virtual,
    now: () => virtual.now(),
    advance: (ms) => virtual.advance(ms),
    scheduler: { clock: virtual },
  };
}

/**
 * Row 011-353 (the model test's clock, row 011-195): a prompt virtual clock
 * from the host's time at its first reading. `cross` moves it after `reads` more readings
 * of `now`, as a host's clock that passes a deadline inside one decision
 * does; the timers that passes fire once the host turns. As a scheduler's
 * `now` alone it stands still but for `advance` and `cross`.
 */
export class CrossingClock implements VirtualClock {
  #made: VirtualClock | null = null;
  /** Made at the first use: a fixture's setup before it is no time on the clock. */
  get #clock(): VirtualClock {
    this.#made ??= virtualClock(Date.now(), { prompt: true });
    return this.#made;
  }
  #left = Number.POSITIVE_INFINITY;
  #jump = 0;
  /** The armed jump came. */
  crossed = false;
  /** The time, read without counting as a reading of `now`. */
  raw = (): number => this.#clock.now();
  now = (): number => {
    if (this.#left-- === 0) {
      this.crossed = true;
      this.#clock.jump(this.#jump);
    }
    return this.#clock.now();
  };
  elapsed = (): ElapsedMs => this.#clock.elapsed();
  arm = (ms: number, fire: () => void): Disarm => this.#clock.arm(ms, fire);
  get armed(): number {
    return this.#clock.armed;
  }
  cross(reads: number, ms: number): void {
    this.#left = reads;
    this.#jump = ms;
    this.crossed = false;
  }
  uncross(): void {
    this.#left = Number.POSITIVE_INFINITY;
  }
  advance(ms: number): void {
    this.#clock.advance(ms);
  }
  jump(ms: number): void {
    this.#clock.jump(ms);
  }
  shiftCalendar(ms: number): void {
    this.#clock.shiftCalendar(ms);
  }
}
