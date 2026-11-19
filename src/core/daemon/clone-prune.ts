import type { PruneSlice } from "../store/prune.js";
import type { EpochMs } from "../types/common.js";
import type { Store } from "../types/store.js";

/**
 * The main store's meta row that holds when a daemon of the clone last
 * claimed its prune, in epoch ms (row 021-33). A row shared by every worktree.
 */
export const PRUNED_AT_KEY = "prune:last-at";

/**
 * Whether the mark `value`, read at `at`, names a prune claimed less than
 * `intervalMs` before. A mark ahead of the clock when read (the clock moved
 * back) or unreadable is due, so neither stops prunes for good.
 */
function fresh(value: string | null, at: EpochMs, intervalMs: number): boolean {
  if (value === null) return false;
  const since = at - Number(value);
  return since >= 0 && since < intervalMs;
}

/**
 * Row 021-33: the slices `slices` makes, at most once per `intervalMs` per
 * clone whatever the number of daemons on it. The first slice reads the mark
 * outside the write lock, at `clock()`; a fresh mark ends the prune there,
 * with no write. Otherwise the next slice claims it in one write transaction,
 * only if the mark is still the value the first read: a different value is a
 * competing daemon's claim, whatever its time, and this one prunes nothing.
 * The claim writes `clock()` as it is then, so a delayed claim counts its
 * interval from when it was made. `claimed` is told when this one claimed.
 * A claim whose prune never ran (its daemon stopped) is due an interval
 * later, as any other.
 */
export function* oncePerClone(
  store: Pick<Store, "meta" | "transaction">,
  clock: () => EpochMs,
  intervalMs: number,
  slices: () => Iterable<PruneSlice>,
  claimed: () => void,
): Generator<PruneSlice, void, undefined> {
  let seen: string | null = null;
  let due = false;
  yield () => {
    seen = store.meta.get(PRUNED_AT_KEY);
    due = !fresh(seen, clock(), intervalMs);
  };
  if (!due) return;
  let won = false;
  yield () => {
    won = store.transaction(() => {
      if (store.meta.get(PRUNED_AT_KEY) !== seen) return false;
      store.meta.set(PRUNED_AT_KEY, String(clock()));
      return true;
    });
  };
  if (!won) return;
  claimed();
  yield* slices();
}
