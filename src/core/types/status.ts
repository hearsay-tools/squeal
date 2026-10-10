import type { CheckId } from "./check.js";
import type {
  AbsolutePath,
  CommitSha,
  EpochMs,
  PayloadSchemaVersion,
  RelativePath,
  RevisionNumber,
  SourceLocation,
  WorktreeId,
} from "./common.js";
import type { ClosureMethod } from "./keys.js";
import type { DaemonNote } from "./scheduler.js";
import type {
  DiagnosticFingerprint,
  FlakyNote,
  KnownOutcome,
  KnownState,
  PendingPhase,
  Transition,
  Validity,
} from "./state.js";
import type { CheckpointKind, ResultRecord } from "./store-records.js";

/** Tally of checks by validity class at the current revision (D5). */
export type ValidityCounts = Readonly<Record<Validity, number>>;

/**
 * Whether a full-suite checkpoint completed.
 *
 * Spec 001 D7: "whether a full-suite checkpoint completed for this revision
 * and at which revision the last one completed". A checkpoint is a request
 * (`run --all` or baseline), not a coverage state: its absence says nothing
 * against current results.
 */
export interface FullSuiteState {
  readonly atCurrentRevision: boolean;
  readonly lastCompletedRevision: RevisionNumber | null;
}

/**
 * Test files of this worktree that have produced no check yet, by class. Their
 * checks are in no `ValidityCounts`.
 *
 * Spec 001 D6: "how many test files have produced no check yet and in which
 * class they are (a never-run or unkeyed file counts as unknown, a queued one
 * as pending)". A running one counts as pending too.
 */
export type TestFileCounts = Readonly<Record<Extract<Validity, "pending" | "unknown">, number>>;

/**
 * Spec 004 D1, D9: the pending work of slow test files, each count a part of
 * the header's total of its kind. Stop waits for the rest only.
 */
export interface SlowPendingCounts {
  /** Slow test files with a pending check, or queued or running without checks. */
  readonly testFiles: number;
  /** Pending checks of slow test files, a part of `counts.pending`. */
  readonly checks: number;
  /** Slow test files queued or running without checks, a part of `testFilesWithoutChecks.pending`. */
  readonly testFilesWithoutChecks: number;
}

/**
 * The open checkpoint status names (task 001-217), read from
 * `checkpointMetaKey`: running while a daemon validates, or owed to the next
 * daemon when the last one stopped first (task 001-219).
 */
export interface CheckpointInProgress {
  readonly id: string;
  /** `run-all` once a `run --all` request is among its records. */
  readonly kind: CheckpointKind;
  /** Revision it was requested at. */
  readonly revision: RevisionNumber;
  readonly startedAt: EpochMs;
  /** Test files with a result, of `total` requested. */
  readonly done: number;
  readonly total: number;
  /** The daemon stopped before it ended; the next daemon resumes it. */
  readonly owed: boolean;
}

/**
 * Spec 004 D8: what the slow tier of a worktree waits for while slow files
 * are pending, as its daemon published it (`src/core/slow/state.ts`): fast
 * work going first, the agent to pause (an idle consumer, D2 trigger a), the
 * per-user slot, or the load guard.
 */
export type SlowTierWait = "fast" | "idle" | "slot" | "load";

/** Spec 004 D8: the slow tier's activity as its daemon last published it. */
export type SlowTierActivity =
  | {
      readonly kind: "running";
      /** The first running file, `paths[0]` when `paths` is present. */
      readonly path: RelativePath;
      /**
       * Every file the run holds, in run order, when an idle tier runs
       * several (004-35); absent for one, or from a daemon that published only `path`.
       */
      readonly paths?: readonly RelativePath[];
      readonly since: EpochMs;
      /** The longest last known run time of its files, before this run; `null` when none ran. */
      readonly lastDurationMs: number | null;
    }
  | { readonly kind: "waiting"; readonly for: SlowTierWait };

/**
 * Spec 004 D8: the slow-tier line of headers and status, for a policy that
 * declares slow files (D1). Each slow test file counts in one of `current`
 * (every check current), `pending` (`SlowPendingCounts.testFiles`) or
 * `notRun` (neither: stale, unknown or never run at this revision).
 */
