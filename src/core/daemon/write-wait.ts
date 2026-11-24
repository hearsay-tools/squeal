/**
 * Spec 025 D9 (row 025-09): how long a hook's write batch waited between
 * the front desk worker posting it and the daemon main thread taking it.
 * Both log lines are parsed verbatim by `bench/lib.mjs` (row 025-08).
 */

/** A wait above this is logged on its own; the same bound as the store's long writes. */
export const LONG_WRITE_WAIT_MS = 250;

/** At most this many waits are kept per report for the p95; count and max stay exact. */
export const WRITE_WAIT_SAMPLE_CAP = 1024;

/** The waits since the last report, and the long-wait lines as they happen. */
export class WriteWaitStats {
  readonly #log: (text: string) => void;
  readonly #cap: number;
  #samples: number[] = [];
  #next = 0;
  #count = 0;
  #max = 0;

  constructor(log: (text: string) => void, cap = WRITE_WAIT_SAMPLE_CAP) {
    this.#log = log;
    this.#cap = Math.max(1, cap);
  }

  /** One write the main thread took after `waitMs`. */
  record(waitMs: number): void {
    const wait = Math.max(0, Number.isFinite(waitMs) ? waitMs : 0);
    if (wait > LONG_WRITE_WAIT_MS) {
      this.#log(
        `long write wait: hook write waited ${Math.round(wait)} ms for the daemon main thread`,
      );
    }
    this.#count += 1;
    if (wait > this.#max) this.#max = wait;
    // A ring: past the cap, the newest waits replace the oldest.
    if (this.#samples.length < this.#cap) this.#samples.push(wait);
    else this.#samples[this.#next] = wait;
    this.#next = (this.#next + 1) % this.#cap;
  }

  /**
   * The line of the writes since the last call, `null` with none:
   * `hook writes: 12 taken, queue wait p95 40 ms max 310 ms`. Resets.
   */
  take(): string | null {
    if (this.#count === 0) return null;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
    const line =
      `hook writes: ${this.#count} taken, queue wait p95 ${Math.round(p95)} ms ` +
      `max ${Math.round(this.#max)} ms`;
    this.#samples = [];
    this.#next = 0;
    this.#count = 0;
    this.#max = 0;
    return line;
  }
}
