import { stripVTControlCharacters } from "node:util";
import {
  type DaemonNote,
  MAX_PERSISTED_NOTES,
  notesMetaKey,
  type Store,
  type WorktreeId,
} from "./types/index.js";

/**
 * Appends a note to the worktree's persisted notes and keeps the newest
 * `MAX_PERSISTED_NOTES`.
 *
 * Spec 001 D7: status shows "the latest persisted daemon notes (runner
 * failures, dropped watcher events, tier pump stopped), kept bounded per
 * worktree in `meta`". A stored value that is not a list is replaced: the
 * notes are a status aid, never the only record of an error. Notes are plain
 * text: ANSI escape codes from a coloured runner message are stripped
 * (lessons, defect 6).
 */
export function appendNote(store: Store, worktreeId: WorktreeId, note: DaemonNote): void {
  const key = notesMetaKey(worktreeId);
  const plain = { ...note, text: stripVTControlCharacters(note.text) };
  store.transaction(() => {
    store.meta.set(key, JSON.stringify(withNote(store.meta.get(key), plain)));
  });
}

/**
 * The stored list with `note` appended, newest `MAX_PERSISTED_NOTES` kept.
 * Items are kept as stored, so a store a newer Squeal wrote keeps its shape.
 */
export function withNote(raw: unknown, note: DaemonNote): unknown[] {
  return [...parseList(raw), note].slice(-MAX_PERSISTED_NOTES);
}

/**
 * The worktree's persisted notes, oldest first, at most `MAX_PERSISTED_NOTES`.
 * A missing or malformed value is no notes; a malformed item is skipped.
 */
export function readDaemonNotes(store: Store, worktreeId: WorktreeId): readonly DaemonNote[] {
  return parseList(store.meta.get(notesMetaKey(worktreeId)))
    .flatMap(toNote)
    .slice(-MAX_PERSISTED_NOTES);
}

function parseList(raw: unknown): unknown[] {
  if (typeof raw !== "string") return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function toNote(item: unknown): DaemonNote[] {
  if (typeof item !== "object" || item === null) return [];
  const { at, revision, text } = item as Record<string, unknown>;
  if (typeof at !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  return [{ at, revision, text }];
}
