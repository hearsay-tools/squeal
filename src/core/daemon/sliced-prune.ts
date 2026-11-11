import { setTimeout as delay } from "node:timers/promises";
import { BUSY_SLICE_MS, type BusyWaits, busyBackoffMs } from "../store/busy.js";
import { isBusy, withBusySliceSync } from "../store/connection.js";
import type { PruneSlice } from "../store/prune.js";

/**
 * Spec 021 D3 (row 021-09): the pause between two prune slices, with the
 * store's write lock free. SQLite's busy handler tries again at most every
 * 100 ms, so a process that waits for the lock takes it in this pause; a
 * prune that took it back at once kept it from them (`store-contention.md`
 * Q3: two holders with 10 ms gaps failed a 10 s wait 4 times in 20).
 */
export const PRUNE_GAP_MS = 100;

/** The busy-wait key, as the daemon's note names the prune. */
const PRUNING = "pruning";

interface SlicedPruneContext {
  readonly log: (line: string) => void;
  readonly busyWaits?: BusyWaits | undefined;
}

/**
 * The daemon's prune, one slice per turn of the event loop, `PRUNE_GAP_MS`
 * apart, so its socket and heartbeat run between them. A slice waits at most
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
   * driver stopped. A failure is logged and ends the prune; `then` runs.
   */
  async run(slices: () => Iterable<PruneSlice>, then?: () => void): Promise<void> {
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
        for (let attempt = 0; ; attempt++) {
          if (this.#stopped) return;
          try {
            withBusySliceSync(BUSY_SLICE_MS, next.value);
            break;
          } catch (error) {
            if (!isBusy(error)) throw error;
            waited = true;
            this.#context.busyWaits?.waiting(PRUNING, PRUNING);
            await delay(busyBackoffMs(attempt), undefined, { ref: false });
          }
        }
        await delay(PRUNE_GAP_MS, undefined, { ref: false });
      }
    } catch (error) {
      this.#context.log(`prune failed: ${String(error)}`);
    } finally {
      iterator?.return?.();
      this.#running = false;
      if (waited) this.#context.busyWaits?.ran(PRUNING);
    }
    if (!this.#stopped) then?.();
  }

  /** No slice runs after this one; a prune in its pause ends there. */
  stop(): void {
    this.#stopped = true;
  }
}
