import type { CheckError, CheckId, RunOutcome } from "./check.js";
import type {
  AbsolutePath,
  CommitSha,
  EpochMs,
  RelativePath,
  RevisionNumber,
  SourceLocation,
  WorktreeId,
} from "./common.js";
import type { Consumer } from "./delivery.js";
import type { CheckKey, Closure, FileHash, TestFileRef } from "./keys.js";
import type { RunEnd } from "./runner.js";
import type { DiagnosticFingerprint, PendingPhase } from "./state.js";

/**
 * Row of `worktrees`.
 *
 * Spec 001 D1: "A **worktree** is one git working tree". D10: the daemon
 * "records the path and a heartbeat in the store".
 */
export interface WorktreeRecord {
  readonly id: WorktreeId;
  readonly root: AbsolutePath;
  /** Spec 001 D1: "The daemon uses `git rev-parse [...] --git-common-dir` and records the result." */
  readonly commonDir: AbsolutePath;
  readonly isMain: boolean;
  readonly registeredAt: EpochMs;
  readonly daemon: DaemonRecord | null;
  /**
   * The last heartbeat of a daemon that cleared its record on shutdown; set
   * only while `daemon` is `null`. Spec 001 D10: status reports "no daemon
   * running since <time>" (review wave 4.5, N5). Absent when no daemon ever
   * recorded one, or when an `upsert` cleared it.
   */
  readonly lastHeartbeatAt?: EpochMs;
}

export interface DaemonRecord {
  readonly socketPath: AbsolutePath;
  readonly startedAt: EpochMs;
  readonly heartbeatAt: EpochMs;
  readonly heartbeatIntervalMs: number;
  readonly squealVersion: string;
  /**
   * A random token the daemon drew at its start, which with the version and
   * the start time makes its incarnation (`daemonIncarnation`) unique without
   * trusting the clock (task 001-270). Absent from a release before it, whose
   * incarnation cannot be read.
   */
  readonly token?: string;
}

/**
 * One stat-cache entry of `file_hashes`.
 *
 * Spec 001 D3: "a stat cache `path -> (mtime, ctime, size, inode, hash)`".
 */
export interface FileHashRecord {
  readonly path: RelativePath;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
  readonly inode: number;
  readonly hash: FileHash;
}

/**
 * Row of `test_files`: repository-wide, newest closure wins.
 *
 * Spec 001 D8: "`test_files` (with the newest closure path list, stored once
 * per test file)". ADR 0002: "compute keys from stored closure lists, look
 * them up."
 */
export interface TestFileRecord {
  readonly testFile: TestFileRef;
  readonly closure: Closure;
  readonly updatedAt: EpochMs;
  readonly updatedBy: WorktreeId;
}

/**
 * The key one worktree computed for one test file at its current revision,
 * plus pending work. Not a table in D8; needed so that status and hooks can
 * classify validity (D5) by reading the store without a daemon (D7, D9).
 */
export interface TestFileKeyRecord {
  readonly worktreeId: WorktreeId;
  readonly testFile: TestFileRef;
  /**
   * `null` while the test file cannot be keyed: its project's environment or
   * its closure is unknown (a runner call failed, spec 001 D5), or a closure
   * path is untracked. The row stays so status and headers count the file as
   * `unknown`; it is removed only when a successful listing no longer has the
   * test file. `pending` is `null` for an unkeyed file.
   */
  readonly key: CheckKey | null;
  readonly revision: RevisionNumber;
  readonly pending: PendingPhase | null;
}

/** Row of `checks`: every check ever seen, test-level or file-level. */
export interface CheckRecord {
  readonly check: CheckId;
  readonly location: SourceLocation | null;
  /** Spec 001 D4: "`test.each` appears as one templated entry until the file has run." */
  readonly templated: boolean;
  readonly firstSeenAt: EpochMs;
}

