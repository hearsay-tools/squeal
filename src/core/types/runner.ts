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
 *
 * `touch` (task 001-159): the file was written and its bytes ended as they
 * were, so no revision names it. A runner may have read other bytes in
 * between: D4, "a touched-unchanged file discards every cached transform".
 */
export interface InvalidatedPath {
  readonly path: RelativePath;
  readonly kind: "add" | "change" | "delete" | "touch";
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
  /**
   * The installed packages and Node builtins the closure's project files
   * import in one hop (D3, task 001-105). Absent when the runner does not
   * report them: the test file then keys by the whole installed-dependency
   * fingerprint.
   */
  readonly packages?: RunnerPackages;
}

/**
 * An installed package a project file imports, as Node would look it up: in
 * `<from>/node_modules/<name>`, then in each parent directory's.
 */
export interface PackageImport {
  /** Worktree-relative directory the lookup starts in; `""` is the worktree root. */
  readonly from: RelativePath;
  /** `name` or `@scope/name`, without a subpath. */
  readonly name: string;
  /**
   * The import reads the package's own `package.json` and loads no code, so
   * the package's version keys it even when it ships no runtime file
   * (task 001-109, review wave-11b N2).
   */
  readonly manifest?: boolean;
}

/**
 * First-hop installed packages and Node builtins of a closure. Spec 001 D3
 * (task 001-105): a test file's key holds the lockfile closure of the
 * packages its closure imports directly; one that imports `child_process`,
 * `worker_threads` or `module` keys by the whole fingerprint instead.
 */
