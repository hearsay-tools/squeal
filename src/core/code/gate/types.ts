import type { FunctionCount } from "../../types/code.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { CoverageRecord } from "../coverage/types.js";
import type { RunEstimate } from "./estimate.js";
import type { PrepareRun } from "./prepare.js";
import type { ScopeEvidence } from "./scope.js";

/*
 * Spec 020: the contract between the gate's three parts. `changedFunctions`
 * (020-02, D2) gives the functions to judge; `collectEvidence` (020-03, D3)
 * gives what the test runs saw; `evaluate` (020-01, D5 to D7) joins both
 * under the policy read at the base and gives the report. Each part is
 * written against these types only.
 */

/**
 * `QUALITY_POLICY_VERSION` (D6): raised when a rule of D5, D6 or D8 changes
 * meaning. 2: D8's exceptions (row 020-09). 3: a loader that skipped a test
 * proves a pass and never a violation (D11.3, row 020-07a). 4: the gaps
 * `left-out` (D14, row 020-15a) and `not-prepared` (D15, row 020-16b).
 */
export const QUALITY_POLICY_VERSION = 4;

/** D7: the format of `squeal code --base --json`. */
export const GATE_REPORT_FORMAT = "squeal-code-gate/1";

/** D8: the format of the file `--exceptions` reads. */
export const EXCEPTIONS_FORMAT = "squeal-code-exceptions/1";

/** D2: why a function is judged; moved, shifted and unchanged ones are not. */
export type ChangeKind = "edited" | "added";

/** D2: one changed function at the head bytes. */
export interface ChangedFunction {
  readonly path: RelativePath;
  /** The head bytes' blob id. */
  readonly blob: FileHash;
  readonly change: ChangeKind;
  readonly count: FunctionCount;
}

/**
 * D2: a changed path counted at the head bytes, with every function, changed
 * or not; the join reads them all (015 D9: own lines exclude nested
 * functions, and a V8 entry that holds another counted function is not
 * that function's).
 */
export interface CountedPath {
  readonly path: RelativePath;
  /** The counted bytes' blob id: the head's in `counted`, the base's in `baseCounted`. */
  readonly blob: FileHash;
  /** The head count's functions, in the count's order. */
  readonly functions: readonly FunctionCount[];
}

/** D2: a changed path the counter could not count, with why. */
export interface UncountedPath {
  readonly path: RelativePath;
  readonly reason: "too-large" | "parse-error" | "unsupported";
  /**
   * The head bytes' blob id, for D7's `head.paths`; absent when the head is
   * not a regular file (`unsupported`) (amended 2026-11-10, review 0.1.423 S1).
   */
  readonly blob?: FileHash;
}

/**
 * D16: why D2 does not judge a head function. `unchanged`: its body hash is
 * that of its identity at the base (a new test title, a reindent).
 * `moved`: the hash is at another identity of a changed path at the base
 * (a moved, renamed or copied body).
 */
export type OmitReason = "unchanged" | "moved";

/** D16: a head function the diff's changed lines touch and D2 does not judge. */
export interface OmittedFunction {
  readonly path: RelativePath;
  readonly qualifiedName: string;
  readonly occurrence: number;
  /** Where it starts at the head, 1-based. */
  readonly line: number;
  readonly reason: OmitReason;
  /** `moved` only: the base function with its body hash, the first by path, name and occurrence. */
  readonly base?: {
    readonly path: RelativePath;
    readonly qualifiedName: string;
    readonly occurrence: number;
  };
}

/** D2: what the inventory gives the evaluator. */
export interface ChangedSet {
  /** The `--base` value as given. */
  readonly ref: string;
  /** `git merge-base <ref> HEAD`. */
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly dirty: boolean;
  /**
   * Every changed path of the diff, untracked ones and removed ones
   * included, whatever its extension or `complexity.include`; sorted. D3.1
   * selects from these, so a test file changed only at top level, or whose
   * functions only moved, still runs (amended 2026-11-10, review 0.1.423 B1).
   */
  readonly paths: readonly RelativePath[];
  readonly functions: readonly ChangedFunction[];
  /**
   * Every changed path counted at the head, including paths whose functions
   * all moved or shifted; sorted by path.
   */
  readonly counted: readonly CountedPath[];
  /** Functions inside a parse-error range; judged `not-counted`. */
  readonly inErrors: readonly ChangedFunction[];
  readonly uncounted: readonly UncountedPath[];
  /**
   * D8: each changed path counted at the merge base, where it is a blob
   * within `maxFileBytes`; sorted by path. An `edited` function's base CC is
   * that of its identity here. Absent when the inventory gave none: then no
   * inherited exception holds (row 020-09).
   */
  readonly baseCounted?: readonly CountedPath[];
  /**
   * D16: the head functions the diff's changed lines touch that are not in
   * `functions` or `inErrors`, with why; sorted by path, name and
   * occurrence. Absent when the inventory gave none (row 020-18).
   */
  readonly omitted?: readonly OmittedFunction[];
}

