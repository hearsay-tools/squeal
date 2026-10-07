import { POLICY_FILE } from "../daemon/policy.js";
import type { UnmatchedInputs } from "../keys/index.js";
import { readDaemonNotes } from "../notes.js";
import type { RelativePath, Store, WorktreeId } from "../types/index.js";

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
export function unmatchedInputNotes(unmatched: UnmatchedInputs, testFiles: number): string[] {
  // With no test file listed (none yet, or the listing failed), every key
  // would read as matching none, which is not true (lessons, defect 13 probe).
  return [
    ...(testFiles === 0 ? [] : unmatched.testGlobs).map(
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
  return new Set(readDaemonNotes(store, worktreeId).map((note) => note.text));
}