export interface SlowTierState {
  /** Slow test files listed in this worktree. */
  readonly testFiles: number;
  readonly current: number;
  readonly pending: number;
  readonly notRun: number;
  /**
   * The oldest revision a current slow result was observed at: every current
   * slow result stands for the artifact as it was then. `null` with none current.
   */
  readonly currentAt: RevisionNumber | null;
  /**
   * The newest revision a current slow result was observed at, when it is not
   * `currentAt`: the results ran at revisions `currentAt` to this one (lessons
   * defect 8b). Absent otherwise.
   */
  readonly currentUpTo?: RevisionNumber;
  /**
   * The artifact globs the runs of the current slow results were declared to
   * test (D5), sorted; empty when none is declared or recorded. Recorded
   * with each run's key, never read from today's policy (review wave 2, B2).
   */
  readonly artifact: readonly string[];
  /**
   * Current slow files whose run's declared artifact is not recorded: a
   * result stored before the records, or one whose record is gone. Absent
   * when none is.
   */
  readonly artifactUnknown?: number;
  /**
   * A source changed in a revision after `currentAt` (not the artifact, a
   * test file, a slow directory's fixture or a fresh worktree's first
   * listing): the sources behind the artifact are newer than the build the
   * results ran against (D5, D8). `false` with nothing current.
   */
  readonly sourcesChangedSince: boolean;
  /** What the daemon last published; `null` when it published nothing. */
  readonly activity: SlowTierActivity | null;
}

/**
 * Header carried by every delivered message and by status.
 *
 * Spec 001 D6: "Every delivered message carries a header: the worktree's
 * current revision, how many checks are current, pending, stale and unknown at
 * that revision, how many test files have produced no check yet and in which
 * class they are [...], and whether a full-suite checkpoint completed for it."
 */
export interface StatusHeader {
  readonly revision: RevisionNumber;
  readonly counts: ValidityCounts;
  readonly testFilesWithoutChecks: TestFileCounts;
  readonly fullSuite: FullSuiteState;
  /**
   * Whether a daemon is validating, from the heartbeat in `worktrees.daemon`.
   * Spec 001 D9 and review wave 3, S2: delivered text says when no daemon is
   * validating. Set on every header delivery and status build; absent only
   * from the bare store reader `readHeader`.
   */
  readonly daemon?: DaemonLiveness;
  /**
   * `false` while the daemon has not listed this worktree's test files: no
   * `test_file_keys` row and no completed checkpoint. Zero counts then mean
   * "not looked yet", not "nothing left to validate". Spec 001 D7 as amended:
   * "When the daemon has not yet listed the worktree's test files, headers and
   * status say so instead of presenting zero counts as complete." Set by
   * `readHeader`; absent reads as listed.
   */
  readonly testFilesListed?: boolean;
  /**
   * `true` while the daemon waits for an install and lists and runs nothing
   * (`awaitingInstallMetaKey`; spec 001 D5 as amended, task 001-100). Set by
   * `readHeader` only when `true`; absent reads as not waiting.
   */
  readonly awaitingInstall?: boolean;
  /**
   * While `awaitingInstall`, the workspaces that declare dependencies and
   * have none installed while others have theirs (task 001-107, review wave
   * 11 N2). Absent when the wait names none: nothing is installed at all.
   */
  readonly missingInstalls?: readonly RelativePath[];
  /**
   * The note saying Squeal runs Vitest without the dependency optimizer a
   * config turns on (spec 001 D4, task 001-176), for the registration
   * header. Set by `readHeader` while the newest Vitest instance's config
   * turns it on; absent otherwise (task 001-181).
   */
  readonly optimizerOff?: string;
  /**
   * Checks whose current result is inherited from another worktree, a part
   * of `counts.current`. Goal 4: inherited results are reported as
   * inherited; D9's skill reads "the header's pending and inherited counts".
   * `StatusSnapshot.inherited` names the sources. Set by `readHeader`; absent
   * reads as 0.
   */
  readonly inheritedCount?: number;
  /**
   * The newest revision whose runner part the daemon applied
   * (`refinedMetaKey`); `null` when no daemon recorded one. Set by
   * `readHeader`.
   */
  readonly refinedRevision?: RevisionNumber | null;
  /**
   * `true` while the current revision is ahead of `refinedRevision`: the
   * runner has not yet listed test files, the affected set or closures for
   * it, so a test file added at this revision is in no count. Pending work
   * like `counts.pending` (review wave 4.5, S1; D2 as amended). Set by
   * `readHeader`; absent reads as `false`.
   */
  readonly runnerPartPending?: boolean;
  /**
   * The pending work of slow test files (spec 004 D9). Set by `readHeader`
   * when its caller passes which files are slow or the worktree's policy
   * declares slow files; absent reads as none.
   */
  readonly slowPending?: SlowPendingCounts;
  /**
   * The slow-tier line's state (spec 004 D8). Set by `readHeader` when the
   * worktree's policy declares slow files; absent otherwise.
   */
  readonly slowTier?: SlowTierState;
  /**
   * The paths changed since the revision this consumer was last told about,
   * a union over the revision records after it up to the current one; the
   * current revision's paths when it is the one last told (task 001-89,
   * review wave 10 S4 (b); task 001-85 named only the current revision's).
   * Set by `readLiveHeader`; absent or empty names nothing.
   */
  readonly changedPaths?: readonly RelativePath[];
  /**
   * `false` when the daemon has hashed this worktree's files and no
   * installed lockfile is among them (`isInstalledLockfile`): its
   * installed-dependency fingerprint is empty, so failures that cannot find
   * a package are expected until an install. Task 001-91. Set by
   * `readLiveHeader`; absent reads as installed or not known.
   */
  readonly dependenciesInstalled?: boolean;
  /**
   * An installed lockfile (`isInstalledLockfile`) among `changedPaths` whose
   * newest change in them wrote it: the results follow a dependency install.
   * A lockfile whose newest change deleted it is not one (`npm ci` deletes
   * `node_modules` first; task 001-94, review wave 10b S1). Set by
   * `readLiveHeader`; absent names none.
   */
  readonly installedLockfile?: RelativePath;
}

