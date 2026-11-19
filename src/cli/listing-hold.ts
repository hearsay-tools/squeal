import { posix } from "node:path";
import type { RevisionNumber, WorktreeId } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";

/*
 * Row 011-398, review 0.1.567 B1: a fixed named set (every named path a
 * listed test file) may give its verdict before the runner lists the
 * revision only when no revision still to be listed can change a named
 * file's closure. The content pass re-keys files whose stored closure holds
 * a changed path; the runner part alone finds what import resolution makes
 * of an added or deleted path (an extensionless import that an added
 * `src/choice.ts` now takes from `src/choice/index.ts`), and re-resolves the
 * closures the content pass queued. The CLI reads neither in memory, so it
 * reads what the store keeps of them: each pending revision's changes, and
 * the revision each named file's key row was last written at.
 */

/**
 * Whether the runner part still to come for `revision` may change the
 * closure of a file of `rows`, the named files' key rows (`undefined` for a
 * file the worktree does not list): a pending revision after `refined`
 * adds or deletes a path or changes a `package.json` (what
 * `closuresToReresolve` re-resolves), or a named row was written after
 * `refined`, as a content pass's re-key writes it. `false` once every
 * revision is refined.
 */
export function listingMayChangeClosures(
  store: Pick<Store, "revisions">,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  refined: RevisionNumber | null | undefined,
  rows: readonly (TestFileKeyRecord | undefined)[],
): boolean {
  if (refined === null || refined === undefined) return false;
  if (rows.some((row) => row === undefined || row.revision > refined)) return true;
  return store.revisions
    .range(worktreeId, refined, revision)
    .some((pending) => pending.changes.some(reresolves));
}

/** A change after which the runner part re-resolves closures that may not hold its path. */
function reresolves(change: {
  readonly path: string;
  readonly oldHash: string | null;
  readonly newHash: string | null;
}): boolean {
  if (change.oldHash === null || change.newHash === null) return true;
  return posix.basename(change.path) === "package.json";
}
