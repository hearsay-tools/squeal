import type { Policy, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo } from "../store/index.js";
import type { RecountReason, RecountRecord } from "./types.js";

/**
 * Code meta `pass:<worktreeId>`: the revision a worktree's states are
 * counted at, and the policy and counter they were judged by. A pass
 * follows the revisions after it; a change of anything else is a recount.
 */
export interface PassCursor {
  readonly revision: RevisionNumber;
  readonly threshold: number;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly maxFileBytes: number;
  readonly counterVersion: number;
}

const passKey = (worktreeId: WorktreeId) => `pass:${worktreeId}`;

/** Code meta key of a worktree's `RecountRecord` (the coordinator's contract with 015-07). */
export const recountKey = (worktreeId: WorktreeId) => `recount:${worktreeId}`;

export function cursorOf(
  revision: RevisionNumber,
  complexity: Policy["complexity"],
  counterVersion: number,
): PassCursor {
  const { threshold, include, exclude, maxFileBytes } = complexity;
  return { revision, threshold, include, exclude, maxFileBytes, counterVersion };
}

/** `null` when none was written, or it does not read: the next pass is a first count. */
export function readCursor(meta: CodeMetaRepo, worktreeId: WorktreeId): PassCursor | null {
  const text = meta.get(passKey(worktreeId));
  if (text === null) return null;
  try {
    const cursor = JSON.parse(text) as PassCursor;
    return typeof cursor.revision === "number" ? cursor : null;
  } catch {
    return null;
  }
}

export function writeCursor(meta: CodeMetaRepo, worktreeId: WorktreeId, cursor: PassCursor): void {
  meta.set(passKey(worktreeId), JSON.stringify(cursor));
}

export function readRecount(meta: CodeMetaRepo, worktreeId: WorktreeId): RecountRecord | null {
  const text = meta.get(recountKey(worktreeId));
  return text === null ? null : (JSON.parse(text) as RecountRecord);
}

export function writeRecount(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  record: RecountRecord,
): void {
  meta.set(recountKey(worktreeId), JSON.stringify(record));
}

/**
 * Why the states are rebuilt rather than followed, or `null` for `edit`:
 * `first` with no cursor or one past the newest revision (a new main store);
 * else what changed, `threshold` before `include` before `counter`.
 */
export function recountReason(cursor: PassCursor | null, now: PassCursor): RecountReason | null {
  if (cursor === null || cursor.revision > now.revision) return "first";
  if (cursor.threshold !== now.threshold) return "threshold";
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((glob, i) => glob === b[i]);
  if (
    !same(cursor.include, now.include) ||
    !same(cursor.exclude, now.exclude) ||
    cursor.maxFileBytes !== now.maxFileBytes
  ) {
    return "include";
  }
  return cursor.counterVersion === now.counterVersion ? null : "counter";
}
