import { testFileId } from "../keys/index.js";
import type {
  CheckKey,
  RelativePath,
  Store,
  TestFileRecord,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";

/**
 * Whether a stored closure is `worktreeId`'s: written by it, or by a
 * worktree whose current key for the file is its own, since a key covers
 * every closure path and its content. The store keeps the newest closure of
 * any worktree, and another branch can import other files (task 001-94,
 * review wave 10b S2; spec 001 D6). Each worktree's keys are read once per
 * returned reader.
 */
function closureTrust(store: Store, worktreeId: WorktreeId) {
  const keys = new Map<WorktreeId, ReadonlyMap<string, CheckKey | null>>();
  const keyOf = (id: WorktreeId, ref: TestFileRef) => {
    let byFile = keys.get(id);
    if (byFile === undefined) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  return (record: TestFileRecord): boolean => {
    if (record.updatedBy === worktreeId) return true;
    const key = keyOf(worktreeId, record.testFile);
    return key !== null && key === keyOf(record.updatedBy, record.testFile);
  };
}

/** The stored closure of `ref` when it is `worktreeId`'s (`closureTrust`); `undefined` otherwise. */
export function closureFor(store: Store, worktreeId: WorktreeId) {
  const trusts = closureTrust(store, worktreeId);
  return (ref: TestFileRef): readonly RelativePath[] | undefined => {
    const record = store.testFiles.get(ref);
    return record !== null && trusts(record) ? record.closure.paths : undefined;
  };
}

/**
 * Row 015-65 (spec 015 D9 Delivery): how many of the worktree's listed test
 * files hold each path in a closure it trusts, D9's loaders. Every stored
 * closure is read once, on the reader's first call (the coordinator's
 * option (a), 2026-10-26: about 54 ms on 1,338 test files here).
 */
export function loaderCounts(store: Store, worktreeId: WorktreeId) {
  let closures: (readonly RelativePath[])[] | undefined;
  const read = () => {
    const listed = new Set(store.testFileKeys.list(worktreeId).map((r) => testFileId(r.testFile)));
    const trusts = closureTrust(store, worktreeId);
    return store.testFiles
      .list()
      .filter((r) => listed.has(testFileId(r.testFile)) && trusts(r))
      .map((r) => r.closure.paths);
  };
  return (path: RelativePath): number => {
    closures ??= read();
    return closures.filter((paths) => paths.includes(path)).length;
  };
}
