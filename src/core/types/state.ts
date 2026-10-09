import type { CheckId } from "./check.js";
import type { CommitSha, EpochMs, RevisionNumber, SourceLocation, WorktreeId } from "./common.js";
import type { CheckKey, TestFileRef } from "./keys.js";
import type { ResultRecord } from "./store-records.js";

/**
 * Last known outcome of a check.
 *
 * Spec 001 D6: "the **known state**: `pass`, `fail`, `skip` (skipped or todo
 * in the runner; counted separately, never a failure, never notable in a
 * delta), `unknown`". `unknown` covers "no result at all" (D5) and
 * "runner-crash to `unknown`" (D6).
 */
export type KnownOutcome = "pass" | "fail" | "skip" | "unknown";

/**
 * Whether the known outcome describes the current revision. Exactly one class
 * per check; status counts are a tally of these.
 *
 * Spec 001 D5: "A stored result is **current** for a check in a worktree at a
 * revision when its key equals the key computed for that check at that
 * revision. Otherwise the check is **stale** (an older result exists under
 * another key) or **unknown** (no result at all). **Pending** means a run that
 * will produce a result for the current key is queued or running."
 *
 * `pending` wins over `stale` and `unknown`: a stale check that is queued is
 * pending. The outcome still carries the last known state.
 */
export type Validity = "current" | "pending" | "stale" | "unknown";

/** Sub-state of `pending`. Styleguide check states include `running` and `queued`. */
export type PendingPhase = "queued" | "running";

/**
 * Where a current result came from.
 *
 * Spec 001 D6: "its origin (`own` or `inherited from <worktree> at
 * <commit>`)".
 */
export type ResultOrigin =
  | { readonly kind: "own" }
  | { readonly kind: "inherited"; readonly worktreeId: WorktreeId; readonly commit: CommitSha };

/**
 * Normalized first error line plus source location, used to tell a changed
 * failure from the same failure.
 *
 * Spec 001 D6: "a **diagnostic fingerprint** (normalized first error line plus
 * source location)."
 */
export type DiagnosticFingerprint = string;

/**
 * The derived state of one check in one worktree.
 *
 * Spec 001 D6: "For each worktree and check the daemon derives the **known
 * state**: `pass`, `fail`, `skip` [...], `unknown`, with `current | stale |
 * pending` validity, the revision and commit it was observed at, its origin [...],
 * duration, location, a concise failure summary, and a **diagnostic
 * fingerprint**".
 */
export interface KnownState {
  readonly worktreeId: WorktreeId;
  readonly check: CheckId;
  readonly outcome: KnownOutcome;
  readonly validity: Validity;
  /** Set only when `validity` is `pending`. */
  readonly pendingPhase: PendingPhase | null;
  /** Revision the outcome was observed at; `null` when never observed. */
  readonly observedAt: RevisionNumber | null;
  readonly commit: CommitSha;
  readonly origin: ResultOrigin | null;
  readonly durationMs: number | null;
  readonly location: SourceLocation | null;
  /**
   * Concise failure text for deltas and status when `outcome` is `fail`; the
   * reason no result exists (runner crash, timeout) when it is `unknown` after
   * `StateSink.markUnknown`; `null` otherwise.
   */
  readonly summary: string | null;
  readonly fingerprint: DiagnosticFingerprint | null;
}

/**
 * A check whose stored outcome flipped under one key: a `fail` replaced by a
 * `pass`, or the reverse, so the same inputs gave both (spec 001 D6 as
 * amended, task 001-170). The newest flip per check is kept in `meta`.
 */
export interface FlakyNote {
  readonly key: CheckKey;
  readonly from: "pass" | "fail";
  readonly to: "pass" | "fail";
  /** Worktree whose run stored the replaced result. */
  readonly fromWorktreeId: WorktreeId;
  /** Worktree whose run stored the result that replaced it. */
  readonly toWorktreeId: WorktreeId;
  readonly at: EpochMs;
}

/**
 * Notable kinds of state change.
 *
 * Spec 001 D6: "first-seen fail, `pass -> fail`, `fail -> pass`, `fail ->
 * fail` with a changed fingerprint, runner-crash to `unknown`."
 */
export type TransitionKind =
  | "first-seen-fail"
  | "pass-to-fail"
  | "fail-to-pass"
  | "fail-changed"
  | "to-unknown";

/**
 * One recorded transition. Audit log only.
 *
 * Spec 001 D6: "A **transition** is recorded, per worktree, whenever a new
 * result changes a check's known state [...]. Transitions are the audit log.
 * Agents never read them directly."
 */
export interface Transition {
  readonly worktreeId: WorktreeId;
  readonly check: CheckId;
  readonly kind: TransitionKind;
  readonly from: KnownOutcome | null;
  readonly to: KnownOutcome;
  readonly fromFingerprint: DiagnosticFingerprint | null;
  readonly toFingerprint: DiagnosticFingerprint | null;
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/**
 * Context of one `StateSink` call that the results do not carry themselves.
 *
 * Spec 001 D6: "Failures first observed by the baseline run after
 * registration are delivered once, in a batch labelled as baseline findings."
 * The sink looks the checkpoint up and remembers first-seen failures of a
 * `baseline` checkpoint for that label.
 */
export interface StateProvenance {
  /** `RunRecord.checkpointId` of the run, or the checkpoint a lookup belongs to; `null` otherwise. */
  readonly checkpointId: string | null;
}

/**
 * Where the scheduler (task 001-20) hands results to the known state (task
 * 001-21). Synchronous like the store. Each call is one store transaction
 * that updates `known_states` and appends the notable `transitions` (D6);
 * each returns the transitions it recorded.
 *
 * Order of writes: store results (`results.putMany`) and the worktree's
 * `test_file_keys` first, then call the sink. Validity is classified against
 * `test_file_keys`: a result is `current` only when its key is the key
 * recorded for its test file; a test file with no recorded key is `stale`.
 */
export interface StateSink {
  /**
   * Applies results produced by a run of this worktree or found by key
   * lookup (D5 step 3). Origin is `own` when `provenance.worktreeId` of a
   * result is this worktree, else `inherited`. `fingerprint` and `summary` of
   * a `fail` should come from `describeFailure` (src/core/state). Known
   * checks of a test file that are missing from `results` keep their state;
   * the scheduler retires checks that left the file with `retire`.
   */
  applyResults(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    results: readonly ResultRecord[],
    provenance: StateProvenance,
  ): readonly Transition[];

  /**
   * Spec 001 D12: "every check in the tier becomes `unknown` at this
   * revision, one transition is recorded". Every known check of the given
   * test files becomes `unknown` with `reason` as its summary. Nothing is
   * stored under a key.
   */
  markUnknown(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
    reason: string,
  ): readonly Transition[];

  /**
   * Re-derives known states from `test_file_keys` and the results stored
   * under those keys: a check with a result under its file's current key
   * takes that result (a lookup hit), every other known check keeps its
   * outcome and becomes `pending`, `stale` or `unknown`. Call after keys or
   * pending phases change. Test files without a recorded key are left alone.
   * `testFiles` limits the work to those files; default every keyed file.
   */
  refresh(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    provenance: StateProvenance,
    testFiles?: readonly TestFileRef[],
  ): readonly Transition[];

  /**
   * Spec 001 D8: "Checks that disappear from a test file are retired from
   * `known_states` and every consumer view". No transition is recorded. A
   * view entry told as `fail` stays until delivery reports it once as no
   * longer reported by the runner (D6, `RetiredEntry`).
   */
  retire(worktreeId: WorktreeId, checks: readonly CheckId[]): void;
}
