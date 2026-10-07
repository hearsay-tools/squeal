import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { CheckpointRecord } from "./store-records.js";
import type { CandidateBatch } from "./watcher.js";

/** Spec 001 D7: status for agents is read from the store; the daemon reads only the revision. */
export interface SchedulerStatus {
  /** The worktree's current revision; `0` before its first revision. */
  readonly revision: RevisionNumber;
}

/**
 * One factual daemon note, persisted for status.
 *
 * Spec 001 D7: status shows "the latest persisted daemon notes (runner
 * failures, dropped watcher events, tier pump stopped), kept bounded per
 * worktree in `meta`". Stored under `notesMetaKey(worktreeId)` as a JSON
 * array, newest last, at most `MAX_PERSISTED_NOTES` entries.
 */
export interface DaemonNote {
  readonly at: EpochMs;
  /** The worktree's revision when the note was written; `null` before the scheduler started. */
  readonly revision: RevisionNumber | null;
  readonly text: string;
}

/** Notes kept per worktree; older ones are dropped. */
export const MAX_PERSISTED_NOTES = 20;

/** `meta` key of a worktree's persisted notes. */
export function notesMetaKey(worktreeId: WorktreeId): string {
  return `notes.${worktreeId}`;
}

/**
 * `meta` key of a worktree's refined revision: the newest revision whose
 * runner part (invalidation, test file listing, affected set, closures) the
 * daemon applied, as a decimal number. Written by the refinement's commit and
 * by the baseline at daemon start.
 *
 * Spec 001 D2 as amended: "The last revision whose refinement was applied is
 * recorded, and headers, status and every wait treat a revision ahead of it
 * as pending, so a test file added during a tier is never reported as nothing
 * pending." In `meta`, not on the `worktrees` row, so no schema migration is
 * needed and a store without the key reads as nothing pending.
 */
export function refinedMetaKey(worktreeId: WorktreeId): string {
  return `refined.${worktreeId}`;
}

/**
 * `meta` key that is `"true"` while the daemon of a worktree waits for an
 * install: the root `package.json` declares dependencies and the root has no
 * installed lockfile, so nothing is listed or run (spec 001 D5 as amended,
 * task 001-100, defect 18). Any other value, or none, is not waiting. The
 * one source for that state: headers, status and hooks read it here.
 */
export function awaitingInstallMetaKey(worktreeId: WorktreeId): string {
  return `awaiting-install.${worktreeId}`;
}

/** A `squeal run --all` request. Spec 001 D5. */
export interface FullSuiteRequest {
  /** Run every test file, even those with a result under their current key. */
  readonly force?: boolean;
}

/**
 * Turns revisions into keys, lookups and tiered runs for one worktree.
 *
 * Spec 001 D5: "On each new revision the daemon: invalidates changed paths in
 * the runner and updates the stat cache and reverse index; computes the
 * affected test files and recomputes their keys; looks each new key up in the
 * store [...]; orders the misses [...]; runs them in tiers of a configurable
 * size". Batches are processed one at a time, never overlapping; a tier in
 * flight is never cancelled.
 */
export interface Scheduler {
  /**
   * Seeds the stat cache, keys every test file, and starts the baseline
   * checkpoint: a lookup for every test file, then a run of the misses or
   * lookup only, per policy `baseline.onStart` (D5, D11).
   */
  start(): Promise<void>;
  /**
   * Reconciles one `ChangeFeed` batch and handles the revision it creates, if
   * any. Resolves once the revision is stored with its content re-key and
   * `queued` phases, without waiting on the runner; the runner part
   * (invalidation, affected set, closures, environment) follows after the
   * tier in flight, in batch order (D2, D5). `idle` waits for it.
   */
  handleBatch(batch: CandidateBatch): Promise<void>;
  /** Spec 001 D5 `squeal run --all`: one checkpoint of kind `run-all`, run in tiers. */
  requestFullSuite(request?: FullSuiteRequest): Promise<CheckpointRecord>;
  status(): SchedulerStatus;
  /** Resolves once nothing is queued or running and no revision waits for its runner part. */
  idle(): Promise<void>;
  /** Paths the stat cache holds, for `ChangeFeed` reconciliation passes. */
  trackedPaths(): Iterable<RelativePath>;
  /**
   * Gitignored files watched anyway: closure paths (generated code) and the
   * installed lockfile (D2). For `ChangeFeed.setExtraFiles`.
   */
  extraFiles(): readonly RelativePath[];
  /** Waits for the tier in flight, starts no other, abandons an open checkpoint. */
  close(): Promise<void>;
}
