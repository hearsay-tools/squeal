import { setTimeout as sleep } from "node:timers/promises";
import type { EpochMs } from "../types/common.js";
import { isBusy, withBusySlice } from "./connection.js";

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

/** How a write a busy store refused is tried again (`retryWhileBusy`). */
export interface BusyRetry {
  /** Each try's writes wait at most this long for a busy store; absent: the store's own wait. */
  readonly sliceMs?: number | undefined;
  /** Where the wait is told: `key` waits, named `what`, from its first refusal until it lands. */
  readonly waits?: BusyWaits | undefined;
  readonly key: string;
  readonly what: string;
  /** True once the caller is gone: a refusal is thrown, not tried again. */
  readonly stopped: () => boolean;
}

/**
 * Spec 021 D2 (row 021-08): `attempt`, tried again while a busy store
 * refuses it. Each try's writes wait at most `sliceMs`, so the event loop
 * is never held longer, and the next try follows `busyBackoffMs`. A busy
 * store refuses `BEGIN IMMEDIATE` before its transaction writes anything;
 * what a refused try changed in memory before it is the caller's to make
 * good at the next try (`attempt`'s `n` above 0). Any other error, or a
 * refusal once `stopped`, is thrown.
 */
export async function retryWhileBusy<T>(
  attempt: (n: number) => Promise<T>,
  retry: BusyRetry,
): Promise<T> {
  const { sliceMs, waits, key } = retry;
  for (let n = 0; ; n++) {
    try {
      const result = await (sliceMs === undefined
        ? attempt(n)
        : withBusySlice(sliceMs, () => attempt(n)));
      waits?.ran(key);
      return result;
    } catch (error) {
      if (!isBusy(error) || retry.stopped()) {
        waits?.abandoned(key);
        throw error;
      }
      waits?.waiting(key, retry.what);
    }
    await sleep(busyBackoffMs(n));
  }
}

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
  /** What each waiter named, so an abandoned one takes its names back. */
  readonly #named = new Map<string, string[]>();
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
    if (what === undefined) return;
    this.#add(what);
    this.#named.set(key, [...(this.#named.get(key) ?? []), what]);
  }

  /**
   * `key`'s retry ran, or no longer waits; `what` names what it stored, as
   * the note lists it. The episode's note follows its last waiter.
   */
  ran(key: string, what?: string): void {
    if (!this.#waiting.delete(key)) return;
    this.#named.delete(key);
    if (what !== undefined) this.#add(what);
    this.#end();
  }

  /**
   * `key` no longer waits and what it named never ran: another error took
   * its write over (review 001-432, B1). Its names leave the note; an
   * episode left with nothing that ran gives none.
   */
  abandoned(key: string): void {
    if (!this.#waiting.delete(key)) return;
    const named = new Set(this.#named.get(key) ?? []);
    this.#named.delete(key);
    const kept = [...this.#named.values()].flat();
    const waited = this.#waited.filter((what) => !named.has(what) || kept.includes(what));
    this.#waited.splice(0, this.#waited.length, ...waited);
    this.#end();
  }

  /** The episode's note, once its last waiter is done and something ran. */
  #end(): void {
    if (this.#waiting.size > 0 || this.#since === null) return;
    const waitedMs = this.#options.now() - this.#since;
    const waited = this.#waited.splice(0);
    this.#since = null;
    if (waited.length > 0) this.#options.note(busyNote(waitedMs, waited));
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
