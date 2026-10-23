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

/**
 * The global setup of one project (task 001-382): a run that failed to start
 * is one failure of this check, not a failure of each test file it kept from
 * running. `testPath` is the `globalSetup` file, `""` when the error named
 * none. It has no key and no stored result: its known state is written by
 * the daemon of the worktree whose run failed, and a run of the project that
 * starts makes it `pass`.
 */
export interface SetupCheckId {
  readonly kind: "setup";
  readonly project: ProjectName;
  readonly testPath: RelativePath;
}

export type CheckId = TestCheckId | FileCheckId | SetupCheckId;

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
  /** Full stack with relativized paths. Kept in the store, printed in the run's console log and by `squeal why`, not in deltas (row 011-164). */
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
  /**
   * The error's own `code`, kept whole (`ERR_MODULE_NOT_FOUND`); absent when
   * it has none and in failure texts stored before task 001-361.
   */
  readonly code?: string;
  /**
   * The error's `cause` chain, outermost first, bounded (task 001-361,
   * research environment-failures Q1): undici's "fetch failed" says only in
   * its cause that the connection was refused. Absent when it has none.
   */
  readonly causes?: readonly CheckErrorCause[];
  /**
   * Where a file-level error happened (task 001-361): `load` when none of the
   * file's tests were collected (an import, a syntax error, a top-level
   * throw), `after-tests` when they were and reported (a hook threw, or the
   * file's teardown; task 011-19), `setup` for a project's global setup.
   * Absent on a test's own errors and in failure texts stored before
   * 001-361; a file-level `setup` is one stored before 011-19.
   */
  readonly phase?: "load" | "after-tests" | "setup";
  /**
   * Set when the error carries a signature of Squeal's recorder (spec 001 D11
   * Fidelity, task 001-390): what it points at, which the summary names.
   * Absent otherwise and in failure texts stored before 001-390.
   */
  readonly recorder?: string;
}

/** One link of `CheckError.causes`: its first line, capped, and its code, whole. */
export interface CheckErrorCause {
  readonly message: string;
  readonly code?: string;
}
