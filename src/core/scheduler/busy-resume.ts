import { type BusyWaits, busyBackoffMs } from "../store/index.js";

/** The pump's key in `BusyWaits`: one wait however many of its writes gave up. */
const PUMP = "scheduler";
/** The key of the records that wait for their retry (row 011-126): another error leaves them waiting. */
const RECORDS = "scheduler:records";

/**
 * Task 001-422: a write of the pump that gave up on a busy store is no
 * stall left for the next batch. The pump resumes after `busyBackoffMs`,
 * once however many gave up, until one of its writes lands.
 *
 * Row 011-126: a tier's record that gave up keeps the run's results and
 * waits here for its turn. Each resume lets the oldest record try again
 * first, and each record that lands lets the next go at once, so their
 * slices never stack in one tick; the pump resumes once none waits.
 */
export class BusyResume {
  #timer: NodeJS.Timeout | null = null;
  #attempts = 0;
  #waiting = false;
  /** The turns of the records that gave up, oldest first. */
  readonly #records: (() => void)[] = [];

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
    this.#arm();
  }

  /**
   * A tier's record gave up (row 011-126); `what` names it. Settles at its
   * turn: a later resume, or a write landing first, or the close, for its
   * last try.
   */
  retry(what: string): Promise<void> {
    this.#waits.waiting(RECORDS, what);
    const turn = new Promise<void>((resolve) => this.#records.push(resolve));
    this.#arm();
    return turn;
  }

  /** A write of the pump or a record landed: the store is free, so the next record goes, or the wait is over. */
  landed(): void {
    if (this.#turn()) return;
    this.#attempts = 0;
    this.#waits.ran(RECORDS);
    if (!this.#waiting) return;
    this.#waiting = false;
    this.#waits.ran(PUMP);
    this.#resume();
  }

  /**
   * Another error stopped the pump (review 001-432, B1): the resume
   * scheduled is dropped, and what waited never ran, so the episode's note
   * does not name it. A later `gaveUp` starts a wait again. The records that
   * wait keep their turns (row 011-126).
   */
  abandon(): void {
    if (this.#records.length === 0) {
      this.#disarm();
      this.#attempts = 0;
    }
    if (!this.#waiting) return;
    this.#waiting = false;
    this.#waits.abandoned(PUMP);
  }

  /** Every record that waits makes its last try now. */
  close(): void {
    this.#disarm();
    for (let turn = this.#records.shift(); turn; turn = this.#records.shift()) turn();
  }

  #arm(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        if (!this.#turn()) this.#resume();
      },
      busyBackoffMs(this.#attempts++),
    );
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** The oldest record that waits tries again; false when none waits. */
  #turn(): boolean {
    const turn = this.#records.shift();
    turn?.();
    return turn !== undefined;
  }
}
