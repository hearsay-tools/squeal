import type { CodeFile } from "../../types/code.js";
import type { RevisionNumber, WorktreeId } from "../../types/index.js";
import { readPulled } from "../pass/pulled.js";
import type { CodeMetaRepo } from "../store/types.js";
import type { CoverageSummary, FileSummary } from "./summary.js";

/*
 * Review 0.1.299 B1 (repair R7): a coverage STILL FAIL comes only for a
 * body the session wrote. The step reuses the complexity pass's edit
 * marks, which a later change git brought does not clear; these say which
 * files git changed since their last judgement, so an older own edit there
 * marks none.
 */

/**
 * Each file git changed, with the last revision it did: the summary's,
 * kept since a step saw it, and the pulled record's (015-38), which an own
 * edit to the file after it empties.
 */
export function broughtByGit(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  summary: CoverageSummary | null,
): Map<string, RevisionNumber> {
  const brought = new Map(Object.entries(summary?.brought ?? {}));
  for (const [path, revision] of readPulled(meta, worktreeId)) {
    brought.set(path, Math.max(revision, brought.get(path) ?? 0));
  }
  return brought;
}

/**
 * Leaves in `brought` the files of `next` not judged at their blob now:
 * for one that is, an older edit is before its judgement, so it marks none
 * anyway.
 */
export function keepUnjudged(
  brought: Map<string, RevisionNumber>,
  files: readonly CodeFile[],
  next: Readonly<Record<string, FileSummary>>,
): void {
  for (const path of brought.keys()) if (next[path] === undefined) brought.delete(path);
  for (const f of files) {
    const now = next[f.path];
    if (now?.state === "judged" && now.blob === f.blob) brought.delete(f.path);
  }
}
