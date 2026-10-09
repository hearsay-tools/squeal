import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { TestFileRef } from "./keys.js";
import type { CheckpointRecord } from "./store-records.js";
import type { CandidateBatch } from "./watcher.js";

/** A test file and the revision whose change last moved its key (`Scheduler.rekeyedSince`). */
export interface RekeyedTestFile {
  readonly testFile: TestFileRef;
  readonly revision: RevisionNumber;
}

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
 * task 001-100, defect 18), or the JSON array of the workspaces still
 * missing theirs while others have one (task 001-107, review wave 11 N2).
 * Any other value, or none, is not waiting. The one source for that state:
 * headers, status and hooks read it here (`parseAwaitingInstall`).
 */
export function awaitingInstallMetaKey(worktreeId: WorktreeId): string {
  return `awaiting-install.${worktreeId}`;
}

/** The `awaitingInstallMetaKey` value of a wait for `workspaces` (none named: `"true"`). */
export function awaitingInstallValue(workspaces: readonly string[]): string {
  return workspaces.length === 0 ? "true" : JSON.stringify(workspaces);
}

/** The workspaces a stored wait names, or `null` when `raw` is not a wait. */
export function parseAwaitingInstall(raw: string | null): readonly string[] | null {
  if (raw === "true") return [];
  if (raw === null || !raw.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : null;
  } catch {
    return null;
  }
}

/** A `squeal run --all` request. Spec 001 D5. */
export interface FullSuiteRequest {
  /** Run every test file, even those with a result under their current key. */
  readonly force?: boolean;
}

/**
 * What a `squeal run --slow` request did (spec 004 D2, trigger (b)). The
 * slow tier then runs once no fast file is pending, whatever the consumers'
 * turns.
 */
export interface SlowSuiteRequest {
  /** The worktree's revision when the request arrived. */
  readonly revision: RevisionNumber;
  /**
   * Slow files the request put in the queue or found queued or running: 0
   * when none is declared or every slow file is current at the revision.
   */
  readonly queued: number;
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
  /**
   * Spec 004 D2 `squeal run --slow`: queues every slow file that is not
   * current, and lets the slow tier run behind pending fast work even while
   * a consumer is in a turn, until no slow file is left pending.
   */
  requestSlowSuite(): Promise<SlowSuiteRequest>;
  /**
   * Spec 003 D3, task 003-26: another worktree grew the shared observed
   * paths. Queues a runner-only refinement, which stores no revision: the
   * runner reports the test files and projects the growth re-keys, and their
   * closures and environments are fetched again. `idle` waits for it.
   * False when nothing took it: before the baseline ends, while waiting for
   * the install, or once closed (004 review wave 2.5, B3); the caller asks
   * again.
   */
  refreshObserved(): boolean;
  status(): SchedulerStatus;
  /**
   * Resolves once the runner work queued before the call is applied: the
   * runner part of every revision stored so far included (task 001-186).
   * Rejects once the scheduler closed.
   */
  refined(): Promise<void>;
  /**
   * Test files whose key a revision numbered after `after` up to `upTo`
   * last moved: its content, closure, declared inputs, observed paths or
   * environment, or the file was added (task 001-186, `status --wait`). Not
   * the baseline's, a backlog's or a run's moves. Empty before the start.
   */
  rekeyedSince(after: RevisionNumber, upTo: RevisionNumber): readonly RekeyedTestFile[];
  /**
   * Resolves once nothing is queued or running and no revision waits for its
   * runner part. Slow files that wait for a trigger or the slot (spec 004
   * D2) do not count; a slow file running or waiting for load does.
   */
  idle(): Promise<void>;
  /**
   * A slow file (spec 004 D2) is queued or running. A daemon whose last
   * session left drains them before it exits (001 D10 as amended, task
   * 004-29). False before the scheduler started and once it closed.
   */
  slowPending(): boolean;
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
