import { requestDaemon } from "../daemon/client.js";
import { readRevisionCommit } from "../state/revision-commit.js";
import { readGitHead } from "../status/git-head.js";
import {
  type AbsolutePath,
  DAEMON_SOCKET_TIMEOUT_MS,
  type Store,
  type WorktreeId,
} from "../types/index.js";
import { readCommitReports } from "./store.js";

/**
 * Spec 019 D5: at the agent's tool boundary, `HEAD` read from the git dir's
 * files, with no spawn, differs from the one the daemon last looked at: its
 * commit reports' `seen`, else, before the daemon wrote any, the `HEAD` the
 * store records. `false` when either is not known.
 */
export function headMovedSinceLook(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
): boolean {
  const head = readGitHead(root);
  if (head === null) return false;
  const row = readCommitReports(store.meta, worktreeId);
  const seen = row === null ? readRevisionCommit(store, worktreeId)?.head : row.seen;
  return seen !== undefined && seen !== null && seen !== head;
}

/**
 * Asks the worktree's daemon for a `sync` pass when `HEAD` moved since its
 * last look, so a commit is reported now, not at the idle pass up to 30 s
 * later. Nothing waits for the pass; a daemon that does not answer within
 * the hook's socket bound is left to its idle pass. An older daemon's pass
 * records the move as it always did, so the store's `HEAD` stops differing.
 * True when it asked.
 */
export async function syncOnHeadMove(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  timeoutMs = DAEMON_SOCKET_TIMEOUT_MS,
): Promise<boolean> {
  if (!headMovedSinceLook(store, worktreeId, root)) return false;
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null) return false;
  await requestDaemon(record.socketPath, { type: "sync" }, timeoutMs).catch(() => {});
  return true;
}
