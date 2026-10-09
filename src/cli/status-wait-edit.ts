import { toldRevision } from "../core/delivery/index.js";
import { testFileId } from "../core/keys/index.js";
import { testFileOf, worktreeSlowView } from "../core/state/index.js";
import type {
  DeltaEntry,
  KnownState,
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
 * whose files it has not seen a result for (001-191), up to the one the
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
}

/** The store as the wait read it at its start and when the daemon named the files. */
export interface WindowReads {
  readonly start: readonly KnownState[];
  readonly states: readonly KnownState[];
  readonly keys: readonly TestFileKeyRecord[];
}

/**
 * The window from the files the daemon named (`rekeyed`, every revision's).
 * Every revision after the one last heard of counts. One heard of or before
 * it counts while one of its files had no result since its re-key when the
 * wait started, slow files aside (task 001-191): a header may name an
 * edit's revision before its result, and two edits in separate tool calls
 * leave the first told; a revision whose files all had their results is
 * done, whatever ran later.
 */
export function editWindow(
  store: Store,
  worktreeId: WorktreeId,
  heard: RevisionNumber,
  revision: RevisionNumber,
  rekeyed: readonly RekeyedTestFile[],
  reads: WindowReads,
): EditWindow {
  const isSlow = worktreeSlowView(store, worktreeId)?.isSlow;
  const told = rekeyed.filter((file) => file.revision <= heard && isSlow?.(file.testFile) !== true);
  const unseen = unseenRevisions(told, reads);
  const kept = rekeyed.filter((file) => file.revision > heard || unseen.has(file.revision));
  const first = kept.reduce((least, file) => Math.min(least, file.revision), heard + 1);
  const refs = kept.map((file) => file.testFile);
  return {
    since: kept.length === 0 ? heard : first,
    revision,
    ids: new Set(refs.map(testFileId)),
    slow: new Set(refs.filter((ref) => isSlow?.(ref) === true).map(testFileId)),
  };
}

/**
 * The revisions of `files` the wait has not seen through: a file with no
 * result observed at or after its re-key at the wait's start, still pending
 * or with that result since. A file re-keyed back to a key that has a result
 * is not pending and has none since: it holds nothing.
 */
function unseenRevisions(
  files: readonly RekeyedTestFile[],
  reads: WindowReads,
): ReadonlySet<RevisionNumber> {
  const before = lastObserved(reads.start);
  const now = lastObserved(reads.states);
  const pending = new Set(
    reads.keys.filter((row) => row.pending !== null).map((row) => testFileId(row.testFile)),
  );
  const unseen = new Set<RevisionNumber>();
  for (const file of files) {
    const id = testFileId(file.testFile);
    if ((before.get(id) ?? -1) >= file.revision) continue;
    if (pending.has(id) || (now.get(id) ?? -1) >= file.revision) unseen.add(file.revision);
  }
  return unseen;
}

/** Each test file's newest observed revision across its checks. */
function lastObserved(states: readonly KnownState[]): ReadonlyMap<string, RevisionNumber> {
  const observed = new Map<string, RevisionNumber>();
  for (const state of states) {
    if (state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    observed.set(id, Math.max(observed.get(id) ?? state.observedAt, state.observedAt));
  }
  return observed;
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
