import { MergeHold } from "../../src/core/scheduler/hold.js";
import { InstallStamps } from "../../src/core/scheduler/install-stamp.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { TierRecords } from "../../src/core/scheduler/record.js";

/*
 * Row 011-195: time and quiet for `model-fixture.ts`. The scheduler's clock
 * moves only when the model moves it, its timers fire when the clock
 * passes them, and the model reads when the scheduler has nothing in
 * flight from its lock.
 */

export const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
export const realSleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

/** A timer of the scheduler: it fires at its delay on the host's clock, or once the model's clock passes `due`. */
class ModelTimer {
  handle: ReturnType<typeof realSetTimeout> | null = null;
  refd = true;
  constructor(
    readonly due: number,
    readonly fn: () => void,
  ) {}
  /** The scheduler's timers are unref'd; nothing else of `Timeout` is called. */
  unref() {
    this.refd = false;
    this.handle?.unref();
    return this;
  }
}

/**
 * The scheduler's clock (`SchedulerOptions.now`): it stands at its first
 * reading until `advance`. `cross` moves it after `reads` more readings, as
 * a host's clock that passes a deadline inside one decision does.
 */
export class ModelClock {
  #at: number | null = null;
  #left = Number.POSITIVE_INFINITY;
  #jump = 0;
  /** The armed jump came. */
  crossed = false;
  readonly #timers = new Set<ModelTimer>();
  /** The time, as the model reads it: no reading of the scheduler's. */
  raw = (): number => {
    this.#at ??= Date.now();
    return this.#at;
  };
  now = (): number => {
    if (this.#left-- === 0) {
      this.crossed = true;
      this.advance(this.#jump);
    }
    return this.raw();
  };
  cross(reads: number, ms: number): void {
    this.#left = reads;
    this.#jump = ms;
    this.crossed = false;
  }
  uncross(): void {
    this.#left = Number.POSITIVE_INFINITY;
  }
  advance(ms: number): void {
    this.#at = this.raw() + ms;
    for (const t of this.#timers)
      if (t.due <= this.#at) {
        if (t.handle !== null) realClearTimeout(t.handle);
        t.handle = realSetTimeout(() => this.#fire(t), 0);
        if (!t.refd) t.handle.unref();
      }
  }
  #fire(t: ModelTimer): void {
    if (this.#timers.delete(t)) t.fn();
  }
  /** Replaces `setTimeout` and `clearTimeout`; Vitest keeps its own. */
  install(): void {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const t = new ModelTimer(this.raw() + Number(ms), () => fn(...args));
      t.handle = realSetTimeout(() => this.#fire(t), ms);
      this.#timers.add(t);
      return t;
    };
    g.clearTimeout = (t: unknown) => {
      if (!(t instanceof ModelTimer)) return realClearTimeout(t as never);
      this.#timers.delete(t);
      if (t.handle !== null) realClearTimeout(t.handle);
    };
  }
  uninstall(): void {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    for (const t of this.#timers) if (t.handle !== null) realClearTimeout(t.handle);
    this.#timers.clear();
  }
}

/** Calls of `proto[name]` count as work in flight until their promise settles; the undo. */
function wrap<O extends object>(proto: O, name: keyof O, track: (work: Promise<unknown>) => void) {
  const original = proto[name] as (...args: unknown[]) => Promise<unknown>;
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const work = original.apply(this, args);
    track(work);
    return work;
  } as O[keyof O];
  return () => {
    proto[name] = original as O[keyof O];
  };
}

/**
 * The scheduler's own work in flight, seen from outside: its lock's tasks
 * (`Mutex.run`), a run's record from its end, outside the lock first
 * (`TierRecords.record`: the stability check, slots' gathering), and the
 * pump's checks before it selects a tier (`InstallStamps.check`,
 * `MergeHold.check`). Replaces the probe's 45 ms of no change (finding 4,
 * flake risk 1): a decision or a record a loaded host slows is in flight.
 */
export function watchWork() {
  let open = 0;
  let started = 0;
  const track = (work: Promise<unknown>) => {
    open += 1;
    started += 1;
    const done = () => {
      open -= 1;
    };
    work.then(done, done);
  };
  const undo = [
    wrap(Mutex.prototype, "run", track),
    wrap(TierRecords.prototype, "record", track),
    wrap(InstallStamps.prototype, "check", track),
    wrap(MergeHold.prototype, "check", track),
  ];
  return {
    open: () => open,
    started: () => started,
    restore: () => {
      for (const u of undo) u();
    },
  };
}
