import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../daemon/client.js";
import { readRevisionCommit } from "../state/revision-commit.js";
import { readGitHead } from "../status/git-head.js";
import {
  type AbsolutePath,
  DAEMON_SOCKET_TIMEOUT_MS,
  type DaemonRequest,
  type DaemonResponse,
  type Store,
  type WorktreeId,
} from "../types/index.js";
import { readCommitReports } from "./store.js";

/**
 * Row 019-29 (lessons round 1, P2 option a): how long the tool boundary
 * that asked for a pass waits for it to store the commit's report, inside
 * the hook's 2 s timeout, so the report's line comes in that delivery.
 */
export const HEAD_MOVE_WAIT_MS = 500;

/** The pause between two asks for the pass's state. */
const PASS_POLL_MS = 20;

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

/** The two bounds of `syncOnHeadMove`: each request's socket timeout, and the whole wait for the pass. */
export interface HeadMoveBounds {
  readonly socketMs?: number;
  readonly waitMs?: number;
}

/**
 * Asks the worktree's daemon for a `sync` pass when `HEAD` moved since its
 * last look, so a commit is reported now, not at the idle pass up to 30 s
 * later, and waits up to `HEAD_MOVE_WAIT_MS` for that pass to end: the pass
 * stores the commit's report before it answers (row 019-29). With no move
 * it asks nothing and waits for nothing. A daemon that does not answer the
 * `sync` within the socket bound, answers an error or forgets the request
 * is not waited for, and is left to its idle pass; a status ask with no
 * answer is asked again while the wait lasts, each ask bounded by what is
 * left of it. An older daemon's pass records the move as it always did, so
 * the store's `HEAD` stops differing. True when it asked.
 */
export async function syncOnHeadMove(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  bounds: HeadMoveBounds = {},
): Promise<boolean> {
  if (!headMovedSinceLook(store, worktreeId, root)) return false;
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null) return false;
  const { socketMs = DAEMON_SOCKET_TIMEOUT_MS, waitMs = HEAD_MOVE_WAIT_MS } = bounds;
  const deadline = performance.now() + waitMs;
  const ask = (request: DaemonRequest, timeoutMs: number) =>
    requestDaemon(record.socketPath, request, timeoutMs).catch(() => null);
  const requestId = pending(await ask({ type: "sync" }, socketMs));
  if (requestId === null) return true;
  for (;;) {
    await sleep(Math.min(PASS_POLL_MS, Math.max(0, deadline - performance.now())));
    const left = deadline - performance.now();
    if (left <= 0) return true;
    const answer = await ask({ type: "sync-status", requestId }, Math.min(socketMs, left));
    if (answer !== null && pending(answer) === null) return true;
  }
}

/** The request id of a `sync` answer whose pass has not ended; `null` for any other answer. */
function pending(answer: DaemonResponse | null): string | null {
  if (answer === null || !answer.ok || answer.type !== "sync") return null;
  return answer.revision === null && answer.error === null ? answer.requestId : null;
}
