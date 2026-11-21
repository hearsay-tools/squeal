import type { TakeBackResult } from "../types/scheduler.js";
import type { Ledger } from "./ledger.js";
import type { RunQueue } from "./queue.js";
import type { Request } from "./request-intake-types.js";

/*
 * Spec 023 D4.11 (row 023-34, T1; lessons round 5; a change in spec 011's
 * files approved by 023's coordinator): `status --at --run` gives back
 * what it queued in the worktree's daemon. In round 5 a wide `--run` left
 * about 1,300 files queued there after its budget ended, and the narrowed
 * call that followed waited behind them for its whole budget. A narrow
 * run (`narrowRequest`) records, under the id of its covered files, the
 * files it queued itself and its batch's promotion; `take-back` with those
 * ids takes out of the queue each such file that has not started. A file
 * stays when it runs, was forced (`run --all --force`), an edit queued it
 * again (recent), or a promotion other than the request's own holds it (a
 * named wait or a later narrow run). No tier in flight is cancelled.
 */

/** What one narrow run queued itself: its files' `testFileId`s and its batch's promotion. */
export interface Queued {
  readonly ids: readonly string[];
  /** The promotion its batch formed (`RunQueue.promote`), `null` when it formed none. */
  readonly promotion: number | null;
}

/** How many narrow runs' records are kept: the newest, as `run-group-status` keeps its requests. */
const KEPT = 256;

/** The narrow runs' records, by the id of their covered files; the newest `KEPT`. */
export class TakeBacks {
  readonly #queued = new Map<string, Queued>();

  record(coveredId: string, queued: Queued): void {
    this.#queued.set(coveredId, queued);
    for (const old of this.#queued.keys()) {
      if (this.#queued.size <= KEPT) break;
      this.#queued.delete(old);
    }
  }

  /** The records of `coveredIds` that are kept; an unknown id has none. */
  of(coveredIds: readonly string[]): Queued[] {
    return coveredIds.flatMap((id) => this.#queued.get(id) ?? []);
  }

  /** Forgets `coveredIds`: a second take-back of them takes nothing. */
  forget(coveredIds: readonly string[]): void {
    for (const id of coveredIds) this.#queued.delete(id);
  }
}

/** What the queue and the ledger say of one file, as the decision reads it. */
export interface TakeBackView {
  readonly queued: (id: string) => boolean;
  readonly running: (id: string) => boolean;
  readonly forced: (id: string) => boolean;
  readonly recent: (id: string) => boolean;
  /** A live promotion other than `own` holds it. */
  readonly promotedElsewhere: (id: string, own: number | null) => boolean;
}

/** The files of `records` to take out of the queue, and the counts of the answer. */
export function decideTakeBack(
  records: readonly Queued[],
  view: TakeBackView,
): { readonly take: readonly string[]; readonly result: TakeBackResult } {
  const take: string[] = [];
  let running = 0;
  let kept = 0;
  const seen = new Set<string>();
  for (const { ids, promotion } of records) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (view.running(id)) running++;
      else if (!view.queued(id)) continue;
      else if (view.forced(id) || view.recent(id) || view.promotedElsewhere(id, promotion)) kept++;
      else take.push(id);
    }
  }
  return { take, result: { takenBack: take.length, running, kept } };
}

/** The real queue and ledger as `decideTakeBack` reads them, at one reading of the promotions' clock. */
export function viewOf(ledger: Ledger, queue: RunQueue): TakeBackView {
  const now = queue.promotionsNow();
  const ref = (id: string) => ledger.files.get(id)?.ref;
  const has = (id: string, test: (r: NonNullable<ReturnType<typeof ref>>) => boolean) => {
    const r = ref(id);
    return r !== undefined && test(r);
  };
  return {
    queued: (id) => has(id, (r) => queue.has(r)),
    running: (id) => (ledger.files.get(id)?.runningKey ?? null) !== null,
    forced: (id) => has(id, (r) => queue.isForced(r)),
    recent: (id) => has(id, (r) => queue.isRecent(r)),
    promotedElsewhere: (id, own) => has(id, (r) => queue.promotedElsewhere(r, own, now)),
  };
}

const NOTHING: TakeBackResult = { takenBack: 0, running: 0, kept: 0 };

/**
 * `take-back` as the request intake takes it: under the lock, the files
 * `coveredIds`' narrow runs queued that may leave do, in one transaction.
 * The ids are forgotten, so the files a later request queues stay its own.
 */
export function takeBackRequest(
  coveredIds: readonly string[],
  takeBacks: TakeBacks,
): Request<TakeBackResult> {
  return {
    operation: "taking back the files a status --at --run queued",
    start: { closed: NOTHING, nothing: coveredIds.length === 0 },
    installWait: { atOnce: NOTHING },
    runnerWork: { skip: "waits for no runner work: it only takes queued files out" },
    store: {
      record: { skip: "covers no file: it queues none" },
      stage: (_context, ledger) => {
        const records = takeBacks.of(coveredIds);
        takeBacks.forget(coveredIds);
        const view = viewOf(ledger, ledger.queue);
        const { take, result } = decideTakeBack(records, view);
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
