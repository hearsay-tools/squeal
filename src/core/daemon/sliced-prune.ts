import { setTimeout as delay } from "node:timers/promises";
import { BUSY_SLICE_MS, type BusyWaits, busyBackoffMs } from "../store/busy.js";
import { isBusy, withBusySliceSync } from "../store/connection.js";
import type { PruneSlice } from "../store/prune.js";
import { turnGapMs } from "../store/write-turns.js";

/** The busy-wait key, as the daemon's note names the prune. */
const PRUNING = "pruning";

interface SlicedPruneContext {
  readonly log: (line: string) => void;
  readonly busyWaits?: BusyWaits | undefined;
  /** Waits `ms` between slices; tests make it short. Default: an unref'd timer. */
  readonly pause?: ((ms: number) => Promise<void>) | undefined;
}

const unrefDelay = (ms: number): Promise<void> => delay(ms, undefined, { ref: false });

/**
 * The daemon's prunes, of the main store and then of the code store (row
 * 011-350), one slice per turn of the event loop, each followed by a pause
 * as long as it took and at least `MIN_PRUNE_GAP_MS` (`turnGapMs`), so its
 * socket and heartbeat run between them, and so does a waiting writer in
 * another process. A slice waits at most
 * `BUSY_SLICE_MS` for a busy store and is tried again after
 * `busyBackoffMs`; what waited goes to `busyWaits`. One prune runs at a
 * time, and `stop` ends it between slices.
 */
export class SlicedPrune {
  #running = false;
  #stopped = false;
  readonly #context: SlicedPruneContext;

  constructor(context: SlicedPruneContext) {
    this.#context = context;
  }

  /**
   * Runs the slices `slices` makes, then `then`, unless a prune runs or the
   * driver stopped. A failure is logged as `what`'s, unless `fault` takes it
   * (row 011-391: corruption of the main store), and ends the prune; `then`
   * runs.
   */
  async run(
    slices: () => Iterable<PruneSlice>,
    then?: () => void,
    what = "prune",
    fault?: (error: unknown) => boolean,
  ): Promise<void> {
    if (this.#running || this.#stopped) return;
    this.#running = true;
    let waited = false;
    let iterator: Iterator<PruneSlice> | undefined;
    try {
      iterator = slices()[Symbol.iterator]();
      for (;;) {
        if (this.#stopped) return;
        const next = iterator.next();
        if (next.done === true) break;
        let took = 0;
        for (let attempt = 0; ; attempt++) {
          if (this.#stopped) return;
          const started = performance.now();
          try {
            withBusySliceSync(BUSY_SLICE_MS, next.value);
            took = performance.now() - started;
            break;
          } catch (error) {
            if (!isBusy(error)) throw error;
            waited = true;
            this.#context.busyWaits?.waiting(PRUNING, PRUNING);
            await delay(busyBackoffMs(attempt), undefined, { ref: false });
          }
        }
        await (this.#context.pause ?? unrefDelay)(turnGapMs(took));
      }
    } catch (error) {
      this.#failed(what, error, fault);
    } finally {
      iterator?.return?.();
      this.#running = false;
      if (waited) this.#context.busyWaits?.ran(PRUNING);
    }
    if (!this.#stopped) then?.();
  }

  #failed(what: string, error: unknown, fault?: (error: unknown) => boolean): void {
    if (fault?.(error) !== true) this.#context.log(`${what} failed: ${String(error)}`);
  }

  /** No slice runs after this one; a prune in its pause ends there. */
  stop(): void {
    this.#stopped = true;
  }
}
