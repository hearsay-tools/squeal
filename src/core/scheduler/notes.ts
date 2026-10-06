import { stripVTControlCharacters } from "node:util";
import { POLICY_FILE } from "../daemon/policy.js";
import type { UnmatchedInputs } from "../keys/index.js";
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
 * notes are a status aid, never the only record of an error. Notes are plain
 * text: ANSI escape codes from a coloured runner message are stripped
 * (lessons, defect 6).
 */
export function appendNote(store: Store, worktreeId: WorktreeId, note: DaemonNote): void {
  const key = notesMetaKey(worktreeId);
  const plain = { ...note, text: plainText(note.text) };
  store.transaction(() => {
    const notes = [...parse(store.meta.get(key)), plain].slice(-MAX_PERSISTED_NOTES);
    store.meta.set(key, JSON.stringify(notes));
  });
}

/** A note's text without ANSI escape codes. */
export function plainText(text: string): string {
  return stripVTControlCharacters(text);
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

/**
 * One note per policy `inputs` entry that selects nothing, in the shape of
 * the daemon's policy notes (review wave 4.5, S5). The matching rule goes
 * with a key, the usual mistake: a bare file name matches a file at the root
 * only.
 */
export function unmatchedInputNotes(unmatched: UnmatchedInputs): string[] {
  return [
    ...unmatched.testGlobs.map(
      (glob) =>
        `${POLICY_FILE}: inputs key "${glob}" matches no test file; keys and input globs ` +
        "match worktree-relative paths from the start, so write " +
        `"**/${glob}" for a file in any directory`,
    ),
    ...unmatched.inputGlobs.map((glob) => `${POLICY_FILE}: inputs glob "${glob}" matches no file`),
  ];
}

/** Texts of the worktree's persisted notes, to skip one an earlier daemon already wrote. */
export function persistedNoteTexts(store: Store, worktreeId: WorktreeId): Set<string> {
  return new Set(parse(store.meta.get(notesMetaKey(worktreeId))).map((note) => note.text));
}
