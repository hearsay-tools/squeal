import type { CheckId } from "./check.js";
import type { CommitSha, EpochMs, RevisionNumber, SourceLocation, WorktreeId } from "./common.js";

/**
 * Last known outcome of a check.
 *
 * Spec 001 D6: "the **known state**: `pass`, `fail`, `unknown`". `unknown`
 * covers "no result at all" (D5) and "runner-crash to `unknown`" (D6).
 */
export type KnownOutcome = "pass" | "fail" | "unknown";

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
 * state**: `pass`, `fail`, `unknown`, with `current | stale | pending`
 * validity, the revision and commit it was observed at, its origin [...],
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
  /** Concise failure text for deltas and status; `null` unless `outcome` is `fail`. */
  readonly summary: string | null;
  readonly fingerprint: DiagnosticFingerprint | null;
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
 * Kinds that count as a regression for PreToolUse denial.
 *
 * Spec 001 D9: "an undelivered regression (first-seen fail or `pass ->
 * fail`)". "Recoveries never deny."
 */
export const REGRESSION_KINDS: readonly TransitionKind[] = ["first-seen-fail", "pass-to-fail"];

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