/**
 * Daemon liveness from the heartbeat.
 *
 * Spec 001 D10: "Status reports \"no daemon running since <time>\" when the
 * heartbeat is older than its interval."
 */
export type DaemonLiveness =
  | { readonly state: "alive"; readonly lastHeartbeatAt: EpochMs }
  | {
      readonly state: "down";
      readonly since: EpochMs | null;
      /**
       * Task 001-156: a daemon a hook spawned at this time has not heartbeat
       * yet, and a registration said it is starting. Set only on a header
       * delivered to a consumer told so, within `DAEMON_START_GRACE_MS`.
       */
      readonly startingSince?: EpochMs;
    };

/** One known failure in status. */
export interface KnownFailure {
  readonly check: CheckId;
  readonly outcome: Extract<KnownOutcome, "fail">;
  readonly validity: Validity;
  readonly observedAt: RevisionNumber;
  readonly summary: string;
  readonly fingerprint: DiagnosticFingerprint;
  readonly location: SourceLocation | null;
}

/** Inherited current results grouped by source. */
export interface InheritedSource {
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath | null;
  readonly commit: CommitSha;
  readonly count: number;
}

/**
 * Counts behind the human line "Affected checks: 47 passed, 3 running, 12
 * queued" (vision, "The desired experience"). `ValidityCounts` says how many
 * checks are current or pending; this says what the current ones are and
 * where the pending ones are.
 */
export interface CheckBreakdown {
  /** Checks with `current` validity, by known outcome. */
  readonly currentByOutcome: Readonly<Record<KnownOutcome, number>>;
  /** Checks with `pending` validity, by phase. A pending check with no phase counts as `queued`. */
  readonly pendingByPhase: Readonly<Record<PendingPhase, number>>;
  /** Test files with a key in this worktree (`test_file_keys`). */
  readonly testFiles: number;
  /**
   * Test files with a `test_file_keys` row but no known check yet: their
   * checks are not in any count. The sum of `StatusHeader.testFilesWithoutChecks`.
   */
  readonly testFilesWithoutChecks: number;
  /**
   * Of those, the ones running now (task 001-217): a baseline over fresh
   * files runs them before any has a check. Absent reads as 0.
   */
  readonly testFilesWithoutChecksRunning?: number;
}

