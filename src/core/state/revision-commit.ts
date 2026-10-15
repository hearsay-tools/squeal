import {
  headMoveMetaKey,
  parseHeadMove,
  type Revision,
  type RevisionCommit,
  type RevisionNumber,
  type Store,
  type WorktreeId,
} from "../types/index.js";

/**
 * Task 001-406: the commit beside the worktree's revision, from the store
 * only. `HEAD` is the latest revision's, or the one a reconciliation pass
 * found moved after it with no file change (`headMoveMetaKey`: a commit).
 * The count is the revisions recorded since `HEAD` last moved: after a move
 * the pass saw, the revisions after it; else after the newest revision at
 * another `HEAD`, whose successor brought this one (a checkout's files) and
 * counts as `+ 0`; with every revision at one `HEAD`, all of them. The dirty
 * flag is the one recorded with what `HEAD` came from. `undefined` while
 * nothing is recorded.
 */
export function readRevisionCommit(
  store: Store,
  worktreeId: WorktreeId,
  latest: Revision | null = store.revisions.latest(worktreeId),
): RevisionCommit | undefined {
  const moved = parseHeadMove(store.meta.get(headMoveMetaKey(worktreeId)));
  const number = latest?.number ?? 0;
  if (moved !== null && moved.revision >= number && moved.head !== latest?.head) {
    return { head: moved.head, sinceHead: 0, dirty: moved.dirty };
  }
  if (latest === null) return undefined;
  const other = store.revisions.lastAtOtherHead(worktreeId, latest.head);
  const since: RevisionNumber =
    moved !== null && moved.head === latest.head && moved.revision >= (other ?? 0)
      ? moved.revision
      : other === null
        ? 0
        : other + 1;
  return { head: latest.head, sinceHead: Math.max(0, number - since), dirty: latest.dirty };
}

/**
 * `79 · 1bc146f0 + 3, dirty`: the revision, then its commit (task 001-406).
 * The number alone before a first commit, which there is nothing to count from.
 */
export function revisionText(revision: RevisionNumber, commit: RevisionCommit | undefined): string {
  if (commit === undefined || commit.head === null) return String(revision);
  const dirty = commit.dirty ? ", dirty" : "";
  return `${revision} · ${commit.head.slice(0, 8)} + ${commit.sinceHead}${dirty}`;
}
