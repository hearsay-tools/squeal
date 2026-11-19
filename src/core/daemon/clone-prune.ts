import type { PruneSlice } from "../store/prune.js";
import type { EpochMs } from "../types/common.js";
import type { Store } from "../types/store.js";

/**
 * The main store's meta row that holds when a daemon of the clone last began
 * its prune, in epoch ms (row 021-33). A row shared by every worktree.
 */
export const PRUNED_AT_KEY = "prune:last-at";

/**
 * How much earlier than a full interval a prune may begin again: a tenth of
 * it, at most a minute. Without it a daemon whose own timer fires a little
 * before the interval ends after its last prune would skip its next one.
 */
function slackMs(intervalMs: number): number {
  return Math.min(60_000, intervalMs / 10);
}

/** Whether `value`, a mark read from the store, names a prune begun in the last interval before `at`. */
function fresh(value: string | null, at: EpochMs, intervalMs: number): boolean {
  if (value === null) return false;
  const since = at - Number(value);
  // A mark ahead of the clock (it moved back) or unreadable is stale.
  return since >= 0 && since < intervalMs - slackMs(intervalMs);
}

/**
 * Row 021-33: the slices `slices` makes, once per `intervalMs` per clone
 * whatever the number of daemons on it. The first slice reads the mark
 * outside the write lock; a fresh mark ends the prune there, with no write.
 * Otherwise the next slice claims the mark in one write that reads it again,
 * so of the daemons that found it stale together one prunes; `claimed` is
 * told when this one did.
 */
export function* oncePerClone(
  store: Pick<Store, "meta" | "transaction">,
  at: EpochMs,
  intervalMs: number,
  slices: () => Iterable<PruneSlice>,
  claimed: () => void,
): Generator<PruneSlice, void, undefined> {
  let due = false;
  yield () => {
    due = !fresh(store.meta.get(PRUNED_AT_KEY), at, intervalMs);
  };
  if (!due) return;
  let won = false;
  yield () => {
    won = store.transaction(() => {
      if (fresh(store.meta.get(PRUNED_AT_KEY), at, intervalMs)) return false;
      store.meta.set(PRUNED_AT_KEY, String(at));
      return true;
    });
  };
  if (!won) return;
  claimed();
  yield* slices();
}