/**
 * Full status of one worktree, read from the store with no daemon needed.
 *
 * Spec 001 D7: "The snapshot contains: worktree root, revision, `HEAD` and
 * dirty flag, daemon liveness and last heartbeat, known failures with
 * fingerprint and location, counts of current / pending / stale / unknown
 * checks, how many current results are inherited and from where, whether a
 * full-suite checkpoint completed for this revision and at which revision the
 * last one completed, the closure method, store schema version, and the latest
 * persisted daemon notes".
 */
export interface StatusSnapshot extends StatusHeader {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly available: true;
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath;
  /** From the latest revision; read from the git dir while none is recorded. */
  readonly head: CommitSha;
  /**
   * From the latest revision; `null` while none is recorded (dirtiness needs
   * git, and status never spawns it) and while no daemon is validating, since
   * nothing observes the files then. Spec 001 D7 as amended: "The dirty flag
   * is the one observed at the last revision and is labelled with that
   * revision; when no daemon is validating it is reported as not known."
   */
  readonly dirty: boolean | null;
  /**
   * The revision `dirty` was observed at; `null` when `dirty` is. Optional
   * for payloads from before the field.
   */
  readonly dirtyObservedAt?: RevisionNumber | null;
  readonly daemon: DaemonLiveness;
  /** Failures first: the list is the reason status exists. */
  readonly knownFailures: readonly KnownFailure[];
  readonly inherited: {
    readonly count: number;
    readonly sources: readonly InheritedSource[];
  };
  readonly breakdown: CheckBreakdown;
  readonly closureMethod: ClosureMethod;
  readonly storeSchemaVersion: number;
  /** Factual notes status itself derives: worktree not registered, no revision, baseline lost after corruption (D12). */
  readonly notes: readonly string[];
  /**
   * The latest persisted daemon notes, oldest first, at most 20: runner
   * failures, dropped watcher events, tier pump stopped. Spec 001 D7: "the
   * latest persisted daemon notes [...], kept bounded per worktree in `meta`".
   * `revision` is `null` when the note belongs to no revision.
   */
  readonly daemonNotes: readonly DaemonNote[];
  /** The open checkpoint, running or owed (tasks 001-217, 001-219). Absent when none is. */
  readonly checkpoint?: CheckpointInProgress;
}

/**
 * Status could not be read. Never a stall, never a guess.
 *
 * Spec 001 D8: "Hooks reading a newer schema report \"status unavailable,
 * store version newer than this Squeal\"." Goal 6: "a dead or hung daemon
 * degrades to \"status unavailable\", never to a stall."
 */
export interface StatusUnavailable {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly available: false;
  /** `not-registered`: the store has no `worktrees` row for the id a `StatusBuilder` was asked about. */
  readonly reason: "no-store" | "store-newer" | "store-unreadable" | "timeout" | "not-registered";
  readonly message: string;
}

export type StatusResult = StatusSnapshot | StatusUnavailable;

/**
 * Builds the full status of one worktree. `HarnessDelivery.status` delegates
 * to it (D9 `status()`); `createStatusBuilder` in src/core/status is the
 * store-backed implementation.
 */
export interface StatusBuilder {
  build(worktreeId: WorktreeId): StatusResult | Promise<StatusResult>;
}

/** One stored result of a check, with where to find its full output. */
export interface WhyResultEntry {
  readonly result: ResultRecord;
  /** Root of the worktree that produced it; `null` when that worktree is gone from the store. */
  readonly worktreeRoot: AbsolutePath | null;
  /** `runs/<run-id>/` of the producing run; `null` when the run record was pruned. */
  readonly logDir: AbsolutePath | null;
}

/**
 * History and provenance of one check, read from the store with no daemon.
 *
 * Spec 001 D7: "`squeal why <check>` prints the full history and provenance
 * of one check and the path to its last run log."
 */