/**
 * Where and when a result was produced. Never part of its key.
 *
 * Spec 001 D3: "The commit SHA, revision and worktree are provenance, stored
 * beside each result and shown to agents, never part of the key."
 */
export interface Provenance {
  readonly worktreeId: WorktreeId;
  readonly revision: RevisionNumber;
  readonly commit: CommitSha;
  readonly dirty: boolean;
  readonly runId: string;
  readonly recordedAt: EpochMs;
}

/**
 * Row of `results`, keyed by `(check, key)`. Crashes and timeouts are not
 * stored here: an `unknown` under a key would be inherited as a hit (D5).
 *
 * Spec 001 D8: "`results` (keyed by check and key, with a last-used time
 * advanced on every lookup hit)". "Failure text is deduplicated by exact
 * text; the fingerprint is a separate derived column."
 */
export interface ResultRecord {
  readonly check: CheckId;
  readonly key: CheckKey;
  readonly outcome: RunOutcome;
  readonly durationMs: number;
  readonly location: SourceLocation | null;
  readonly fingerprint: DiagnosticFingerprint | null;
  readonly summary: string | null;
  readonly errors: readonly CheckError[];
  readonly provenance: Provenance;
}

/**
 * The run behind an UNKNOWN known state (row 011-108, gh-74; 011 C6, C7):
 * recorded beside the known state of every check of `testFile` in
 * `worktreeId`, never as a keyed result, in the shared `meta` entry
 * `unknown-runs`. It fits the state while the state is `unknown` with
 * `revision` as its `observedAt` and `reason` as its summary.
 */
export interface UnknownRun {
  readonly worktreeId: WorktreeId;
  readonly testFile: TestFileRef;
  /** The run whose end made the file UNKNOWN; `null` when no run did (its runner, install or environment failed first). */
  readonly runId: string | null;
  /** The revision the UNKNOWN state was observed at. */
  readonly revision: RevisionNumber;
  /** The worker's error, the state's summary. */
  readonly reason: string;
  readonly at: EpochMs;
}

/** One `markUnknown` of a ledger commit, as `FailureRepo.recordUnknownRuns` takes it. */
export interface MarkedUnknown {
  readonly testFiles: readonly TestFileRef[];
  readonly reason: string;
  readonly runId: string | null;
}

/** A failing `results` row at a key with its failure text's id (`FailureRepo.failingAt`). */
export interface FailingRow {
  readonly result: ResultRecord;
  /** Its `failure_texts` row; `null` when it has none. */
  readonly failureId: string | null;
}

/** A stored failure text (`FailureRepo.text`). */
export interface FailureText {
  readonly summary: string | null;
  readonly errors: readonly CheckError[];
}

/** The pass that replaced a failure at its key (`ReplacedFailure.replacedBy`). */
export interface ReplacingPass {
  readonly runId: string;
  readonly worktreeId: WorktreeId;
  readonly recordedAt: EpochMs;
}

/**
 * A failing row that a pass replaced at the same key (011 C5 as amended
 * 2026-10-21, row 011-77; gh-54): history beside `results`, kept in the
 * shared `meta` entry `replaced-failures`. No known state, transition,
 * delivery, lookup or held fail reads it.
 */
export interface ReplacedFailure {
  readonly check: CheckId;
  readonly key: CheckKey;
  /** The failing run's provenance. */
  readonly provenance: Provenance;
  readonly durationMs: number;
  readonly location: SourceLocation | null;
  readonly fingerprint: DiagnosticFingerprint | null;
  readonly summary: string | null;
  /** Its failure text, which prune keeps while this is kept; `null` when it had none. */
  readonly failureId: string | null;
  /** The load per CPU its run had (`failed-run-loads`); `null` when not recorded. */
  readonly loadPerCpu: number | null;
  readonly replacedBy: ReplacingPass;
}

