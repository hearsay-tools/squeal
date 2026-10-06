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

/** Spec 001 D10: consumer expiry. */
export const CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1000;
