import { setTimeout as sleep } from "node:timers/promises";
import type { Mutex } from "./mutex.js";

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
  #commitMs = 0;

  constructor(options: SlotRecordsOptions<E, R>) {
    this.#options = options;
  }

  /** Records the slot whose run ended, `ended` its reads outside the lock. */
  async record(ended: Promise<E>): Promise<R> {
    const outcome = new Promise<R>((resolve, reject) => {
      this.#ended.push({ ended, resolve, reject });
    });
    // Its rejection is the slot's outcome's, below.
    ended.catch(() => {});
    const gather = Math.max(SLOT_GATHER_MS, SLOT_GATHER_COMMITS * this.#commitMs);
    this.#gathering ??= sleep(gather).then(() => {
      this.#gathering = null;
    });
    await this.#gathering;
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
      const started = performance.now();
      try {
        this.#options.commit();
        this.#commitMs = performance.now() - started;
      } catch (error) {
        for (const { slot } of recorded) slot.reject(error);
        return;
      }
      for (const { slot, record } of recorded) slot.resolve(record);
    });
    return outcome;
  }
}
