import type { TestSpecification, Vitest } from "vitest/node";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { compare } from "../../core/fs/index.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import { findInstalledLockfile } from "../../core/keys/index.js";
import { optimizerOffNote } from "../../core/state/optimizer-note.js";
import type {
  AbsolutePath,
  AffectedTestFiles,
  EnumeratedCheck,
  EpochMs,
  InvalidatedPath,
  InvalidateResult,
  RelativePath,
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import { focusedTexts } from "../focus.js";
import { readsOfEvery, withRecorderSignatures } from "../observe/index.js";
import { affectedTestFiles } from "./affected.js";
import { closeBroken, instanceTempDirs, runnerFailure } from "./broken.js";
import { ConfigStamps } from "./config-stamps.js";
import {
  coveredFiles,
  InstanceCoverage,
  inspectorFiles,
  inspectorNote,
  type VitestCoverage,
} from "./coverage.js";
import { closeEmptied } from "./empty-closed.js";
import { formerPackages, projectEnvironment } from "./environment.js";
import { exclusion } from "./exclude.js";
import { Gate, type Hold } from "./gate.js";
import { importClosure, missingCandidates } from "./graph.js";
import { loadVitest, type VitestNode } from "./load.js";
import { mayHaveReadTouched, mayHaveRun, withoutFiles, withoutTouched } from "./moved.js";
import { namePattern } from "./name-pattern.js";
import { VitestObserver } from "./observe.js";
import { noteOnce, withoutOptimizer } from "./optimizer.js";
import { closurePackages, environmentPackages } from "./packages.js";
import type { WorktreePaths } from "./paths.js";
import {
  configFiles,
  findProject,
  projectInputs,
  recreateTriggers,
  resolveExtensions,
  snapshotPath,
} from "./project.js";
import { createSquealReporter, RunCollector } from "./reporter.js";
import { compareRefs, enumeratedChecks } from "./results.js";
import { abandon, buildReport, execute, writeRunLog } from "./run.js";
import { invalidateStale, SourceStamps } from "./sources.js";
import { invalidateStructural } from "./stale.js";
import { closeRejected, startupFailure, withStartup } from "./startup.js";
import { sortTouched, Touches } from "./touched.js";
import { VITEST_ADAPTER_VERSION } from "./version.js";

/**
 * Vitest adapter over one warm `vitest/node` instance per worktree.
 *
 * Runs queue behind runs, the runner part behind the runner part, and the
 * two overlap (task 001-150, D5 as amended: `Gate`). What replaces or
 * closes the instance (a start, a recreate, a broken or hung instance
 * dropped, `close`) waits for both and holds both.
 */
/**
 * What the adapter tells of each instance it starts and asks before each run
 * (task 011-37 section 5, row 011-40): the width a run takes. Width changes
 * nothing a check stores (`maxWorkers` left the environment hash at format
 * 10, task 001-378), so it is answered outside this class, whose code a
 * stored result's meaning rests on (`VitestWidths`, `index.ts`).
 */
export interface VitestHints {
  /** `vitest` started: its configs' widths are each run's ceilings. */
  started(vitest: Vitest): void;
  /** Sizes `vitest`'s next run for `workers`, a tier's grant; absent, the instance's own width. */
  size(vitest: Vitest, workers: number | undefined, testFiles: readonly TestFileRef[]): void;
}

const NO_HINTS: VitestHints = { started: () => {}, size: () => {} };

export class VitestAdapter implements RunnerAdapter {
  readonly name = "vitest";
  readonly adapterVersion = VITEST_ADAPTER_VERSION;
  /** 013 V4 (row 011-135): a run takes `RunOptions.checks`. */
  readonly focuses = true;

  #vitest: Vitest | null = null;
  /** Where the current instance copies transformed modules (`instanceTempDirs`). */
  #tempDirs: AbsolutePath[] = [];
  /** What the current instance read of each project file (task 001-146). */
  #sources: SourceStamps;
  /** The current instance's config files, stamped before the next one reads them (task 001-157). */
  #configFiles = new Set<AbsolutePath>();
  /** What was on disk of them before the current instance read them. */
  #config: ConfigStamps | null = null;
  /**
   * Task 001-157: inputs the current instance read once (its config, its
   * global setup) and may have read other bytes of than those on disk. The
   * next call replaces it; a run under one is not stored.
   */
  #unsure: AbsolutePath[] = [];
  /**
   * Task 001-159: files touched with their bytes ending as they were, since
   * the current instance began to start, whoever wrote them (task 001-168).
   * Task 013-02: one the instance could have read replaces it at the next
   * call and withholds a run's files that may have read it; any other is
   * forgotten once the calls in flight when it was heard have returned.
   */
  readonly #touches = new Touches();
  /** Told of each instance, and asked to size each run (`VitestHints`, row 011-40). */
  readonly #hints: VitestHints;
  /** Installed lockfiles the current instance started with. */
  #lockfiles = new Set<AbsolutePath>();
  /** The next start imports `vitest/node` again: the installed dependencies changed. */
  #reload = false;
  #node: VitestNode;
  #collector: RunCollector | null = null;
  /** The typecheck files the last listing left out (task 005-26). */
  #omitted = 0;
  /** Bumped per instance, so hooks from an abandoned instance never reach a later run. */
  #generation = 0;
  readonly #gate = new Gate();
  /** A run is between its first load and its last check: what the runner part invalidates is logged for it. */
  #running = false;
  #closed = false;
  readonly #note: (text: string) => void;
  readonly #optimizer: (projects: readonly string[]) => void;
  readonly #observer: VitestObserver;
  readonly #childEnv: Readonly<Record<string, string>>;
  readonly #exclude: () => readonly string[];
  readonly #excludeFiles: () => readonly string[];
  /** Policy `vitest.excludeProjects` and `vitest.exclude` as the current instance started with them (tasks 001-349, 004-81). */
  #excluded = excludedStamp([], []);
  /** Policy `vitest.exclude` as the current instance started with it (task 004-81). */
  #excludedFile: (path: RelativePath) => boolean = () => false;
  /** Spec 015 D8: coverage in the runs Squeal makes anyway; absent, never. */
  readonly #coverage: VitestCoverage | undefined;
  /** Whether the current instance started with coverage on, as policy had it then. */
  #coverageOn = false;
  /** The current instance's coverage; `null` with coverage off. */
  #instanceCoverage: InstanceCoverage | null = null;
  /** Every instance's reports directory, removed at `close`: a payload outlives its instance. */
  readonly #coverageDirs: InstanceCoverage[] = [];

  /**
   * `vitest` is the project's own `vitest/node` (`loadVitest`). Only types
   * come from Squeal's Vitest, so loading this module loads no Vitest.
   * `note` records a fact the adapter worked around as a status note (D7).
   * `observe` is policy `observe.runtimeInputs`, read before each call
   * (task 001-132); absent, nothing is observed. `childEnv` goes into every
   * worker's env beside the recorder's and, like it, stays out of the
   * environment hash (D12, task 001-142). `hints` sizes each run (D11, task
   * 001-378; `VitestWidths`); absent, a run takes its configs' own width.
   * `optimizer` hears, at each start, the projects whose config turns the
   * dependency optimizer on, none included (task 001-181). `exclude` is policy
   * `vitest.excludeProjects`, read at each start (task 001-349);
   * `excludeFiles` is policy `vitest.exclude`, read at each start too (spec
   * 004 D7, task 004-81). `coverage` collects coverage in each run while it
   * is enabled (spec 015 D8, row 015-11).
   */
  constructor(
    readonly paths: WorktreePaths,
    vitest: VitestNode,
    note: (text: string) => void = () => {},
    observe: () => boolean = () => false,
    childEnv: Readonly<Record<string, string>> = {},
    hints: VitestHints = NO_HINTS,
    optimizer: (projects: readonly string[]) => void = () => {},
    exclude: () => readonly string[] = () => [],
    excludeFiles: () => readonly string[] = () => [],
    coverage?: VitestCoverage,
  ) {
    this.#coverage = coverage;
    this.#exclude = exclude;
    this.#excludeFiles = excludeFiles;
    this.#node = vitest;
    this.#optimizer = optimizer;
    this.#sources = new SourceStamps(paths);
    this.#childEnv = childEnv;
    this.#hints = hints;
    this.#note = note;
    this.#observer = new VitestObserver(paths, observe);
  }

  /** Spec 001 D4: `createVitest('test', { root, watch: false, ... })`, then `standalone()`. */
  async #start(): Promise<Vitest> {
    if (this.#reload) {
      // A worktree that had no `node_modules` ran its parent's Vitest (lessons, defect 12).
      this.#node = await loadVitest(this.paths.root);
      this.#reload = false;
    }
    const generation = ++this.#generation;
    const current = () => (generation === this.#generation ? this.#collector : null);
    const env = { ...this.#childEnv, ...this.#observer.start().env };
    // Touches heard from here on are after this start read the disk; a failed start keeps all.
    const heard = this.#touches.mark();
    const sources = new SourceStamps(this.paths);
    const config = await ConfigStamps.take(this.paths, this.#configFiles);
    const excluded = [...this.#exclude()];
    const excludedFiles = [...this.#excludeFiles()];
    const { project, unknown } = await exclusion(this.#node, this.paths.root, excluded);
    const coverageOn = this.#coverage?.enabled() ?? false;
    const coverage = this.#startCoverage(coverageOn);
    const vitest = await this.#node.createVitest("test", {
      root: this.paths.root,
      watch: false,
      reporters: [createSquealReporter(current)],
      update: "none",
      includeTaskLocation: true,
      // Task 001-157: a transform `fsModuleCache` serves skips the plugin
      // container, so nothing stamps the bytes it holds (D4). A CLI option,
      // so it reaches every project.
      fsModuleCache: false,
      // Row 013-07: a config's own coverage would clean and rewrite the project's
      // reports and print to the daemon's output. A CLI option wins over the config.
      // Row 015-11: with the policy on, Squeal's own provider instead (spec 015 D8).
      coverage: coverage === null ? { enabled: false } : coverage.options(),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(project === undefined ? {} : { project }),
    });
    // Review wave-13 B2: every project server's, not only the root's, before any load.
    sources.attach(vitest);
    this.#sources = sources;
    try {
      // Task 001-176: no bundle of the optimizer is ever loaded, whatever a config says (D4).
      const optimized = withoutOptimizer(vitest);
      this.#optimizer(optimized);
      if (optimized.length > 0) noteOnce(this.paths.root, optimizerOffNote(optimized), this.#note);
      await vitest.standalone();
      this.#observer.configure(vitest);
      this.#tempDirs = instanceTempDirs(vitest);
      this.#hints.started(vitest);
      this.#lockfiles = await this.#installedLockfiles(vitest);
      this.#configFiles = configFiles(vitest);
      this.#config = config;
      this.#unsure = await config.unsure(this.#configFiles);
      this.#touches.since(heard);
      this.#excluded = excludedStamp(excluded, excludedFiles);
      this.#excludedFile = createInputMatcher(excludedFiles);
      this.#coverageOn = coverageOn;
      this.#instanceCoverage = coverage;
      if (coverage !== null) this.#noteUnisolated(vitest);
      for (const problem of await unknown) {
        noteOnce(this.paths.root, `${POLICY_FILE}: ${problem}`, this.#note);
      }
    } catch (error) {
      await vitest.close();
      throw error;
    }
    return vitest;
  }

  /** Spec 015 D8: the coverage of an instance starting with the policy `on`; `null` with it off. */
  #startCoverage(on: boolean): InstanceCoverage | null {
    if (!on || this.#coverage === undefined) return null;
    const coverage = InstanceCoverage.start(this.#coverage);
    this.#coverageDirs.push(coverage);
    return coverage;
  }

  /** Spec 015 D8: a project run with `isolate: false` gets no coverage, and one note. */
  #noteUnisolated(vitest: Vitest): void {
    const shared = vitest.projects.filter((p) => p.config.isolate === false).map((p) => p.name);
    if (shared.length === 0) return;
    const names = shared.map((name) => (name === "" ? "the root project" : `"${name}"`));
    noteOnce(
      this.paths.root,
      `coverage is off in ${names.join(", ")}: its test files share modules (isolate: false), so one file's run cannot be told from another's (spec 015 D8)`,
      this.#note,
    );
  }

  /** The installed lockfile of each project, as the environment hash finds it (D3). */
  async #installedLockfiles(vitest: Vitest): Promise<Set<AbsolutePath>> {
    const found = new Set<AbsolutePath>();
    for (const project of vitest.projects) {
      const lockfile = await findInstalledLockfile(project.config.root, this.paths.root);
      if (lockfile !== null) found.add(lockfile.path);
    }
    return found;
  }

  async open(): Promise<void> {
    this.#vitest = await this.#start();
  }

  #part<T>(fn: (vitest: Vitest, hold: Hold) => Promise<T>): Promise<T> {
    return this.#gate.part(this.#call(async (hold) => fn(await this.#instance(hold), hold)));
  }

  /** `fn` as one call in flight of its lane (task 013-02, `Touches`). */
  #call<T>(fn: (hold: Hold) => Promise<T>): (hold: Hold) => Promise<T> {
    return (hold) => this.#touches.call(() => fn(hold));
  }

  /**
   * The instance a call of a lane uses; it is not replaced until the call
   * returns. One unsure of its inputs is replaced once per call, and one a
   * pending touch counts for at once.
   */
  async #instance(hold: Hold): Promise<Vitest> {
    let replaced = false;
    const stale = async (vitest: Vitest) =>
      this.#observer.stale() ||
      (!replaced && this.#unsure.length > 0) ||
      (await this.#counts(vitest));
    for (;;) {
      if (this.#closed) throw new Error("vitest adapter: closed");
      // Policy `observe.runtimeInputs` moved: the workers' env is set at creation.
      const current = this.#vitest;
      if (current !== null && !(await stale(current))) return current;
      // A failed recreate or a hung run leaves no instance; the next call retries.
      await hold.exclusive(async () => {
        if (this.#closed) return;
        if (this.#vitest === null) this.#vitest = await this.#start();
        else if (await stale(this.#vitest)) {
          replaced = true;
          await this.#recreate(this.#vitest);
        }
      });
    }
  }

  /**
   * Task 013-02: whether a pending touch is one `vitest` could have read.
   * Sorted again at each call, since a transform in flight when it was heard
   * records its reads only as it completes; one that does not count is
   * forgotten once every call in flight then has returned.
   */
  async #counts(vitest: Vitest): Promise<boolean> {
    const pending = this.#touches.pending();
    if (pending.length === 0) return false;
    const sorted = await sortTouched(
      vitest,
      pending.map(this.#absolute),
      this.#lockfiles,
      this.paths,
    );
    const counted = new Set([...sorted.inputs, ...sorted.modules]);
    this.#touches.forget(new Set(pending.filter((path) => !counted.has(this.#absolute(path)))));
    return counted.size > 0;
  }

  readonly #absolute = (path: RelativePath): AbsolutePath => this.paths.toAbsolute(path);

  /**
   * Task 001-146: invalidates what moved since Vite read it. Task 001-157:
   * the config and global setup were read once, so one moved since leaves
   * the instance unsure.
   */
  async #invalidateStale(vitest: Vitest, loadedSince?: EpochMs): Promise<AbsolutePath[]> {
    const moved = await invalidateStale(vitest, this.#sources, loadedSince);
    if (this.#vitest !== vitest) return moved;
    const triggers = moved.length === 0 ? new Set() : await recreateTriggers(vitest);
    const inputs = [
      ...moved.filter((file) => triggers.has(file)),
      ...((await this.#config?.unsure(this.#configFiles)) ?? []),
    ];
    if (inputs.length > 0) this.#unsure = [...new Set([...this.#unsure, ...inputs])].sort();
    return moved;
  }

  /** Inside `Gate.exclusive`. */
  async #recreate(old: Vitest | null): Promise<Vitest> {
    this.#vitest = null;
    if (old !== null) await closeEmptied(old);
    this.#vitest = await this.#start();
    return this.#vitest;
  }

  /**
   * A `touch` (task 001-159) is heard at once, not behind the run in flight.
   * One the instance could have read (task 013-02) withholds the files of a
   * run in flight that may have read it, and replaces the instance at the
   * next call: every project and environment's transforms and module graph
   * and the global setup go with it. No project counts as recreated for it:
   * the files are the bytes they were, so the environment and the listing
   * are too, and a listing now could find a file the watcher has not
   * reconciled yet, which then never makes a revision.
   */
  invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    this.#touches.hear(paths.filter((p) => p.kind === "touch").map((p) => p.path));
    const changed = paths.filter((p) => p.kind !== "touch");
    if (changed.length === 0) return Promise.resolve({ recreatedProjects: [] });
    return this.#invalidate(changed);
  }

  #invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    return this.#part(async (vitest, hold) => {
      const abs = paths.map((p) => ({ ...p, abs: this.paths.toAbsolute(p.path) }));
      const triggers = await recreateTriggers(vitest);
      // Spec 001 D4: an install recreates the instance from the worktree's own
      // `vitest/node`. The lockfile it started with covers a change or a
      // removal, the one found now an install into a worktree that had none.
      const lockfiles = new Set([...this.#lockfiles, ...(await this.#installedLockfiles(vitest))]);
      if (abs.some((p) => lockfiles.has(p.abs))) this.#reload = true;
      // Tasks 001-349, 004-81: a revision that moved `vitest.excludeProjects`
      // or `vitest.exclude` reloaded the policy first; the recreate relists.
      const exclusion = excludedStamp(this.#exclude(), this.#excludeFiles()) !== this.#excluded;
      // Row 015-11: so is one that turned coverage on or off (spec 015 D8).
      const coverage = (this.#coverage?.enabled() ?? false) !== this.#coverageOn;
      if (exclusion || coverage || abs.some((p) => triggers.has(p.abs) || lockfiles.has(p.abs))) {
        const before = vitest.projects.map((p) => p.name);
        // A run in flight uses the instance: the recreate waits for it, and the next run for the recreate.
        const fresh = await hold.exclusive(async () => {
          if (this.#closed) throw new Error("vitest adapter: closed");
          return this.#recreate(this.#vitest);
        });
        const names = new Set([...before, ...fresh.projects.map((p) => p.name)]);
        return { recreatedProjects: [...names].sort() };
      }
      // A run in flight checks the bytes it read only after it ends: what moved
      // is logged before this drops its transform (`SourceStamps.stale`), and
      // what has not moved yet keeps its stamp for that check (task 001-264).
      if (this.#running) {
        this.#sources.hold(vitest);
        await this.#sources.stale(vitest);
      }
      for (const p of abs) vitest.invalidateFile(p.abs);
      await invalidateStructural(vitest, abs, this.#note);
      // Task 001-146: a file read between a revert and its restore is named by no revision.
      await this.#invalidateStale(vitest);
      return { recreatedProjects: [] };
    });
  }

  affected(changedPaths: readonly RelativePath[]): Promise<AffectedTestFiles> {
    return this.#part(async (vitest) => {
      const specs = this.#covered(await testSpecifications(vitest));
      const changed = changedPaths.map((p) => this.paths.toAbsolute(p));
      const { direct, transitive } = await affectedTestFiles(vitest, specs, changed);
      return {
        direct: direct.map((s) => this.#ref(s)).sort(compareRefs),
        transitive: transitive.map((s) => this.#ref(s)).sort(compareRefs),
      };
    });
  }

  closure(testFile: TestFileRef): Promise<RunnerClosure> {
    return this.#part(async (vitest) => {
      const project = findProject(vitest, testFile);
      const abs = this.paths.toAbsolute(testFile.path);
      const graph = await importClosure(project, [abs]);
      // Spec 001 D3: the snapshot path whether or not the file exists, and
      // every resolution candidate of an unresolved import, so the key
      // changes when one appears, incrementally and at bootstrap (review B1).
      const files = new Set([
        ...graph.files,
        ...missingCandidates(graph, resolveExtensions(project)),
      ]);
      files.add(snapshotPath(project, abs));
      const paths = [...files]
        .filter((f) => this.paths.isProjectFile(f))
        .map((f) => this.paths.toRelative(f))
        .filter((p): p is RelativePath => p !== null)
        .sort();
      // Task 001-105: the installed packages the closure imports, for the key.
      return { testFile, paths, packages: closurePackages(graph, this.paths) };
    });
  }

  enumerate(testFile: TestFileRef): Promise<readonly EnumeratedCheck[]> {
    return this.#part(async (vitest) => {
      const project = findProject(vitest, testFile);
      const spec = project.createSpecification(this.paths.toAbsolute(testFile.path));
      const [module] = await vitest.parseSpecifications([spec]);
      if (!module) return [];
      return enumeratedChecks(module, testFile);
    });
  }

  testFiles(): Promise<readonly TestFileRef[]> {
    return this.#part(async (vitest) => {
      const specs = await vitest.globTestSpecifications();
      // A file `vitest.exclude` drops is left out too: a bare `vitest run` still runs it (005 D8 step 3).
      const covered = this.#covered(supported(specs));
      this.#omitted = specs.length - covered.length;
      return covered.map((s) => this.#ref(s)).sort(compareRefs);
    });
  }

  omittedTestFiles(): number {
    return this.#omitted;
  }

  environment(): Promise<readonly RunnerEnvironment[]> {
    return this.#part(async (vitest) => {
      const context = {
        paths: this.paths,
        runnerVersion: this.#node.version,
        adapterVersion: this.#observer.adapterVersion(this.adapterVersion),
        ...(this.#instanceCoverage === null ? {} : { coverage: this.#instanceCoverage.provider }),
      };
      const envs: RunnerEnvironment[] = [];
      for (const project of vitest.projects) {
        const inputs = await projectInputs(vitest, project);
        const environment = {
          ...projectEnvironment(project, inputs, {
            ...context,
            injected: { ...this.#childEnv, ...this.#observer.injectedFor(project.name) },
          }),
          packages: await environmentPackages(project, inputs, this.paths),
        };
        envs.push({
          ...environment,
          ...(await formerPackages(project, inputs, environment, this.paths)),
        });
      }
      return envs.sort((a, b) => compare(a.project, b.project));
    });
  }

  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    return this.#gate.run(
      this.#call(async (hold) => {
        // Task 001-146: drops what moved since Vite read it. Task 001-157: an
        // instance unsure of what it read once is then replaced.
        await this.#invalidateStale(await this.#instance(hold));
        const vitest = await this.#instance(hold);
        const specs = testFiles.map((ref) => {
          const project = findProject(vitest, ref);
          const path = this.paths.toAbsolute(ref.path);
          const texts = focusedTexts(options.checks, ref);
          // 013 V4 (row 011-135): the specification's own pattern, never the instance's.
          return texts === null
            ? project.createSpecification(path)
            : project.createSpecification(path, {
                testNamePattern: namePattern(texts, vitest.version),
              });
        });
        const collector = new RunCollector(
          testFiles,
          this.paths,
          options.fileEnded,
          options.checks,
        );
        if (specs.length === 0) {
          const empty = buildReport(collector, { end: "completed", failure: null, hung: false }, 0);
          writeRunLog(options, collector, empty);
          return empty;
        }
        // D11 Capacity (task 001-378): the tier's grant, under each project's own width.
        this.#hints.size(vitest, options.workers, testFiles);
        const coverage = this.#instanceCoverage;
        const uncovered =
          coverage === null ? null : await this.#uncovered(vitest, coverage, testFiles, options);
        const exitCode = process.exitCode;
        const unsure = this.#unsure;
        const loadedSince = Date.now();
        const started = performance.now();
        this.#collector = collector;
        this.#running = true;
        try {
          let execution = await execute(
            vitest,
            specs,
            options.timeoutMs,
            collector,
            options.signal,
          );
          // Task 001-146: bytes the run read that moved since; the files that may have run them.
          const ran = await this.#invalidateStale(vitest, loadedSince);
          const moved = [...new Set([...ran, ...unsure])].sort();
          this.#running = false;
          // Task 001-159: touched after this run's instance began to start, and not forgotten since.
          // Task 013-02: sorted now, when the run's transforms have recorded what they read.
          const touched = await sortTouched(
            vitest,
            this.#touches.pending().map(this.#absolute),
            this.#lockfiles,
            this.paths,
          );
          // Task 013-06: read before a close below empties the instance.
          const reran = mayHaveRun(vitest, moved, testFiles, this.paths);
          const reread = mayHaveReadTouched(vitest, touched, testFiles, this.paths);
          const broken = runnerFailure(collector, { paths: this.paths, tempDirs: this.#tempDirs });
          const rejected = execution.rejected;
          const startup =
            rejected === undefined
              ? null
              : startupFailure(vitest, specs, collector, rejected.error, this.paths);
          if (execution.hung || broken !== null || rejected !== undefined) {
            // The runner part may be using the instance: it is dropped once that call returns.
            const ran = execution;
            execution = await hold.exclusive(async () => {
              if (this.#vitest !== vitest) return ran;
              this.#vitest = null;
              // The workers ignore cancellation. Abandon the instance; the next call starts a new one.
              if (ran.hung) abandon(vitest, collector);
              else if (broken !== null) return closeBroken(vitest, collector, broken);
              // Task 001-382: a rejected run leaves a global setup Vitest will not run again.
              else await closeRejected(vitest, collector);
              return ran;
            });
          }
          // Spec 001 D11 Fidelity (task 001-390): a signature of the recorder this run used says so.
          const built = withRecorderSignatures(
            withStartup(
              buildReport(collector, execution, Math.round(performance.now() - started)),
              startup,
            ),
            {
              files: this.#observer.files,
              inNodeOptions: this.#observer.active,
              relativize: (text) => this.paths.relativizeText(text),
            },
          );
          const observed = this.#observer.take(built.completedFiles);
          // A warm-up's reads are what the recorder saw, ignored paths too, of every completed
          // file (tasks 001-307, 001-312).
          const reads =
            observed !== undefined && options.observeIgnored === true
              ? { reads: readsOfEvery(observed, built.completedFiles) }
              : {};
          const kept = withoutFiles(
            observed === undefined ? built : { ...built, observed, ...reads },
            reran,
            moved,
            this.paths,
          );
          // Review wave-13e B1: a path the run wrote itself counts too. Writing its bytes proves
          // nothing about which bytes a cache served the run.
          const counted = [...touched.inputs, ...touched.modules].map(
            (file) => this.paths.toRelative(file) ?? file,
          );
          const report = withoutTouched(kept, reread, counted.sort());
          if (coverage !== null && uncovered !== null) {
            const clean = !execution.hung && broken === null && rejected === undefined;
            this.#collect(vitest, coverage, report, clean ? uncovered : null, options.runId);
          }
          // One persisted note for status, besides the crash's delivered line (D5).
          if (broken !== null && report.failure !== null) this.#note(report.failure);
          writeRunLog(options, collector, report);
          return report;
        } finally {
          this.#running = false;
          this.#collector = null;
          // Spec 001 D4: "`process.exitCode` is reset after each run."
          process.exitCode = exitCode;
        }
      }),
    );
  }

  /**
   * Spec 015 D8: the files of a run whose workers take no coverage, written
   * for the provider: a focused file, whose run is not the whole file's, and
   * one whose closure or project setup imports `node:inspector`, named once
   * in a note.
   */
  async #uncovered(
    vitest: Vitest,
    coverage: InstanceCoverage,
    testFiles: readonly TestFileRef[],
    options: RunOptions,
  ): Promise<Set<string>> {
    const focused = testFiles.filter((ref) => focusedTexts(options.checks, ref) !== null);
    const reading = await inspectorFiles(vitest, testFiles, this.paths);
    for (const file of reading) noteOnce(this.paths.root, inspectorNote(file), this.#note);
    const skipped = [...focused, ...reading.map((file) => file.ref)];
    coverage.skip(skipped.map((ref) => this.paths.toAbsolute(ref.path)));
    return new Set(skipped.map(fileKey));
  }

  /**
   * Hands the run's payloads of its completed, covered files to the
   * records' writer, and drops the rest; `uncovered` `null` drops all (a
   * hung, broken or rejected run).
   */
  #collect(
    vitest: Vitest,
    coverage: InstanceCoverage,
    report: RunReport,
    uncovered: ReadonlySet<string> | null,
    runId: string,
  ): void {
    const completed = new Set(report.completedFiles.map(fileKey));
    const wanted = (ref: TestFileRef) =>
      uncovered !== null && completed.has(fileKey(ref)) && !uncovered.has(fileKey(ref));
    const batches = coverage.take(vitest);
    const files = coveredFiles(vitest, batches, wanted, this.#sources, this.paths);
    if (files.length > 0) this.#coverage?.collected({ runId, files });
  }

  close(): Promise<void> {
    return this.#gate.exclusive(async () => {
      if (this.#closed) return;
      this.#closed = true;
      const vitest = this.#vitest;
      this.#vitest = null;
      // A slow pass's instance among them (spec 004 D2, `withSlowInstance`).
      if (vitest !== null) await closeEmptied(vitest);
      this.#observer.stop();
      for (const coverage of this.#coverageDirs.splice(0)) coverage.remove();
    });
  }

  /**
   * Spec 004 D7 (task 004-81): without the files policy `vitest.exclude`
   * selects, from the worktree root, so none is listed, keyed, run or
   * counted, nor counted as omitted.
   */
  #covered(specs: readonly TestSpecification[]): TestSpecification[] {
    return specs.filter((spec) => {
      const path = this.paths.toRelative(spec.moduleId);
      return path === null || !this.#excludedFile(path);
    });
  }

  #ref(spec: TestSpecification): TestFileRef {
    const path = this.paths.toRelative(spec.moduleId);
    if (path === null) {
      throw new Error(`vitest adapter: test file outside the worktree: ${spec.moduleId}`);
    }
    return { project: spec.project.name, path };
  }
}

/** Test specifications of every project. Typecheck specs (`tsc`, no module graph) are not supported in v1. */
async function testSpecifications(vitest: Vitest): Promise<TestSpecification[]> {
  return supported(await vitest.globTestSpecifications());
}

function fileKey(ref: TestFileRef): string {
  return `${ref.project}\0${ref.path}`;
}

function excludedStamp(projects: readonly string[], files: readonly string[]): string {
  return JSON.stringify([projects, files]);
}

function supported(specs: readonly TestSpecification[]): TestSpecification[] {
  return specs.filter((s) => s.pool !== "typescript");
}
