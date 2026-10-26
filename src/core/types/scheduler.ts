import type {
  CommitSha,
  EpochMs,
  ProjectName,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "./common.js";
import type { SyncAnswer } from "./daemon.js";
import type { CheckKey, TestFileRef } from "./keys.js";
import type { CancelCause } from "./runner.js";
import { worktreeMetaKey } from "./store.js";
import type { CheckpointKind, CheckpointLane, CheckpointRecord } from "./store-records.js";
import type { CandidateBatch } from "./watcher.js";

/** A test file and a revision whose move of its key has no result yet (`answerMoves`). */
export interface RekeyedTestFile {
  readonly testFile: TestFileRef;
  readonly revision: RevisionNumber;
  /**
   * The move had its result, or became `unknown`, since the wait started
   * (task 001-196): the file's news is the window's, but it owes no work.
   * Absent while the move has no result.
   */
  readonly resolved?: true;
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
  /**
   * A stop's processes, written beside `text` by the daemon so status folds
   * notes by command without parsing the text (task 001-255). Absent on any
   * other note and on one an older daemon wrote, which stays unfolded.
   */
  readonly stopped?: StoppedProcesses;
  /**
   * The incarnation (`daemonIncarnation`) of the daemon whose shutdown wrote
   * this note, its first, so a reader tells that it left from any other note
   * (review wave-13af B1). Absent on any other note and on one a daemon
   * before task 001-272 wrote.
   */
  readonly exitOf?: string;
  /**
   * What the note is about, `<owner>:<subject>`, such as
   * `pytest-environment:<project>`: status lists only the latest stored
   * note of a topic, while the store keeps up to 3 (task 007-39, agreed
   * with 001). Absent on every note that replaces nothing.
   */
  readonly topic?: string;
}

/** The processes one stop stopped (`describe` in `src/core/daemon/terminate.ts`). */
export interface StoppedProcesses {
  /** What the stop was for, such as `a test left running after its tier`. */
  readonly what: string;
  /** Each process's command line, as the note's text names it. */
  readonly commands: readonly string[];
}

/** Notes kept per worktree; older ones are dropped. */
export const MAX_PERSISTED_NOTES = 20;

/** `meta` key of a worktree's persisted notes. */
export function notesMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("notes", worktreeId);
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
  return worktreeMetaKey("refined", worktreeId);
}

/**
 * `meta` key of a worktree's listing (row 015-52, agreed with 011): a JSON
 * `ListingFact`. Written only in the ledger transaction that applies a test
 * file listing that did not fail, the baseline's or a runner part's, beside
 * the refined revision. A refined revision alone proves no listing: a failed
 * `testFiles`, a whole-refinement error and an install wait write none.
 */
export function listingMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("listing", worktreeId);
}

/** What `listingMetaKey` holds. */
export interface ListingFact {
  /** Every test file this revision or an earlier one added is listed. */
  readonly revision: RevisionNumber;
  /** The commits that recorded a listing: one at the same revision is news too. */
  readonly count: number;
}

/** `null` when absent or not a `ListingFact`. */
export function parseListing(raw: string | null): ListingFact | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { revision, count } = value as Record<string, unknown>;
    return Number.isInteger(revision) && Number.isInteger(count)
      ? { revision: revision as RevisionNumber, count: count as number }
      : null;
  } catch {
    return null;
  }
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
  return worktreeMetaKey("awaitingInstall", worktreeId);
}

/**
 * `meta` key of the `HEAD` a reconciliation pass found moved with no file
 * change (a commit, a partial one among them), a JSON `HeadMove` (task
 * 001-406). A revision records `HEAD` only when files change, so this is how
 * headers and status learn of a commit before the next edit.
 */
export function headMoveMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("headMove", worktreeId);
}

/** The `headMoveMetaKey` value: `HEAD` and the dirty flag, seen at `revision`. */
export interface HeadMove {
  readonly head: CommitSha;
  readonly dirty: boolean;
  readonly revision: RevisionNumber;
}

/** A stored `HeadMove`, or `null` when `raw` is none. */
export function parseHeadMove(raw: string | null): HeadMove | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const { head, dirty, revision } = value;
    if (head !== null && typeof head !== "string") return null;
    if (typeof dirty !== "boolean" || !Number.isInteger(revision)) return null;
    return { head, dirty, revision: revision as RevisionNumber };
  } catch {
    return null;
  }
}

/** The `awaitingInstallMetaKey` value of a wait for `workspaces` (none named: `"true"`). */
export function awaitingInstallValue(workspaces: readonly string[]): string {
  return workspaces.length === 0 ? "true" : JSON.stringify(workspaces);
}

/**
 * `meta` key of the command that installs a waiting worktree's dependencies
 * (`npm ci`, …), named by the header's install sentence (task 001-410).
 * Written with `awaitingInstallMetaKey` and read only while it waits.
 */
export function installCommandMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("installCommand", worktreeId);
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

