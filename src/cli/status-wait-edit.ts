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
 * wait covers the revisions since the consumer last heard, up to the one the
 * daemon's sync pass stored (001-185). It holds for the runner part of those
 * revisions and for every test file whose key they moved, until each has a
 * result under its new key; not for slow files, the baseline, a backlog,
 * `run --all`, other worktrees or edits made after the wait started. Only a
 * transition of those files ends it early.
 */

/**
 * The revision the wait last heard of: the oldest revision a consumer of
 * `session` in this worktree was last told about. Without one (no session
 * in the environment, none registered, or none told), the revision current
 * when the wait started. The window is the revisions after it, or from it
 * when nothing after it re-keyed a file (`editWindow`).
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
}

/**
 * The window from the files the daemon named from `heard` on. The revision
 * last heard of counts only when no revision after it re-keyed a file: a
 * header may have named the edit's revision before its result (the hook
 * after the edit read it already), while a revision heard of before a later
 * edit is often an environment change whose backlog is not the edit's.
 */
export function editWindow(
  store: Store,
  worktreeId: WorktreeId,
  heard: RevisionNumber,
  revision: RevisionNumber,
  rekeyed: readonly RekeyedTestFile[],
): EditWindow {
  const after = rekeyed.some((file) => file.revision > heard);
  const refs = rekeyed.filter((file) => !after || file.revision > heard).map((f) => f.testFile);
  const isSlow = worktreeSlowView(store, worktreeId)?.isSlow;
  return {
    since: after ? heard + 1 : heard,
    revision,
    ids: new Set(refs.map(testFileId)),
    slow: new Set(refs.filter((ref) => isSlow?.(ref) === true).map(testFileId)),
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
