import type { EpochMs } from "../types/index.js";

/**
 * How long a write of a reconciliation pass or of the daemon's timers waits
 * for a busy store before it gives up and is retried (task 001-422). The
 * event loop is held by one such wait at most this long.
 */
export const BUSY_SLICE_MS = 250;

/**
 * The delay before retry `attempt` (0 first) of a write that gave up on a
 * busy store: at once, then backing off to 250 ms, so a lock freed during a
 * delay is taken well within a second of it.
 */
export function busyBackoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 0;
}

const BACKOFF_MS = [0, 100, 250] as const;

/**
 * What waits for a busy store, as one episode: from the first write that
 * gave up to the retry of the last one, then one note (task 001-422). Each
 * waiter has a key; `waiting` again under a key adds what it names, so a
 * retry that gives up again is the same wait.
 */
export class BusyWaits {
  readonly #waiting = new Set<string>();
  /** What waited in this episode, as the note lists it, in order. */
  readonly #waited: string[] = [];
  #since: EpochMs | null = null;

  readonly #options: { readonly now: () => EpochMs; readonly note: (text: string) => void };

  // No parameter properties: the store's sources load under Node's type stripping too.
  constructor(options: { readonly now: () => EpochMs; readonly note: (text: string) => void }) {
    this.#options = options;
  }

  /** `key`'s write gave up on a busy store; `what`, when given, waits for its retry. */
  waiting(key: string, what?: string): void {
    this.#since ??= this.#options.now();
    this.#waiting.add(key);
    if (what !== undefined) this.#add(what);
  }

  /**
   * `key`'s retry ran, or no longer waits; `what` names what it stored, as
   * the note lists it. The episode's note follows its last waiter.
   */
  ran(key: string, what?: string): void {
    if (!this.#waiting.delete(key)) return;
    if (what !== undefined) this.#add(what);
    if (this.#waiting.size > 0 || this.#since === null) return;
    const waitedMs = this.#options.now() - this.#since;
    const waited = this.#waited.splice(0);
    this.#since = null;
    this.#options.note(busyNote(waitedMs, waited));
  }

  #add(what: string): void {
    if (!this.#waited.includes(what)) this.#waited.push(what);
  }
}

/** The episode's one note: how long, and what waited. */
export function busyNote(waitedMs: number, waited: readonly string[]): string {
  const seconds = Number((waitedMs / 1000).toFixed(1));
  return (
    `the store was busy for ${seconds} s (another connection held its write lock); ` +
    `ran once it was free: ${waited.join(", ")}`
  );
}
