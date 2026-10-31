import { RETRIES_META_KEY, readRetries } from "../retry/index.js";
import { pendingAt, type RetryRecord } from "../retry/records.js";
import type { TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { SelectedFacts } from "./promotions.js";
import { backlogSlot } from "./slots.js";

/**
 * The promoted files (C15) a batch's tier takes, or `null` when none is due
 * (spec 011 C4 step 5 and C15 as amended 2026-10-29, row 011-268,
 * `research/named-wait-batches.md` Recommendation 1: at 11 workers the
 * 56-file gate's verdict took 364 and 327 s in a one-lane replay against
 * 1,978 and 2,053 s recorded).
 *
 * Such a tier is due while a free lane, whose runner runs its backlog in
 * tiers, holds a promoted file, whether or not an edit's work is queued. It
 * holds the files of one batch, the first with a file that can start, in
 * `RunQueue.orderedBatches`' order, longest first. It is chosen as the
 * backlog's, a grant from the pool that it waits for, with no wall budget:
 * up to `runner.backlogTierSize` files within `batchBudget`. In flight it is
 * a backlog tier (`Tier.promoted`). Its files stay in their batch while
 * they run, so only a revision that supersedes it cancels it, an edit's
 * work does not make it yield (`cancelsBacklog`, `TierYields`, row
 * 011-265), and a later batch's file ranks after its own and does not cut
 * it (`rankToBeat`). It does not count toward the four first-group tiers
 * before the backlog's turn; after it, while a file of the second group is
 * queued, the backlog's turn is due (`batchTurnDue`). A lane's wait for
 * quiet does not hold it (row 011-82). When none of its files can start,
 * each waiting on another worktree's claim of its key (C7), the selection
 * runs again without this rule (`selectTier`'s `wide`), so the backlog does
 * not stall behind the claim.
 *
 * A lane whose runner runs its backlog in slots (`backlogSlot`: node:test,
 * pytest) keeps its promoted files in an edit's tier: its backlog tier is
 * one slot, narrower than `runner.tierSize` (coordinator, 2026-10-28).
 */
export function batchFiles(
  context: SchedulerContext,
  ledger: Ledger,
  free: (ref: TestFileRef) => boolean,
): ((ref: TestFileRef) => boolean) | null {
  const { queue } = ledger;
  const takes = (ref: TestFileRef) =>
    free(ref) && queue.isPromoted(ref) && backlogSlot(context, ref) === null;
  return queue.hasFast(takes) ? takes : null;
}

/**
 * The backlog's turn is due after a batch's tier (row 011-268,
 * Recommendation 4; review `reviews/0.1.378.md` B1): a batch's tier was
 * selected while the second group waited, no tier has taken a file of it
 * since, and one is queued in a free lane. It is C4 step 4's turn after
 * four first-group tiers: selected while an edit's work is queued,
 * `runner.tierSize` files of a comparable time, a grant, cancelled only by
 * supersession and cut by no wait (`TierKind` `turn`). An edit's tier does
 * not discharge it. A stream of waits then moves the backlog by one tier
 * after each batch tier, and the gate's verdict does not move (435 s
 * against 1,607 s for the unnamed files' first result in the heavy stream).
 */
export function batchTurnDue(ledger: Ledger, free: (ref: TestFileRef) => boolean): boolean {
  const { queue } = ledger;
  return queue.batchTurn() && queue.hasFast((ref) => free(ref) && !queue.isFirstGroup(ref));
}

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
