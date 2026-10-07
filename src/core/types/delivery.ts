import type { CheckId } from "./check.js";
import type {
  AbsolutePath,
  EpochMs,
  PayloadSchemaVersion,
  RelativePath,
  RevisionNumber,
  SourceLocation,
  WorktreeId,
} from "./common.js";
import type { CheckKey } from "./keys.js";
import type {
  DiagnosticFingerprint,
  KnownOutcome,
  ResultOrigin,
  TransitionKind,
  Validity,
} from "./state.js";
import type { DaemonLiveness, KnownFailure, StatusHeader, StatusResult } from "./status.js";

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
  /**
   * For a failure: the paths of its test file's closure (`TestFileRecord`)
   * changed in this worktree since the consumer registered, the revisions
   * after its registration revision. Empty when none is; absent when it is
   * not known (no closure stored, or a consumer registered before the
   * registration revision was recorded). Inherited results are read against
   * this worktree's changes too. Task 001-91, lessons defect 16.
   */
  readonly changesInClosure?: readonly RelativePath[];
  /**
   * For a failure that is a test or hook timeout: the one-minute load
   * average when it ran (`CheckError.loadAverage`). Task 001-91.
   */
  readonly loadAverage?: number;
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
  /**
   * Empty only when `liveness` is set: a delta with nothing to say is `null`
   * at the call site.
   */
  readonly entries: readonly DeltaEntry[];
  /**
   * Set when daemon liveness changed since this consumer was last told; the
   * same value as `header.daemon`. Spec 001 D9 and review wave 3, S2: the
   * header line is delivered once per consumer when liveness changes.
   * Tool-boundary deliveries only; a peek and the idle waiter leave it.
   */
  readonly liveness?: DaemonLiveness;
  /**
   * Checks whose known state is `fail` at delivery, any validity, so a
   * report with many recoveries can name what still fails instead of what
   * recovered (task 001-91, lessons defect 15). Absent reads as unknown: the
   * recovered list is shown.
   */
  readonly stillFailing?: readonly CheckId[];
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

/**
 * Where a consumer is in its agent's turns, task 001-85. `in-turn` from a
 * prompt (or a wake) until a Stop that ends the turn silently; `idle` after
 * it, with what the idle waiter may wake the agent for: the test files
 * (`testFileId`) pending when the turn ended, and with `newTestFiles` checks
 * first observed since, because the runner part of that revision was pending
 * and the test files it adds were not listed yet. A consumer starts idle and
 * waiting for nothing.
 */
export type TurnState =
  | { readonly turn: "in-turn" }
  | {
      readonly turn: "idle";
      readonly testFiles: readonly string[];
      readonly newTestFiles: boolean;
      /**
       * Task 001-89 (review wave 10, S3): the key each of `testFiles` was
       * pending at. A file is waited for only while its key is still that
       * one, so an edit made later, from outside the turn, never wakes the
       * agent. Absent for a file (or a state an older build wrote): waited
       * for until the next turn.
       */
      readonly keys?: Readonly<Record<string, CheckKey | null>>;
      /**
       * Task 001-89: the revision the turn ended at; with `newTestFiles`,
       * only checks observed at or before it are waited for. Absent: any.
       */
      readonly revision?: RevisionNumber;
    };

/** Options of `HarnessDelivery.register`. */
export interface RegisterOptions {
  /**
   * Task 001-89 (review wave 10, S1): the consumer registers in a turn (a
   * prompt or a tool call registered it), in the same transaction, so no
   * result can land between the registration and the turn. Default `false`:
   * it starts idle, waiting for nothing.
   */
  readonly inTurn?: boolean;
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
  register(consumer: Consumer, options?: RegisterOptions): Promise<Registration>;
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

  /**
   * Resolves with the first non-empty delta for an idle consumer, or `null`
   * on timeout or abort. Spec 001 D9 as amended (task 001-85): only while the
   * consumer is idle (`TurnState`), and only entries of the test files that
   * were pending when its turn ended; every other difference stays for the
   * next prompt or tool boundary. Delivering wakes the agent, so the consumer
   * is in a turn again.
   */
  waitForDelta(consumer: Consumer, options: WaitOptions): Promise<Delta | null>;

  /**
   * A turn starts (a prompt): the consumer is in a turn, and the delta not yet
   * delivered is returned as `onToolBoundary` would. Task 001-85.
   */
  startTurn(consumer: Consumer): Promise<Delta | null>;

  /**
   * A turn ended silently: the consumer is idle, waiting for the test files
   * pending now and those with a difference not yet delivered. Task 001-85.
   */
  endTurn(consumer: Consumer): Promise<void>;

  status(worktreeId: WorktreeId): Promise<StatusResult>;
}
