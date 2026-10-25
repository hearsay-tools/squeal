/**
 * Row 015-42 (011-197): coverage work on the daemon's main thread gives
 * its time back. After work that took `d` ms there, the next unit starts no
 * sooner than `d` ms after it ended, so the change feed and hooks get at
 * least half of every window. Work measured before that time has passed
 * adds to the wait. The daemon gives the records' writer and the coverage
 * step one pace, so the half holds for both together (row 015-45).
 */
export class Pace {
  readonly #now: () => number;
  #spent = 0;
  #notBefore = 0;
  #timer: NodeJS.Timeout | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Runs `work` and counts its time against the next unit; what `work` returns. */
  measure<T>(work: () => T): T {
    const began = this.#now();
    if (began >= this.#notBefore) this.#spent = 0;
    try {
      return work();
    } finally {
      const ended = this.#now();
      this.#spent += ended - began;
      this.#notBefore = ended + this.#spent;
    }
  }

  /** The next unit may start now. */
  due(): boolean {
    return this.#now() >= this.#notBefore;
  }

  /**
   * Resolves once the next unit may start by the time it is called, never
   * in the same turn of the event loop. Another user of the pace may run a
   * unit meanwhile, so `due` says whether to wait again.
   */
  wait(): Promise<void> {
    const delay = Math.max(0, this.#notBefore - this.#now());
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** Calls `next` once the next unit may start; a call while one waits joins it. */
  after(next: () => void): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        next();
      },
      Math.max(0, this.#notBefore - this.#now()),
    );
    this.#timer.unref();
  }

  cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
