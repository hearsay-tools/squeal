import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { CheckKey, FileHash, TestFileRef } from "../types/keys.js";
import type { FileChange, Revision } from "../types/revision.js";
import type { ContentRekey, RevisionEdit } from "./revision.js";

/** A revision's runner part, queued and not started yet (`RunnerWork.queueRefine`). */
export interface QueuedRefine {
  readonly revision: Revision;
  readonly content: ContentRekey;
  readonly touched: readonly RelativePath[];
}

/**
 * Row 011-396 (gh-181, research `stuck-running.md` E4b): the runner part of
 * `newer` stands in for the queued one of `older`, as a daemon start lists
 * only the newest revision (E4c). One runner part then invalidates, lists
 * and resolves what both revisions changed, at `newer`'s number, which
 * counts `older` refined too (`covers`).
 *
 * Each path changes from its hash before `older` to its hash after `newer`,
 * so the runner hears of every path either revision changed:
 *
 * - a path added and then deleted is a delete from the hash it held in
 *   between: the runner forgets what it may have read of it, and the
 *   listing runs, as both revisions' listings would have;
 * - a path deleted and then added again, or edited back to its old bytes,
 *   is a change: the listing never removed a file that exists again;
 * - every other path keeps the kind its first and last hash give, so an
 *   added test file kept is listed, and one deleted is not.
 *
 * What the content parts found joins: every re-keyed file, the key each
 * held before `older` (`previous`, for the stored graph), the environment
 * read when either asked for it, and each revision's paths on their own for
 * the catch-up count (`RevisionEdit`, never their union: review wave 5,
 * B3). A touched path either revision changed is a change instead.
 */
export function supersede(older: QueuedRefine, newer: QueuedRefine): QueuedRefine {
  const changes = mergeChanges([...older.revision.changes, ...newer.revision.changes]);
  const changed = new Set(changes.map((change) => change.path));
  const touched = [...new Set([...older.touched, ...newer.touched])].filter(
    (path) => !changed.has(path),
  );
  return {
    revision: { ...newer.revision, changes },
    content: mergeContent(older, newer),
    touched,
  };
}

/** Each path once, in first-change order: its first `oldHash` and last `newHash`. */
function mergeChanges(changes: readonly FileChange[]): FileChange[] {
  const first = new Map<RelativePath, FileChange>();
  const last = new Map<RelativePath, FileChange>();
  const held = new Map<RelativePath, FileHash>();
  for (const change of changes) {
    if (!first.has(change.path)) first.set(change.path, change);
    last.set(change.path, change);
    if (change.newHash !== null) held.set(change.path, change.newHash);
  }
  return [...first.values()].map(({ path, oldHash }) => {
    const { newHash, ignored } = last.get(path) as FileChange;
    // Added, then deleted: a delete of what it held in between.
    const before = oldHash === null && newHash === null ? (held.get(path) ?? null) : oldHash;
    return { path, oldHash: before, newHash, ...(ignored === true ? { ignored } : {}) };
  });
}

function mergeContent(older: QueuedRefine, newer: QueuedRefine): ContentRekey {
  const rekeyed = byId([...older.content.rekeyed, ...newer.content.rekeyed]);
  // The key before `older` wins: the runner last walked the files at it.
  const previous = new Map<string, CheckKey | null>(newer.content.previous ?? []);
  for (const [id, key] of older.content.previous ?? []) previous.set(id, key);
  const recent = byId([...(older.content.recent ?? []), ...(newer.content.recent ?? [])]);
  const catchUp = older.content.catchUp === true && newer.content.catchUp === true;
  return {
    rekeyed,
    previous,
    environment: older.content.environment || newer.content.environment,
    ...(catchUp ? { catchUp } : {}),
    ...(recent.length > 0 ? { recent } : {}),
    edits: [...editsOf(older), ...editsOf(newer)],
  };
}

/** The revisions a queued runner part stands for, each on its own. */
function editsOf({ revision, content }: QueuedRefine): readonly RevisionEdit[] {
  return (
    content.edits ?? [
      {
        paths: new Set(revision.changes.map((change) => change.path)),
        catchUp: content.catchUp === true,
      },
    ]
  );
}

function byId(refs: readonly TestFileRef[]): TestFileRef[] {
  return [...new Map(refs.map((ref) => [testFileId(ref), ref])).values()];
}