/** Row of `runs`. Spec 001 D1: "`runs/<run-id>/`: full runner output per run, referenced from results". */
export interface RunRecord {
  readonly id: string;
  readonly worktreeId: WorktreeId;
  readonly revision: RevisionNumber;
  readonly testFiles: readonly TestFileRef[];
  /** The checkpoint this run is a tier of; `null` for runs the daemon scheduled on its own. */
  readonly checkpointId: string | null;
  readonly logDir: AbsolutePath;
  readonly startedAt: EpochMs;
  readonly endedAt: EpochMs | null;
  /** `null` while running. */
  readonly end: RunEnd | null;
}

/** Spec 001 D7: "A checkpoint is one `run --all` or baseline request". */
export type CheckpointKind = "run-all" | "baseline";

/**
 * Spec 004 D2 as amended (task 004-61): the one lane a `run --all --fast`
 * checkpoint requested. A checkpoint without one ran both lanes; a one-lane
 * checkpoint is never a full-suite checkpoint.
 */
export type CheckpointLane = "fast" | "slow";

/**
 * How a checkpoint ended. `completed`: every requested test file has a
 * result. `abandoned`: it ended without one for some file (daemon stopped,
 * superseded by a newer request, a tier crashed or timed out).
 */
export type CheckpointEnd = "completed" | "abandoned";

/**
 * Row of `checkpoints`: one `run --all` or baseline request. Its tiers are
 * separate `RunRecord`s that carry its id.
 *
 * Spec 001 D7: status reports "whether a full-suite checkpoint completed for
 * this revision and at which revision the last one completed".
 */
export interface CheckpointRecord {
  readonly id: string;
  readonly worktreeId: WorktreeId;
  /** Revision the request was made at. */
  readonly revision: RevisionNumber;
  readonly kind: CheckpointKind;
  /** Test files the request queued. D5: misses only, or every file with `--force`. */
  readonly testFiles: readonly TestFileRef[];
  readonly startedAt: EpochMs;
  /** When `end` was recorded, whichever it is; `null` while running. */
  readonly completedAt: EpochMs | null;
  /** `null` while running. */
  readonly end: CheckpointEnd | null;
  /** The one lane it requested (task 004-61); absent when it requested both. */
  readonly lane?: CheckpointLane;
}

/**
 * Row of `consumers`.
 *
 * Spec 001 D10: "A consumer that has not been delivered to or heard from for
 * 12 hours is expired".
 */
export interface ConsumerRecord {
  readonly consumer: Consumer;
  readonly registeredAt: EpochMs;
  readonly lastSeenAt: EpochMs;
  readonly lastDeliveredAt: EpochMs | null;
}

/**
 * The harness process a consumer registered from (lessons, defect 24;
 * `research/harness-process-liveness.md`): its PID, the start time from
 * `/proc/<pid>/stat` field 22 in clock ticks, which a reused PID does not
 * share, and the PID namespace the PID means something in
 * (`readlink /proc/self/ns/pid`). Kept in `meta` beside the consumer.
 */
export interface HarnessProcess {
  readonly pid: number;
  readonly startTime: number;
  readonly pidNamespace: string;
}

/** Spec 001 D10: consumer expiry. */
export const CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1000;

/** Every synchronous hook in hooks.json has `timeout: 2`; Claude Code kills it after this. */
export const HOOK_TIMEOUT_MS = 2_000;

/**
 * Task 001-416: a SubagentStop marks its consumer leaving before it waits,
 * and finishes within the hook timeout or is killed. A mark older than five
 * hook timeouts outlived its hook, so the daemon drops the consumer.
 */
export const LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;

/**
 * Expiry of a consumer whose idle waiter is gone: its waiter lock file exists
 * and no waiter holds it (lessons, defects 8 and 10; task 001-47). Claude
 * Code kills the waiter at every exit but runs no SessionEnd after a typed
 * prompt, so the lock file left behind is the interactive main agent's
 * liveness.
 */
export const WAITERLESS_EXPIRY_MS = 10 * 60 * 1000;
