import type { EpochMs } from "../types/common.js";
import type { Rest, RestWake } from "../types/scheduler.js";
import { type Clock, type Disarm, MAX_TIMER_MS } from "./clock.js";
import { type WakeReason, wakeRank } from "./step-events.js";

/*
 * Row 011-352 (card 7, `research/scheduler-step.md`, decision 2 and "The wake
 * loop"): the scheduler's one timer and its rest signal. Each owner states its
 * next wake through a slot; the loop arms one timer, through `Clock.arm`, at
 * the earliest. A pass takes one clock reading and runs every owner due at it
 * in the written order (`WAKE_ORDER`), then arms at the earliest wake left.
 */

/** What the loop alone reports at rest: `Rest` without the scheduler's busy resume. */
export type WakesRest = Omit<Rest, "busyResume">;

/** An owner's wake, stated as a value: `GLOSSARY.md`, "Wake". */
export interface WakeSlot {
  readonly reason: WakeReason;
  /** The stated wake; `null` when the owner needs none. */
  readonly wake: EpochMs | null;
  /** States the wake: `at`, or none with `null`. A wake in the past fires at the next pass. */
  at(at: EpochMs | null): void;
  /** The earlier of the stated wake and `at`. */
  atMost(at: EpochMs): void;
  /** States no wake. */
  clear(): void;
  /** Leaves the loop for good: an owner that ended (a runner-part call, a retired lane). */
  drop(): void;
  /**
   * Orders this slot among those of its reason, lowest first (`SlotOptions.rank`);
   * its wake stays. A policy reload reorders slow lanes so (review 0.1.513 B3).
   */
  rank: number;
}

export interface SlotOptions {
  /** Orders the slots of one reason in a pass, lowest first; then the order they were made. */
  readonly rank?: number;
}

/** What a slot runs at its wake, with the pass's one reading. */
export type WakeFire = (at: EpochMs) => void;

class Slot implements WakeSlot {
  wake: EpochMs | null = null;
  /** `wake` on the loop's steady time (`Wakes.#steady`): when it is due. */
  due: number | null = null;
  dropped = false;

  constructor(
    readonly reason: WakeReason,
    readonly fire: WakeFire,
    public rank: number,
    readonly seq: number,
    private readonly state: (slot: Slot, at: EpochMs | null) => void,
  ) {}

  at(at: EpochMs | null): void {
    if (!this.dropped) this.state(this, at);
  }

  atMost(at: EpochMs): void {
    if (this.wake === null || at < this.wake) this.at(at);
  }

  clear(): void {
    this.at(null);
  }

  drop(): void {
    this.clear();
    this.dropped = true;
    this.state(this, null);
  }
}

/** The written order of a pass: the reason's rank, the slot's rank, the order slots were made. */
function inOrder(a: Slot, b: Slot): number {
  return wakeRank(a.reason) - wakeRank(b.reason) || a.rank - b.rank || a.seq - b.seq;
}

/** One pass's readings: the clock's, which owners get, and the loop's steady time. */
interface Reading {
  readonly at: EpochMs;
  readonly steady: number;
}

/**
 * The wake loop. Besides the wakes it counts the scheduler's own async work
 * (`track`), a runner's run set aside (`aside`) and the lock's queued tasks
 * (`locked`, the `Mutex` count hook), so `rest` can say when nothing is left.
 *
 * A wake is stated on the scheduler's clock and kept as a delay from the
 * reading it was stated at, on the loop's steady time: the largest of the
 * clock's `ticks` and the time each fired timer stood for. On the virtual
 * clock that is its reading; on the host's, `performance.now`; with a test's
 * fixed `now`, or fake timers that leave `performance` real, each wake still
 * fires after its delay, as each owner's own timer did before.
 */
export class Wakes {
  readonly #clock: Clock;
  readonly #slots = new Set<Slot>();
  #seq = 0;
  #disarm: Disarm | null = null;
  /** The due time the timer is armed for, and the steady time it stands for (at most `MAX_TIMER_MS` on). */
  #armed: { readonly due: number; readonly until: number } | null = null;
  /** The loop's steady time: never goes back. */
  #steady = Number.NEGATIVE_INFINITY;
  /** The reading of the pass that runs, while one runs. */
  #pass: Reading | null = null;
  #closed = false;
  #tracked = 0;
  #locked = 0;
  readonly #waiters: (() => void)[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** A slot of `reason` whose wake runs `fire`. */
  slot(reason: WakeReason, fire: WakeFire, options: SlotOptions = {}): WakeSlot {
    const slot = new Slot(reason, fire, options.rank ?? 0, this.#seq++, (s, at) =>
      this.#state(s, at),
    );
    this.#slots.add(slot);
    return slot;
  }