/**
 * `meta` key of a worktree's open checkpoint and its progress, a JSON
 * `CheckpointProgress` (task 001-217): status names a checkpoint in progress
 * from it. Written by the scheduler's checkpoint tracker as its files get
 * results; `""` once it ended. With `owed`, the daemon stopped before an
 * explicit checkpoint ended and the next daemon resumes it (task 001-219).
 */
export function checkpointMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("checkpoint", worktreeId);
}

/** The open checkpoint of a worktree, as `checkpointMetaKey` holds it. */
export interface CheckpointProgress {
  /** The checkpoint whose id its results carry. */
  readonly id: string;
  /** `run-all` when a `run --all` request is among the records that end with it. */
  readonly kind: CheckpointKind;
  /** Revision it was requested at. */
  readonly revision: RevisionNumber;
  readonly startedAt: EpochMs;
  /** Test files with a result, of `total` requested. */
  readonly done: number;
  readonly total: number;
  /** Set when the daemon stopped first: what the next daemon resumes (task 001-219). */
  readonly owed?: OwedCheckpoint;
}

/** An explicit checkpoint a stopped daemon left for the next one (task 001-219). */
export interface OwedCheckpoint {
  /** The `run --all` records that end once it ends. */
  readonly ids: readonly string[];
  /** Test files still without a result. */
  readonly remaining: readonly TestFileRef[];
  /** Of `remaining`, those only a run of its own counts for (`run --all --force`). */
  readonly strict: readonly TestFileRef[];
}

/** The `checkpointMetaKey` value, or `null` when absent, ended or not readable. */
export function parseCheckpointProgress(raw: string | null): CheckpointProgress | null {
  if (raw === null || !raw.startsWith("{")) return null;
  try {
    const value = JSON.parse(raw) as Partial<CheckpointProgress>;
    const numbers = [value.revision, value.startedAt, value.done, value.total];
    if (typeof value.id !== "string" || numbers.some((n) => typeof n !== "number")) return null;
    if (value.kind !== "run-all" && value.kind !== "baseline") return null;
    const owed = value.owed;
    const lists = owed === undefined ? [] : [owed.ids, owed.remaining, owed.strict];
    if (!lists.every(Array.isArray)) return null;
    return value as CheckpointProgress;
  } catch {
    return null;
  }
}

/**
 * The checkpoint a `run --all` request recorded, and `owner`: the id of the
 * checkpoint whose tiers do its work. Its own id when it started or completed
 * at once, a warm-up's always (it never joins, task 001-312); the open
 * checkpoint's when it joined that one (`Checkpoints.join`, task 001-217).
 * The store's row holds no owner (review wave-3, B4).
 */
export interface FullSuiteCheckpoint extends CheckpointRecord {
  readonly owner: string;
}

