import type { TestSpecification, Vitest } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import { findInstalledLockfile } from "../../core/keys/index.js";
import type {
  AbsolutePath,
  AffectedTestFiles,
  EnumeratedCheck,
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
import { projectEnvironment } from "./environment.js";
import { importClosure, resolutionCandidates } from "./graph.js";
import { loadVitest, type VitestNode } from "./load.js";
import { VitestObserver } from "./observe.js";
import { closurePackages, environmentPackages } from "./packages.js";
import type { WorktreePaths } from "./paths.js";
import {
  findProject,
  projectInputs,
  recreateTriggers,
  resolveExtensions,
  snapshotPath,
} from "./project.js";
import { createSquealReporter, RunCollector } from "./reporter.js";
import { compareRefs, enumeratedChecks } from "./results.js";
import { abandon, buildReport, execute, writeRunLog } from "./run.js";
import { invalidateStructural } from "./stale.js";

/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check (D3).
 */
export const VITEST_ADAPTER_VERSION = "2";

/**
 * Vitest adapter over one warm `vitest/node` instance per worktree.
 *
 * Every public call is serialized: Vitest serializes runs itself, but
 * `config.related` is reset by each run and a recreate must not race a run.
 */
export class VitestAdapter implements RunnerAdapter {
  readonly name = "vitest";
  readonly adapterVersion = VITEST_ADAPTER_VERSION;

  #vitest: Vitest | null = null;
  /** Where the current instance copies transformed modules (`instanceTempDirs`). */
  #tempDirs: AbsolutePath[] = [];
  /** Installed lockfiles the current instance started with. */
  #lockfiles = new Set<AbsolutePath>();
  /** The next start imports `vitest/node` again: the installed dependencies changed. */
  #reload = false;
  #node: VitestNode;
  #collector: RunCollector | null = null;
  /** Bumped per instance, so hooks from an abandoned instance never reach a later run. */
  #generation = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;
  readonly #note: (text: string) => void;
  readonly #observer: VitestObserver;

  /**
   * `vitest` is the project's own `vitest/node` (`loadVitest`). Only types
   * come from Squeal's Vitest, so loading this module loads no Vitest.
   * `note` records a fact the adapter worked around as a status note (D7).
   * `observe` is policy `observe.runtimeInputs`, read before each call
   * (task 001-132); absent, nothing is observed.
   */
  constructor(
    readonly paths: WorktreePaths,
    vitest: VitestNode,
    note: (text: string) => void = () => {},
    observe: () => boolean = () => false,
  ) {
    this.#node = vitest;
    this.#note = note;
    this.#observer = new VitestObserver(paths, observe, note);
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
    const vitest = await this.#node.createVitest("test", {
      root: this.paths.root,
      watch: false,
      reporters: [createSquealReporter(current)],
      update: "none",
      includeTaskLocation: true,
      ...this.#observer.start(),
    });
    try {
      await vitest.standalone();
      this.#observer.configure(vitest);
      this.#tempDirs = instanceTempDirs(vitest);
      this.#lockfiles = await this.#installedLockfiles(vitest);
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

  #serial<T>(fn: (vitest: Vitest) => Promise<T>): Promise<T> {
    const next = this.#queue.then(async () => {
      if (this.#closed) throw new Error("vitest adapter: closed");
      // A failed recreate or a hung run leaves no instance; the next call retries.
      this.#vitest ??= await this.#start();
      // Policy `observe.runtimeInputs` moved: the workers' env is set at creation.
      if (this.#observer.stale()) await this.#recreate(this.#vitest);
      return fn(this.#vitest as Vitest);
    });
    // The caller gets the error from `next`; the queue only needs to settle.
    this.#queue = next.catch(() => {});
    return next;
  }

  async #recreate(old: Vitest): Promise<Vitest> {
    this.#vitest = null;
    await old.close();
    this.#vitest = await this.#start();
    return this.#vitest;
  }

  invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    return this.#serial(async (vitest) => {
      const abs = paths.map((p) => ({ ...p, abs: this.paths.toAbsolute(p.path) }));
      const triggers = await recreateTriggers(vitest);
      // Spec 001 D4: an install recreates the instance from the worktree's own
      // `vitest/node`. The lockfile it started with covers a change or a
      // removal, the one found now an install into a worktree that had none.
      const lockfiles = new Set([...this.#lockfiles, ...(await this.#installedLockfiles(vitest))]);
      if (abs.some((p) => lockfiles.has(p.abs))) this.#reload = true;
      if (abs.some((p) => triggers.has(p.abs) || lockfiles.has(p.abs))) {
        const before = vitest.projects.map((p) => p.name);
        const fresh = await this.#recreate(vitest);
        const names = new Set([...before, ...fresh.projects.map((p) => p.name)]);
        return { recreatedProjects: [...names].sort() };
      }
      for (const p of abs) vitest.invalidateFile(p.abs);
      await invalidateStructural(vitest, abs, this.#note);
      return { recreatedProjects: [] };
    });
  }

  affected(changedPaths: readonly RelativePath[]): Promise<AffectedTestFiles> {
    return this.#serial(async (vitest) => {
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
    return this.#serial(async (vitest) => {
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
    return this.#serial(async (vitest) => {
      const project = findProject(vitest, testFile);
      const spec = project.createSpecification(this.paths.toAbsolute(testFile.path));
      const [module] = await vitest.parseSpecifications([spec]);
      if (!module) return [];
      return enumeratedChecks(module, testFile);
    });
  }

  testFiles(): Promise<readonly TestFileRef[]> {
    return this.#serial(async (vitest) =>
      (await testSpecifications(vitest)).map((s) => this.#ref(s)).sort(compareRefs),
    );
  }

  environment(): Promise<readonly RunnerEnvironment[]> {
    return this.#serial(async (vitest) => {
      const context = {
        paths: this.paths,
        runnerVersion: this.#node.version,
        adapterVersion: this.#observer.adapterVersion(this.adapterVersion),
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
    return this.#serial(async (vitest) => {
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
      const started = performance.now();
      this.#collector = collector;
      try {
        let execution = await execute(vitest, specs, options.timeoutMs, collector, options.signal);
        if (execution.hung) {
          // The workers ignore cancellation. Abandon the instance; the next call starts a new one.
          this.#vitest = null;
          abandon(vitest, collector);
        }
        const broken = runnerFailure(collector, { paths: this.paths, tempDirs: this.#tempDirs });
        if (broken !== null && this.#vitest === vitest) {
          this.#vitest = null;
          execution = await closeBroken(vitest, collector, broken);
        }
        const built = buildReport(collector, execution, Math.round(performance.now() - started));
        const observed = this.#observer.take(built.completedFiles);
        const report = observed === undefined ? built : { ...built, observed };
        // One persisted note for status, besides the crash's delivered line (D5).
        if (broken !== null && report.failure !== null) this.#note(report.failure);
        writeRunLog(options, collector, report);
        return report;
      } finally {
        this.#collector = null;
        // Spec 001 D4: "`process.exitCode` is reset after each run."
        process.exitCode = exitCode;
      }
    });
  }

  close(): Promise<void> {
    const closing = this.#queue.then(async () => {
      if (this.#closed) return;
      this.#closed = true;
      const vitest = this.#vitest;
      this.#vitest = null;
      await vitest?.close();
      this.#observer.stop();
    });
    this.#queue = closing.catch(() => {});
    return closing;
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
