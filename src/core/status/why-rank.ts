import { testFileId } from "../keys/reverse-index.js";
import { readSlowEvidence } from "../slow/rank-store.js";
import type { WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { WhyRankedBy } from "../types/status.js";
import type { Store } from "../types/store.js";

/**
 * Spec 004 D2 as amended 2026-10-18 (task 004-82): the tokens that ranked
 * the first test file of this worktree `matches` selects, while the daemon's
 * record of them is at that file's current key. Absent when none did.
 */
export function whyRankedBy(
  store: Store,
  worktreeId: WorktreeId,
  matches: (ref: TestFileRef) => boolean,
): WhyRankedBy | undefined {
  const ranked = readSlowEvidence(store, worktreeId);
  if (ranked.size === 0) return undefined;
  for (const { testFile, key } of store.testFileKeys.list(worktreeId)) {
    if (!matches(testFile)) continue;
    const entry = ranked.get(testFileId(testFile));
    if (entry !== undefined && entry.key === key) {
      return { testFile: testFile.path, tokens: entry.tokens };
    }
  }
  return undefined;
}

/** A query that names a test file: its path, or the end of it after a `/`. */
export function namesFile(query: string): (ref: TestFileRef) => boolean {
  return (ref) => ref.path === query || ref.path.endsWith(`/${query}`);
}
