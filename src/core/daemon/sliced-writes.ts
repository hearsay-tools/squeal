import {
  BUSY_SLICE_MS,
  type BusyWaits,
  busyBackoffMs,
  isBusy,
  withBusySliceSync,
} from "../store/index.js";

/** One step of a timer's writes: the name its failure is logged under, and the write. */
export type Step = readonly [string, () => void];

/**
 * Task 001-422: the timers' writes, each waiting at most `BUSY_SLICE_MS` for
 * a busy store, so none holds the event loop longer. A step that gives up
 * stops its group; the rest of the group runs again after `busyBackoffMs`,
 * and a tick of the group while that retry is pending is the retry's, so
 * retries are coalesced and never stacked. Any other failure is logged, and
 * the group goes on, as before.
 */
export class SlicedWrites {
  readonly #retries = new Map<string, NodeJS.Timeout>();
  readonly #attempts = new Map<string, number>();
  #stopped = false;

  constructor(
    private readonly context: {
      readonly log: (line: string) => void;
      readonly busyWaits?: BusyWaits | undefined;
    },
  ) {}

  /** Runs `steps`, the writes of group `what`, unless its retry is pending. */
  run(what: string, steps: readonly Step[]): void {
    if (this.#stopped || this.#retries.has(what)) return;
    const waits = this.context.busyWaits;
    for (const [index, [step, fn]] of steps.entries()) {
      try {
        if (waits === undefined) fn();
        else withBusySliceSync(BUSY_SLICE_MS, fn);
      } catch (error) {
        if (waits === undefined || !isBusy(error)) {
          this.context.log(`${step} failed: ${String(error)}`);
          continue;
        }
        waits.waiting(what, what);
        this.#retry(what, steps.slice(index));
        return;
      }
    }
    if (this.#attempts.delete(what)) waits?.ran(what);
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#retries.values()) clearTimeout(timer);
    this.#retries.clear();
  }

  #retry(what: string, steps: readonly Step[]): void {
    const attempt = this.#attempts.get(what) ?? 0;
    this.#attempts.set(what, attempt + 1);
    const timer = setTimeout(() => {
      this.#retries.delete(what);
      this.run(what, steps);
    }, busyBackoffMs(attempt));
    timer.unref();
    this.#retries.set(what, timer);
  }
}
