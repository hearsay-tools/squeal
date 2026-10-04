import {
  type DaemonNote,
  MAX_PERSISTED_NOTES,
  notesMetaKey,
  type RelativePath,
  type Store,
  type WorktreeId,
} from "../types/index.js";

/**
 * Appends a note to the worktree's persisted notes and keeps the newest
 * `MAX_PERSISTED_NOTES`.
 *
 * Spec 001 D7: status shows "the latest persisted daemon notes (runner
 * failures, dropped watcher events, tier pump stopped), kept bounded per
 * worktree in `meta`". A stored value that is not a list is replaced: the
 * notes are a status aid, never the only record of an error.
 */
export function appendNote(store: Store, worktreeId: WorktreeId, note: DaemonNote): void {
  const key = notesMetaKey(worktreeId);
  store.transaction(() => {
    const notes = [...parse(store.meta.get(key)), note].slice(-MAX_PERSISTED_NOTES);
    store.meta.set(key, JSON.stringify(notes));
  });
}

function parse(raw: string | null): DaemonNote[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as DaemonNote[]) : [];
  } catch {
    return [];
  }
}

/** Paths for a note, at most `max` of them. Styleguide: "Errors carry context (check id, revision, path)." */
export function listPaths(paths: readonly RelativePath[], max = 5): string {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}
