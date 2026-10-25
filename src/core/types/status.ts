import type { CheckError, CheckId, RunOutcome } from "./check.js";
import type { CodeStatus } from "./code-delivery.js";
import type {
  AbsolutePath,
  CommitSha,
  EpochMs,
  PayloadSchemaVersion,
  RelativePath,
  RevisionNumber,
  SourceLocation,
  TestFileFrame,
  WorktreeId,
} from "./common.js";
import type { CheckKey, ClosureMethod, TestFileRef } from "./keys.js";
import type { DaemonNote } from "./scheduler.js";
import type {
  OutstandingGroup,
  PendingTestFiles,
  SlowSlotHolders,
  StatusHold,
} from "./standing.js";
import type {
  DiagnosticFingerprint,
  FlakyNote,
  KnownOutcome,
  KnownState,
  PendingPhase,
  RerunFirstFailure,
  Transition,
  Validity,
} from "./state.js";
import type {
  CheckpointKind,
  CheckpointLane,
  ReplacedFailure,
  ReplacingPass,
  ResultRecord,
} from "./store-records.js";

/** Tally of checks by validity class at the current revision (D5). */
export type ValidityCounts = Readonly<Record<Validity, number>>;

/**
 * Spec 011 C6 as amended 2026-10-18 (gh-34, task 011-15): known failures by
 * validity. Only `current` ones are counted in `Known failures`; `pending`
 * are queued or running for a rerun, `stale` have no run queued.
 */
export interface KnownFailureCounts {
  readonly current: number;
  readonly pending: number;
  readonly stale: number;
}

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
  /**
   * A one-lane checkpoint that completed after the last full one (task
   * 004-61): headers name the lane, never a full suite.
   */
  readonly lane?: { readonly lane: CheckpointLane; readonly revision: RevisionNumber };
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
  /**
   * The first `SLOW_FILES_NAMED` of `testFiles` in path order, which the
   * `Affected checks` line names (004 D8 as amended 2026-10-19, row 004-83).
   * Absent from a header read before it.
   */
  readonly files?: readonly TestFileRef[];
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
  /** The oldest revision a current slow result was observed at. `null` with none current. */
  readonly currentAt: RevisionNumber | null;
  /**
   * The newest revision a current slow result was observed at, when it is not
   * `currentAt`: the results ran at revisions `currentAt` to this one (lessons
   * defect 8b). Absent otherwise.
   */
  readonly currentUpTo?: RevisionNumber;
  /** What the daemon last published; `null` when it published nothing. */
  readonly activity: SlowTierActivity | null;
  /**
   * With `stop.requireSlowSuite` on, how long a main agent's Stop waits for
   * slow files (004 D9 as amended 2026-10-12, task 001-285). Absent when off.
   */
  readonly stopWaitMs?: number;
  /**
   * Under `slow.trigger: "idle"` (004 D2 as amended 2026-10-18, row 004-80):
   * slow files run only when the agent pauses. Absent under `"continuous"`,
   * where they run after the fast tests.
   */
  readonly pausesOnly?: true;
}

/**
 * Header carried by every delivered message and by status.
 *
 * Spec 001 D6: "Every delivered message carries a header: the worktree's
 * current revision, how many checks are current, pending, stale and unknown at
 * that revision, how many test files have produced no check yet and in which
 * class they are [...], and whether a full-suite checkpoint completed for it."
 */
/**
 * `HEAD` as the daemon last saw it, the revisions recorded since it last
 * moved (`1bc146f0 + 3`), and whether the tree was dirty then (task 001-406).
 * A commit moves `HEAD` and leaves the revision number as it was.
 */
export interface RevisionCommit {
  readonly head: CommitSha;
  readonly sinceHead: number;
  readonly dirty: boolean;
}

