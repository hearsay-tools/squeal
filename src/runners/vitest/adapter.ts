import type { TestSpecification, Vitest } from "vitest/node";
import { compare } from "../../core/fs/index.js";
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
import { affectedTestFiles } from "./affected.js";
import { closeBroken, instanceTempDirs, runnerFailure } from "./broken.js";
import { ConfigStamps } from "./config-stamps.js";
import { projectEnvironment } from "./environment.js";
import { Gate, type Hold } from "./gate.js";
import { importClosure, resolutionCandidates } from "./graph.js";
import { loadVitest, type VitestNode } from "./load.js";
import { mayHaveRun, withoutFiles, withoutTouched } from "./moved.js";
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

/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check (D3).
 */
export const VITEST_ADAPTER_VERSION = "2";

/**
 * Vitest adapter over one warm `vitest/node` instance per worktree.
 *
 * Runs queue behind runs, the runner part behind the runner part, and the
 * two overlap (task 001-150, D5 as amended: `Gate`). What replaces or
 * closes the instance (a start, a recreate, a broken or hung instance
 * dropped, `close`) waits for both and holds both.
 */
export class VitestAdapter implements RunnerAdapter {
  readonly name = "vitest";
  readonly adapterVersion = VITEST_ADAPTER_VERSION;

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
   * the current instance began to start. The next call replaces it; a run
   * that hears of one before it ends is not stored, whoever wrote it (task
   * 001-168).
   */
  #touched: RelativePath[] = [];
  /** Installed lockfiles the current instance started with. */
  #lockfiles = new Set<AbsolutePath>();
  /** The next start imports `vitest/node` again: the installed dependencies changed. */
  #reload = false;
  #node: VitestNode;
  #collector: RunCollector | null = null;
  /** Bumped per instance, so hooks from an abandoned instance never reach a later run. */
  #generation = 0;
  readonly #gate = new Gate();
  /** A run is between its first load and its last check: what the runner part invalidates is logged for it. */
  #running = false;
  #closed = false;
  readonly #note: (text: string) => void;
  readonly #observer: VitestObserver;
  readonly #childEnv: Readonly<Record<string, string>>;
  readonly #maxWorkers: number | undefined;