export interface RunnerPackages {
  /** Unordered; duplicates allowed. */
  readonly imports: readonly PackageImport[];
  /** Builtin module names without the `node:` prefix or a subpath (`fs`, not `fs/promises`). */
  readonly builtins: readonly string[];
  /**
   * Of an environment's `imports`, those that drive the run in the runner's
   * own process and that no test file imports: the runner (`vitest`) and the
   * config file's imports, its plugins. Their closures start processes and
   * workers, or resolve by hand, by design, so an opaque package in them
   * sends no test file to the whole fingerprint (task 001-109).
   */
  readonly runner?: readonly PackageImport[];
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
  /**
   * Every path the project's runs report in `RunReport.observed` and
   * `environmentObserved` is a module load, which keys whatever policy
   * `observe.runtimeInputs` says (spec 016 D4, survey O8: node:test and
   * pytest). Absent: observed paths key only while the policy holds. It
   * enters no environment hash.
   */
  readonly observedLoads?: true;
  /** Canonical JSON of the resolved config, absolute paths relativized. */
  readonly resolvedConfig: string;
  /**
   * Config file, its dependencies, setup files and global setup with their
   * closures. Paths only: the core hashes them with its own file hash (D3) and
   * stat cache, and recomputes the environment when one of them changes.
   */
  readonly files: readonly RelativePath[];
  /**
   * The files the key definition before task 011-85 listed in place of
   * `files`, where they differ: every Vitest project's config files. A
   * lookup reads the keys over them as one (011 C3, C14). Absent otherwise.
   */
  readonly formerFiles?: readonly RelativePath[];
  /**
   * Installed packages every test file of the project can load: the runner
   * itself, and what the setup and `globalSetup` closures and the config
   * files import (D3, task 001-105). Absent when the runner does not report
   * them: every test file then keys by the whole installed-dependency
   * fingerprint.
   */
  readonly packages?: RunnerPackages;
  /**
   * The packages the key definition before task 011-85 read in place of
   * `packages`, where they differ: what every Vitest project's config files
   * import, a sibling's included, so a sibling's builtin made this
   * environment opaque then. A lookup reads the keys over them as one (011
   * C3, C14). Absent otherwise.
   */
  readonly formerPackages?: RunnerPackages;
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
  /**
   * Where the adapter writes full runner output: a directory no earlier run
   * used (spec 016 D2). The daemon gives `runs/<run-id>/`. An adapter may
   * read back what its run wrote there, so a reused directory can report an
   * earlier run's results.
   */
  readonly logDir: AbsolutePath;
  /** From policy `runner.timeoutMs`; `null` means no limit. */
  readonly timeoutMs: number | null;
  /**
   * Aborted when the scheduler cancels a backlog tier for an edit (D5 as
   * amended, task 001-124). The run stops as on a timeout: files whose module
   * ended before the cancel are completed, and the report's end is the run's
   * own. An adapter that cannot cancel runs to the end. A `squeal stop`
   * aborts it too, for every tier (D10, task 001-367). Its `reason` is the
   * `CancelCause` when the scheduler names one (row 011-56).
   */
  readonly signal?: AbortSignal;
  /**
   * Aborted by a `squeal stop` alone (D10, task 001-367), for an adapter that
   * keeps running to the end under an edit's cancel (`signal`): it stops its
   * processes, starts no other and reports the files that completed.
   */
  readonly stop?: AbortSignal;
  /**
   * The tier's lane (`RunnerAdapter.lane`, or `SLOW_LANE_PREFIX` and it for a
   * slow file, spec 004 D2): the runner instance that runs it. Absent: the
   * adapter's own.
   */
  readonly lane?: string;
  /**
   * What the run's processes add to their env: the daemon's mark of the
   * lane (001 D12, task 004-18). An adapter that starts processes per run
   * puts it over its own; one whose workers start with the instance ignores
   * it.
   */
  readonly childEnv?: Readonly<Record<string, string>>;
  /**
   * A warm-up's checkpoint (task 001-307): report what each completed file
   * read as `RunReport.reads`, ignored paths too. It changes no key, closure
   * or result. Absent: the run reports no `reads`.
   */
  readonly observeIgnored?: boolean;
  /**
   * The tier's grant from the per-user pool (spec 001 D11 Capacity, task
   * 001-376): how many test processes a backlog or checkpoint tier may run,
   * one permit each (row 011-96). Absent for an edit's tier, which runs
   * at `runner.tierSize`, and without a pool. Adapters size their runs from
   * it from task 001-378 on.
   */
  readonly workers?: number;
  /**
   * Called as each test file of the run ends, before the report, by a
   * runner that knows (Vitest: `onTestModuleEnd`, row 011-54): a file whose
   * module ended in a final state before any cancel. The scheduler's
   * supersession cancel and yield remainder take only the files not named
   * (spec 011 C4 step 5). It stores nothing: results wait for the report,
   * the completion barrier and the stability check, and a file named here
   * may still be left out of `completedFiles` (a crash, a withheld file).
   * A runner that never calls it leaves every file of the run unfinished.
   */
  readonly fileEnded?: (testFile: TestFileRef) => void;
  /**
   * A focused run (spec 011 C14 as amended 2026-10-23, row 011-135): per
   * test file of the run, matched by project and path, the texts that
   * select its checks. Such a file runs only the checks whose full name
   * holds a text (`holdsCheckText`, `src/runners/focus.ts`), through the
   * runner's own filter, and the report holds results for those alone, its
   * file errors as for any run, and its count in `RunReport.focused`. A
   * file without an entry runs whole. Given only to an adapter with
   * `RunnerAdapter.focuses`. Absent: every file runs whole.
   */
  readonly checks?: readonly FocusedFile[];
}

/** One test file's texts in a focused run (`RunOptions.checks`). */
export interface FocusedFile {
  readonly testFile: TestFileRef;
  /** Literal texts, at least one. A check is selected when its full name holds any one. */
  readonly texts: readonly string[];
}

/**
 * What a focused run's texts selected in one completed file
 * (`RunReport.focused`, spec 011 C14).
 */
export interface FocusedCount {
  readonly testFile: TestFileRef;
  /**
   * The checks the runner collected in the file, selected or not; `null`
   * when its filter hides the others (node:test, spec 003 D5).
   */
  readonly collected: number | null;
  /**
   * Of them, the checks whose full name holds a text, the ones that ran. `0`
   * selected nothing, which is never a pass.
   */
  readonly matched: number;
}

/**
 * Why the scheduler cancelled a run, the `reason` of `RunOptions.signal`
 * (row 011-56): `supersession`, the revisions during it changed an input of
 * every file that had not ended; `backlog`, an edit arrived during a backlog
 * tier (`cancelsBacklog`); `yield`, the tier yielded to an edit's work, a
 * promoted file or a runner part waiting for it (spec 011 C4 step 5);
 * `stop` and `step-down`, the daemon's (D10, C9); `hold`, a `squeal hold`
 * began (011 C9, "Holds", row 011-74).
 */
