import type { RevisionNumber, WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 011-339 (`research/progress-records.md`): the refined revision's one
 * owner. It is the newest revision whose runner part (invalidation, test
 * file listing, affected set, closures) the daemon applied, or counted as
 * applied after its refinement failed, stored as a decimal number.
 *
 * Spec 001 D2 as amended: "The last revision whose refinement was applied is
 * recorded, and headers, status and every wait treat a revision ahead of it
 * as pending, so a test file added during a tier is never reported as nothing
 * pending." In `meta`, not on the `worktrees` row, so no schema migration is
 * needed. With none recorded, or one not readable as a whole number, no
 * revision is pending: a store no daemon of this version refined.
 *
 * No function here opens a transaction: each write runs inside its caller's.
 */

function refinedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("refined", worktreeId);
}

/** The refined revision; `null` when none is recorded or it is not a whole number. */
export function readRefined(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): RevisionNumber | null {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}

/** Whether the runner part of `revision` is applied: with no refined revision recorded, it is. */
export function isRefined(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
): boolean {
  const refined = readRefined(store, worktreeId);
  return refined === null || revision <= refined;
}

/** The runner part of `revision` was applied: sets the refined revision (the ledger's commit). */
export function recordRefinedApplied(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
): void {
  store.meta.set(refinedMetaKey(worktreeId), String(revision));
}

/**
 * The refinement of `revision` failed and counts as refined, so no wait
 * hangs on it (D2 as amended): raises the refined revision, never lowers it.
 */
export function recordRefinedFailed(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
): void {
  const key = refinedMetaKey(worktreeId);
  const previous = Number(store.meta.get(key) ?? Number.NaN);
  if (!(previous >= revision)) store.meta.set(key, String(revision));
}