/** D3: one test file of the runs. */
export interface TestFileEvidence {
  readonly runner: "vitest" | "node-test";
  readonly path: RelativePath;
  /** It ran whole before the deadline. */
  readonly completed: boolean;
  /** Full names of its failed tests; empty when none failed. */
  readonly failed: readonly string[];
  /**
   * A test of it was skipped, so its record cannot show what that test
   * runs: it proves a pass and never a violation (D11.3).
   */
  readonly skipped: boolean;
  /** The sources its closure loads; `null` when the closure is not known. */
  readonly loads: readonly RelativePath[] | null;
  /** Its record at the current provider and record versions; `null` when none. */
  readonly record: CoverageRecord | null;
  /**
   * Where its evidence came from when this command did not run it: `store`,
   * read from the stores at the key a daemon gives it (D11.7); `parts`, from
   * `squeal ci record`'s parts (D13.2). Absent when this command ran it.
   */
  readonly from?: "store" | "parts";
  /**
   * D12.7: with `coverage.children` at the base, the coverage files of the
   * processes and threads its tests started that this command read; absent
   * with the key off, and for a file read from the stores.
   */
  readonly children?: ChildFiles;
  /**
   * D15.3: its node:test entry's `prepare` failed, timed out, or is declared
   * only at the head, so it did not run; `completed` is `false`.
   */
  readonly notPrepared?: true;
}

/**
 * D12.7: coverage files of child processes and threads. Each process
 * writes one file per thread it ran, so this counts files, not processes.
 */
export interface ChildFiles {
  /** Mapped into the test file's record. */
  readonly read: number;
  /** Dropped alone, over 64 MiB or not parsed (D12.4); each one only lowers coverage. */
  readonly dropped: number;
}

/** D3: what the collector gives the evaluator. */
export interface Evidence {
  readonly testFiles: readonly TestFileEvidence[];
  /** The budget ended before every selected file ran. */
  readonly timedOut: boolean;
  readonly budgetSeconds: number;
  /** D14: the scope and the selected files it left out; absent when the caller gave no scope. */
  readonly scope?: ScopeEvidence;
  /** D15.3: each node:test entry's `prepare` that a selected file waited for; absent when none. */
  readonly prepares?: readonly PrepareRun[];
  /** D17.1: each runner's estimate before its run, in the order they ran (D18); absent when no file was to run. */
  readonly estimates?: readonly RunEstimate[];
}

/** D6: the policy, read at the base commit. */
export interface GatePolicy {
  readonly complexityThreshold: number;
  readonly crapThreshold: number;
  /** `coverage.exclude`: globs whose functions read `skipped`. */
  readonly coverageExclude: readonly string[];
}

/** D5: a function's state; D8: `accepted`, a violation an exception covers. */
export type GateState = "pass" | "violation" | "incomplete" | "skipped" | "accepted";

/** D5: why a function is incomplete. */
export type GateGap =
  | "not-counted"
  | "no-loader"
  | "not-finished"
  | "no-record"
  | "not-joined"
  | "test-failed"
  /** D11.3: a loader skipped a test, and the records in hand do not prove a pass. */
  | "skipped"
  /** D14.2: a loader the scope left out did not run, and the records in hand do not prove a pass. */
  | "left-out"
  /** D15.3: a loader did not run, because its node:test entry's `prepare` did not pass. */
  | "not-prepared";

/** D7: the verdict and its exit code (D1). */
export type GateVerdict = "pass" | "violations" | "incomplete";

/**
 * D8: one entry of the exceptions file, as the consumer verified it. It
 * names a changed function at the head and the merge base it was accepted
 * against. Squeal applies it; it does not decide who may approve.
 */
export interface ExceptionEntry {
  readonly path: RelativePath;
  readonly qualifiedName: string;
  readonly bodyHash: string;
  readonly measure: "complexity" | "crap";
  /** `inherited`: over at the base and not worse; `approved`: a new or worse finding. */
  readonly kind: "inherited" | "approved";
  /** The highest accepted value of `measure`. */
  readonly value: number;
  /** A URL. */
  readonly issue: string;
  /** Who accepted it, as the consumer verified. */
  readonly approver: string;
  readonly baseCommit: string;
}