/** A `squeal run --all` request. Spec 001 D5. */
export interface FullSuiteRequest {
  /** Run every test file, even those with a result under their current key. */
  readonly force?: boolean;
  /**
   * A warm-up (task 001-307): the checkpoint's tiers report the gitignored
   * worktree paths each file read, stored for setup as `readIgnoredReads`
   * returns them. Keys, closures and results are as without it.
   */
  readonly observeIgnored?: boolean;
  /** Only this lane's test files (task 004-61); absent, both lanes. */
  readonly lane?: CheckpointLane;
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

/** `Scheduler.slowWaiting`: what a departure drain's waiting slow lane would leave queued (row 011-163). */
export interface SlowWaiting {
  /** Since when no slow file ran and the drain's fast work was done, or the drain began. */
  readonly since: EpochMs;
  /** The slow files queued, in the lane's order. */
  readonly paths: readonly RelativePath[];
}

/**
 * A worktree's own closure of each test file and the key made from it, as
 * its scheduler's key index holds them (spec 001 D3). The main store's
 * closure is the newest any worktree stored.
 */
/**
 * Spec 017 D7 (agreed with 011, 2026-10-26): the side of the scheduler's
 * pool, its `TierCapacity`, the lint pass takes a slot from. `take` gives a
 * lease, `"wait"` when the pool refused, `null` when it failed and the part
 * runs ungranted; `running` marks a part without a grant until it ends.
 */
export interface SharedCapacity {
  take(
    want: number,
    lane: "fast" | "slow",
    least: number,
    kind: "backlog" | "checkpoint",
  ): { release(): void } | "wait" | null;
  running(workers: number): () => void;
}

export interface ClosureIndex {
  key(testFile: TestFileRef): CheckKey | null;
  closure(testFile: TestFileRef): { readonly paths: readonly RelativePath[] } | undefined;
  /**
   * Spec 015 D9 (row 015-75): the runner `project`'s environment names
   * (`RunnerEnvironment.runnerName`) and the files it was read with, such
   * as a node:test preload's closure; `undefined` before its first read.
   */
  environment?(
    project: ProjectName,
  ): { readonly runner: string; readonly files: readonly RelativePath[] } | undefined;
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
  requestFullSuite(request?: FullSuiteRequest): Promise<FullSuiteCheckpoint>;
  /**
   * Spec 004 D2 `squeal run --slow`: queues every slow file that is not
   * current, and lets the slow tier run behind pending fast work even while
   * a consumer is in a turn, until no slow file is left pending.
   */
  requestSlowSuite(): Promise<SlowSuiteRequest>;
  /**
   * `squeal retry` (spec 001 D6, 001-368): claims and queues the pending
   * retry requests at this worktree's keys that may run now. A `load`
   * request whose load is too high waits for a later reconciliation pass.
   */
  requestRetries(): Promise<void>;
  /**
   * Spec 011 C15: a named wait promotes `testFiles`, queued in this
   * worktree, to the head of the first group for `withinMs` on this
   * daemon's clock or until their keys settle. Changes only the order of
   * queued files; nothing running is cancelled.
   */
  promote(testFiles: readonly TestFileRef[], withinMs: number): Promise<void>;
  /**
   * Spec 011 C15, focused checks (row 011-145): a named wait with `--check`
   * asks for the checks of each of `testFiles` whose full name holds one of
   * `texts`, run first and alone, until `withinMs` on this daemon's clock.
   * Their outcome is never a result (C5): it goes to the focused meta
   * row. A slow file or one whose runner does not focus gets no entry.
   * Absent: the daemon cannot focus.
   */
  focus?(
    testFiles: readonly TestFileRef[],
    texts: readonly string[],
    withinMs: number,
  ): Promise<void>;
  /**
   * A hook's nudge (task 001-281): a silent Stop ended a turn, so slow files
   * waiting for their consumers to go idle are planned now instead of at the
   * slow tier's recheck. Starts nothing a trigger does not allow.
   */
  nudge(): void;
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
   * Row 011-234 (005 D2 as amended): a named wait's sync, its revision and,
   * for each of `paths`, the test files whose closure in this worktree's
   * key index holds it (`SyncAnswer.readers`). Absent: the daemon names no
   * readers, and the wait selects by the stored closures.
   */
  readers?(paths: readonly RelativePath[]): Promise<SyncAnswer>;
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
  /**
   * The daemon is in use (011 C9 as amended 2026-10-21, row 011-92): an
   * edit's work, a promoted file, an open explicit checkpoint, an open `run
   * --slow` request or a new failure's re-run is queued or running. The
   * backlog is no use, queued or running, slow files no request asked for
   * included, so the unused stop does not wait for it. False before the
   * scheduler started and once it closed.
   */
  inUse(): boolean;
  /** Test files queued, fast and slow: what an unused stop leaves to the next daemon (row 011-92). */
  queued(): number;
  /**
   * A departure drain runs only its session's work (011 C9 as amended
   * 2026-10-21, row 011-93): with `true` the backlog stays queued for the
   * next daemon and the slow tier yields the slot to another worktree's
   * fresh mark; `false`, a session registered, ends the pause.
   */
  pauseBacklog(on: boolean): void;
  /**
   * Spec 011 C9, "Holds" (row 011-74): reads the worktree's command holds
   * again (the `commandHold` row of `meta`) and removes, with one note each, those
   * whose processes are both gone or whose `until` passed. While one holds,
   * no tier starts, and the tiers in flight whose runner cancels are
   * cancelled, their unfinished files queued again; it resolves once those
   * tiers ended, with `true`. When none holds any more, the queued work
   * starts. Before the scheduler started it only reads.
   */
  commandHold(): Promise<boolean>;
  /**
   * What the worktree is owed and the last session's departure drains
   * before the exit, as the drain's notes name it: an explicit checkpoint
   * open, or a new failure's re-run queued or running (task 001-219).
   * `null` with nothing owed, before the scheduler started and once it closed.
   */
  owedWork(): string | null;
  /**
   * A departure drain's slow lane waits (011 C9 as amended 2026-10-23, row
   * 011-163): the drain's fast work is done, no slow file runs, and slow
   * files are queued. `null` otherwise, when no drain paused the backlog,
   * before the scheduler started and once it closed.
   */
  slowWaiting(): SlowWaiting | null;
  /** Paths the stat cache holds, for `ChangeFeed` reconciliation passes. */
  trackedPaths(): Iterable<RelativePath>;
  /**
   * Gitignored files watched anyway: closure paths (generated code) and the
   * installed lockfile (D2). For `ChangeFeed.setExtraFiles`.
   */
  extraFiles(): readonly RelativePath[];
  /** Spec 015 D9 (review 0.1.297 B3): this worktree's own closures and keys; `null` before `start`. */
  keyIndex(): ClosureIndex | null;
  /** Spec 017 D7 (agreed with 011, 2026-10-26): the pool its tiers share with the lint pass; `null` with none. */
  capacity(): SharedCapacity | null;
  /**
   * Waits for the tiers in flight, starts no other, abandons an open
   * checkpoint. With `cancel`, also during a close already begun, the tiers
   * in flight are cancelled first (`squeal stop`, D10, task 001-367).
   */
  close(options?: SchedulerCloseOptions): Promise<void>;
}

export interface SchedulerCloseOptions {
  /** Cancel every tier in flight, as a timeout stops one; what it cut short stays queued. */
  readonly cancel?: boolean;
  /** What the cancel's runs name as its cause (row 011-56); absent, a neutral text. */
  readonly cause?: Extract<CancelCause, "stop" | "step-down">;
}
