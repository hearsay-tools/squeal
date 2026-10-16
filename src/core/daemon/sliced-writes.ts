import {
  BUSY_SLICE_MS,
  type BusyWaits,
  busyBackoffMs,
  isBusy,
  withBusySliceSync,
} from "../store/index.js";

/** Where a timer's failure is logged, and what waits for a busy store; without it, no slice. */
interface SlicedContext {
  readonly log: (line: string) => void;
  readonly busyWaits?: BusyWaits | undefined;
}

/** One step of a timer's writes: the name its failure is logged under, and the write. */
export type Step = readonly [string, () => void];

/**
 * Task 001-422: the timers' writes, each waiting at most `BUSY_SLICE_MS` for
 * a busy store, so none holds the event loop longer. A step that gives up
 * stops its group, and the whole group is pending: a tick it skips is the
 * retry's, so the retry writes the heartbeat a step after it gave up has
 * missed too. One timer retries
 * the pending groups after `busyBackoffMs`, in order, until one gives up
 * again, so their slices never stack in one tick, and retries are
 * coalesced. Any other failure is logged, and
 * the group goes on, as before.
 */
export class SlicedWrites {
  readonly #pending = new Map<string, readonly Step[]>();
  /** Groups that gave up in this episode: each is told to `busyWaits` once it ran. */
  readonly #waited = new Set<string>();
  #timer: NodeJS.Timeout | null = null;
  #attempt = 0;
  #stopped = false;

  readonly #context: SlicedContext;

  constructor(context: SlicedContext) {
    this.#context = context;
  }

  /**
   * Runs `steps`, the writes of group `what`, unless its retry is pending.
   * While another group's is, the store is busy: it waits for the same retry.
   */
  run(what: string, steps: readonly Step[]): void {
    if (this.#stopped || this.#pending.has(what)) return;
    if (this.#pending.size === 0) {
      this.#run(what, steps);
      return;
    }
    this.#context.busyWaits?.waiting(what, what);
    this.#waited.add(what);
    this.#pending.set(what, steps);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
  }

  /** Runs the group; false when a step gave up on a busy store and the rest is pending. */
  #run(what: string, steps: readonly Step[]): boolean {
    const waits = this.#context.busyWaits;
    for (const [step, fn] of steps) {
      try {
        if (waits === undefined) fn();
        else withBusySliceSync(BUSY_SLICE_MS, fn);
      } catch (error) {
        if (waits === undefined || !isBusy(error)) {
          this.#context.log(`${step} failed: ${String(error)}`);
          continue;
        }
        waits.waiting(what, what);
        this.#waited.add(what);
        this.#pending.set(what, steps);
        this.#arm();
        return false;
      }
    }
    if (this.#waited.delete(what)) waits?.ran(what);
    return true;
  }

  #arm(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#retry();
      },
      busyBackoffMs(this.#attempt++),
    );
    this.#timer.unref();
  }

  #retry(): void {
    for (const [what, steps] of [...this.#pending]) {
      if (this.#stopped) return;
      this.#pending.delete(what);
      // Still busy: the groups after it wait for the next retry, not for another slice now.
      if (!this.#run(what, steps)) return;
    }
    this.#attempt = 0;
  }
}