export type CancelCause = "supersession" | "backlog" | "yield" | "stop" | "step-down" | "hold";

/** The lane of a slow file is this and its runner's lane (spec 004 D2, task 004-18). */
export const SLOW_LANE_PREFIX = "slow:";

/** A slow file's lane: its runs go to a runner instance of their own. */
export function isSlowLane(lane: string): boolean {
  return lane.startsWith(SLOW_LANE_PREFIX);
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

/**
 * What one completed test file's processes and threads were observed to
 * read at run time (spec 001 D3, D4; task 001-132): project paths it read,
 * stat'ed, loaded or executed and directories it listed, none of them
 * written by the run. Worktree-relative and sorted. Not filtered against the
 * closure or ignored paths; the core does that.
 */
export interface ObservedInputs {
  readonly testFile: TestFileRef;
  readonly paths: readonly RelativePath[];
  /** Directories whose entry names the file read (`readdir`, `opendir`). */
  readonly directories: readonly RelativePath[];
  /**
   * Directories listed with `recursive: true`, each among `directories` too.
   * The core keys each with the listing of every directory below it that
   * holds a tracked file (review wave 12d, B5; task 001-134). Absent: none.
   */
  readonly recursive?: readonly RelativePath[];
  /**
   * Directories the run wrote, created (`mkdtemp` too) or removed that hold
   * one of `paths` or `directories`. The core drops a git-ignored path below
   * one of them, and keeps every other git-ignored path (spec 016 D4, the
   * written-directory bound). Absent: none, or the runner records no writes.
   */
  readonly written?: readonly RelativePath[];
  /**
   * Of `paths`, those that put the test file in `direct` when they change, as
   * a one-hop import does: what a process the test file started imported
   * (spec 016 D4, row 007-56). The core keeps them beside the paths, so a
   * restarted daemon and another worktree see them. Absent: none.
   */
  readonly direct?: readonly RelativePath[];
}

/** Everything one `run` call produced. Only test files passed to `run` appear here. */
export interface RunReport {
  readonly end: RunEnd;
  readonly durationMs: number;
  /**
   * Test files that ran to completion; the rest of the tier has no reliable
   * result. A file whose end may come from Squeal's own cancel, stop or
   * deadline is not completed, unless its runner proves it ended before that
   * (001 D12: "files whose module ended before the cancel keep their
   * results"): Vitest's whole modules after a step-down (row 011-137), and
   * the files of a pytest batch whose process died of the SIGTERM itself
   * (row 011-232). One adapter's `crashed` report lists none: nothing in that
   * run is trusted (D12). The composite runner (spec 003 D7) keeps the
   * completed files of its other parts, since the scheduler trusts a file only
   * when it is listed here, whatever `end` says.
   */
  readonly completedFiles: readonly TestFileRef[];
  readonly results: readonly CheckRunResult[];
  readonly fileErrors: readonly FileLevelError[];
  /**
   * Set when `end` is not `completed`, and when some file of a completed run
   * did not complete (a node:test file whose process died, spec 003 D5): it
   * names that file, so the scheduler's `unknown` reason reads well.
   */
  readonly failure: string | null;
  /**
   * The duration of each completed file, when the runner reports one (Vitest:
   * the module diagnostic of `onTestModuleEnd`). Optional: a runner without it
   * leaves the file's duration to the sum of its test cases.
   */
  readonly fileDurations?: readonly FileDuration[];
  /**
   * Of the completed files, what each was observed to read at run time, when
   * the runner observes (task 001-132). Absent: nothing observed.
   */
  readonly observed?: readonly ObservedInputs[];
  /**
   * Of the completed files, what each read at run time, in a run with
   * `RunOptions.observeIgnored` (task 001-307). Only for the warm-up's list of
   * ignored paths: never keyed, never a closure. Absent: not asked, or the
   * runner cannot observe.
   */
  readonly reads?: readonly ObservedInputs[];
  /**
   * Per project, the environment files the run was observed to load: what a
   * node:test preload loads by a computed specifier (spec 003 D5; task
   * 003-43), keyed or not. For a test file whose key lacked one, the core
   * stores nothing, reads the environments again and runs the file again
   * under the key that holds it. Absent: nothing observed.
   */
  readonly environmentObserved?: readonly EnvironmentObserved[];
  /**
   * Of the completed files, those whose module skipped itself as a whole: a
   * pytest module-level skip (spec 007 D6, task 007-23). The core records
   * `skip` for every check of the file's previous key and a `pass` for its
   * file-level check, as it expands `fileErrors`; the file's `results` are the
   * runner's fallback, kept only when the core knows no check of the file.
   * Absent: no file skipped itself (Vitest and node:test never set it).
   */
  readonly skippedFiles?: readonly SkippedFile[];
  /**
   * The run failed to start: it rejected with one error before any test file
   * ran, as a `globalSetup` that throws (task 001-382). The core stores
   * nothing under a key, blocks the projects' files through D5's runner
   * failure path and keeps one known failure per project, its `setup` check.
   * Absent: the run started.
   */
  readonly startupFailure?: StartupFailure;
  /**
   * The projects whose run got past global setup, whatever their files then
   * did: a test that times out or a crash still proves the setup ran (review
   * wave-13bp B4). The core passes their setup checks, with the projects of
   * `completedFiles`. Absent: only the completed files' projects started.
   */
  readonly startedProjects?: readonly ProjectName[];
  /**
   * Test files that ran to completion and whose results the runner withheld,
   * not listed in `completedFiles`: bytes the run may have executed moved or
   * were rewritten during it (Vitest, tasks 001-146 and 001-159). `failure`
   * names the paths. The core queues them again as a discarded run, counted
   * toward its limit, instead of leaving them `unknown` at a key no revision
   * moves (issue 10, task 011-06). Absent: none withheld.
   */
  readonly withheld?: readonly TestFileRef[];
  /**
   * Of the completed files given texts (`RunOptions.checks`), what the texts
   * selected in each, sorted as `completedFiles`. Absent: no file had texts.
   */
  readonly focused?: readonly FocusedCount[];
  /**
   * Processes the run's workers started that still ran when a run cut by
   * its forced cancel settled, read before that cancel (row 011-245, gh-101).
   * The daemon names those still running after its sweep in a note and
   * stops none of them. Absent: no forced cancel, or none was left.
   */
  readonly outlived?: readonly ProcessIdentity[];
}

/** A process by its pid and its start, in the clock of the host's process table (`RunReport.outlived`). */
export interface ProcessIdentity {
  readonly pid: number;
  readonly start: number;
}

/** A run that failed to start (`RunReport.startupFailure`). */
export interface StartupFailure {
  /**
   * The projects whose files cannot run: the one whose `globalSetup` file
   * the error names, else every project of the run.
   */
  readonly projects: readonly ProjectName[];
  /** The run's test files, none of which ran: the files of other projects among them run again. */
  readonly testFiles: readonly TestFileRef[];
  /** That `globalSetup` file, `null` when the error names none. */
  readonly setupFile: RelativePath | null;
  /** The error, with its code and bounded cause chain (task 001-361), phase `setup`. */
  readonly error: CheckError;
}

/** A completed file whose module skipped itself (`RunReport.skippedFiles`). */
export interface SkippedFile {
  readonly testFile: TestFileRef;
  /** The skip's reason, as the runner reported it. */
  readonly reason: string;
}

/** One project's observed environment files (`RunReport.environmentObserved`). */
export interface EnvironmentObserved {
  readonly project: ProjectName;
  readonly paths: readonly RelativePath[];
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
   * A bounded look at inputs no watched file shows, such as a pytest
   * environment's installed set in an ignored `.venv` (spec 007 D2 as
   * amended, task 007-26). The scheduler calls it at a reconciliation pass
   * that applied and touched nothing, and nothing else at that pass unless a
   * project is reported recreated, which it then re-keys as it does one
   * `invalidate` reports. So it must cost next to nothing when nothing
   * moved. `invalidate` looks at the same inputs, so a refinement stands in
   * for it. Absent: the runner has no such inputs.
   */
  recheck?(): Promise<InvalidateResult>;

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

  /**
   * How many test files the last successful `testFiles()` left out because
   * the adapter does not run them, such as Vitest's typecheck files (spec 005
   * D8 step 3, task 005-26). Absent for a runner that lists every file.
   */
  omittedTestFiles?(): number;

  /** Runner-side environment hash inputs, one entry per project. */
  environment(): Promise<readonly RunnerEnvironment[]>;

  /**
   * How many of `testFiles`, in order, one slow run of theirs starts at
   * once, at least 1. Spec 004 D2: a slow tier of several files starts them
   * all at once, so none starts after an edit or a close; the slow tier
   * takes only these (review 001-394 B2). Synchronous: selection holds the
   * scheduler's lock. Absent: all of them.
   */
  slowWidth?(testFiles: readonly TestFileRef[]): number;

  /**
   * How many test files a backlog tier holding `testFile` runs at once at a
   * grant of `grant` workers, at least 1 (spec 011 C4 step 5, task 001-366):
   * Vitest's `maxWorkers` for it, at least 2 and never above the project's
   * own; node:test's and pytest's `runner.tierSize`, whatever the grant. The
   * scheduler budgets the tier's wall time over it and asks the pool for no
   * more. Synchronous: selection holds the scheduler's lock. Absent: `grant`.
   */
  tierWidth?(testFile: TestFileRef, grant: number): number;

  /**
   * Which part of a backlog tier `testFile` runs in (task 001-366, review
   * wave-3 B1): the parts of one tier run one after another, so the
   * scheduler sums their wall estimates. A composite's adapters share a
   * lane but run in turn. Synchronous, as `tierWidth`. Absent: one part.
   */
  tierPart?(testFile: TestFileRef): string;

  /**
   * Whether an edit's tier holding `testFile` may start beside a backlog
   * tier of its lane (spec 011 C4 step 5 as amended 2026-10-19, task
   * 011-21): node:test and pytest, which cannot cancel a run and start the
   * processes of each run with that run's `childEnv`, so the run's sweep
   * can be its own. Synchronous, as `tierWidth`. Absent: `false`, the edit
   * cancels the backlog tier instead (Vitest).
   */
  besideBacklog?(testFile: TestFileRef): boolean;

  /**
   * The test files one backlog slot holding `testFile` runs (spec 011 C4
   * step 5 as amended for slots, task 011-21 slice 2): node:test 1, a
   * process per file; pytest its batch size, light files packed into one
   * process. A runner that answers runs its backlog in slots, up to
   * `runner.tierSize` runs in flight per lane, each storing when it ends.
   * Synchronous, as `tierWidth`. Absent or `null`: the backlog runs in
   * tiers (Vitest, one run per instance).
   */
  backlogSlot?(testFile: TestFileRef): number | null;

  /**
   * Spec 001 D4: "`run(testFiles) -> results`: `runTestSpecifications`. [...]
   * `process.exitCode` is reset after each run."
   */
  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport>;

  /**
   * The adapter honours `RunOptions.checks` (spec 011 C14, row 011-135).
   * Absent: it runs whole files only, and is given no focused run.
   */
  readonly focuses?: true;

  /**
   * Whether the adapter that runs `testFile` honours `RunOptions.checks`,
   * for a runner of several adapters (the daemon's composite, spec 003 D7;
   * row 011-145). Absent: `focuses` answers for every file.
   */
  focusesFile?(testFile: TestFileRef): boolean;

  /**
   * The lane that runs `testFile`: runner instances that run one tier at a
   * time between them. Tiers of different lanes run at once (spec 001 D5 as
   * amended, task 001-140); a tier holds files of one lane. Absent: one lane,
   * so one tier at a time.
   */
  lane?(testFile: TestFileRef): string;

  /**
   * The scheduler has no tier queued for `lane` any more: what serves only
   * that lane may close (spec 004 D2: the slow tier's Vitest instance closes
   * when the slow pass drains). Never called while a tier of the lane is in
   * flight; a later tier of the lane may follow.
   */
  releaseLane?(lane: string): Promise<void>;

  close(): Promise<void>;
}
