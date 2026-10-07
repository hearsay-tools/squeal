import type { ProjectName, RelativePath, SourceLocation } from "./common.js";

/**
 * Identity of one test.
 *
 * Spec 001 D4: "Check identity is `(project name, relative test path,
 * fullName)`. Vitest's positional ids are used only within one run."
 */
export interface TestCheckId {
  readonly kind: "test";
  readonly project: ProjectName;
  readonly testPath: RelativePath;
  /** Vitest `fullName`, e.g. `"auth > expired token"`. */
  readonly fullName: string;
}

/**
 * The file-level check of one test file. Carries import and syntax failures,
 * which have no test cases.
 *
 * Spec 001 D4: "File-level errors (import or syntax failures) become a `fail`
 * for every check previously known in that file plus one file-level check."
 * A separate kind avoids reserving a `fullName` that a real test could use.
 */
export interface FileCheckId {
  readonly kind: "file";
  readonly project: ProjectName;
  readonly testPath: RelativePath;
}

export type CheckId = TestCheckId | FileCheckId;

/**
 * Outcome of one check in one run, as the runner reports it.
 *
 * `skip` covers Vitest `skipped` and `todo`. It maps to the known state
 * `skip` (spec 001 D6).
 */
export type RunOutcome = "pass" | "fail" | "skip";

/**
 * One error from a failed check, paths relative to the worktree root.
 *
 * Research vitest-internals Q4: `result().errors[]`: `{ name, message, stack,
 * stacks: [{ file, line, column, method }], diff, expected, actual }`. Spec 001
 * D4: "Stack paths are relativized before storage."
 */
export interface CheckError {
  readonly name: string;
  readonly message: string;
  /** Full stack with relativized paths. Kept in the run log and `squeal why`, not in deltas. */
  readonly stack: string | null;
  /** First source-mapped frame. Research Q4: "Failure location: `errors[0].stacks[0]`". */
  readonly location: SourceLocation | null;
  readonly diff: string | null;
  /**
   * The one-minute load average when a test or hook timed out, recorded by
   * the runner as the result came in; absent for every other error, on
   * Windows, and in failure texts stored before task 001-91.
   */
  readonly loadAverage?: number;
}
