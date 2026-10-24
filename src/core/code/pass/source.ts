import {
  type CommitSha,
  headMoveMetaKey,
  parseHeadMove,
  type RelativePath,
  type RevisionNumber,
  type Store,
  type WorktreeId,
} from "../../types/index.js";
import type { PassSource } from "./types.js";

/**
 * The pass's reads of a worktree's main store: revisions (011 C2), the stat
 * cache's blob ids and sizes (C3) and the test files the runners list.
 * `ignored` is the scheduler's extra files, which git ignores.
 */
export function mainStoreSource(
  store: Pick<Store, "revisions" | "fileHashes" | "testFileKeys" | "meta">,
  worktreeId: WorktreeId,
  ignored: () => readonly RelativePath[],
): PassSource {
  /**
   * `HEAD` at the end of revision `after`: the one a reconciliation pass
   * saw moved after it with no file change (task 001-406, a commit; at
   * revision 0, the daemon's first look), else the revision's own.
   */
  const headAt = (after: RevisionNumber): CommitSha | undefined => {
    const moved = parseHeadMove(store.meta.get(headMoveMetaKey(worktreeId)));
    if (moved !== null && moved.revision === after) return moved.head;
    return after > 0 ? store.revisions.get(worktreeId, after)?.head : undefined;
  };
  return {
    latestRevision: () => store.revisions.latest(worktreeId)?.number ?? 0,
    changedPaths: (after, upTo) => [
      ...new Set(
        store.revisions.range(worktreeId, after, upTo).flatMap((r) => r.changes.map((c) => c.path)),
      ),
    ],
    movedHead: (after, upTo) =>
      headAfterMove(
        headAt(after),
        store.revisions.range(worktreeId, after, upTo).map((r) => r.head),
      ),
    file: (path) => {
      const record = store.fileHashes.get(worktreeId, path);
      return record === null ? null : { path, hash: record.hash, size: record.size };
    },
    files: () =>
      store.fileHashes
        .list(worktreeId)
        .map((record) => ({ path: record.path, hash: record.hash, size: record.size })),
    testFiles: () => store.testFileKeys.list(worktreeId).map((row) => row.testFile.path),
    ignored,
  };
}

/**
 * The last of `heads` when it differs from the one before it, `before`
 * for the first; `null` when none does. With `before` unknown, the last:
 * `HEAD` may have moved, so the pass asks git.
 */
export function headAfterMove(
  before: CommitSha | undefined,
  heads: readonly CommitSha[],
): CommitSha {
  const last = heads.at(-1) ?? null;
  if (before === undefined) return last;
  return heads.some((head, i) => head !== (i === 0 ? before : heads[i - 1])) ? last : null;
}
