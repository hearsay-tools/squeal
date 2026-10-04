import {
  type DaemonNote,
  MAX_PERSISTED_NOTES,
  notesMetaKey,
  type Store,
  type WorktreeId,
} from "../types/index.js";

/** Most daemon notes status shows; the scheduler keeps the list bounded the same way. */
const MAX_NOTES = MAX_PERSISTED_NOTES;

/**
 * Spec 001 D7: "the latest persisted daemon notes (runner failures, dropped
 * watcher events, tier pump stopped), kept bounded per worktree in `meta`".
 * The scheduler writes `notes.<worktreeId>` as a JSON array, newest last. A
 * missing or malformed value is no notes; a malformed item is skipped.
 */
export function readDaemonNotes(store: Store, worktreeId: WorktreeId): readonly DaemonNote[] {
  const raw = store.meta.get(notesMetaKey(worktreeId));
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(toNote).slice(-MAX_NOTES);
}

function toNote(item: unknown): DaemonNote[] {
  if (typeof item !== "object" || item === null) return [];
  const { at, revision, text } = item as Record<string, unknown>;
  if (typeof at !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  return [{ at, revision, text }];
}
