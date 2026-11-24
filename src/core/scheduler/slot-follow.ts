import type { SlotRun } from "../slow/slot-holding.js";
import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Ledger } from "./ledger.js";

/*
 * Row 023-78 (dogfood round 10, Z2; spec 023 D7.3): one `status --at
 * --run` call queues the same files of a group on the commit side and in
 * the working tree, two worktrees of one repository that share the group's
 * `maxParallel` slot (`tasks/023-71-notes.md`). Spec 004 D2's handover
 * already gives the slot to the two sides in turn: a holder between files
 * yields one turn to a marked waiter. What each side ran in its turn was its
 * own queue's first file, and the two queues can differ (the working tree
 * queues the change's files in a request of their own, a side that started
 * later is behind), so slot turns passed with no file run on both sides.
 *
 * Now the side that takes the slot runs first a file the other worktree
 * ran under it, when that file is queued here by a `status --at --run`
 * request (`PromotionRank.place`, row 023-68): the commit side's run of a
 * file, then the working tree's run of that file, then the leader's next
 * file. Row 023-83 (round 11, AA2): of those, the one the other worktree
 * ran first, not its latest, so a side that came late pairs the leader's
 * files in the leader's order, its first file first. It only reorders the files that may run now: it waits for no one,
 * so a side whose partner has nothing queued, is gone, or ran a file this
 * side was not asked for runs its own order at once. A file a call named
 * (a leading batch, row 023-34) stays ahead of a partner's file no call
 * named here.
 */

/**
 * `refs`, the files of the lane that may run now in its order, with the
 * file another worktree ran first under the slot first, of those this
 * side's `status --at --run` request holds. `runs` gives the other
 * worktrees' runs, each file once, the first run first (`partnerRuns`); it
 * is called only when such a request holds a file of `refs`.
 */
export function followPartner(
  refs: readonly TestFileRef[],
  ledger: Ledger,
  at: EpochMs,
  runs: () => readonly SlotRun[],
): readonly TestFileRef[] {
  if (refs.length < 2) return refs;
  const ranks = refs.map((ref) => ledger.queue.rankAt(ref, at));
  if (!ranks.some((rank) => rank?.place !== undefined)) return refs;
  const lead = ranks[0];
  for (const run of runs()) {
    const index = refs.findIndex((r) => r.project === run.project && r.path === run.path);
    if (index === 0) return refs;
    const rank = ranks[index];
    if (index < 0 || rank?.place === undefined) continue;
    // A named file (a leading batch) goes first, as before.
    if (lead != null && lead.rank < 0 && rank.rank > lead.rank) continue;
    return [refs[index] as TestFileRef, ...refs.filter((_, i) => i !== index)];
  }
  return refs;
}
