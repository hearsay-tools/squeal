import { statesMark } from "../../core/store/write-markers.js";
import type { WorktreeId } from "../../core/types/common.js";
import type { KnownState } from "../../core/types/state.js";
import type { KnownStateRepo, Store } from "../../core/types/store.js";

/*
 * Row 005-124: one Stop listed the worktree's known states three times: for
 * its news (`newsText`, the delivery's `onToolBoundary` and the failure line),
 * for its decision (`decide`, and `holdsNow` with required checks) and for the
 * turn's end (`endTurn`). On a large store each list costs 186 to 250 ms SQL
 * and about 50 ms decode (`research/boundary-hook-cost.md`, section 3).
 *
 * `keepStates` makes the hook's store keep its last full list with the
 * states marker it was read at (`statesMark`, rows 011-44 and 011-45: the
 * database's triggers move it in the writing transaction on every write to
 * the worktree's `known_states` rows, whoever writes). A later full list
 * reads the marker and returns the kept list while the marker is unchanged,
 * else it reads again, as `status --wait` does (`readEvery`). So each read
 * returns what a fresh list would return at that moment:
 *
 * - The marker is read before the rows. Outside a transaction a write between
 *   the two can only pair an old marker with newer rows; the next read then
 *   sees a different marker and reads again. It never pairs a new marker
 *   with old rows.
 * - Inside a read or write transaction the marker and the rows are of one
 *   snapshot. The hook writes no `known_states` row (only the daemon's state
 *   sink does), and a write it did make would move the marker in its own
 *   transaction, so a read after it reads again.
 * - A store without the triggers, or with no marker yet, gives `null`: every
 *   list reads in full, as before.
 *
 * Between the three reads the daemon can commit new states (a Stop waits up
 * to `stop.waitMs` and for the waiting entry's record): the marker then
 * moved, and the next read lists them again. A list for some files only is
 * never kept.
 */

interface Kept {
  readonly worktreeId: WorktreeId;
  readonly mark: string;
  readonly states: readonly KnownState[];
}

/**
 * Replaces `store.knownStates` in place with one that keeps its last full
 * list while the worktree's states marker stands. In place, since the
 * hook's delivery holds this store and reads `store.knownStates` at each
 * call. For one hook call's store only.
 */
export function keepStates(store: Store): void {
  const repo = store.knownStates;
  let kept: Kept | null = null;
  const keeping: KnownStateRepo = {
    list: (worktreeId, files) => {
      if (files !== undefined) return repo.list(worktreeId, files);
      const mark = statesMark(store, worktreeId);
      if (mark !== null && kept?.worktreeId === worktreeId && kept.mark === mark) {
        return kept.states;
      }
      const states = repo.list(worktreeId);
      kept = mark === null ? null : { worktreeId, mark, states };
      return states;
    },
    untold: (consumer) => repo.untold(consumer),
    get: (worktreeId, check) => repo.get(worktreeId, check),
    upsertMany: (states) => {
      kept = null;
      repo.upsertMany(states);
    },
    removeMany: (worktreeId, checks) => {
      kept = null;
      repo.removeMany(worktreeId, checks);
    },
  };
  (store as { knownStates: KnownStateRepo }).knownStates = keeping;
}
