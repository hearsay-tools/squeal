import type { WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Review of 0.1.428, B1 (row 018-28, spec 018 D5): an import into a running
 * daemon's store adds observed entries that its keys take only at the next
 * refinement's apply (`ImportsSeen`, `Scheduler.refreshObserved`). Until
 * then each of the import's files holds its old key, and status, which reads
 * the store alone, would call it "content differs". The daemon names the
 * imports its keys have not taken in a row of the worktree's: the retry
 * request that hands it an import adds it, the refinement whose apply takes
 * its observed entries removes it, and a start, which keys every import the
 * store holds, empties the row.
 */

/** The `meta` key of `worktreeId`'s row. */
export function importsWaitingMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("importsWaiting", worktreeId);
}

/** The imports whose observed entries `worktreeId`'s keys have not taken yet. */
export function importsWaiting(store: Store, worktreeId: WorktreeId): string[] {
  const value = store.meta.get(importsWaitingMetaKey(worktreeId));
  if (value === null) return [];
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Adds `imports` to the imports the keys wait for. */
export function markImportsWaiting(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly string[],
): void {
  if (imports.length === 0) return;
  store.transaction(() => {
    const ids = new Set([...importsWaiting(store, worktreeId), ...imports]);
    store.meta.set(importsWaitingMetaKey(worktreeId), JSON.stringify([...ids].sort()));
  });
}

/** Removes `imports`, whose observed entries the keys took; the row goes when none is left. */
export function importsKeyed(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly string[],
): void {
  if (imports.length === 0) return;
  store.transaction(() => {
    const taken = new Set(imports);
    const left = importsWaiting(store, worktreeId).filter((id) => !taken.has(id));
    if (left.length === 0) store.meta.delete(importsWaitingMetaKey(worktreeId));
    else store.meta.set(importsWaitingMetaKey(worktreeId), JSON.stringify(left));
  });
}

/** A start keys every import the store holds: the keys wait for none. */
export function clearImportsWaiting(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(importsWaitingMetaKey(worktreeId));
}