export interface StatusHeader {
  readonly revision: RevisionNumber;
  /**
   * The commit beside the revision (task 001-406): revisions count per
   * worktree, so the number alone does not compare across worktrees. Set by
   * `readHeader` once a revision or a `HEAD` move is recorded.
   */
  readonly commit?: RevisionCommit;
  readonly counts: ValidityCounts;
  /**
   * The file-level checks among `counts`, one per test file (spec 001 D4);
   * the tests are the rest. Spec 005 D1: every count of checks names the two
   * apart. Set by `readHeader`; absent, the counts are printed whole.
   */
  readonly fileLevelCounts?: ValidityCounts;
  readonly testFilesWithoutChecks: TestFileCounts;
  /**
   * Every listed test file by class, as a named wait classes it: `current`
   * only when every check it has is (spec 011 C6 as amended 2026-10-20,
   * gh-45, row 011-26). Set by `readHeader`; absent, `Known failures` says
   * nothing of what is not current.
   */
  readonly testFileCounts?: ValidityCounts;
  /**
   * The `pending` test files of `testFileCounts` by phase: running while
   * their row, a check or an open run of the live daemon holds them (C15),
   * else queued. Set by `readHeader`.
   */
  readonly testFilesByPhase?: Readonly<Record<PendingPhase, number>>;
  /**
   * The pending tests among `counts.pending` by phase, as
   * `testFilesByPhase` reads it; file-level checks are counted as their
   * files. Set by `readHeader`.
   */
  readonly testsByPhase?: Readonly<Record<PendingPhase, number>>;
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
   * While `awaitingInstall`, the command that installs the dependencies
   * (`installCommandMetaKey`, task 001-410). Absent when a daemon from
   * before it started the wait.
   */
  readonly installCommand?: string;
  /**
   * Row 011-73 (spec 011 C6, C8 and C9 as amended 2026-10-21): the holds on
   * the worktree's validation, the merge hold first, then the command holds
   * by start. The merge hold only from a live daemon that published it since
   * its start; the command holds as `squeal hold` wrote them. Set by
   * `buildSnapshot` and `readLiveHeader` only while one holds; absent from an
   * older Squeal, and read as none.
   */
  readonly holds?: readonly StatusHold[];
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
   * The file-level checks among `inheritedCount` (spec 005 D1). Set by
   * `readHeader`; absent, the inherited count is printed whole.
   */
  readonly inheritedFileLevelCount?: number;
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
 * Row 011-200 (C6, C8): the last batch the live daemon's change feed delivered, a watcher batch
 * or a reconciliation pass, started at `since`, more than twice the idle interval ago.
 */
export interface FeedLate {
  readonly since: EpochMs;
}

/**
 * Daemon liveness from the heartbeat.
 *
 * Spec 001 D10: "Status reports \"no daemon running since <time>\" when the
 * heartbeat is older than its interval."
 */
export type DaemonLiveness =
  | {
      readonly state: "alive";
      readonly lastHeartbeatAt: EpochMs;
      /** Row 011-34: its shutdown began while its heartbeat is still fresh. */
      readonly stopping?: DaemonStopping;
      /** Row 011-140: it registered older than the handoff claim it ended. */
      readonly short?: DaemonShort;
      /** Row 011-200: its change feed is late (`withLate`); edits since may not be seen yet. */
      readonly late?: FeedLate;
    }
  | {
      readonly state: "down";
      readonly since: EpochMs | null;
      /** Row 011-34: its shutdown began, its heartbeat stopped, and it still holds its lock. */
      readonly stopping?: DaemonStopping;
      /**
       * Task 001-156: a daemon a hook spawned at this time has not heartbeat
       * yet, and a registration said it is starting, or it was spawned
       * after a quiet rest (review 001-417 B2). Set only on a delivered
       * header, within `DAEMON_START_GRACE_MS`.
       */
      readonly startingSince?: EpochMs;
      /**
       * Task 001-415, review 001-417 B2: the daemon stopped unused and no
       * hook has started its successor yet; delivered headers only, status
       * leaves it out.
       */
      readonly resting?: true;
      /**
       * Task 011-08: `squeal stop` stopped it and no edit or start came
       * since, so no hook starts one (`heldStop`).
       */
      readonly stopped?: true;
      /**
       * Task 001-263: the recorded daemon stopped heartbeating and never shut
       * down (no stop note, its record not cleared), as a SIGKILL or a test's
       * `kill(0, ...)` leaves it. Absent when it stopped, or no record names it.
       */
      readonly died?: DaemonDeath;
    };

/**
 * Row 011-34 (011 C9 as amended 2026-10-20, gh-47): the recorded daemon is
 * stopping, neither alive nor down. `state` keeps what its heartbeat says,
 * so readers that switch on two values keep working; every text that says
 * the daemon's state says this first.
 */
export interface DaemonStopping {
  /** Its version, as its record names it. */
  readonly from: string;
  /** When its shutdown began. */
  readonly since: EpochMs;
  /** With a handoff claim for it (row 011-32): the version that follows. */
  readonly to?: string;
  /** With that claim: its bound. */
  readonly boundAt?: EpochMs;
  /**
   * Past the claim's bound, or `HANDOFF_BOUND_MS` after `since` without a
   * claim: the handoff did not finish, and `squeal start` finishes it.
   */
  readonly overdue: boolean;
}

/**
 * Row 011-140 (011 C9): the recorded daemon registered older than the live
 * handoff claim it ended, so it validates at its own version, no hook asks
 * it to step down again, and `squeal start` of the claim's version replaces it.
 */
export interface DaemonShort {
  /** Its incarnation, what a consumer is told once (`ToldLiveness`). */
  readonly of: string;
  /** Its version. */
  readonly version: string;
  /** The claim's version, which it was to run. */
  readonly claimed: string;
  /** When it registered. */
  readonly since: EpochMs;
}

/** What a daemon that died without shutting down was doing (task 001-263). */
export interface DaemonDeath {
  /** Its runs with no end, oldest first: the tiers in flight when it died. */
  readonly runs: readonly InFlightRun[];
}

/** One run a dead daemon left open, from its `runs` row. */
export interface InFlightRun {
  readonly id: string;
  readonly revision: RevisionNumber;
  readonly testFiles: readonly TestFileRef[];
}

/** One known failure in status. */
export interface KnownFailure {
  readonly check: CheckId;
  readonly outcome: Extract<KnownOutcome, "fail">;
  readonly validity: Validity;
  readonly observedAt: RevisionNumber;
  readonly summary: string;
  readonly fingerprint: DiagnosticFingerprint;
  readonly location: SourceLocation | null;
  /**
   * When `location` is not in the check's own test file: the first frame in
   * that file, read from the stored row at the failure's key (011 C5 as
   * amended 2026-10-21, gh-67). Absent when there is none or no such row.
   */
  readonly testFileFrame?: TestFileFrame;
  /**
   * Where its stored result was recorded, the load then, and the retry asked
   * at its key (spec 001 D6, 001-368): the facts a session that meets the
   * failure at registration is given. Absent when no stored result stands
   * for it at the current key.
   */
  readonly recorded?: RecordedFacts;
  /**
   * No stored result is identifiably the one that produced it (replaced,
   * pruned, or several fit): its age and load are unknown (review 001-417
   * B3). Absent when `recorded` is given, and for a setup failure.
   */
  readonly recordedUnknown?: true;
  /**
   * A registration's: the closure paths of its test file changed since the
   * session first registered (011 C5 as amended, gh-32, task 011-18). Absent
   * when none is, or when that is not known.
   */
  readonly changesInClosure?: readonly RelativePath[];
}

/** `KnownFailure.recorded`. */
export interface RecordedFacts {
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath | null;
  /** The recording worktree's revision. */
  readonly revision: RevisionNumber;
  /** When its run stored the result (001-404); absent from facts read before it was kept. */
  readonly recordedAt?: EpochMs;
  /** The host's load per CPU when its run started; `null` when not kept. */
  readonly loadPerCpu: number | null;
  /** The newest retry asked at the key; absent when none was. */
  readonly retry?: RetryFact;
}

/** A retry asked at a key, and how it ended (spec 001 D6, 001-368). */
export interface RetryFact {
  readonly reason: "load" | "environment";
  readonly outcome: "pending" | "passed" | "failed" | "unknown" | "cancelled";
}

/** Inherited current results grouped by source. */
export interface InheritedSource {
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath | null;
  readonly commit: CommitSha;
  readonly count: number;
  /** The file-level checks among `count` (spec 005 D1); absent, `count` is printed whole. */
  readonly fileLevelCount?: number;
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
  /** The file-level checks among `currentByOutcome` (spec 005 D1); absent, the counts are printed whole. */
  readonly fileLevelByOutcome?: Readonly<Record<KnownOutcome, number>>;
  /** The file-level checks among `pendingByPhase` (spec 005 D1); absent, the counts are printed whole. */
  readonly fileLevelByPhase?: Readonly<Record<PendingPhase, number>>;
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
  /**
   * The worktree's `HEAD` now, the one the text names (task 011-05): the
   * header's `commit.head`, which a reconciliation pass moves after a commit;
   * the git dir's while that differs (`headMovedSince`) or no revision is
   * recorded.
   */
  readonly head: CommitSha;
  /**
   * The header's dirty flag (`commit.dirty`, else the latest revision's);
   * `null` while no revision is recorded (dirtiness needs git, and status
   * never spawns it), while no daemon is validating, since nothing observes
   * the files then, and while `HEAD` moved after the last observation. Spec
   * 001 D7 as amended: "The dirty flag is the one observed at the last
   * revision and is labelled with that revision; when no daemon is
   * validating it is reported as not known." `commit.dirty` stays as the
   * daemon recorded it, as deliveries print it.
   */
  readonly dirty: boolean | null;
  /**
   * The revision `dirty` was observed at, a pass's `HEAD` move after it
   * included; `null` when `dirty` is. Optional for payloads from before the
   * field.
   */
  readonly dirtyObservedAt?: RevisionNumber | null;
  /**
   * Task 011-05: the latest revision, when the git dir's `HEAD` is not the
   * one recorded (a commit or a checkout no pass has seen yet); `head` is the
   * git dir's then and `dirty` not known. Absent otherwise.
   */
  readonly headMovedSince?: RevisionNumber;
  readonly daemon: DaemonLiveness;
  /** Failures first: the list is the reason status exists. */
  readonly knownFailures: readonly KnownFailure[];
  /** Task 011-15: `knownFailures` counted by validity; absent in payloads from before the field. */
  readonly knownFailureCounts?: KnownFailureCounts;
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
  /**
   * Policy `vitest.excludeProjects` while Vitest is built: the projects
   * Squeal never runs (001 D11, task 001-349). Absent when none is listed.
   */
  readonly vitestExcluded?: readonly string[];
  /**
   * Policy `vitest.exclude` while Vitest is built: test-file globs Squeal
   * never lists, runs or counts (004 D7, task 004-81). Absent when none.
   */
  readonly vitestExcludedFiles?: readonly string[];
  /**
   * The agent's retries pending at this worktree's current keys (spec 001
   * D6, 001-368), oldest first, with the host's load now when one waits for
   * it. Absent when none is pending.
   */
  readonly pendingRetries?: PendingRetries;
  /**
   * Task 001-403: the test files without a result at their current key and
   * not pending, each with why, so an abandoned checkpoint's gap is named.
   * Absent when there are none.
   */
  readonly unknownTestFiles?: UnknownTestFiles;
  /**
   * Task 011-12 (011 C15): how many runs the worktree's live daemon has open,
   * so status tells work it has not scheduled from work behind a run. Absent
   * while no daemon is validating.
   */
  readonly runsOpen?: number;
  /**
   * Spec 011 C6 as amended 2026-10-20 (row 011-29): the worktree's test
   * files that are not current in groups that read alike, each with where
   * they stand (011 C15), as `Outstanding:` prints them with what advances
   * each: no daemon validating, the files not listed, the revision's runner
   * part, a checkpoint in progress, a pending retry, then each file's own
   * state. Every file is in one group; slow files the `Slow tier:` line
   * counts are in none, except a running one whose project has a global
   * setup. Absent from payloads before the field; empty when nothing is
   * outstanding.
   */
  readonly outstanding?: readonly OutstandingGroup[];
  /**
   * Row 011-58 (gh-61; 011 C6): the running and the queued test files,
   * slow ones included, the first `PHASE_FILES_LISTED` of each phase in path
   * order with how many more there are, beside `testFilesByPhase`'s counts.
   * Absent from payloads before the field.
   */
  readonly pendingTestFiles?: PendingTestFiles;
  /**
   * Row 011-58 (gh-58; 004 D2 and D8): while the live daemon's slow tier
   * waits for the per-user slow slot, each held permit's holder: worktree,
   * pid, time held, running files and pending count, or that its record is
   * stale, missing or unreadable. Absent otherwise.
   */
  readonly slowSlot?: SlowSlotHolders;
  /**
   * Row 011-07: what the policy loader reports for `squeal.config.json`, as
   * `setup --check` names it (011 C6, C10). Absent for a valid or missing config.
   */
  readonly configProblems?: readonly string[];
  /** Spec 015 D6: the complexity counts; absent while `complexity.enabled` is off. */
  readonly code?: CodeStatus;
  /**
   * Row 011-146 (011 C6 as amended 2026-10-23): the worktree's focused runs,
   * the newest of each test file, oldest first, each with whether it
   * applies. Never a result: no count, failure or checkpoint above comes
   * from it. Absent when there is none and from payloads before the field.
   */
  readonly focused?: readonly StatusFocused[];
}

/**
 * Spec 011 C5 and C6 as amended 2026-10-23 (row 011-146): one focused run,
 * as its worktree's focused meta row keeps it, for status, `why` and the
 * focused wait. It is never a result, a known failure, a duration or a
 * checkpoint.
 */
export interface StatusFocused {
  readonly testFile: TestFileRef;
  /** The file's key when the run started. */
  readonly key: CheckKey;
  /** The revision the run started at. */
  readonly revision: RevisionNumber;
  /** The `--check` texts it ran for. */
  readonly texts: readonly string[];
  readonly runId: string;
  readonly logDir: string;
  readonly startedAt: EpochMs;
  /** `null` while it runs. */
  readonly endedAt: EpochMs | null;
  /** `endedAt - startedAt`; `null` while it runs. */
  readonly durationMs: number | null;
  /** How it ended; `null` while it runs. */
  readonly end: "completed" | "discarded" | "crashed" | "timed-out" | "cancelled" | null;
  /** Why it was discarded, crashed or timed out. */
  readonly reason: string | null;
  /** The checks the runner collected in the file. */
  readonly collected: number | null;
  /** How many checks held a text: `0` is a selection that matched nothing. */
  readonly matched: number | null;
  /** The selected checks that ran, at most 50. */
  readonly checks: readonly StatusFocusedCheck[];
  /** How many selected checks `checks` leaves out. */
  readonly more: number;
  /**
   * Review 0.1.286 B2: how many selected checks passed, failed and were
   * skipped, counted before `checks` was cut; absent from a run in flight
   * and from an entry written before the count.
   */
  readonly outcomes?: { readonly pass: number; readonly fail: number; readonly skip: number };
  /** Its key is its file's current key and no result is stored at that key (C5). */
  readonly applies: boolean;
  /**
   * Status only (review 0.1.286 B5): its file's phase as `pendingTestFiles`
   * counts it, read before that list's cap; `null` when nothing queues the
   * file. Absent from the wait's and `why`'s entries.
   */
  readonly phase?: PendingPhase | null;
}

/** One selected check of a focused run. */
export interface StatusFocusedCheck {
  readonly check: CheckId;
  /** As `formatCheck` prints it. */
  readonly name: string;
  readonly outcome: RunOutcome;
  readonly durationMs: number;
  readonly summary: string | null;
  readonly location: SourceLocation | null;
}

/** `StatusSnapshot.unknownTestFiles`: the first `files`, path order, of `total`. */
export interface UnknownTestFiles {
  readonly total: number;
  readonly files: readonly UnknownTestFile[];
}

/** One test file without a result at its key (task 001-403). */
export interface UnknownTestFile {
  readonly testFile: TestFileRef;
  /** Its run completed and stored nothing: "ran, nothing recorded". */
  readonly ran: boolean;
  /** Why it has no result; `null` when no reason was kept. */
  readonly reason: string | null;
  /** A few of the paths that kept it from holding still, for a first-seen growth. */
  readonly samples: readonly RelativePath[];
  /**
   * Row 011-27: why, structured where the words alone do not say what
   * advances it; absent for a reason with no step of its own and for a
   * record from a daemon before it.
   */
  readonly cause?: UnknownCause;
}

/**
 * Why a test file has no result at its key, as its next step needs it (row
 * 011-27): `timeout`, its tier of its own timed out (C4); `install`, no
 * dependencies are installed; `runner`, it has no key or a runner call
 * failed; `setup`, its project's global setup failed; `never-run`, its key
 * never had a result and nothing queued it. The scheduler records each but
 * `never-run` with the file (`RecordedCause`); status derives the rest.
 */
export type UnknownCause = "timeout" | "install" | "runner" | "setup" | "never-run";

/** `StatusSnapshot.pendingRetries`. */
export interface PendingRetries {
  readonly retries: readonly PendingRetry[];
  /** The one-minute load average now; `null` where the platform has none. */
  readonly loadAverage: number | null;
  readonly cpus: number;
}

/** One test file's pending retry; several sessions' requests at its key are one run. */
export interface PendingRetry {
  readonly testFile: TestFileRef;
  /** `environment` when any request at the key is: it runs at once. */
  readonly reason: "load" | "environment";
  /** Asked for a file with no result at its key: it runs at once whatever its reason (011 C5). */
  readonly noResult?: true;
  readonly askedAt: EpochMs;
  /** The worktree whose daemon queued its run; `null` while none has. */
  readonly claimedBy: WorktreeId | null;
  readonly requests: number;
  /** Row 011-27: when the live daemon's open run holding it started. */
  readonly runningSince?: EpochMs;
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
  /** Row 011-07: as `StatusSnapshot.configProblems`, for `squeal status` in a worktree. */
  readonly configProblems?: readonly string[];
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
  /** The commit beside `revision` (task 001-406); absent while none is recorded. */
  readonly commit?: RevisionCommit;
  readonly check: CheckId;
  /** Root of every worktree in the store, for naming origins and producers. */
  readonly worktreeRoots: Readonly<Record<WorktreeId, AbsolutePath>>;
  /** Known state in this worktree; `null` when it has none. */
  readonly knownState: KnownState | null;
  /**
   * For a failing known state: the facts status gives it (`KnownFailure.recorded`),
   * where and at what load its stored result was recorded and the retry asked
   * at its key (row 011-67, gh-52). Absent for any other state, or when no
   * stored result is identifiably behind it.
   */
  readonly recorded?: RecordedFacts;
  /**
   * For a failing known state whose `location` is not in the check's own
   * test file: the first frame in that file, read from the stored result
   * behind the state (011 C5 as amended 2026-10-21, gh-67). Absent when
   * there is none or no stored result is identifiably behind it.
   */
  readonly testFileFrame?: TestFileFrame;
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
  /** Why `runLog` is `null`; absent when it is not (issue 15, 011-04). */
  readonly runLogUnavailable?: WhyRunLogGap;
  /**
   * For an UNKNOWN known state: the run that produced it, recorded beside
   * the state, never as a keyed result (row 011-108, gh-74; 011 C6, C7).
   * Absent for any other state.
   */
  readonly unknownRun?: WhyUnknownRun;
  /**
   * The stored result at this worktree's current key for the check's test
   * file when it is not the one behind the known state: a later run, often
   * another worktree's with the same key, replaced it (spec 011 C7, one row
   * per check and key). Its errors are that run's, not those of the run
   * behind the state (issue 15, 011-04). Absent otherwise.
   */
  readonly replacedAtKey?: WhyReplacement;
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
   * Stored failures of the check older than `results`, newest first, at
   * most `WHY_OLDER_FAILURE_LIMIT` (011 C6 as amended 2026-10-21, row
   * 011-77, gh-67 Q3). Absent when there is none.
   */
  readonly olderFailures?: readonly WhyResultEntry[];
  /**
   * The check's replaced failures, newest first (011 C5 as amended
   * 2026-10-21, row 011-77, gh-54). Absent when none is kept.
   */
  readonly replacedFailures?: readonly WhyReplacedFailure[];
  /**
   * The first error of the check's one re-run after all its tests passed,
   * at this worktree's current key, with that run's log; kept whether the
   * re-run passed or failed again (spec 011 C5 as amended, gh-20; review
   * wave-2b B2). Absent when none is kept at the key.
   */
  readonly rerunFirstFailure?: WhyRerunFirstFailure;
  /**
   * The paths changed after the revision the known state was observed at,
   * when that revision is older than the current one (task 001-225, 005 D6).
   * Absent for a known state at the current revision, or with none.
   */
  readonly changedSince?: WhyChangedSince;
  /**
   * For a failing check: the closure paths of its test file changed since
   * the shell's harness session registered, as its deliveries name them
   * (011 C5 as amended, gh-32, task 011-18). Absent when the shell names no
   * registered session or the changes are not known.
   */
  readonly changesInClosure?: readonly RelativePath[];
  /** The tokens that ranked the check's slow test file (004 D2, task 004-82). Absent when none did. */
  readonly rankedBy?: WhyRankedBy;
  /**
   * Durations over every stored result of the check, not only the listed
   * ones (task 001-411). `null` when no pass or fail is stored.
   */
  readonly durations: WhyDurations | null;
  /**
   * Row 011-146 (011 C6 as amended 2026-10-23): the newest focused run of
   * the check's test file that selected the check. Never a stored result.
   * Absent when none did.
   */
  readonly focused?: WhyFocused;
}

/** `WhyReport.focused`: the focused run and this check's outcome in it (row 011-146). */
export interface WhyFocused {
  /** The run as status gives it, with `applies`. */
  readonly run: StatusFocused;
  /** This check in the run. */
  readonly result: StatusFocusedCheck;
  /** The file's current key is no longer the run's. */
  readonly keyMoved: boolean;
}

/**
 * Durations of a check's stored results across worktrees (task 001-411):
 * passes and fails, as a skip runs nothing. Nearest-rank median and p95.
 */
export interface WhyDurations {
  /** Results timed: `pass + fail`. */
  readonly results: number;
  readonly pass: number;
  readonly fail: number;
  /** Stored skips, counted and left out of the figures. */
  readonly skip: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

/**
 * Spec 004 D2 as amended 2026-10-18 (task 004-82): "`why <slow file>` names
 * the tokens that ranked it", at the key its file was queued for.
 */
export interface WhyRankedBy {
  readonly testFile: RelativePath;
  /** Tokens of the changed files that the slow file or its helpers select. */
  readonly tokens: readonly string[];
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
  /**
   * `true` when the run comes from the state sink's producer record because
   * its stored result was replaced or pruned: the log has the run's output
   * while `results` no longer holds its errors (issue 15, 011-04).
   */
  readonly fromProducer?: true;
}

/**
 * Why `squeal why` names no run log (issue 15, 011-04). `no-state`: no known
 * state and no held failure. `no-origin`: the state names no origin (an
 * older Squeal wrote it). `replaced`: the row at the current key is a later
 * run's and no producer of the state is stored. `producer-pruned`: the run
 * the state sink named as its producer has no run record left. `not-stored`:
 * no row at the current key. `unidentified`: no stored row, or several, fit
 * a state that is not current.
 */
export type WhyRunLogGap =
  | "no-state"
  | "no-origin"
  | "replaced"
  | "producer-pruned"
  | "not-stored"
  | "unidentified";

/** The run whose result replaced the one behind a known state at its key (issue 15, 011-04). */
export interface WhyReplacement {
  readonly runId: string;
  readonly worktreeId: WorktreeId;
  readonly recordedAt: EpochMs;
  readonly key: CheckKey;
  /** `runs/<run-id>/` of that run, the log of the errors stored at the key; `null` when its run record was pruned. */
  readonly logDir: AbsolutePath | null;
}

/**
 * `WhyReport.unknownRun`. `missing` says why `log` is absent: `pruned`, its
 * run record is gone; `never-written`, no run produced the UNKNOWN or its run
 * wrote no log; `older-daemon`, no record fits the state, which a daemon
 * before row 011-108 wrote.
 */
export interface WhyUnknownRun {
  /** `null` when no run produced it, or no record says which did. */
  readonly runId: string | null;
  /** Its worktree: this one, as an UNKNOWN is never inherited (C7). */
  readonly worktreeId: WorktreeId;
  /** The revision its run ran at; the state's when its run record is gone or there is none. */
  readonly revision: RevisionNumber | null;
  /** The worker's error, as the state's summary holds it. */
  readonly error: string | null;
  readonly log?: WhyRunLog;
  readonly missing?: "pruned" | "never-written" | "older-daemon";
}

/** `WhyReport.replacedFailures`: a kept replaced failure with its run's log and its errors. */
export interface WhyReplacedFailure {
  readonly failure: ReplacedFailure;
  /** Root of the failing worktree; `null` when it is gone from the store. */
  readonly worktreeRoot: AbsolutePath | null;
  /** `runs/<run-id>/` of the failing run; `null` when its run record was pruned. */
  readonly logDir: AbsolutePath | null;
  /** Its failure text's errors, the first one's stack included; `null` when the text was pruned. */
  readonly errors: readonly CheckError[] | null;
}

/** `WhyReport.rerunFirstFailure`: the record with its run's log. */
export interface WhyRerunFirstFailure extends RerunFirstFailure {
  /** `runs/<run-id>/` of the run that stored it; `null` when its run record was pruned. */
  readonly logDir: AbsolutePath | null;
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
  /** Each candidate's durations, in the order of `candidates` (task 001-411). */
  readonly candidateDurations: readonly (WhyDurations | null)[];
  /**
   * Test files of this worktree queued or running with no result at their
   * current key: an unrun test may be in one of them (011 C4 as amended,
   * gh-31, task 011-17). Absent from a payload that predates it.
   */
  readonly queuedWithoutResult?: number;
  /** The query names a slow test file that evidence ranked (task 004-82). Absent otherwise. */
  readonly rankedBy?: WhyRankedBy;
}

export type WhyResult = WhyReport | WhyNoMatch | StatusUnavailable;

/**
 * One stored failing result, as `squeal failures` lists it (task 001-409).
 * Flat, without the full error stacks: `squeal why` prints those.
 */
export interface FailureEntry {
  readonly check: CheckId;
  readonly worktreeId: WorktreeId;
  /** Root of the producing worktree; `null` when it is gone from the store. */
  readonly worktreeRoot: AbsolutePath | null;
  readonly revision: RevisionNumber;
  /** `HEAD` when it ran; `null` before the first commit. */
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly recordedAt: EpochMs;
  readonly durationMs: number;
  readonly fingerprint: string | null;
  readonly summary: string | null;
  readonly runId: string;
  /** Where it failed; `null` when the runner named no place (row 011-77). */
  readonly location: SourceLocation | null;
  /**
   * The first frame in the check's own test file when `location` is not in
   * it (011 C5 as amended 2026-10-21, gh-67); absent when there is none or
   * its failure text was pruned.
   */
  readonly testFileFrame?: TestFileFrame;
  /** The load per CPU its run had (`failed-run-loads`, 001-368); `null` when not recorded. */
  readonly loadPerCpu: number | null;
  /**
   * The pass that replaced it at its key: a replaced failure, kept as
   * history (011 C5 as amended 2026-10-21, row 011-77, gh-54). Absent for a
   * failing row still stored.
   */
  readonly replacedBy?: FailureReplacedBy;
  /**
   * Its test file has a key in its own worktree (`test_file_keys`); `false`
   * for history outside the active configuration, a deleted file or a
   * project the configuration no longer has (011 C6 and C10, row 011-79).
   */
  readonly active: boolean;
}

/** `FailureEntry.replacedBy`: the replacing pass, with its worktree's root. */
export interface FailureReplacedBy extends ReplacingPass {
  /** `null` when that worktree is gone from the store. */
  readonly worktreeRoot: AbsolutePath | null;
}

/** What `squeal failures` was asked for (row 011-75, spec 011 C6 as amended for 011-64). */
export interface FailuresSelection {
  /** Root-relative test files or directories, as typed from the working directory; `.` the root. */
  readonly paths: readonly RelativePath[];
  /** `--check` texts; a check matches when its printed name holds one. */
  readonly checks: readonly string[];
  /** `--error` texts; a failure matches when its summary holds one. */
  readonly errors: readonly string[];
  /** `--per-check`: each check once, at its newest failure the rest selects. */
  readonly perCheck: boolean;
}

/**
 * Recent failures from the shared store, newest first, read with no daemon
 * (task 001-409, spec 001 D8): this worktree's, or every worktree's.
 */
export interface FailuresReport {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly available: true;
  /** The worktree the command ran in. */
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath;
  /** `--all-worktrees`: failures of every worktree, not only this one. */
  readonly allWorktrees: boolean;
  /** `--since`: the earliest record time listed; `null` for any time. */
  readonly since: EpochMs | null;
  /** The test files, directories and check-name parts given (row 011-75); empty lists select all. */
  readonly selection: FailuresSelection;
  /** At most `limit` entries, newest first. */
  readonly failures: readonly FailureEntry[];
  /** Failures matching in all, checks with `perCheck`; more than `failures.length` when capped. */
  readonly total: number;
  /** How many of `total` are replaced failures (row 011-77); with `perCheck`, checks whose newest is one. */
  readonly replaced: number;
  /** The most listed: `--limit`, 20 by default, `total` for `--limit all`. */
  readonly limit: number;
}

export type FailuresResult = FailuresReport | StatusUnavailable;
