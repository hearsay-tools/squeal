import type { RelativePath, RevisionNumber } from "./common.js";
import type { ValidityCounts } from "./status.js";
import type { CheckpointKind, CheckpointRecord } from "./store-records.js";
import type { CandidateBatch } from "./watcher.js";

/**
 * Counters of one worktree's scheduler, for the daemon log and tests. Status
 * for agents is read from the store (D7); these describe the daemon's own
 * work since it started.
 */
export interface SchedulerStatus {
  /** The worktree's current revision; `0` before its first revision. */
  readonly revision: RevisionNumber;
  /**
   * Test files by validity class of their key (D5). A test file is `current`
   * when results exist under its current key, `pending` while queued or
   * running, `stale` when results exist only under an older key, `unknown`
   * otherwise, including after a crash or timeout at its current key (D12).
   */
  readonly testFiles: ValidityCounts;
  /** Known checks by the validity class of their test file. */
  readonly checks: ValidityCounts;
  /** Test files waiting for a tier. */
  readonly queued: number;
  /** Test files in the tier that is running. */
  readonly running: number;
  readonly runs: {
    readonly started: number;
    readonly completed: number;
    readonly crashed: number;
    readonly timedOut: number;
  };
  /** Key lookups (D5 step 3); a hit means no run was needed. */
  readonly lookups: { readonly hits: number; readonly misses: number };
  /** Test files whose tier results were discarded by the stability check (D5). */
  readonly discarded: number;
  /** The checkpoint in progress. */
  readonly checkpoint: {
    readonly id: string;
    readonly kind: CheckpointKind;
    readonly remaining: number;
  } | null;
  /** Factual notes, newest last: runner errors the scheduler worked around. */
  readonly notes: readonly string[];
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
  /** Reconciles one `ChangeFeed` batch and handles the revision it creates, if any. */
  handleBatch(batch: CandidateBatch): Promise<void>;
  /** Spec 001 D5 `squeal run --all`: one checkpoint of kind `run-all`, run in tiers. */
  requestFullSuite(request?: FullSuiteRequest): Promise<CheckpointRecord>;
  status(): SchedulerStatus;
  /** Resolves once nothing is queued or running. */
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
