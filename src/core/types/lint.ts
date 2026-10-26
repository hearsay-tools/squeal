import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { CheckKey, FileHash } from "./keys.js";

/*
 * Spec 017: a project's own linter as a check of its own. A lint check is
 * neither a test `CheckId` (check.ts) nor a 015 `CodeCheckId` (code.ts), so
 * no older reader of their tables meets it (D2; `lint-seams.md` F2.2).
 */

/** Spec 017 D2: the tools a lint check runs. ESLint 9 and 10 only (Non-goals). */
export type LintTool = "eslint";

/** Spec 017 D2: one file and one tool. */
export interface LintCheckId {
  readonly kind: "lint";
  readonly path: RelativePath;
  readonly tool: LintTool;
}

/**
 * Spec 017 D2: `pass` with no finding of severity error or warning, `fail`
 * with at least one, `pending` while Squeal has not linted the current
 * bytes, `unknown` when it cannot (D9).
 */
export type LintOutcome = "pass" | "fail" | "pending" | "unknown";

/** Spec 017 D2: warnings count as findings. A rule set `off` reports nothing. */
export type LintSeverity = "error" | "warning";

/** Spec 017 D6: one finding of one file, as the store keeps it. */
export interface LintFinding {
  /** The rule's id; `null` for a finding no rule made, as a parse error (D9). */
  readonly rule: string | null;
  readonly message: string;
  readonly severity: LintSeverity;
  /** 1-based, as ESLint reports them. Evidence only: never in the fingerprint (D2). */
  readonly line: number;
  readonly column: number;
  /** A hash of the line's text with every whitespace character removed: D2's added and removed match. */
  readonly lineHash: string;
}

/**
 * Spec 017 D2: a hash of the sorted multiset of `rule|message` of a file's
 * findings, with no line and no column (016-33's a-set).
 */
export type LintFingerprint = string;

/**
 * Spec 017 D5, D6: one file's lint result at one key, shared by every
 * worktree. Only a run that linted the file makes one: `pending` and
 * `unknown` are a worktree's states, never results.
 */
export interface LintResult {
  readonly check: LintCheckId;
  readonly key: CheckKey;
  readonly outcome: "pass" | "fail";
  /** In ESLint's order. Empty when `outcome` is `pass`. */
  readonly findings: readonly LintFinding[];
  /** `null` when `outcome` is `pass`. */
  readonly fingerprint: LintFingerprint | null;
  readonly toolVersion: string;
  readonly lintedAt: EpochMs;
}

/** The result a lint state was last judged on: the `before` of its next transition. */
export interface LintJudged {
  readonly key: CheckKey;
  readonly outcome: "pass" | "fail";
  readonly fingerprint: LintFingerprint | null;
  /** The file's bytes it was linted at. */
  readonly blob: FileHash;
  /** The revision it was linted at (goal 2). */
  readonly revision: RevisionNumber;
}

/** Spec 017 D6, after 015 D4: the known lint state of one file in one worktree. */
export interface LintKnownState {
  readonly worktreeId: WorktreeId;
  readonly check: LintCheckId;
  readonly outcome: LintOutcome;
  /**
   * The last result judged; `null` before the first. Kept while the file is
   * `pending`, `unknown` or stale, so the next result is compared with it.
   */
  readonly judged: LintJudged | null;
  /** D5: a whole-program file whose key moved, re-linted when the agent is idle. It keeps `outcome`. */
  readonly stale: boolean;
  /** D9: why the file is `unknown`; `null` otherwise. */
  readonly reason: string | null;
  /** The revision it last changed outcome. */
  readonly changedAt: RevisionNumber;
}

/**
 * Spec 017 D2, after 015 D5: `first-seen-fail` is a file linted for the first
 * time with findings, `fail-changed` a `fail` whose fingerprint changed,
 * `removed` a file deleted or excluded while `fail`.
 */
export type LintTransitionKind =
  | "first-seen-fail"
  | "pass-to-fail"
  | "fail-to-pass"
  | "fail-changed"
  | "removed";

/**
 * What the transition function decides for one file (D2): the kind and, as
 * evidence only, the findings added and removed.
 */
export interface LintChange {
  readonly kind: LintTransitionKind;
  readonly added: readonly LintFinding[];
  readonly removed: readonly LintFinding[];
}

/** One recorded change of a lint check's state, per worktree; the audit log (011 C5). */
export interface LintTransition extends LintChange {
  readonly worktreeId: WorktreeId;
  readonly check: LintCheckId;
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/** Spec 017 D8, after 015 D6: `count` told only in a number, `full` in its own line. */
export type LintTold = "count" | "full";

/** What a consumer was last told about one lint check (D8, after 015 D6's views). */
export interface LintViewEntry {
  readonly check: LintCheckId;
  readonly outcome: LintOutcome;
  /** The fingerprint told; `null` for a `pass`. */
  readonly fingerprint: LintFingerprint | null;
  readonly told: LintTold;
  readonly toldAt: EpochMs;
}
