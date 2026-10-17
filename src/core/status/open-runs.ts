import type {
  DaemonLiveness,
  RunRecord,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";

/**
 * The runs the worktree's live daemon has open, oldest first: those with no
 * end that it started (task 011-12). A run an earlier daemon left open, or
 * one of a daemon that is down, runs nothing now.
 */
export function openRuns(
  store: Store,
  worktree: WorktreeRecord | null,
  daemon: DaemonLiveness,
): readonly RunRecord[] {
  const record = worktree?.daemon ?? null;
  if (worktree === null || record === null || daemon.state !== "alive") return [];
  return store.runs.inFlight(worktree.id, record.startedAt);
}

/** The open runs of `worktreeId`'s live daemon, read from its row. */
export function openRunsOf(
  store: Store,
  worktreeId: WorktreeId,
  daemon: DaemonLiveness,
): readonly RunRecord[] {
  return openRuns(store, store.worktrees.get(worktreeId), daemon);
}
