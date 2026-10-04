import type { CheckId } from "./check.js";
import type {
  AbsolutePath,
  EpochMs,
  PayloadSchemaVersion,
  RevisionNumber,
  SourceLocation,
  WorktreeId,
} from "./common.js";
import type {
  DiagnosticFingerprint,
  KnownOutcome,
  ResultOrigin,
  TransitionKind,
  Validity,
} from "./state.js";
import type { KnownFailure, StatusHeader, StatusResult } from "./status.js";

/** Agent id of a session's main agent. */
export const MAIN_AGENT = "main";

/**
 * One receiver of deltas.
 *
 * Spec 001 D6: "A consumer is `(worktree, session id, agent id or
 * \"main\")`."
 */
export interface Consumer {
  readonly worktreeId: WorktreeId;
  readonly sessionId: string;
  /** Harness agent id, or `MAIN_AGENT`. */
  readonly agentId: string;
}

/**
 * What a consumer was last told about one check.
 *
 * Spec 001 D6: "Its view is the state and fingerprint last told to it for each
 * check."
 */
export interface ViewEntry {
  readonly check: CheckId;
  readonly outcome: KnownOutcome;
  readonly fingerprint: DiagnosticFingerprint | null;
  readonly toldAt: EpochMs;
}

/**
 * One notable difference between a consumer's view and the known state of a
 * check that still has one.
 *
 * Spec 001 D6: "keeps only notable differences (the transition kinds above,
 * evaluated between what was told and what is known now)".
 */
export interface TransitionEntry {
  readonly check: CheckId;
  readonly kind: TransitionKind;
  readonly from: KnownOutcome | null;
  readonly to: KnownOutcome;
  /** Validity of the `to` state; a `fail` may be `pending` again at the current revision. */
  readonly validity: Validity;
  readonly observedAt: RevisionNumber;
  readonly origin: ResultOrigin;
  /**
   * Root of the worktree an inherited result came from, from the `worktrees`
   * table. Absent for own results and when that worktree has no row.
   */
  readonly originRoot?: AbsolutePath;
  readonly summary: string | null;
  readonly location: SourceLocation | null;
  /**
   * True for a `first-seen-fail` first observed by the worktree's baseline
   * checkpoint. Spec 001 D6: "Failures first observed by the baseline run
   * after registration are delivered once, in a batch labelled as baseline
   * findings." Absent means false.
   */
  readonly baseline?: boolean;
}

/**
 * A check told to this consumer as failing that has no known state any more:
 * the runner stopped reporting it (renamed or deleted test, a file-level
 * failure gone after a fix). Not a transition: nothing is recorded in the
 * audit log.
 *
 * Spec 001 D6: "A check retired while the last state told to a consumer was
 * `fail` is delivered once to that consumer as resolved, worded as no longer
 * reported by the runner, so a renamed or deleted failing test never leaves an
 * open failure in an agent's view."
 */
export interface RetiredEntry {
  readonly check: CheckId;
  readonly kind: "fail-retired";
  readonly from: "fail";
  /** No known state: the runner no longer reports the check. */
  readonly to: null;
  /** Fingerprint of the failure that was told. */
  readonly fingerprint: DiagnosticFingerprint | null;
  /** Current revision when the delivery found the check gone. */
  readonly observedAt: RevisionNumber;
}

/** Kind of a delta entry: a transition kind, or `fail-retired`. */
export type DeltaKind = TransitionKind | RetiredEntry["kind"];

/** Discriminated by `kind`. */
export type DeltaEntry = TransitionEntry | RetiredEntry;

/**
 * A delivery: header plus notable differences, failures first.
 *
 * Spec 001 D6: "Failures first observed by the baseline run after
 * registration are delivered once, in a batch labelled as baseline findings."
 * Rendering and the 10,000-character cap are a separate formatter.
 */
export interface Delta {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly consumer: Consumer;
  readonly header: StatusHeader;
  /** `baseline` when every entry is a baseline finding, else `transitions`. */
  readonly label: "transitions" | "baseline";
  /** Never empty: an empty delta is `null` at the call site. */
  readonly entries: readonly DeltaEntry[];
}

/**
 * Result of registering a consumer.
 *
 * Spec 001 D6: "On registration the view is seeded with the current known
 * state of every check, so pre-existing and inherited failures are reported
 * once in the registration header as known failures, not later as
 * transitions."
 */
export interface Registration {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly consumer: Consumer;
  readonly header: StatusHeader;
  readonly knownFailures: readonly KnownFailure[];
}

export interface PeekOptions {
  /** Kinds to return and mark delivered, e.g. `REGRESSION_KINDS`. */
  readonly kinds: readonly DeltaKind[];
}

export interface WaitOptions {
  /** Silent expiry. Spec 001 D9: "Its `timeout` is explicit and long; expiry is silent". */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * The harness-neutral delivery surface the core offers to harness adapters.
 *
 * Spec 001 D9: "The adapter interface implied by Claude Code, Codex, Pi and
 * OpenCode is three operations: `onToolBoundary(consumer) -> delta | none`,
 * `waitForDelta(consumer) -> delta` where the harness can wake an idle agent,
 * and `status()`. Nothing in the core depends on Claude Code."
 *
 * `register` and `unregister` are the consumer lifecycle that SessionStart,
 * SubagentStart and SessionEnd need (D9); they are not push or pull channels.
 */
export interface HarnessDelivery {
  register(consumer: Consumer): Promise<Registration>;
  unregister(consumer: Consumer): Promise<void>;

  /**
   * Computes the delta, writes it into the view, returns it. `null` when
   * nothing is notable. Spec 001 D6: "A check that broke and recovered between
   * two deliveries produces nothing."
   */
  onToolBoundary(consumer: Consumer): Promise<Delta | null>;

  /**
   * Like `onToolBoundary`, restricted to entries of `options.kinds`: only
   * those are returned and written into the view, every other difference
   * stays for the next delivery. `null` when none is notable.
   *
   * Spec 001 D9, PreToolUse: "The hook reads regressions through a peek that
   * marks only those entries delivered, so recoveries are not consumed by a
   * denial and the same regression never denies twice."
   */
  peek(consumer: Consumer, options: PeekOptions): Promise<Delta | null>;

  /** Resolves with the first non-empty delta, or `null` on timeout or abort. */
  waitForDelta(consumer: Consumer, options: WaitOptions): Promise<Delta | null>;

  status(worktreeId: WorktreeId): Promise<StatusResult>;
}
