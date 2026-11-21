import type { TakeBackResult } from "../types/scheduler.js";
import type { Ledger } from "./ledger.js";
import type { RunQueue } from "./queue.js";
import type { Request } from "./request-intake-types.js";

/*
 * Spec 023 D4.11 (row 023-34, T1; lessons round 5; a change in spec 011's
 * files approved by 023's coordinator): `status --at --run` gives back
 * what it queued in the worktree's daemon. In round 5 a wide `--run` left
 * about 1,300 files queued there after its budget ended, and the narrowed
 * call that followed waited behind them for its whole budget.
 *
 * Each narrow run of such a call carries the call's own identity, its
 * owner, from before the scheduler takes it (review wave-20 B3). A
 * take-back of an owner first cancels it, so a request of it still
 * pending queues nothing when it is taken later. Then each file the
 * owner's runs queued or shared gives the owner up (`RunQueue.release`):
 * its entry leaves the queue once no request and nothing else needs it.
 * An entry anything else queued (an edit, catch-up, a demoted reader, a
 * forced or ordinary request) is nobody's and stays (review wave-20 B1).
 * A file that runs goes on, and one another promotion holds stays. No tier
 * in flight is cancelled.
 */

/** What one owner's narrow runs queued or shared: their files and their batches' promotions. */
export interface Queued {
  readonly ids: readonly string[];
  /** The promotions their batches formed (`RunQueue.promote`). */
  readonly promotions: readonly number[];
}

/** How many owners' records and cancellations are kept: the newest. */
const KEPT = 256;

/** The owners' records and the owners taken back; the newest `KEPT` of each. */
export class TakeBacks {
  readonly #queued = new Map<string, Queued>();
  readonly #cancelled = new Set<string>();

  /** `owner`'s narrow run queued or shared `queued`, beside what its earlier runs did. */
  record(owner: string, queued: Queued): void {
    const earlier = this.#queued.get(owner);
    this.#queued.delete(owner);
    this.#queued.set(owner, {
      ids: [...(earlier?.ids ?? []), ...queued.ids],
      promotions: [...(earlier?.promotions ?? []), ...queued.promotions],
    });
    for (const old of this.#queued.keys()) {
      if (this.#queued.size <= KEPT) break;
      this.#queued.delete(old);
    }
  }

  /** B3: `owners` are taken back: a request of them taken from now on queues nothing. */
  cancel(owners: readonly string[]): void {
    for (const owner of owners) {
      this.#cancelled.delete(owner);
      this.#cancelled.add(owner);
    }
    for (const old of this.#cancelled) {
      if (this.#cancelled.size <= KEPT) break;
      this.#cancelled.delete(old);
    }
  }

  cancelled(owner: string): boolean {
    return this.#cancelled.has(owner);
  }

  /** The records of `owners`, each once, and forgets them: a second take-back takes nothing. */
  take(owners: readonly string[]): { readonly owner: string; readonly queued: Queued }[] {
    const records = [...new Set(owners)].flatMap((owner) => {
      const queued = this.#queued.get(owner);
      return queued === undefined ? [] : [{ owner, queued }];
    });
    for (const owner of owners) this.#queued.delete(owner);
    return records;
  }
}

/** What the queue and the ledger say of one file, as the decision reads it. */
export interface TakeBackView {
  readonly running: (id: string) => boolean;
  /** A live promotion other than `own` holds it. */
  readonly promotedElsewhere: (id: string, own: readonly number[]) => boolean;
  /** `owner` gives the file up (`RunQueue.release`). */
  readonly release: (id: string, owner: string) => "free" | "kept" | "absent";
}

/** The files of `records` to take out of the queue, and the counts of the answer. */
export function decideTakeBack(
  records: readonly { readonly owner: string; readonly queued: Queued }[],
  view: TakeBackView,
): { readonly take: readonly string[]; readonly result: TakeBackResult } {
  const take = new Set<string>();
  const running = new Set<string>();
  const kept = new Set<string>();
  for (const { owner, queued } of records) {
    for (const id of queued.ids) {
      if (view.running(id)) {
        running.add(id);
        continue;
      }
      if (view.promotedElsewhere(id, queued.promotions)) {
        kept.add(id);
        continue;
      }
      const released = view.release(id, owner);
      if (released === "free") take.add(id);
      else if (released === "kept") kept.add(id);
    }
  }
  for (const id of take) kept.delete(id);
  const result = { takenBack: take.size, running: running.size, kept: kept.size };
  return { take: [...take], result };
}

/** The real queue and ledger as `decideTakeBack` reads them, at one reading of the promotions' clock. */
export function viewOf(ledger: Ledger, queue: RunQueue): TakeBackView {
  const now = queue.promotionsNow();
  const ref = (id: string) => ledger.files.get(id)?.ref;
  return {
    running: (id) => (ledger.files.get(id)?.runningKey ?? null) !== null,
    promotedElsewhere: (id, own) => {
      const r = ref(id);
      return r !== undefined && queue.promotedElsewhere(r, own, now);
    },
    release: (id, owner) => {
      const r = ref(id);
      return r === undefined ? "absent" : queue.release(r, owner);
    },
  };
}

const NOTHING: TakeBackResult = { takenBack: 0, running: 0, kept: 0 };

/**
 * `take-back` as the request intake takes it: under the lock, the files
 * `owners`' narrow runs queued that no one else needs leave the queue, in
 * one transaction. `Scheduler.takeBack` cancels the owners before it.
 */
export function takeBackRequest(
  owners: readonly string[],
  takeBacks: TakeBacks,
): Request<TakeBackResult> {
  return {
    operation: "taking back the files a status --at --run queued",
    start: { closed: NOTHING, nothing: owners.length === 0 },
    installWait: { atOnce: NOTHING },
    runnerWork: { skip: "waits for no runner work: it only takes queued files out" },
    store: {
      record: { skip: "covers no file: it queues none" },
      stage: (_context, ledger) => {
        const { take, result } = decideTakeBack(
          takeBacks.take(owners),
          viewOf(ledger, ledger.queue),
        );
        ledger.queue.settlingOnce(() => {
          for (const id of take) {
            const file = ledger.files.get(id);
            if (file !== undefined) ledger.dequeue(file);
          }
        });
        // Their narrow asks drop once they are not pending (`CommitAsks.prune`).
        if (take.length > 0) ledger.commit();
        return { answer: result, covered: [] };
      },
    },
    wake: { skip: "queues nothing: what is left runs as before" },
  };
}
