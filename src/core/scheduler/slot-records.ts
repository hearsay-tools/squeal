import type { EpochMs } from "../types/common.js";
import { elapsed } from "./clock.js";
import type { Mutex } from "./mutex.js";
import type { WakeSlot, Wakes } from "./wakes.js";

/**
 * How long a record of slots waits at least for the slots that end
 * meanwhile: slots a selection started together end within tens of
 * milliseconds of each other.
 */
const SLOT_GATHER_MS = 25;
/**
 * How many times the last commit a record of slots waits: a slot that ends
 * during a commit waits for it to end before the pump refills it, so
 * commits hold the thread a quarter of the time at most.
 */
const SLOT_GATHER_COMMITS = 3;

/** A slot's ended run waiting for the next record. */
interface EndedSlot<E, R> {
  readonly ended: Promise<E>;
  resolve(record: R): void;
  reject(error: unknown): void;
}

export interface SlotRecordsOptions<E, R> {
  /** The scheduler's lock: records run under it. */
  readonly lock: Mutex;
  /** Records one ended slot under the lock, leaving its writes to `commit`. */
  record(ended: E): Promise<R>;
  /** Commits what the records wrote. */
  commit(): void;
  /** The clock a commit's time is read on (row 011-351). */
  readonly now: () => EpochMs;
  /** The scheduler's wake loop, which ends a gather (row 011-352). */
  readonly wakes: Wakes;
}

/**
 * The records of backlog slots (spec 011 C4 step 5 as amended for slots,
 * task 011-21 slice 2): each slot's, together with the slots that end
 * meanwhile, in one commit. Each commit's sink call lists every known state
 * of the worktree, 55 to 340 ms of write lock on cezar's store
 * (`mergeApplied`), and holds the thread meanwhile, so the slots that end
 * during one commit are recorded by the next. A record first waits, outside
 * the lock, `SLOT_GATHER_COMMITS` times as long as the last commit took and
 * at least `SLOT_GATHER_MS`, so they join it while the pump refills their
 * slots; then it takes every slot that ended until none is left. A slot
 * joins as its run ends, before its reads; one an earlier record took gets
 * that record's outcome. An error fails only the slots whose records it
 * reached.
 */
export class SlotRecords<E, R> {
  readonly #options: SlotRecordsOptions<E, R>;
  readonly #ended: EndedSlot<E, R>[] = [];
  /** The wait of the next record, while one is open. */
  #gathering: Promise<void> | null = null;
  /** Ends the open wait: the gather's wake (row 011-352). */
  #gathered: (() => void) | null = null;
  readonly #wake: WakeSlot;
  /** The scheduler's loop, whose named wait the gather takes. */
  readonly #wakes: Wakes;
  readonly #now: () => EpochMs;
  #commitMs = 0;

  constructor(options: SlotRecordsOptions<E, R>) {
    this.#options = options;
    this.#now = options.now;
    this.#wakes = options.wakes;
    this.#wake = options.wakes.slot("slot-gather", () => this.#gathered?.());
  }

  /** Records the slot whose run ended, `ended` its reads outside the lock. */
  async record(ended: Promise<E>): Promise<R> {
    const outcome = new Promise<R>((resolve, reject) => {
      this.#ended.push({ ended, resolve, reject });
    });
    // Its rejection is the slot's outcome's, below.
    ended.catch(() => {});
    // A record may fail this slot while it still awaits a later slot's reads, before this call
    // returns `outcome`: handled here, so Node does not exit on it (review wave-4 slice 2, B1).
    outcome.catch(() => {});
    this.#gathering ??= this.#gather();
    // The gather waits for its stated wake: a named wait, so a rest can come meanwhile (011-352).
    await this.#wakes.waitFor({ for: "wake", reason: "slot-gather" }, this.#gathering);
    await this.#options.lock.run(async () => {
      const recorded: { slot: EndedSlot<E, R>; record: R }[] = [];
      for (let slot = this.#ended.shift(); slot; slot = this.#ended.shift()) {
        try {
          recorded.push({ slot, record: await this.#options.record(await slot.ended) });
        } catch (error) {
          slot.reject(error);
        }
      }
      if (recorded.length === 0) return;
      const now = this.#now;
      const started = now();
      try {
        this.#options.commit();
        this.#commitMs = elapsed(started, now());
      } catch (error) {
        for (const { slot } of recorded) slot.reject(error);
        return;
      }
      for (const { slot, record } of recorded) slot.resolve(record);
    }, "recording the results of backlog slots");
    return outcome;
  }

  /** The record's wait: `SLOT_GATHER_COMMITS` times the last commit, at least `SLOT_GATHER_MS`. */
  #gather(): Promise<void> {
    const gather = Math.max(SLOT_GATHER_MS, SLOT_GATHER_COMMITS * this.#commitMs);
    return new Promise<void>((resolve) => {
      this.#gathered = () => {
        this.#gathering = null;
        this.#gathered = null;
        resolve();
      };
      this.#wake.at((this.#now() + gather) as EpochMs);
    });
  }
}
