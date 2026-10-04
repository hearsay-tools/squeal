import type { CommitSha, EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { FileHash } from "./keys.js";

/**
 * One path whose content hash changed between two revisions.
 *
 * Spec 001 D2: "the revision records the changed paths with old and new
 * hashes". `null` on the old side is an add, `null` on the new side a delete.
 */
export interface FileChange {
  readonly path: RelativePath;
  readonly oldHash: FileHash | null;
  readonly newHash: FileHash | null;
}

/** Why a reconciliation produced this revision. Recorded for status and `squeal why`. */
export type RevisionTrigger = "watch" | "interval" | "start" | "dropped-events";

/**
 * A revision of one worktree.
 *
 * Spec 001 D2: "the revision records the changed paths with old and new
 * hashes, the time, `HEAD`, and whether the tree is dirty. A revision is never
 * created by a touch or a no-op save."
 */
export interface Revision {
  readonly worktreeId: WorktreeId;
  readonly number: RevisionNumber;
  readonly createdAt: EpochMs;
  readonly head: CommitSha;
  readonly dirty: boolean;
  readonly trigger: RevisionTrigger;
  /** Never empty: an empty change set does not create a revision. */
  readonly changes: readonly FileChange[];
}
