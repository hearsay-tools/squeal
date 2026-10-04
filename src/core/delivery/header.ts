import type { KnownState, StatusHeader, Store, Validity, WorktreeId } from "../types/index.js";

/**
 * Spec 001 D6: "Every delivered message carries a header: the worktree's
 * current revision, how many checks are current, pending, stale and unknown at
 * that revision, and whether a full-suite result exists for it."
 *
 * Read from the store only, so hooks need no daemon. Counts tally
 * `known_states`, which the daemon keeps classified (see `StateSink.refresh`);
 * a check never observed in this worktree has no row and is not counted.
 * Revision `0` means no revision has been recorded yet.
 */
export function readHeader(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[] = store.knownStates.list(worktreeId),
): StatusHeader {
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  const counts: Record<Validity, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  for (const state of states) counts[state.validity]++;
  const last = store.checkpoints.lastCompleted(worktreeId);
  return {
    revision,
    counts,
    fullSuite: {
      atCurrentRevision: last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
    },
  };
}
