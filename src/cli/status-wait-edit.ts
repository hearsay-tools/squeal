import { toldRevision } from "../core/delivery/index.js";
import { testFileId } from "../core/keys/index.js";
import { testFileOf, worktreeSlowView } from "../core/state/index.js";
import type {
  DeltaEntry,
  RevisionNumber,
  StatusHeader,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";

/*
 * Lessons, defect 32, decided by the human (2026-10-09, task 001-186): a
 * wait covers the revisions since the consumer last heard, up to the one the
 * daemon's sync pass stored (001-185). It holds for the runner part of those
 * revisions and for every test file whose key they moved, until each has a
 * result under its new key; not for slow files, the baseline, a backlog,
 * `run --all`, other worktrees or edits made after the wait started. Only a
 * transition of those files ends it early.
 */

/**
 * The first revision of the wait's window: the oldest revision a consumer of
 * `session` in this worktree was last told about, so an edit whose revision
 * a header already named is still covered (its result was not told). Without
 * one (no session in the environment, none registered, or none told), the
 * revision current when the wait started.
 */
export function windowStart(
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
  /** The pass's revision: the window's last. */
  readonly revision: RevisionNumber;
  /** `testFileId`s of the files the window's revisions re-keyed. */
  readonly ids: ReadonlySet<string>;
  /** Of those, the ones the wait does not hold for: slow files (spec 004 D9, as Stop). */
  readonly slow: ReadonlySet<string>;
}

export function editWindow(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  rekeyed: readonly TestFileRef[],
): EditWindow {
  const isSlow = worktreeSlowView(store, worktreeId)?.isSlow;
  return {
    revision,
    ids: new Set(rekeyed.map(testFileId)),
    slow: new Set(rekeyed.filter((ref) => isSlow?.(ref) === true).map(testFileId)),
  };
}

/** The window's files still queued or running, slow ones aside. */
export function heldPending(window: EditWindow, keys: readonly TestFileKeyRecord[]): number {
  return keys.filter((row) => {
    const id = testFileId(row.testFile);
    return row.pending !== null && window.ids.has(id) && !window.slow.has(id);
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
