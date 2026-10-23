import { BusyWaits } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/types/index.js";

/** The daemon's busy waits, as the scheduler's options take them (row 011-126). */
export const busyWaits = () => new BusyWaits({ now: Date.now, note: () => {} });

/**
 * Makes the `nth` record's write transaction from now on give up as on a
 * busy store, after `during` ran: that record waits for its retry. A write's
 * nested transactions do not count. Returns the restore.
 */
export function busyWrite(store: Store, during: () => void, nth = 1): () => void {
  const real = store.transaction.bind(store);
  let left = nth;
  let depth = 0;
  store.transaction = ((fn: () => unknown) => {
    if (left > 0 && depth === 0 && new Error().stack?.includes("TierScheduler.#write")) {
      left -= 1;
      if (left === 0) {
        during();
        throw Object.assign(new Error("database is locked"), { errcode: 5 });
      }
    }
    depth += 1;
    try {
      return real(fn);
    } finally {
      depth -= 1;
    }
  }) as typeof store.transaction;
  return () => {
    store.transaction = real;
  };
}
