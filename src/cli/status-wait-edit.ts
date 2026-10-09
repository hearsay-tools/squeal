import { toldRevision } from "../core/delivery/index.js";
import { testFileId } from "../core/keys/index.js";
import { testFileOf, worktreeSlowView } from "../core/state/index.js";
import type {
  DeltaEntry,
  RekeyedTestFile,
  RevisionNumber,
  StatusHeader,
  Store,
  TestFileKeyRecord,
  WorktreeId,
} from "../core/types/index.js";

/*
 * Lessons, defect 32, decided by the human (2026-10-09, task 001-186): a
 * wait covers the revisions since the consumer last heard, and earlier ones
 * whose files had no result under their new key when it started (001-191,
 * 001-196), up to the one the daemon's sync pass stored (001-185). It holds
 * for the runner part of those revisions and for every test file whose key
 * they moved, until each has a result under its new key; not for slow files,
 * the baseline, a backlog, `run --all`, other worktrees or edits made after
 * the wait started. Only a transition of those files, a result that landed
 * before the daemon answered included, ends it early.
 */

/**
 * The revision the wait last heard of: the oldest revision a consumer of
 * `session` in this worktree was last told about. Without one (no session
 * in the environment, none registered, or none told), the revision current
 * when the wait started. The window is the revisions after it, and those up
 * to it whose files the wait has not seen through (`editWindow`).
 */
export function lastHeard(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  session: string | null,
): RevisionNumber {
  if (session === null) return revision;
  const told = store.consumers
    .list(worktreeId)
    .filter((record) => record.consumer.sessionId === session)
    .flatMap((record) => toldRevision(store, record.consumer) ?? []);
  return Math.min(revision, ...told);
}

/** What the wait knows of its window once the daemon named the files (`SyncState.rekeyed`). */
export interface EditWindow {
  /** The window's first revision. */
  readonly since: RevisionNumber;
  /** The pass's revision: the window's last. */
  readonly revision: RevisionNumber;
  /** `testFileId`s of the files the window's revisions re-keyed. */
  readonly ids: ReadonlySet<string>;
  /** Of those, the ones the wait does not hold for: slow files (spec 004 D9, as Stop). */
  readonly slow: ReadonlySet<string>;
  /**
   * Of those, the ones whose move had its result after the wait started and
   * owe no later move: named for their news, held for nothing, not even a
   * re-run at the same key (task 001-196).
   */
  readonly resolved: ReadonlySet<string>;
}

/**
 * The window from the files the daemon named (`rekeyed`, every revision's):
 * each with no result under its current key, or whose move had its result
 * since the wait started (`resolved`). Every revision after the one last
 * heard of counts. One heard of or before it counts while the daemon names
 * one of its files, slow files aside (tasks 001-191, 001-196): a header may
 * name an edit's revision before its result, and two edits in separate tool
 * calls leave the first told; a revision whose files all had their results
 * before the wait is done, whatever ran later. Whether a file is seen
 * through is the daemon's to say, by key: a result at the same revision
 * under the file's previous key is no result (review wave 13k, B1).
 */
export function editWindow(
  store: Store,
  worktreeId: WorktreeId,
  heard: RevisionNumber,
  revision: RevisionNumber,
  rekeyed: readonly RekeyedTestFile[],
): EditWindow {
  const isSlow = worktreeSlowView(store, worktreeId)?.isSlow;
  const unseen = new Set(
    rekeyed
      .filter((file) => file.revision <= heard && isSlow?.(file.testFile) !== true)
      .map((file) => file.revision),
  );
  const kept = rekeyed.filter((file) => file.revision > heard || unseen.has(file.revision));
  const first = kept.reduce((least, file) => Math.min(least, file.revision), heard + 1);
  const refs = kept.map((file) => file.testFile);
  const owed = new Set(
    kept.filter((file) => file.resolved !== true).map((file) => testFileId(file.testFile)),
  );
  const ids = new Set(refs.map(testFileId));
  return {
    since: kept.length === 0 ? heard : first,
    revision,
    ids,
    slow: new Set(refs.filter((ref) => isSlow?.(ref) === true).map(testFileId)),
    resolved: new Set([...ids].filter((id) => !owed.has(id))),
  };
}

/** The window's files still queued or running, slow and resolved ones aside. */
export function heldPending(window: EditWindow, keys: readonly TestFileKeyRecord[]): number {
  return keys.filter((row) => {
    const id = testFileId(row.testFile);
    return (
      row.pending !== null && window.ids.has(id) && !window.slow.has(id) && !window.resolved.has(id)
    );
  }).length;
}

/** Whether the window's runner part is applied: the store's refined revision reached it. */
export function windowRefined(window: EditWindow, header: StatusHeader): boolean {
  const refined = header.refinedRevision ?? null;
  return refined === null || refined >= window.revision;
}

/** Transitions of the window's files, which end the wait, and of every other check, which do not. */
export function splitNews(
  window: EditWindow,
  entries: readonly DeltaEntry[],
): { readonly own: number; readonly other: number } {
  const own = entries.filter((entry) => window.ids.has(testFileId(testFileOf(entry.check)))).length;
  return { own, other: entries.length - own };
}
