import { testFileId } from "../keys/index.js";
import type { CheckKey, RelativePath, Store, TestFileRef, WorktreeId } from "../types/index.js";

/**
 * The stored closure of `ref` when it is `worktreeId`'s: written by it, or by
 * a worktree whose current key for the file is its own, since a key covers
 * every closure path and its content. `undefined` otherwise: the store keeps
 * the newest closure of any worktree, and another branch can import other
 * files (task 001-94, review wave 10b S2; spec 001 D6). Each worktree's keys
 * are read once per returned reader.
 */
export function closureFor(store: Store, worktreeId: WorktreeId) {
  const keys = new Map<WorktreeId, ReadonlyMap<string, CheckKey | null>>();
  const keyOf = (id: WorktreeId, ref: TestFileRef) => {
    let byFile = keys.get(id);
    if (byFile === undefined) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  return (ref: TestFileRef): readonly RelativePath[] | undefined => {
    const record = store.testFiles.get(ref);
    if (record === null) return undefined;
    if (record.updatedBy === worktreeId) return record.closure.paths;
    const key = keyOf(worktreeId, ref);
    return key !== null && key === keyOf(record.updatedBy, ref) ? record.closure.paths : undefined;
  };
}
