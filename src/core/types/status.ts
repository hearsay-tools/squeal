import type { CheckId } from "./check.js";
import type {
  AbsolutePath,
  CommitSha,
  EpochMs,
  PayloadSchemaVersion,
  RevisionNumber,
  SourceLocation,
  WorktreeId,
} from "./common.js";
import type { ClosureMethod } from "./keys.js";
import type { DaemonNote } from "./scheduler.js";
import type {
  DiagnosticFingerprint,
  KnownOutcome,
  KnownState,
  PendingPhase,
  Transition,
  Validity,
} from "./state.js";
import type { ResultRecord } from "./store-records.js";

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
}

/**
 * Daemon liveness from the heartbeat.
 *
 * Spec 001 D10: "Status reports \"no daemon running since <time>\" when the
 * heartbeat is older than its interval."
 */
export type DaemonLiveness =
  | { readonly state: "alive"; readonly lastHeartbeatAt: EpochMs }
  | { readonly state: "down"; readonly since: EpochMs | null };

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
