/*
 * Spec 020 D17.5 as amended by row 020-59 (#201, #202, #216): the keeper
 * writes each run's decided files while the gate's other runs go on. One
 * pass at a time writes what is queued; a pass that a busy store refused
 * leaves the rest queued, and the next pass starts after a pause that
 * grows to `MAX_PAUSE_MS`, timed by a `Pause`. Nothing here waits for the
 * run: `kick` returns at once, and `stop`, once the report is out, ends
 * the pause under way and waits
 * only for the pass that is writing, which gives up at its next busy
 * refusal. The bounded wait for what is still queued is the keeper's
 * last pass (`Keeper.flush`).
 */

/** The pauses between passes after a busy store refused one: they grow, then stay at the last. */
const PAUSES_MS = [250, 500, 1_000, 2_000] as const;

/** The longest pause between two passes. */
export const MAX_PAUSE_MS: number = PAUSES_MS[PAUSES_MS.length - 1] ?? 2_000;

/** How one pass ended: everything it took was written or decided, or some is left for a later pass. */
export type PassEnd = "done" | "left";

/**
 * Times one pause between passes: calls `then` after `ms`, unless the
 * returned function cancels it first. The default is an unref'd timer;
 * tests drive the order of a refusal and its retry with their own (row
 * 020-64).
 */
export type Pause = (ms: number, then: () => void) => () => void;

/** An unref'd timer: a pending pause never keeps the process alive. */
const timerPause: Pause = (ms, then) => {
  const timer = setTimeout(then, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export class EarlyWrites {
  readonly #pass: () => Promise<PassEnd>;
  readonly #pause: Pause;
  /** The passes and the pauses between them, until no pass is left to run. */
  #running: Promise<void> | null = null;
  #again = false;
  #stopped = false;
  /** Ends the pause under way, if any, with no pass after it. */
  #cancel: (() => void) | null = null;
  #busy = 0;

  /** `pass` writes what is queued; it never rejects. `pause` times the pauses between passes. */
  constructor(pass: () => Promise<PassEnd>, pause: Pause = timerPause) {
    this.#pass = pass;
    this.#pause = pause;
  }

  /** Whether `stop` was called: a pass then gives up at its next busy refusal. */
  get stopped(): boolean {
    return this.#stopped;
  }

  /** Something was queued: a pass starts now, or once the running pass or pause ends. */
  kick(): void {
    if (this.#stopped) return;
    if (this.#running !== null) {
      this.#again = true;
      return;
    }
    this.#running = this.#loop().finally(() => {
      this.#running = null;
    });
  }

  /** No pass starts any more; ends a pause under way and resolves once the running pass ended. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancel?.();
    await this.#running;
  }

  /**
   * One pass after another while files are queued. A pass that left files
   * is followed by a pause, inside the loop, so a pause that ends at any
   * time starts the next pass (row 020-64); a pass that wrote everything
   * is followed at once by another only when something was queued during it.
   */
  async #loop(): Promise<void> {
    for (;;) {
      this.#again = false;
      // Review 0.1.495 B3: a pass that throws, which it should not, counts as one that left files.
      const end = await this.#pass().catch((): PassEnd => "left");
      if (this.#stopped) return;
      if (end === "left") {
        const pause = PAUSES_MS[Math.min(this.#busy, PAUSES_MS.length - 1)] ?? MAX_PAUSE_MS;
        this.#busy += 1;
        // Row 020-66: `stop` in the turn that ended the pause still starts no pass.
        if (!(await this.#paused(pause)) || this.#stopped) return;
        continue;
      }
      this.#busy = 0;
      if (!this.#again) return;
    }
  }

  /** Resolves `true` once a pause of `ms` ended, `false` when `stop` ended it first. */
  #paused(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const cancel = this.#pause(ms, () => {
        this.#cancel = null;
        resolve(true);
      });
      this.#cancel = () => {
        this.#cancel = null;
        cancel();
        resolve(false);
      };
    });
  }
}