  /**
   * Counts `work` as the scheduler's own until it settles; returns it. Given
   * a function, counts first and then calls it, so an `aside` in its
   * synchronous start is inside the count (an `async` body runs to its first
   * `await` before a promise it returns could be handed over).
   */
  track<T>(work: Promise<T> | (() => Promise<T>)): Promise<T> {
    this.#tracked += 1;
    const done = () => {
      this.#tracked -= 1;
      this.#poke();
    };
    let promise: Promise<T>;
    try {
      promise = typeof work === "function" ? work() : work;
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(done, done);
    return promise;
  }

  /**
   * Sets `run`, a runner's run or a wait awaited inside tracked work, aside
   * until it settles: a run a test holds counts as rest; its end, and what
   * follows it, does not. Returns `run`. Called outside tracked work it sets
   * nothing aside, so the count never goes below what tracked work holds
   * (its caller must be inside tracked work when any is open).
   */
  aside<T>(run: Promise<T>): Promise<T> {
    if (this.#tracked <= 0) return run;
    this.#tracked -= 1;
    this.#poke();
    const back = () => {
      this.#tracked += 1;
    };
    run.then(back, back);
    return run;
  }

  /** The `Mutex` count hook: how many of its tasks are queued or running. */
  locked(count: number): void {
    this.#locked = count;
    if (count === 0) this.#poke();
  }

  /** Disarms the timer: no owner runs again. Counting goes on, so `rest` still answers. */
  close(): void {
    this.#closed = true;
    this.#disarm?.();
    this.#disarm = null;
    this.#armed = null;
    this.#poke();
  }

  /** Each owner's stated wake, earliest first, then in the written order. */
  wakes(): RestWake[] {
    return [...this.#slots]
      .filter((slot): slot is Slot & { wake: EpochMs; due: number } => slot.due !== null)
      .sort((a, b) => a.due - b.due || inOrder(a, b))
      .map(({ reason, wake }) => ({ reason, at: wake }));
  }

  /** Resolves when the scheduler rests (`Scheduler.rest`), with the next wake and each owner's. */
  async rest(): Promise<WakesRest> {
    for (;;) {
      if (this.#atRest()) {
        await new Promise<void>((resolve) => globalThis.setImmediate(resolve));
        if (this.#atRest()) {
          const wakes = this.wakes();
          return { next: wakes[0] ?? null, wakes };
        }
        continue;
      }
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  #atRest(): boolean {
    if (this.#pass !== null || this.#tracked > 0 || this.#locked > 0) return false;
    if (this.#closed) return true;
    const steady = this.#steadyNow();
    for (const slot of this.#slots) if (slot.due !== null && slot.due <= steady) return false;
    return true;
  }

  /** The loop's steady time now: the clock's ticks, or `at` without them; never behind a timer that fired. */
  #steadyNow(at?: EpochMs): number {
    const ticks = this.#clock.ticks?.() ?? at ?? this.#clock.now();
    if (ticks > this.#steady) this.#steady = ticks;
    return this.#steady;
  }

  /** The reading a statement is measured from: the pass's, else one taken now. */
  #reading(): Reading {
    if (this.#pass !== null) return this.#pass;
    const at = this.#clock.now();
    return { at, steady: this.#steadyNow(at) };
  }

  #state(slot: Slot, at: EpochMs | null): void {
    if (slot.dropped) this.#slots.delete(slot);
    else if (slot.wake === at) return;
    else {
      slot.wake = at;
      if (at === null) slot.due = null;
      else {
        const reading = this.#reading();
        slot.due = reading.steady + (at - reading.at);
      }
    }
    this.#rearm();
    this.#poke();
  }

  /**
   * One pass: one reading; each owner due at it, in the written order. An
   * owner an earlier one moved past the reading waits for its new wake. An
   * owner's throw does not stop the others; the first is thrown after the
   * pass, as a timer's would be.
   */
  #run(): void {
    const armed = this.#armed;
    this.#disarm = null;
    this.#armed = null;
    if (this.#closed) return;
    // The timer fired: its time came, whatever the clock reads (a fixed `now`, fake timers).
    if (armed !== null && armed.until > this.#steady) this.#steady = armed.until;
    const at = this.#clock.now();
    const pass: Reading = { at, steady: this.#steadyNow(at) };
    this.#pass = pass;
    const due = [...this.#slots].filter((slot) => slot.due !== null && slot.due <= pass.steady);
    const errors: unknown[] = [];
    try {
      for (const slot of due.sort(inOrder)) {
        if (slot.dropped || slot.due === null || slot.due > pass.steady) continue;
        slot.wake = null;
        slot.due = null;
        try {
          slot.fire(pass.at);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.#pass = null;
      this.#rearm();
      this.#poke();
    }
    if (errors.length > 0) throw errors[0];
  }

  /**
   * Arms the one timer at the earliest due wake. Its delay is measured from
   * the steady time now, read after a pass's owners ran (review 0.1.513 B2):
   * the time they took is not added to the next wake.
   */
  #rearm(): void {
    if (this.#pass !== null || this.#closed) return;
    let next: number | null = null;
    for (const slot of this.#slots)
      if (slot.due !== null && (next === null || slot.due < next)) next = slot.due;
    if (next === (this.#armed?.due ?? null)) return;
    this.#disarm?.();
    this.#disarm = null;
    this.#armed = null;
    if (next === null) return;
    const steady = this.#steadyNow();
    const ms = next - steady;
    // A delay past a timer's range fires early, at the range's end, and arms again.
    this.#armed = { due: next, until: steady + Math.min(ms, MAX_TIMER_MS) };
    this.#disarm = this.#clock.arm(ms, () => this.#run());
  }

  #poke(): void {
    for (const resolve of this.#waiters.splice(0)) resolve();
  }
}
