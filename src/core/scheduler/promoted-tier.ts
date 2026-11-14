import { pendingAt, RETRIES_META_KEY, type RetryRecord, readRetries } from "../retry/records.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { SelectedFacts } from "./promotions.js";

/**
 * The estimated wall time a batch's tier selects at most: `runner.timeoutMs`,
 * since a tier estimated past the run's deadline would time out (C4's
 * timeout rule; Recommendation 5: at 2 workers the 55-file batch's estimate
 * is about 1,900 s, more than cezar's 900 s); none without a deadline. Not
 * the backlog's 120 s budget, which kept the gate in tiers of 4 to 11.
 */
export function batchBudget(timeoutMs: number | null): number {
  return timeoutMs ?? Number.POSITIVE_INFINITY;
}

/**
 * Row 011-283 (review `reviews/0.1.384.md` B1): what `Promotions` asks of a
 * named wait's file it has not seen queued: its key now, and whether it has
 * its answer there, a result at that key with no `squeal retry` pending at
 * it. A retry the load gate holds is no answer, so its wait stays open for
 * the run (gh-127); a file current when the wait came, or made current by
 * a shared result since, holds nothing. The store is read only for a file
 * current at its key, and the requests are parsed again only when their row
 * changed.
 */
export function answeredOf(context: SchedulerContext, ledger: Ledger): SelectedFacts {
  let raw: string | null | undefined;
  let requests: readonly RetryRecord[] = [];
  return (ref) => {
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    if (key === null || file?.resultKey !== key) return { key, answered: false };
    const now = context.store.meta.get(RETRIES_META_KEY);
    if (now !== raw) {
      raw = now;
      requests = readRetries(context.store);
    }
    return { key, answered: !requests.some(pendingAt(ref, key)) };
  };
}
