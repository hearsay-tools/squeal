import type { RevisionNumber, WorktreeId } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { CodeMetaRepo } from "../store/types.js";
import type { RecountReason, RecountRecord } from "./types.js";

/**
 * Which files a pass counts, beside the policy's keys: 1, every included
 * file but test files (015 D1); 2, test files too (spec 020 D11.6). A cursor
 * at another version, or one written before the field, is an `include`
 * recount: one summary line, never a line per function (015 D6).
 */
export const COUNTING_RULES_VERSION = 2;

/**
 * Code meta `pass:<worktreeId>`: the revision a worktree's states are
 * counted at, and the policy, counting rules and counter they were judged
 * by. A pass follows the revisions after it; a change of anything else is a
 * recount.
 */
export interface PassCursor {
  readonly revision: RevisionNumber;
  readonly threshold: number;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly maxFileBytes: number;
  /** `COUNTING_RULES_VERSION`; absent in a cursor written before it. */
  readonly rules?: number;
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
  const rules = COUNTING_RULES_VERSION;
  return { revision, threshold, include, exclude, maxFileBytes, rules, counterVersion };
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

/** Code meta key set by a registration before the worktree's cursor exists (015-35). */
const awaitedKey = (worktreeId: WorktreeId) => `awaited:${worktreeId}`;

/**
 * Row 015-35: a consumer registered while the worktree's first count had
 * not ended, so its line said counting; that count writes the recount
 * record, which tells it the count once.
 */
export function awaitFirstCount(meta: CodeMetaRepo, worktreeId: WorktreeId): void {
  meta.set(awaitedKey(worktreeId), "1");
}

/** Whether a consumer awaits the first count (`awaitFirstCount`); the mark goes. */
export function takeAwaited(meta: CodeMetaRepo, worktreeId: WorktreeId): boolean {
  if (meta.get(awaitedKey(worktreeId)) === null) return false;
  meta.delete(awaitedKey(worktreeId));
  return true;
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
 * else what changed, `threshold` before `include` before `counter`. Other
 * counting rules (`rules`) are an `include` change.
 */
export function recountReason(cursor: PassCursor | null, now: PassCursor): RecountReason | null {
  if (cursor === null || cursor.revision > now.revision) return "first";
  if (cursor.threshold !== now.threshold) return "threshold";
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((glob, i) => glob === b[i]);
  if (
    !same(cursor.include, now.include) ||
    !same(cursor.exclude, now.exclude) ||
    cursor.maxFileBytes !== now.maxFileBytes ||
    cursor.rules !== now.rules
  ) {
    return "include";
  }
  return cursor.counterVersion === now.counterVersion ? null : "counter";
}
