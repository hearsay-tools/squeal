import type { CheckError, RunOutcome, TestCheckId } from "./check.js";
import type { AbsolutePath, ProjectName, RelativePath, SourceLocation } from "./common.js";
import type { FileHash, TestFileRef } from "./keys.js";

/**
 * A changed path handed to the runner. The kind tells the adapter whether
 * specification caches must be cleared.
 *
 * Spec 001 D4: "`invalidate(paths)`: calls `invalidateFile` for each path;
 * calls `clearSpecificationsCache()` when a path matching a test glob was
 * added or removed".
 */
export interface InvalidatedPath {
  readonly path: RelativePath;
  readonly kind: "add" | "change" | "delete";
}

/** What `invalidate` did. A recreate re-keys every check of the project through the environment hash (D12). */
export interface InvalidateResult {
  /**
   * Projects whose instance was recreated. Spec 001 D4: "recreates the
   * instance when the config file or one of its dependencies changed".
   */
  readonly recreatedProjects: readonly ProjectName[];
}

/**
 * The runner-side part of a test file's closure. The core adds policy
 * `inputs` (D3) and builds the final `Closure`.
 *
 * Spec 001 D4: "`closure(testFile) -> paths`: from the same transform graph,
 * plus the additions in D3." The snapshot file is a runner addition because
 * only the runner knows where snapshots live.
 */
export interface RunnerClosure {
  readonly testFile: TestFileRef;
  /** Transitive static and dynamic project imports plus snapshot files. `node_modules` excluded. */
  readonly paths: readonly RelativePath[];
}

/**
 * Runner-side inputs to the environment hash of one project.
 *
 * Spec 001 D3: "Vitest [...] versions, [...] the resolved Vitest config, the
 * contents of the config file and its `configFileDependencies`, the closure of
 * every `setupFiles` and `globalSetup` entry".
 */
export interface RunnerEnvironment {
  readonly project: ProjectName;
  readonly runnerName: string;
  readonly runnerVersion: string;
  readonly adapterVersion: string;
  /** Canonical JSON of the resolved config, absolute paths relativized. */
  readonly resolvedConfig: string;
  /** Config file, its dependencies, setup files and global setup with their closures. */
  readonly files: readonly (readonly [RelativePath, FileHash])[];
}

/**
 * One check found statically, before the file has run.
 *
 * Spec 001 D4: "`enumerate(testFile) -> check ids`: `parseSpecifications`,
 * static [...]. `test.each` appears as one templated entry until the file has
 * run."
 */
export interface EnumeratedCheck {
  readonly check: TestCheckId;
  /** True for an unexpanded `test.each` entry whose `fullName` is the template. */
  readonly templated: boolean;
  readonly location: SourceLocation | null;
}

/** Result of one check in one run. Spec 001 D4: "Results come only from the reporter hooks". */
export interface CheckRunResult {
  readonly check: TestCheckId;
  readonly outcome: RunOutcome;
  readonly durationMs: number;
  readonly location: SourceLocation | null;
  /** Empty unless `outcome` is `fail`. */
  readonly errors: readonly CheckError[];
}

/**
 * An import or syntax failure of a whole test file.
 *
 * Spec 001 D4: "File-level errors (import or syntax failures) become a `fail`
 * for every check previously known in that file plus one file-level check."
 * The adapter reports the error; the core, which knows the previously known
 * checks, expands it.
 */
export interface FileLevelError {
  readonly testFile: TestFileRef;
  readonly errors: readonly CheckError[];
}

/**
 * How a run ended. `crashed` and `timed-out` make every check in the tier
 * `unknown` (D12).
 */
export type RunEnd = "completed" | "crashed" | "timed-out";

export interface RunOptions {
  /** Id of the `runs/<run-id>/` directory (D1). */
  readonly runId: string;
  /** Where the adapter writes full runner output. */
  readonly logDir: AbsolutePath;
  /** From policy `runner.timeoutMs`; `null` means no limit. */
  readonly timeoutMs: number | null;
}

/** Everything one `run` call produced. Only test files passed to `run` appear here. */
export interface RunReport {
  readonly end: RunEnd;
  readonly durationMs: number;
  /** Test files that ran to completion; the rest of the tier has no reliable result. */
  readonly completedFiles: readonly TestFileRef[];
  readonly results: readonly CheckRunResult[];
  readonly fileErrors: readonly FileLevelError[];
  /** Set when `end` is not `completed`. */
  readonly failure: string | null;
}

/**
 * A test runner behind a stable interface. Vitest in v1, pytest next.
 *
 * Spec 001 D4: "The adapter exposes, through the runner interface that later
 * adapters will implement: invalidate, affected, closure, enumerate, run."
 * `testFiles`, `environment` and `close` are additions: D5 baseline and
 * `run --all` need every test file, D3 needs the runner's environment inputs,
 * D10 needs a clean shutdown.
 */
export interface RunnerAdapter {
  readonly name: string;
  readonly adapterVersion: string;

  /** Spec 001 D4: "`invalidate(paths)`". */
  invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult>;

  /**
   * Spec 001 D4: "`affected(changedPaths) -> test files`: the `related` walk
   * [...]. Squeal adds what Vitest's walk misses: all test files of a project
   * when a setup file, its closure, `globalSetup`, or the config changed; the
   * owning test file when a `.snap` changed."
   */
  affected(changedPaths: readonly RelativePath[]): Promise<readonly TestFileRef[]>;

  /** Spec 001 D4: "`closure(testFile) -> paths`". */
  closure(testFile: TestFileRef): Promise<RunnerClosure>;

  /** Spec 001 D4: "`enumerate(testFile) -> check ids`". */
  enumerate(testFile: TestFileRef): Promise<readonly EnumeratedCheck[]>;

  /** Every test file of every project, from the runner's own include globs. */
  testFiles(): Promise<readonly TestFileRef[]>;

  /** Runner-side environment hash inputs, one entry per project. */
  environment(): Promise<readonly RunnerEnvironment[]>;

  /**
   * Spec 001 D4: "`run(testFiles) -> results`: `runTestSpecifications`. [...]
   * `process.exitCode` is reset after each run."
   */
  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport>;

  close(): Promise<void>;
}
