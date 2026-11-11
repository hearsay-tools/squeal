import { BUSY_SLICE_MS, type BusyWaits, retryWhileBusy } from "../store/busy.js";
import type { Store } from "../types/store.js";

/**
 * How long a write of the daemon's shutdown is tried on a busy store: the
 * one wait of `DAEMON_BUSY_TIMEOUT_MS` it replaces (spec 021 D2).
 */
export const SHUTDOWN_WRITE_MS = 5_000;

/**
 * Spec 021 D2 (row 021-08): the daemon's writes outside the change feed,
 * the pump and the timers, in the retried path of 001-422. Each try waits
 * at most `BUSY_SLICE_MS` for a busy store, so the socket and the heartbeat
 * are served between tries, and a refused try is tried again after
 * `busyBackoffMs` until it lands or `stopped` says to give up. The wait is
 * told to the daemon's `BusyWaits`, so its episode note names it.
 */
export class DaemonWrites {
  readonly #store: Store;
  readonly #waits: BusyWaits;
  #next = 0;

  constructor(store: Store, waits: BusyWaits) {
    this.#store = store;
    this.#waits = waits;
  }

  /**
   * `write`, one store transaction or one statement, tried again while a
   * busy store refuses it; `what` names it in the episode's note. A
   * refusal once `stopped` is thrown.
   */
  write<T>(what: string, write: () => T, stopped: () => boolean): Promise<T> {
    return retryWhileBusy(async () => write(), {
      sliceMs: BUSY_SLICE_MS,
      waits: this.#waits,
      key: `daemon:${++this.#next}`,
      what,
      stopped,
    });
  }

  /**
   * Resolves once the store's write lock was free, for a socket request
   * that writes: an empty write transaction took it. A request changes the
   * scheduler's memory before its commit, so it is never run twice; it
   * waits here instead, then runs once with the store's own wait.
   */
  writable(what: string, stopped: () => boolean): Promise<void> {
    return this.write(what, () => this.#store.transaction(() => {}), stopped);
  }
}

/** A `stopped` for `DaemonWrites`: true once `ms` passed from now, or once `stopping` is. */
export function within(ms: number, stopping: () => boolean = () => false): () => boolean {
  const until = Date.now() + ms;
  return () => stopping() || Date.now() >= until;
}
