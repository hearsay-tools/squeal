import type { CheckError, RunOutcome, TestCheckId } from "./check.js";
import type { AbsolutePath, ProjectName, RelativePath, SourceLocation } from "./common.js";
import type { TestFileRef } from "./keys.js";

/**
 * A changed path handed to the runner. The kind tells the adapter whether
 * other cached transforms and specification caches must be dropped.
 *
 * Spec 001 D4: "`invalidate(paths)`: calls `invalidateFile` for each changed
 * path. An add or delete also invalidates the cached transforms it can make
 * wrong, and only those [...]. Calls `clearSpecificationsCache()` when a path
 * matching a test glob was added or removed".
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
 * plus the additions in D3." The snapshot path and resolution candidates are
 * runner additions because only the runner knows where snapshots live and
 * how imports resolve.
 */
export interface RunnerClosure {
  readonly testFile: TestFileRef;
  /**
   * Transitive static and dynamic project imports, the snapshot path whether
   * or not it exists, and every resolution candidate of an unresolved import
   * (D3). Paths that do not exist hash as absent. `node_modules` excluded.
   */
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
  /**
   * The project's root directory relative to the worktree root; absent means
   * the worktree root. The installed lockfile is looked up from here (D3:
   * "installed lockfile metadata under `node_modules`"), so a workspace
   * package with its own `node_modules` is hashed and watched (review N8).
   */
  readonly root?: RelativePath;
  readonly runnerName: string;
  readonly runnerVersion: string;
  readonly adapterVersion: string;
  /** Canonical JSON of the resolved config, absolute paths relativized. */
  readonly resolvedConfig: string;
  /**
   * Config file, its dependencies, setup files and global setup with their
   * closures. Paths only: the core hashes them with its own file hash (D3) and
   * stat cache, and recomputes the environment when one of them changes.
   */
  readonly files: readonly RelativePath[];
}

/**
 * One check found statically, before the file has run. `check.fullName`
 * carries the same line suffix for duplicate names as a run result (D4).
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
 * The test files a change affects, split by distance in the runner's module
 * graph.
 *
 * Spec 001 D5 step 4 as amended: "test files that import a changed path
 * directly according to the runner's module graph, then transitively
 * affected files". Lessons, defect 3: with barrel imports, every source edit
 * reaches most test files transitively, and the edited module's own test
 * waited behind slow ones.
 */
export interface AffectedTestFiles {
  /**
   * Test files that changed themselves, import a changed path in one hop
   * (statically or dynamically, including a changed path that no longer
   * exists), or own a changed snapshot. Sorted.
   */
  readonly direct: readonly TestFileRef[];
  /**
   * The other affected test files: reached through other modules, or through
   * an environment input (config, setup files). Sorted, disjoint from `direct`.
   */
  readonly transitive: readonly TestFileRef[];
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

/**
 * How long one test file took as a whole: collection, setup files, hooks and
 * tests. Review wave 4.5, N1: the sum of test-case durations leaves out
 * `beforeAll`, `afterAll` and collection, so a file whose time goes into a
 * `beforeAll` ranked as short in D5 step 4.
 */
export interface FileDuration {
  readonly testFile: TestFileRef;
  readonly durationMs: number;
}

/** Everything one `run` call produced. Only test files passed to `run` appear here. */
export interface RunReport {
  readonly end: RunEnd;
  readonly durationMs: number;
  /**
   * Test files that ran to completion; the rest of the tier has no reliable
   * result. Empty when `end` is `crashed`: nothing in the run is trusted (D12).
   */
  readonly completedFiles: readonly TestFileRef[];
  readonly results: readonly CheckRunResult[];
  readonly fileErrors: readonly FileLevelError[];
  /** Set when `end` is not `completed`. */
  readonly failure: string | null;
  /**
   * The duration of each completed file, when the runner reports one (Vitest:
   * the module diagnostic of `onTestModuleEnd`). Optional: a runner without it
   * leaves the file's duration to the sum of its test cases.
   */
  readonly fileDurations?: readonly FileDuration[];
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
   * owning test file when a `.snap` changed." Split into direct importers
   * and the rest (D5 step 4); a runner that cannot tell them apart returns
   * every file as transitive.
   */
  affected(changedPaths: readonly RelativePath[]): Promise<AffectedTestFiles>;

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
