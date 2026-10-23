import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "./common.js";
import type { CheckKey, FileHash } from "./keys.js";

/*
 * Spec 015: the code as a check type of its own. A code check is never a
 * `CheckId` (check.ts): it has no run, re-run, retry, held failure, inherited
 * confirmation or checkpoint, and shares none of the scheduler's paths (D2).
 */

/** Spec 015 D3: the languages the counter reads. TS and JS share one grammar, Python has its own. */
export type CodeLanguage = "typescript" | "javascript" | "python";

/** Spec 015 D1: every extension the counter reads, with the language it is counted as. */
export const CODE_EXTENSIONS: Readonly<Record<string, CodeLanguage>> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

/**
 * Identity of one function (spec 015 D2): `(relative path, qualified name,
 * occurrence)`. The body hash is not part of it.
 */
export interface CodeCheckId {
  readonly kind: "code";
  readonly path: RelativePath;
  /**
   * Enclosing classes and functions plus the function's own name,
   * `Ledger.settle`; an anonymous function is named by the call it is passed
   * to (`createDelivery.deliver.<transaction>`) or the variable or property
   * that receives it.
   */
  readonly qualifiedName: string;
  /** 0-based index among the file's functions with the same qualified name, in source order. */
  readonly occurrence: number;
}

/**
 * What a code check measures (spec 015 D5, D9). Each measure has a state of
 * its own: `complexity` from wave 1, `crap` and `uncovered` from wave 2.
 */
export type CodeMeasure = "complexity" | "crap" | "uncovered";

/**
 * Spec 015 D5: `pass` at or under the threshold, `fail` above it, `pending`
 * until Squeal counts the file (for `crap` and `uncovered`, until every test
 * file that loads the source has a current result with a coverage record,
 * D9), `unknown` in a parse error's range or where no coverage record can be.
 */
export type CodeOutcome = "pass" | "fail" | "pending" | "unknown";

/** A span of source text: 1-based lines and columns, as `SourceLocation`; the end is inclusive. */
export interface CodeRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * Spec 015 D3: one kind of decision point, each adding 1. TS and JS follow
 * ESLint's classic `complexity` rule; `else` (a loop's or a `try`'s),
 * `comprehension` and `assert` are radon's for Python. `logical` counts
 * `&&`, `||`, `??` and Python's `and` and `or` per extra operand.
 */
export type DecisionKind =
  | "if"
  | "loop"
  | "case"
  | "catch"
  | "ternary"
  | "logical"
  | "optional-chain"
  | "default"
  | "logical-assignment"
  | "else"
  | "comprehension"
  | "assert";

/** Spec 015 D3, D4: one function of a count. */
export interface FunctionCount {
  readonly qualifiedName: string;
  readonly occurrence: number;
  readonly range: CodeRange;
  /** The function's text with whitespace normalised (D2); follows a move or a rename. */
  readonly bodyHash: string;
  /** Cyclomatic complexity: 1 plus every decision point. */
  readonly complexity: number;
  /** Decision points by kind; a kind the function has none of is absent. */
  readonly decisions: Readonly<Partial<Record<DecisionKind, number>>>;
}

/**
 * Spec 015 D4: the count of one file's bytes, shared by every worktree. It
 * depends on the bytes alone, so its key holds no path: the blob, the
 * language and the counter version.
 */
export interface FileCount {
  readonly blob: FileHash;
  readonly language: CodeLanguage;
  /** `COUNTER_VERSION` of the counter that made it; a count is never read at another. */
  readonly counterVersion: number;
  readonly functions: readonly FunctionCount[];
  /** D3: the ranges the parser could not read; a function in one is `unknown`. Empty when it parsed. */
  readonly errors: readonly CodeRange[];
}

/**
 * One included file of a worktree at its current revision (spec 015 D4,
 * D6): the blob its count is stored under. A count no current file uses is
 * pruned past the retention.
 */
export interface CodeFile {
  readonly path: RelativePath;
  readonly blob: FileHash;
  readonly language: CodeLanguage;
  readonly counterVersion: number;
  /** Bytes; a file over `complexity.maxFileBytes` is never counted, and `squeal code` names it. */
  readonly size: number;
  /** The revision that saw the file at this blob. */
  readonly revision: RevisionNumber;
}

/**
 * Spec 015 D4: the known state of one measure of one code check in one
 * worktree.
 */
export interface CodeKnownState {
  readonly worktreeId: WorktreeId;
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly outcome: CodeOutcome;
  /** CC for `complexity`, the score for `crap`; `null` for `uncovered` and while there is none. */
  readonly value: number | null;
  /** The threshold `value` was judged against; `null` for `uncovered`. */
  readonly threshold: number | null;
  /** The revision and the blob it was counted at. */
  readonly countedAt: RevisionNumber;
  readonly blob: FileHash;
  /** The revision it last changed outcome; its first count for a new function. */
  readonly changedAt: RevisionNumber;
}

/**
 * Spec 015 D5, after 011 C5: `first-seen-fail` is a new function over the
 * threshold, `removed` a function gone while `fail` ("no longer in the
 * code"). A move, a rename, a changed value that stays `fail` and a policy
 * change record none.
 */
export type CodeTransitionKind = "first-seen-fail" | "pass-to-fail" | "fail-to-pass" | "removed";

/** One recorded change of a code check's state, per worktree; the audit log (011 C5). */
export interface CodeTransition {
  readonly worktreeId: WorktreeId;
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly kind: CodeTransitionKind;
  /** `null` for `first-seen-fail`. */
  readonly from: CodeOutcome | null;
  /** `null` for `removed`. */
  readonly to: CodeOutcome | null;
  readonly fromValue: number | null;
  readonly toValue: number | null;
  readonly threshold: number | null;
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/**
 * Spec 015 D6: how much a consumer was told of a failing function. `count`:
 * only as part of a number (registration, a policy change's summary);
 * `full`: in its own line.
 */
export type CodeTold = "count" | "full";

/**
 * What a consumer was last told about one measure of one code check (spec
 * 015 D6, after 011 C5's consumer view). The fingerprint of a code failure
 * is its measure and threshold, never its value (D5).
 */
export interface CodeViewEntry {
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly outcome: CodeOutcome;
  readonly threshold: number | null;
  readonly told: CodeTold;
  readonly toldAt: EpochMs;
}

/**
 * Spec 015 D8 (wave 2): a test file's coverage record, stored at its result
 * key and the provider's version, so it is adopted and pruned with the
 * result. Its payload's shape is wave 2's.
 */
export interface CoverageRecordKey {
  readonly resultKey: CheckKey;
  readonly providerVersion: number;
}
