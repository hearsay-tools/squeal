import { stripVTControlCharacters } from "node:util";
import {
  type DaemonNote,
  MAX_PERSISTED_NOTES,
  notesMetaKey,
  type StoppedProcesses,
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
 *
 * Topics (task 007-39, agreed with 001): a note may carry a `topic`,
 * namespaced `<owner>:<subject>` so owners never replace each other's
 * notes, such as `pytest-environment:<project>`. The list keeps the
 * replaced notes too, since persisted notes are the daemon's only record
 * (D12: no log file in v1), but at most `NOTES_PER_TOPIC` of one topic, its
 * oldest dropped first, so a topic coming and going never evicts other
 * notes. `readDaemonNotes`, which status reads, lists the latest note of
 * each topic. A replacing note is appended as any new note is, so a reader
 * told the old one is told it once.
 */
export function withNote(raw: unknown, note: DaemonNote): unknown[] {
  const list = [...parseList(raw), note];
  const { topic } = note;
  const ofTopic = list.flatMap((item, i) =>
    topic !== undefined && topicOf(item) === topic ? [i] : [],
  );
  const dropped = new Set(ofTopic.slice(0, -NOTES_PER_TOPIC));
  return list.filter((_, i) => !dropped.has(i)).slice(-MAX_PERSISTED_NOTES);
}

/** Stored notes kept per topic, the latest among them listed. */
export const NOTES_PER_TOPIC = 3;

function topicOf(item: unknown): unknown {
  return typeof item === "object" && item !== null
    ? (item as { topic?: unknown }).topic
    : undefined;
}

/**
 * The worktree's persisted notes, oldest first, at most `MAX_PERSISTED_NOTES`,
 * with only the latest of each topic (`withNote`). A missing or malformed
 * value is no notes; a malformed item is skipped.
 */
export function readDaemonNotes(store: Store, worktreeId: WorktreeId): readonly DaemonNote[] {
  const notes = parseList(store.meta.get(notesMetaKey(worktreeId)))
    .flatMap(toNote)
    .slice(-MAX_PERSISTED_NOTES);
  const latest = new Map<string, DaemonNote>();
  for (const note of notes) if (note.topic !== undefined) latest.set(note.topic, note);
  return notes.filter((note) => note.topic === undefined || latest.get(note.topic) === note);
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
  const { stopped: rawStopped, exitOf, topic } = item as Record<string, unknown>;
  const stopped = stoppedOf(rawStopped);
  return [
    {
      at,
      revision,
      text,
      ...(stopped === undefined ? {} : { stopped }),
      ...(typeof exitOf === "string" ? { exitOf } : {}),
      ...(typeof topic === "string" ? { topic } : {}),
    },
  ];
}

/** A note's processes (task 001-255); a malformed field is dropped, so the note stays unfolded. */
function stoppedOf(value: unknown): StoppedProcesses | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { what, commands } = value as Record<string, unknown>;
  if (typeof what !== "string" || !Array.isArray(commands)) return undefined;
  return commands.every((c) => typeof c === "string") ? { what, commands } : undefined;
}
