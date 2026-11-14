/**
 * Spec 021 D3 (row 021-09): the least pause after a slice of a long write,
 * with the store's write lock free. The pause is as long as the slice held
 * the lock, so the writer holds it at most half the time, and a process
 * whose busy handler tries every 1 to 100 ms finds it free in about half its
 * tries; a writer that took it back at once kept it from them
 * (`store-contention.md` Q3: two holders with 10 ms gaps failed a 10 s wait
 * 4 times in 20).
 */
export const MIN_PRUNE_GAP_MS = 10;

/**
 * Row 011-350 (#220): the pause after a slice that held the write lock
 * `heldMs`: as long as the hold, and at least `MIN_PRUNE_GAP_MS`. A store
 * shared by every worktree's daemon gives a waiting writer turns only in
 * these pauses (`issue-220.md` Q1: back-to-back 50 ms or 250 ms
 * transactions let a waiter in 0 times in 8 s; with a pause as long as the
 * hold, 68 to 188 times). Every loop of back-to-back write transactions
 * pauses by this rule: the daemon's prunes (`SlicedPrune`) and the import
 * (`importSliced`).
 */
export function turnGapMs(heldMs: number): number {
  return Math.max(MIN_PRUNE_GAP_MS, Math.ceil(heldMs));
}
