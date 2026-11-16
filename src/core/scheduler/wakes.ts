import { AsyncLocalStorage } from "node:async_hooks";
import type { EpochMs } from "../types/common.js";
import type { Rest, RestWake } from "../types/scheduler.js";
import { type Clock, type Disarm, type ElapsedMs, MAX_TIMER_MS } from "./clock.js";
import { type WakeReason, wakeRank } from "./step-events.js";

/*
 * Row 011-352 (card 7, `research/scheduler-step.md`, decision 2 and "The wake
 * loop"): the scheduler's one timer and its rest signal. Each owner states its
 * next wake through a slot; the loop arms one timer, through `Clock.arm`, at
 * the earliest. A pass takes one clock reading and runs every owner due at it
 * in the written order (`WAKE_ORDER`), then arms at the earliest wake left.
 *
 * Row 011-369: an owner states its wake as a delay, kept on elapsed time
 * (`Clock.elapsed`), never as a calendar time; an owner whose deadline is a
 * calendar time (a hold's stored end) states the delay to it. A change of
 * the calendar clock moves no wake.
 */

/** What the loop alone reports at rest: `Rest` without the scheduler's busy resume. */
export type WakesRest = Omit<Rest, "busyResume">;

/** An owner's wake, stated as a value: `GLOSSARY.md`, "Wake". */
export interface WakeSlot {
  readonly reason: WakeReason;
  /** The elapsed time the stated wake is due at; `null` when the owner needs none. */
  readonly due: ElapsedMs | null;
  /**
   * States the wake `ms` of elapsed time from now: the pass's reading inside
   * a pass, else the clock's. At most 0 fires at the next pass.
   */
  after(ms: number): void;
  /** The earlier of the stated wake and one `ms` from now. */
  within(ms: number): void;
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
  due: ElapsedMs | null = null;
  dropped = false;

  constructor(
    readonly reason: WakeReason,
    readonly fire: WakeFire,
    public rank: number,
    readonly seq: number,
    private readonly state: (slot: Slot, due: ElapsedMs | null) => void,
    private readonly from: () => ElapsedMs,
  ) {}

  after(ms: number): void {
    if (!this.dropped) this.state(this, (this.from() + ms) as ElapsedMs);
  }

  within(ms: number): void {
    if (this.dropped) return;
    const due = (this.from() + ms) as ElapsedMs;
    if (this.due === null || due < this.due) this.state(this, due);
  }