  /**
   * `vitest` is the project's own `vitest/node` (`loadVitest`). Only types
   * come from Squeal's Vitest, so loading this module loads no Vitest.
   * `note` records a fact the adapter worked around as a status note (D7).
   * `observe` is policy `observe.runtimeInputs`, read before each call
   * (task 001-132); absent, nothing is observed. `childEnv` goes into every
   * worker's env beside the recorder's and, like it, stays out of the
   * environment hash (D12, task 001-142). `maxWorkers` overrides the
   * config's (spec 004 D2: the slow tier's instance); not keyed, since the
   * slow instance's environment is never asked for.
   */
  constructor(
    readonly paths: WorktreePaths,
    vitest: VitestNode,
    note: (text: string) => void = () => {},
    observe: () => boolean = () => false,
    childEnv: Readonly<Record<string, string>> = {},
    maxWorkers?: number,
  ) {
    this.#node = vitest;
    this.#sources = new SourceStamps(paths);
    this.#childEnv = childEnv;
    this.#maxWorkers = maxWorkers;
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
    const heard = this.#touched.length;
    const sources = new SourceStamps(this.paths);
    const config = await ConfigStamps.take(this.paths, this.#configFiles);
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
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(this.#maxWorkers === undefined ? {} : { maxWorkers: this.#maxWorkers }),
    });
    // Review wave-13 B2: every project server's, not only the root's, before any load.
    sources.attach(vitest);
    this.#sources = sources;
    try {
      // Task 001-176: no bundle of the optimizer is ever loaded, whatever a config says (D4).
      const optimized = withoutOptimizer(vitest);
      if (optimized.length > 0) noteOnce(this.paths.root, optimizerOffNote(optimized), this.#note);
      await vitest.standalone();
      this.#observer.configure(vitest);
      this.#tempDirs = instanceTempDirs(vitest);
      this.#lockfiles = await this.#installedLockfiles(vitest);
      this.#configFiles = configFiles(vitest);
      this.#config = config;
      this.#unsure = await config.unsure(this.#configFiles);
      this.#touched = this.#touched.slice(heard);
    } catch (error) {
      await vitest.close();
      throw error;
    }
    return vitest;
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
    return this.#gate.part(async (hold) => fn(await this.#instance(hold), hold));
  }

  /**
   * The instance a call of a lane uses; it is not replaced until the call
   * returns. One unsure of its inputs is replaced once per call.
   */
  async #instance(hold: Hold): Promise<Vitest> {
    let replaced = false;
    const stale = () =>
      this.#observer.stale() || (!replaced && this.#unsure.length > 0) || this.#touched.length > 0;
    for (;;) {
      if (this.#closed) throw new Error("vitest adapter: closed");
      // Policy `observe.runtimeInputs` moved: the workers' env is set at creation.
      if (this.#vitest !== null && !stale()) return this.#vitest;
      // A failed recreate or a hung run leaves no instance; the next call retries.
      await hold.exclusive(async () => {
        if (this.#closed) return;
        if (this.#vitest === null) this.#vitest = await this.#start();
        else if (stale()) {
          replaced = true;
          await this.#recreate(this.#vitest);
        }
      });
    }
  }

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
    await old?.close();
    this.#vitest = await this.#start();
    return this.#vitest;
  }

  /**
   * A `touch` (task 001-159) is heard at once, so a run in flight is not
   * stored, and the instance is replaced before the next call: every
   * project and environment's transforms and module graph and the global
   * setup go with it. No project counts as recreated for it: the files are
   * the bytes they were, so the environment and the listing are too, and a
   * listing now could find a file the watcher has not reconciled yet, which
   * then never makes a revision.
   */
  invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    const touched = paths.filter((p) => p.kind === "touch").map((p) => p.path);
    this.#touched.push(...touched);
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
      if (abs.some((p) => triggers.has(p.abs) || lockfiles.has(p.abs))) {
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
      // is logged before this drops its transform (`SourceStamps.stale`).
      if (this.#running) await this.#sources.stale(vitest);
      for (const p of abs) vitest.invalidateFile(p.abs);
      await invalidateStructural(vitest, abs, this.#note);
      // Task 001-146: a file read between a revert and its restore is named by no revision.
      await this.#invalidateStale(vitest);
      return { recreatedProjects: [] };
    });
  }

  affected(changedPaths: readonly RelativePath[]): Promise<AffectedTestFiles> {
    return this.#part(async (vitest) => {
      const specs = await testSpecifications(vitest);
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
      const files = new Set(graph.files);
      files.add(snapshotPath(project, abs));
      const extensions = resolveExtensions(project);
      for (const target of graph.missing) {
        for (const candidate of resolutionCandidates(target, extensions)) files.add(candidate);
      }
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
    return this.#part(async (vitest) =>
      (await testSpecifications(vitest)).map((s) => this.#ref(s)).sort(compareRefs),
    );
  }

  environment(): Promise<readonly RunnerEnvironment[]> {
    return this.#part(async (vitest) => {
      const context = {
        paths: this.paths,
        runnerVersion: this.#node.version,
        adapterVersion: this.#observer.adapterVersion(this.adapterVersion),
        injected: { ...this.#childEnv, ...this.#observer.injected },
      };
      const envs: RunnerEnvironment[] = [];
      for (const project of vitest.projects) {
        const inputs = await projectInputs(vitest, project);
        envs.push({
          ...projectEnvironment(project, inputs, context),
          packages: await environmentPackages(project, inputs, this.paths),
        });
      }
      return envs.sort((a, b) => compare(a.project, b.project));
    });
  }

  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    return this.#gate.run(async (hold) => {
      // Task 001-146: drops what moved since Vite read it. Task 001-157: an
      // instance unsure of what it read once is then replaced.
      await this.#invalidateStale(await this.#instance(hold));
      const vitest = await this.#instance(hold);
      const specs = testFiles.map((ref) =>
        findProject(vitest, ref).createSpecification(this.paths.toAbsolute(ref.path)),
      );
      const collector = new RunCollector(testFiles, this.paths);
      if (specs.length === 0) {
        const empty = buildReport(collector, { end: "completed", failure: null, hung: false }, 0);
        writeRunLog(options, collector, empty);
        return empty;
      }
      const exitCode = process.exitCode;
      const unsure = this.#unsure;
      const loadedSince = Date.now();
      const started = performance.now();
      this.#collector = collector;
      this.#running = true;
      try {
        let execution = await execute(vitest, specs, options.timeoutMs, collector, options.signal);
        // Task 001-146: bytes the run read that moved since; the files that may have run them.
        const ran = await this.#invalidateStale(vitest, loadedSince);
        const moved = [...new Set([...ran, ...unsure])].sort();
        this.#running = false;
        // Task 001-159: touched after this run's instance began to start, so heard during the run.
        const heard = [...new Set(this.#touched)];
        const broken = runnerFailure(collector, { paths: this.paths, tempDirs: this.#tempDirs });
        if (execution.hung || broken !== null) {
          // The runner part may be using the instance: it is dropped once that call returns.
          const ran = execution;
          execution = await hold.exclusive(async () => {
            if (this.#vitest !== vitest) return ran;
            this.#vitest = null;
            // The workers ignore cancellation. Abandon the instance; the next call starts a new one.
            if (ran.hung) abandon(vitest, collector);
            else if (broken !== null) return closeBroken(vitest, collector, broken);
            return ran;
          });
        }
        const built = buildReport(collector, execution, Math.round(performance.now() - started));
        const observed = this.#observer.take(built.completedFiles);
        // Review wave-13e B1: a path the run wrote itself counts too. Writing its bytes proves
        // nothing about which bytes a cache served the run.
        const touched = heard.sort();
        const kept = withoutFiles(
          observed === undefined ? built : { ...built, observed },
          mayHaveRun(vitest, moved, testFiles, this.paths),
          moved,
          this.paths,
        );
        const report = touched.length === 0 ? kept : withoutTouched(kept, testFiles, touched);
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
    });
  }

  close(): Promise<void> {
    return this.#gate.exclusive(async () => {
      if (this.#closed) return;
      this.#closed = true;
      const vitest = this.#vitest;
      this.#vitest = null;
      await vitest?.close();
      this.#observer.stop();
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
  return (await vitest.globTestSpecifications()).filter((s) => s.pool !== "typescript");
}
