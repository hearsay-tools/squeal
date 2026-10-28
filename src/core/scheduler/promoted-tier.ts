import type { TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { backlogSlot } from "./slots.js";

/**
 * The promoted files (C15) a tier sized as the backlog's takes, or `null`
 * when no such tier is due (spec 011 C4 step 5 as amended 2026-10-28, row
 * 011-265, `research/issue-79-gate.md` option B: 56 named files beside 537
 * others ended in 343 s instead of 1,096 s at 23 workers, simulated).
 *
 * Such a tier is due while the lanes `free` holds hold no work an edit
 * caused and one of them holds a promoted file. It holds promoted files
 * only and is chosen as the backlog's: up to the backlog's size, within the
 * wall budget at the grant (`BacklogWall`), which it takes from the pool
 * and waits for. In flight it is a backlog tier (`Tier.promoted`). While
 * a file of it that has not ended has an open promotion, only a revision
 * that supersedes it cancels it: an edit's work in its lane waits for it to
 * end, as its cut files would go back promoted and run before the edit's
 * work (`cancelsBacklog`, `TierYields`; coordinator, 2026-10-28). With none
 * open, an edit's work cancels it as any backlog tier (review
 * `reviews/0.1.377.md` B1). It does not count toward the four first-group
 * tiers before the backlog's turn, and the turn does not go before it. A
 * lane's wait for quiet does not hold it, as it holds no promoted file (row
 * 011-82). When none of its files can start, each waiting on another
 * worktree's claim of its key (C7), the selection runs again without this
 * rule (`selectTier`'s `wide`), so the backlog does not stall behind the
 * claim.
 *
 * A lane whose runner runs its backlog in slots (`backlogSlot`: node:test,
 * pytest) keeps its promoted files in an edit's tier: its backlog tier is
 * one slot, narrower than `runner.tierSize` (coordinator, 2026-10-28).
 */
export function promotedOnly(
  context: SchedulerContext,
  ledger: Ledger,
  free: (ref: TestFileRef) => boolean,
): ((ref: TestFileRef) => boolean) | null {
  const { queue } = ledger;
  if (queue.hasRecent(free)) return null;
  const takes = (ref: TestFileRef) =>
    free(ref) && queue.isPromoted(ref) && backlogSlot(context, ref) === null;
  return queue.hasFast(takes) ? takes : null;
}
