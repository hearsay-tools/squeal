import { setTimeout as sleep } from "node:timers/promises";
import { BUSY_SLICE_MS, busyBackoffMs } from "./busy.js";
import { isBusy, withBusySliceSync } from "./connection.js";

/**
 * How long a write outside the daemon keeps asking a busy store before it
 * says another process holds it (row 011-212, gh-86, 011 C13): a command's
 * requests, and the gate's kept files (spec 020 D17.3).
 */
export const BUSY_BOUND_MS = 10_000;

/**
 * Spec 011 C8's busy writes, for one write, one synchronous transaction:
 * each try waits at most `BUSY_SLICE_MS` for a busy store, and the next
 * follows `busyBackoffMs` later, so the event loop runs between them. A
 * refused `BEGIN IMMEDIATE` writes nothing, and the pause is awaited
 * between tries, never inside a transaction. `undefined` once `giveUp`,
 * asked after each pause, says so; any error but busy is thrown.
 */
export async function slicedWrite<T>(
  write: () => T,
  giveUp: () => boolean,
): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return withBusySliceSync(BUSY_SLICE_MS, write);
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    await sleep(busyBackoffMs(attempt));
    if (giveUp()) return undefined;
  }
}
