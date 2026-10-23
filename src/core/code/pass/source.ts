import type { RelativePath, Store, WorktreeId } from "../../types/index.js";
import type { PassSource } from "./types.js";

/**
 * The pass's reads of a worktree's main store: revisions (011 C2), the stat
 * cache's blob ids and sizes (C3) and the test files the runners list.
 * `ignored` is the scheduler's extra files, which git ignores.
 */
export function mainStoreSource(
  store: Pick<Store, "revisions" | "fileHashes" | "testFileKeys">,
  worktreeId: WorktreeId,
  ignored: () => readonly RelativePath[],
): PassSource {
  return {
    latestRevision: () => store.revisions.latest(worktreeId)?.number ?? 0,
    changedPaths: (after, upTo) => [
      ...new Set(
        store.revisions.range(worktreeId, after, upTo).flatMap((r) => r.changes.map((c) => c.path)),
      ),
    ],
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
