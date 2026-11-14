/*
 * Spec 020 D17.5 as amended by row 020-59 (#201, #202, #216): the keeper
 * writes each run's decided files while the gate's other runs go on. One
 * pass at a time writes what is queued; a pass that a busy store refused
 * leaves the rest queued, and the next pass starts after a pause that
 * grows to `MAX_PAUSE_MS`. Nothing here waits for the run: `kick` returns
 * at once, and `stop`, once the report is out, ends the pauses and waits
 * only for the pass that is writing, which gives up at its next busy
 * refusal. The bounded wait for what is still queued is the keeper's
 * last pass (`Keeper.flush`).
 */

/** The pauses between passes after a busy store refused one: they grow, then stay at the last. */
const PAUSES_MS = [250, 500, 1_000, 2_000] as const;

/** The longest pause between two passes. */
export const MAX_PAUSE_MS = PAUSES_MS[PAUSES_MS.length - 1];

/** How one pass ended: everything it took was written or decided, or some is left for a later pass. */
export type PassEnd = "done" | "left";

export class EarlyWrites {
  readonly #pass: () => Promise<PassEnd>;
  #running: Promise<void> | null = null;
  #again = false;
  #stopped = false;
  #timer: NodeJS.Timeout | null = null;
  #busy = 0;

  /** `pass` writes what is queued; it never rejects. */
  constructor(pass: () => Promise<PassEnd>) {
    this.#pass = pass;
  }

  /** Whether `stop` was called: a pass then gives up at its next busy refusal. */
  get stopped(): boolean {
    return this.#stopped;
  }

  /** Something was queued: a pass starts now, or once the running one ends; never during a pause. */
  kick(): void {
    if (this.#stopped) return;
    if (this.#running !== null || this.#timer !== null) {
      this.#again ||= this.#running !== null;
      return;
    }
    this.#running = this.#loop().finally(() => {
      this.#running = null;
    });
  }

  /** No pass starts any more; resolves once the running one ended. */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  async #loop(): Promise<void> {
    for (;;) {
      this.#again = false;
      const end = await this.#pass();
      if (this.#stopped) return;
      if (end === "left") {
        const pause = PAUSES_MS[Math.min(this.#busy, PAUSES_MS.length - 1)] ?? MAX_PAUSE_MS;
        this.#busy += 1;
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.kick();
        }, pause);
        this.#timer.unref();
        return;
      }
      this.#busy = 0;
      if (!this.#again) return;
    }
  }
}
