import { BUSY_SLICE_MS, type BusyWaits, retryWhileBusy } from "../store/busy.js";

/**
 * How long a write of the daemon's shutdown is tried on a busy store: the
 * one wait of `DAEMON_BUSY_TIMEOUT_MS` it replaces (spec 021 D2).
 */
export const SHUTDOWN_WRITE_MS = 5_000;

/**
 * Spec 021 D2 (row 021-08): the daemon's own writes outside the change
 * feed, the pump, the timers and the scheduler's requests (its `#request`),
 * in the retried path of 001-422. Each try waits at most `BUSY_SLICE_MS`
 * for a busy store, so the socket and the heartbeat are served between
 * tries, and a refused try is tried again after
 * `busyBackoffMs` until it lands or `stopped` says to give up. The wait is
 * told to the daemon's `BusyWaits`, so its episode note names it.
 */
export class DaemonWrites {
  readonly #waits: BusyWaits;
  #next = 0;

  constructor(waits: BusyWaits) {
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
}

/** A `stopped` for `DaemonWrites`: true once `ms` passed from now, or once `stopping` is. */
export function within(ms: number, stopping: () => boolean = () => false): () => boolean {
  const until = Date.now() + ms;
  return () => stopping() || Date.now() >= until;
}
