import type { WorktreeId } from "../types/common.js";
import type { HeadMove } from "../types/scheduler.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 011-339 (`research/progress-records.md`): the head move, its one
 * owner. The `HEAD` a reconciliation pass found moved with no file change (a
 * commit, a partial one among them), a JSON `HeadMove` (task 001-406). A
 * revision records `HEAD` only when files change, so this is how headers
 * and status learn of a commit before the next edit. Apart from
 * `head-move.ts`, which loads commit and git code the header must not load.
 *
 * Its readers read it two ways, kept as they are: the code pass takes a
 * move at exactly revision N as `HEAD` at the end of N; the header and
 * `head-move.ts` take one at N or later as the current `HEAD`.
 */

function headMoveMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("headMove", worktreeId);
}

/** The recorded move, or `null` when none is recorded or it is not readable. */
export function readHeadMove(store: Pick<Store, "meta">, worktreeId: WorktreeId): HeadMove | null {
  const raw = store.meta.get(headMoveMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const { head, dirty, revision } = value;
    if (head !== null && typeof head !== "string") return null;
    if (typeof dirty !== "boolean" || !Number.isInteger(revision)) return null;
    return { head, dirty, revision: revision as HeadMove["revision"] };
  } catch {
    return null;
  }
}

/** A pass saw `HEAD` moved: records `move`, replacing the last. */
export function writeHeadMove(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  move: HeadMove,
): void {
  store.meta.set(headMoveMetaKey(worktreeId), JSON.stringify(move));
}
