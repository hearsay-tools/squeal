import { worktreeLiveness } from "../core/delivery/index.js";
import type { QueueReads } from "../core/retry/index.js";
import { readSlowTier, worktreeSlowView } from "../core/state/index.js";
import { openRunsOf } from "../core/status/index.js";
import type { KnownState, Store, WorktreeId } from "../core/types/index.js";

/**
 * What the live daemon recorded that a retry's queued run waits on, as
 * `squeal retry` answers (row 011-272, gh-114): its open runs and its slow
 * tier's activity as status reads them; none without a live daemon, whose
 * records may be old. `states` are the worktree's, read by the caller.
 */
export function queueReads(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
): QueueReads {
  const view = worktreeSlowView(store, worktreeId);
  const isSlow = view?.isSlow ?? (() => false);
  const daemon = worktreeLiveness(store.worktrees.get(worktreeId), Date.now());
  if (daemon.state !== "alive") return { isSlow, activity: null, runs: [] };
  // Every row: a running activity names only the slow files whose rows still run.
  const keys = store.testFileKeys.list(worktreeId);
  const tier = view === null ? null : readSlowTier(store, worktreeId, states, keys, view);
  return { isSlow, activity: tier?.activity ?? null, runs: openRunsOf(store, worktreeId, daemon) };
}