export interface WhyReport {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly available: true;
  readonly found: true;
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath;
  /** Current revision of the worktree; `null` when none is recorded. */
  readonly revision: RevisionNumber | null;
  readonly check: CheckId;
  /** Root of every worktree in the store, for naming origins and producers. */
  readonly worktreeRoots: Readonly<Record<WorktreeId, AbsolutePath>>;
  /** Known state in this worktree; `null` when it has none. */
  readonly knownState: KnownState | null;
  /** Transitions of the check in this worktree, oldest first. */
  readonly history: readonly Transition[];
  /**
   * Stored results of the check from every worktree, newest first, at most
   * `WHY_RESULT_LIMIT`. The first entry's `logDir` is the last run log.
   */
  readonly results: readonly WhyResultEntry[];
  /**
   * The log of the run that produced the result the known state shows: this
   * worktree's own, or the producing worktree's when inherited. `null` when
   * no stored result is identifiably behind it: replaced, pruned, or one of
   * several that fit (review wave-13i B4). Task 001-173.
   */
  readonly runLog: WhyRunLog | null;
  /**
   * Another worktree's `fail` of the check under this worktree's current key
   * that this worktree has not confirmed: held, no known state or delivery
   * comes from it until the file runs here (spec 001 D6 as amended, task
   * 001-170). Absent when there is none.
   */
  readonly heldFailure?: ResultRecord;
  /** The check's flaky note: its stored outcome flipped under one key (task 001-170). Absent when none. */
  readonly flaky?: FlakyNote;
  /**
   * The paths changed after the revision the known state was observed at,
   * when that revision is older than the current one (task 001-225, 005 D6).
   * Absent for a known state at the current revision, or with none.
   */
  readonly changedSince?: WhyChangedSince;
}

/** What changed in this worktree since an older result's revision. Task 001-225. */
export interface WhyChangedSince {
  /** The revision the known state was observed at. */
  readonly revision: RevisionNumber;
  /** Each changed path in the order of its first change, at most `WHY_CHANGED_LIMIT`. */
  readonly paths: readonly WhyChangedPath[];
  /** Paths changed in all; more than `paths.length` when capped. */
  readonly total: number;
}

/** One path changed since an older result's revision. */
export interface WhyChangedPath {
  readonly path: RelativePath;
  /** The revisions that changed it, oldest first, at most `WHY_CHANGED_LIMIT`. */
  readonly revisions: readonly RevisionNumber[];
  /** Revisions that changed it in all; more than `revisions.length` when capped. */
  readonly revisionCount: number;
}

/**
 * Where a check's console output is: the `vitest.log` of one run, which
 * covers every test file of that run, not only the check. Task 001-173.
 */
export interface WhyRunLog {
  readonly runId: string;
  /** Worktree of the producing run. */
  readonly worktreeId: WorktreeId;
  /** `<common-dir>/squeal/runs/<run-id>/vitest.log`. */
  readonly path: AbsolutePath;
  /**
   * `present`: the file is on disk. `pruned`: neither it nor its run
   * directory is (D1 pruning, or a run that never wrote one). `not-vitest`:
   * the run directory exists without a `vitest.log` or a node:test log of
   * the check's file, so no console of it was captured. `node-test`: the
   * check's file ran under node:test, whose output is its own: `path` is
   * its stdout log and `stderrPath` its stderr log (task 001-188).
   */
  readonly state: "present" | "pruned" | "not-vitest" | "node-test";
  /** With `node-test`: the file's stderr log. */
  readonly stderrPath?: AbsolutePath;
  /**
   * With `--include-logs`: the file's console lines the reporter tagged with
   * the check's test file, at most `WHY_LOG_LINE_LIMIT`, and none for
   * `not-vitest`, which captured no console of it; `null` without the flag
   * or when `pruned`.
   */
  readonly console: WhyConsole | null;
}

/** A check's test file's console lines from one run log, capped. */
export interface WhyConsole {
  /** The lines kept, each as the log wrote it (`[stdout] <file>: <text>`). */
  readonly lines: readonly string[];
  /** Lines tagged with the file in the log; more than `lines.length` when capped. */
  readonly total: number;
  readonly limit: number;
}

/** No check, or more than one, matched the name given to `squeal why`. */
export interface WhyNoMatch {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly available: true;
  readonly found: false;
  readonly query: string;
  /** Checks of this worktree whose name contains the query; empty when none does. */
  readonly candidates: readonly CheckId[];
}

export type WhyResult = WhyReport | WhyNoMatch | StatusUnavailable;
