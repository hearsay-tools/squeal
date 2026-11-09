import type { FunctionCount } from "../../types/code.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { CoverageRecord } from "../coverage/types.js";

/*
 * Spec 020: the contract between the gate's three parts. `changedFunctions`
 * (020-02, D2) gives the functions to judge; `collectEvidence` (020-03, D3)
 * gives what the test runs saw; `evaluate` (020-01, D5 to D7) joins both
 * under the policy read at the base and gives the report. Each part is
 * written against these types only.
 */

/** `QUALITY_POLICY_VERSION` (D6): raised when a rule of D5 or D6 changes meaning. */
export const QUALITY_POLICY_VERSION = 1;

/** D7: the format of `squeal code --base --json`. */
export const GATE_REPORT_FORMAT = "squeal-code-gate/1";

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

/** D2: a changed path the counter could not count, with why. */
export interface UncountedPath {
  readonly path: RelativePath;
  readonly reason: "too-large" | "parse-error" | "unsupported";
}

/** D2: what the inventory gives the evaluator. */
export interface ChangedSet {
  /** The `--base` value as given. */
  readonly ref: string;
  /** `git merge-base <ref> HEAD`. */
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly dirty: boolean;
  readonly functions: readonly ChangedFunction[];
  /** Functions inside a parse-error range; judged `not-counted`. */
  readonly inErrors: readonly ChangedFunction[];
  readonly uncounted: readonly UncountedPath[];
}

/** D3: one test file of the runs. */
export interface TestFileEvidence {
  readonly runner: "vitest" | "node-test";
  readonly path: RelativePath;
  /** It ran whole before the deadline. */
  readonly completed: boolean;
  /** Full names of its failed tests; empty when none failed. */
  readonly failed: readonly string[];
  /** The sources its closure loads; `null` when the closure is not known. */
  readonly loads: readonly RelativePath[] | null;
  /** Its record at the current provider and record versions; `null` when none. */
  readonly record: CoverageRecord | null;
}

/** D3: what the collector gives the evaluator. */
export interface Evidence {
  readonly testFiles: readonly TestFileEvidence[];
  /** The budget ended before every selected file ran. */
  readonly timedOut: boolean;
  readonly budgetSeconds: number;
}

/** D6: the policy, read at the base commit. */
export interface GatePolicy {
  readonly complexityThreshold: number;
  readonly crapThreshold: number;
  /** `coverage.exclude`: globs whose functions read `skipped`. */
  readonly coverageExclude: readonly string[];
}

/** D5: a function's state. */
export type GateState = "pass" | "violation" | "incomplete" | "skipped";

/** D5: why a function is incomplete. */
export type GateGap =
  | "not-counted"
  | "no-loader"
  | "not-finished"
  | "no-record"
  | "not-joined"
  | "test-failed";

/** D7: the verdict and its exit code (D1). */
export type GateVerdict = "pass" | "violations" | "incomplete";
