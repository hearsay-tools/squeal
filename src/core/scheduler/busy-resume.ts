import { type BusyWaits, busyBackoffMs } from "../store/index.js";

/** The pump's key in `BusyWaits`: one wait however many of its writes gave up. */
const PUMP = "scheduler";

/**
 * Task 001-422: a write of the pump or of a tier's record that gave up on a
 * busy store is no stall left for the next batch. The pump resumes after
 * `busyBackoffMs`, once however many gave up, until one of its writes lands.
 */
export class BusyResume {
  #timer: NodeJS.Timeout | null = null;
  #attempts = 0;
  #waiting = false;

  readonly #waits: BusyWaits;
  readonly #resume: () => void;

  constructor(waits: BusyWaits, resume: () => void) {
    this.#waits = waits;
    this.#resume = resume;
  }

  /** A resume is scheduled: the scheduler is not idle. */
  get pending(): boolean {
    return this.#timer !== null;
  }

  /** A write gave up and none of the pump's has landed since. */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** A write gave up; `what` waits for the pump to resume. */
  gaveUp(what: string): void {
    this.#waiting = true;
    this.#waits.waiting(PUMP, what);
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#resume();
      },
      busyBackoffMs(this.#attempts++),
    );
  }

  /** A write of the pump landed: the wait, if any, is over. */
  landed(): void {
    if (!this.#waiting) return;
    this.#waiting = false;
    this.#attempts = 0;
    this.#waits.ran(PUMP);
  }

  close(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