  clear(): void {
    if (!this.dropped) this.state(this, null);
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

/**
 * What a piece of work may wait for while it does not count toward `rest`,
 * a closed list (row 011-352, repair 3): its stated wake, which the loop
 * fires; a runner's run, which a test may hold; the pump's next event, each
 * of whose sources counts on its own or comes from outside; other pieces,
 * which count on their own. No other wait sets work aside.
 */
export type Waiting =
  | { readonly for: "wake"; readonly reason: WakeReason }
  | { readonly for: "run" }
  | { readonly for: "event" }
  | { readonly for: "pieces" };

/** A piece of work that runs on its own (`Wakes.track`); it counts unless it waits in a named wait. */
interface Piece {
  waiting: number;
  /** The last named wait it took, for a reader of the loop. */
  for?: Waiting;
}

/** One pass's readings: calendar time, which owners get, and elapsed time, which decides what is due. */
interface Reading {
  readonly at: EpochMs;
  readonly elapsed: ElapsedMs;
}

/**
 * The wake loop. Besides the wakes it keeps the rest signal's one rule (row
 * 011-352, repair 3): every piece of scheduler work that runs on its own is
 * counted on its own (`track`), and a piece stops counting only while it
 * waits in a named wait (`waitFor`, `Waiting`): for a stated wake of this
 * loop, a runner's run, the pump's next event, or other pieces. The lock's
 * queued and running tasks count too (`locked`, the `Mutex` count hook).
 *
 * Row 011-369: a wake is kept on elapsed time only and is due once
 * `Clock.elapsed()` reaches it. A timer that fires before (elapsed time a
 * little behind a host timer) runs a pass that fires nothing and arms
 * again for the time left.
 */
export class Wakes {
  readonly #clock: Clock;
  readonly #slots = new Set<Slot>();
  #seq = 0;
  #disarm: Disarm | null = null;
  /** The elapsed time the timer is armed for. */
  #armed: ElapsedMs | null = null;
  /** The reading of the pass that runs, while one runs. */
  #pass: Reading | null = null;
  #closed = false;
  /** The pieces of work open (`track`), each counted on its own. */
  readonly #pieces = new Set<Piece>();
  /** The piece the running code belongs to. */
  readonly #piece = new AsyncLocalStorage<Piece>();
  #locked = 0;
  readonly #waiters: (() => void)[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** A slot of `reason` whose wake runs `fire`. */
  slot(reason: WakeReason, fire: WakeFire, options: SlotOptions = {}): WakeSlot {
    const slot = new Slot(
      reason,
      fire,
      options.rank ?? 0,
      this.#seq++,
      (s, due) => this.#state(s, due),
      () => this.elapsed(),
    );
    this.#slots.add(slot);
    return slot;
  }

  /**
   * Starts `work` as a piece of the scheduler's work, counted on its own
   * until it settles; returns its promise. The piece is counted before
   * `work` is called, and `work` runs in the piece's context, so its named
   * waits (`waitFor`) suspend this piece and no other. Work started inside
   * it that runs beside it (a record's reads beside its gather) is a piece
   * of its own: start it with `track` too.
   */
  track<T>(work: () => Promise<T>): Promise<T> {
    const piece: Piece = { waiting: 0 };
    this.#pieces.add(piece);
    const done = () => {
      this.#pieces.delete(piece);
      this.#poke();
    };
    let promise: Promise<T>;
    try {
      promise = this.#piece.run(piece, work);
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(done, done);
    return promise;
  }

  /**
   * The one way a piece stops counting (`Waiting`): it waits for `promise`,
   * which settles at what `waiting` names. The piece whose context this runs
   * in stops counting until `promise` settles and counts again before its
   * continuation runs. Outside any piece it suspends nothing.
   */
  waitFor<T>(waiting: Waiting, promise: Promise<T>): Promise<T> {
    const piece = this.#piece.getStore();
    if (piece === undefined || !this.#pieces.has(piece)) return promise;
    piece.waiting += 1;
    piece.for = waiting;
    this.#poke();
    const back = () => {
      piece.waiting -= 1;
    };
    promise.then(back, back);
    return promise;
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

  /** Elapsed time now: the pass's reading inside a pass, else the clock's. */
  elapsed(): ElapsedMs {
    return this.#pass?.elapsed ?? this.#clock.elapsed();
  }

  /**
   * Each owner's stated wake, earliest first, then in the written order; its
   * `at` is calendar time now plus the delay left, as a reader moves the clock.
   */
  wakes(): RestWake[] {
    const at = this.#clock.now();
    const elapsed = this.#clock.elapsed();
    return [...this.#slots]
      .filter((slot): slot is Slot & { due: ElapsedMs } => slot.due !== null)
      .sort((a, b) => a.due - b.due || inOrder(a, b))
      .map(({ reason, due }) => ({ reason, at: (at + Math.max(0, due - elapsed)) as EpochMs }));
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
    if (this.#pass !== null || this.#locked > 0) return false;
    for (const piece of this.#pieces) if (piece.waiting === 0) return false;
    if (this.#closed) return true;
    const elapsed = this.#clock.elapsed();
    for (const slot of this.#slots) if (slot.due !== null && slot.due <= elapsed) return false;
    return true;
  }

  #state(slot: Slot, due: ElapsedMs | null): void {
    if (slot.dropped) this.#slots.delete(slot);
    else if (slot.due === due) return;
    else slot.due = due;
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
    this.#disarm = null;
    this.#armed = null;
    if (this.#closed) return;
    const pass: Reading = { at: this.#clock.now(), elapsed: this.#clock.elapsed() };
    this.#pass = pass;
    const due = [...this.#slots].filter((slot) => slot.due !== null && slot.due <= pass.elapsed);
    const errors: unknown[] = [];
    try {
      for (const slot of due.sort(inOrder)) {
        if (slot.dropped || slot.due === null || slot.due > pass.elapsed) continue;
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
   * elapsed time now, read after a pass's owners ran (review 0.1.513 B2):
   * the time they took is not added to the next wake. A delay past a
   * timer's range fires early, at the range's end, and arms again.
   */
  #rearm(): void {
    if (this.#pass !== null || this.#closed) return;
    let next: ElapsedMs | null = null;
    for (const slot of this.#slots)
      if (slot.due !== null && (next === null || slot.due < next)) next = slot.due;
    if (next === this.#armed) return;
    this.#disarm?.();
    this.#disarm = null;
    this.#armed = null;
    if (next === null) return;
    const ms = Math.min(Math.max(0, next - this.#clock.elapsed()), MAX_TIMER_MS);
    this.#armed = next;
    // A pass belongs to no piece: the timer would run it in the context of whoever armed it.
    this.#disarm = this.#clock.arm(ms, () => this.#piece.exit(() => this.#run()));
  }

  #poke(): void {
    for (const resolve of this.#waiters.splice(0)) resolve();
  }
}
