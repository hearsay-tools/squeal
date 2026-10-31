import { readRetries } from "../retry/index.js";
import { pendingAt } from "../retry/records.js";
import type { CheckKey, Store, TestFileRef, WorktreeId } from "../types/index.js";

/**
 * Row 011-283 (`research/named-wait-rule.md` rule 5): whether a file's
 * queued run at `key` is a pending `squeal retry` request's that
 * `worktreeId`'s daemon queued (C5: forced at the file's normal priority).
 * Status names it; named-wait order does not change it.
 */
export function retriedRuns(
  store: Store,
  worktreeId: WorktreeId,
): (ref: TestFileRef, key: CheckKey | null) => boolean {
  const records = readRetries(store).filter(
    (r) => r.end === null && r.claim?.worktreeId === worktreeId,
  );
  if (records.length === 0) return () => false;
  return (ref, key) => key !== null && records.some(pendingAt(ref, key));
}
