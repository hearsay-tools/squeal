import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import { compare, sameList } from "../../core/fs/compare.js";
import { toAbsolute } from "../../core/fs/paths.js";
import { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { JestProject } from "../../core/types/policy-jest.js";
import type {
  InvalidatedPath,
  ObservedInputs,
  RunnerAdapter,
  RunOptions,
  RunReport,
} from "../../core/types/runner.js";
import { isGroupLane } from "../../core/types/scheduler.js";
import { makeLogDir } from "../log-dir.js";
import { observedInputs } from "../observe/inputs.js";
import { takeRecorded } from "../observe/read.js";
import { observeRecorder } from "../observe/runtime.js";
import { type JestCoverage, ProjectCoverage } from "./coverage.js";
import { enumerate } from "./enumerate.js";
import {
  configFiles,
  isTransformConfig,
  type JestRead,
  jestCwd,
  jestEnvironment,
  projectProcessEnv,
  readJestProject,
  unavailableEnvironment,
} from "./environment.js";
import { createJestGraph, type JestGraph, type ModuleNameMapper } from "./graph/index.js";
import { type JestInstall, resolveJest } from "./resolve.js";
import { type HostObserved, runJest } from "./run/run.js";
import { defaultWarmMemoryLimitBytes, JestWarmPool } from "./run/warm.js";
import { jestTraits } from "./traits.js";
import { JEST_ADAPTER_VERSION } from "./version.js";

export { JEST_ADAPTER_VERSION };

export interface JestAdapterOptions {
  /** The worktree root. */
  readonly root: AbsolutePath;
  /** Problem notes: no Jest, a config that does not read; a `topic`'s latest replaces its earlier ones. */
  readonly note?: (text: string, topic?: string) => void;
  /** Batches at once, read per run: policy `runner.tierSize`. Default every batch of the tier. */
  readonly concurrency?: () => number;
  /** Files per batch, read per run; default the project's `batchSize`, else 5 (D4.1). */
  readonly batchSize?: () => number | undefined;
  /** Policy `observe.runtimeInputs`, read per call: runs carry `recorder.cjs`. Default on. */
  readonly observe?: () => boolean;
  /** Spec 001 D10: the daemon's temp directory, every child's `TMPDIR`, `TMP` and `TEMP`. */
  readonly tempDir?: AbsolutePath;
  /** Spec 001 D12: the mark every child carries so the daemon finds what a test leaves running. */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Squeal's folder for the wrapper config and Jest's transform cache; default under the OS temp folder. */
  readonly cacheDir?: AbsolutePath;
  /** The environment the project's processes inherit; default this process's. */
  readonly source?: NodeJS.ProcessEnv;
  /** Spec 028 D5.3, spec 015 D8: coverage in the runs the adapter makes anyway; absent, none. */
  readonly coverage?: JestCoverage;
  /** Spec 028 D7: batches run on warm workers where the project allows it. Default on. */
  readonly warm?: boolean;
  /** D7.4: an idle warm worker exits after this long; default 60 s. */
  readonly warmIdleMs?: number;
}

const MIB = 1024 * 1024;

/** The project as it last read: its Jest, config, test files and static graph. */
type Opened =
  | {
      readonly ok: true;
      readonly install: JestInstall;
      readonly read: Extract<JestRead, { ok: true }>;
      readonly graph: JestGraph;
      files: RelativePath[];
    }
  | {
      readonly ok: false;
      readonly note: string;
      readonly install: JestInstall | null;
      /** The existing files a failed config evaluation loaded, keyed while it stays unavailable. */
      readonly configDeps: readonly AbsolutePath[];
    };

/**
 * The Jest adapter of one configured project (spec 028 D1 to D6). Never
 * rejects for the project's sake: no Jest, an unsupported one or a config
 * that does not read is one note, `runnerVersion` "unavailable", no test
 * files and every run `crashed`, so its checks stay `unknown`. Without a
 * Jest each batch looks again; with a config that does not read, each batch
 * that changes any file reads it again (review 0.1.644-r3 B4). The first
 * read that succeeds recreates the project. Once it reads, only a change of
 * a file of its config chain, or of `observe.runtimeInputs`, reads the
 * project again and recreates it, which re-keys every check (D2.3).
 */
export async function createJestAdapter(
  project: JestProject,
  options: JestAdapterOptions,
): Promise<RunnerAdapter> {
  const root = realpathSync(options.root) as AbsolutePath;
  const paths = new WorktreePaths(root);
  const source = options.source ?? process.env;
  const label = `jest project ${JSON.stringify(project.name)}`;
  const topic = `jest-project:${project.name}`;
  const note = (text: string) => options.note?.(`${label}: ${text}`, topic);
  const observing = () => options.observe?.() ?? true;
  const ref = (path: RelativePath): TestFileRef => ({ project: project.name, path });
  const coverage = new ProjectCoverage(options.coverage, note);
  const warmPool =
    options.warm === false
      ? undefined
      : new JestWarmPool({
          memoryLimitBytes: () =>
            project.warmMemoryLimitMb === undefined
              ? defaultWarmMemoryLimitBytes()
              : project.warmMemoryLimitMb * MIB,
          ...(options.warmIdleMs === undefined ? {} : { idleMs: options.warmIdleMs }),
          ...(options.concurrency === undefined ? {} : { keep: options.concurrency }),
        });

  const open = async (): Promise<Opened> => {
    const resolution = resolveJest(project.name, jestCwd(root, project), root);
    if (!resolution.ok) return { ok: false, note: resolution.note, install: null, configDeps: [] };
    const { install } = resolution;
    const read = await readJestProject(root, project, install, source);
    if (!read.ok) {
      const configDeps = read.configDeps ?? [];
      return { ok: false, note: `${read.error}; its checks stay unknown`, install, configDeps };
    }
    const files = listed(root, project, read);
    try {
      return { ok: true, install, read, graph: await graphOf(root, project, read, files), files };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const note = `its module graph cannot be built: ${reason}`;
      return { ok: false, note, install, configDeps: read.configDeps };
    }
  };

  /**
   * Review 0.1.653 B1: folders of the worktree files runs observed, whose
   * Babel and Browserslist configs are keyed with the environment. Kept
   * across a new read of the project.
   */
  const loadedDirs = new Set<string>();
  /** Folders whose existing transform configs key the environment: the static graph's and the runs'. */
  const configDirs = (current: Opened): string[] => [...graphDirs(root, current), ...loadedDirs];

  let state = await open();
  let observed = observing();
  let watched = watchedOf(root, project, state, source, configDirs(state));
  if (!state.ok) note(state.note);

  /**
   * Reads the project again; notes a new failure, or that it reads again.
   * No warm worker of the old read runs again (D7.3).
   */
  const reopen = async (): Promise<void> => {
    await warmPool?.recycle();
    const before = state.ok ? null : state.note;
    state = await open();
    observed = observing();
    watched = watchedOf(root, project, state, source, configDirs(state));
    if (!state.ok && state.note !== before) note(state.note);
    else if (state.ok && before !== null) note(`it reads again (jest ${state.install.version})`);
  };

  return {
    name: "jest",
    adapterVersion: JEST_ADAPTER_VERSION,
    traits: jestTraits({
      tierSize: options.concurrency,
      batchSize: () => options.batchSize?.() ?? project.batchSize,
    }),
    async invalidate(changed) {
      const current = state;
      if (!current.ok) {
        /*
         * Review 0.1.644-r3 B4: an unavailable project lists no tests and
         * holds no graph, so any edit may be the one that repairs its config
         * (a restored helper, a created `options/index.js`, a package `main`,
         * an alias), and nothing guesses which. No Jest yet costs a lookup per
         * batch, no process; a config that did not read waits for an edit.
         */
        if (current.install !== null && changed.length === 0) return { recreatedProjects: [] };
        await reopen();
        // A project that stays unavailable keys as it did: nothing to recreate.
        return { recreatedProjects: state.ok ? [project.name] : [] };
      }
      // Healthy: only its config chain, a transform config added or deleted (review 0.1.653
      // B1), or the recorder setting reads it again.
      const configChanged = (p: InvalidatedPath) =>
        watched.has(p.path) || (p.kind !== "change" && isTransformConfig(p.path));
      if (observed !== observing() || changed.some(configChanged)) {
        await reopen();
        return { recreatedProjects: [project.name] };
      }
      current.graph.invalidate(changed);
      if (changed.some((p) => p.kind === "add" || p.kind === "delete")) {
        if (mayList(current.read, changed)) await relist(root, project, source, current);
      }
      // A policy that turned coverage on or off re-keys the project's checks once (015 D8).
      const toggled = coverage.changed();
      // D7.3: a warm worker's haste map knows no added or deleted file; a source edit it sees.
      if (toggled || changed.some((p) => p.kind !== "change")) await warmPool?.recycle();
      // Review 0.1.648 B1: unless Node holds the edited file, a transform or a helper of one.
      else await warmPool?.recycleFor(new Set(changed.map((p) => p.path)));
      return { recreatedProjects: toggled ? [project.name] : [] };
    },
    async affected(changed) {
      if (!state.ok) return { direct: [], transitive: [] };
      const { direct, transitive } = state.graph.affected(changed);
      return { direct: direct.map(ref), transitive: transitive.map(ref) };
    },
    async closure(testFile) {
      if (!state.ok || !state.files.includes(testFile.path)) {
        return { testFile, paths: [testFile.path] };
      }
      const closure = state.graph.closure(testFile.path);
      return { testFile, paths: closure.paths, packages: closure.packages };
    },
    enumerate: (testFile) => enumerate(toAbsolute(root, testFile.path), testFile),
    testFiles: async () => (state.ok ? state.files.map(ref) : []),
    async environment() {
      if (!state.ok) {
        const { note, configDeps } = state;
        return [unavailableEnvironment(root, project, note, JEST_ADAPTER_VERSION, configDeps)];
      }
      const { install, read } = state;
      const environment = jestEnvironment({
        root,
        project,
        install,
        read,
        source,
        adapterVersion: JEST_ADAPTER_VERSION,
        observing: observed,
        covering: coverage.key(),
        extraConfigDirs: configDirs(state),
      });
      return [environment];
    },
    async run(testFiles, runOptions) {
      if (!state.ok) return unavailable(`${label}: ${state.note}`);
      const covered = coverage.covered(state.graph, state.files);
      return runProject(state.install, state.read, testFiles, runOptions, covered);
    },
    close: async () => {
      await warmPool?.close();
    },
  };

  async function runProject(
    install: JestInstall,
    read: Extract<JestRead, { ok: true }>,
    testFiles: readonly TestFileRef[],
    runOptions: RunOptions,
    covered: ((testFile: TestFileRef) => boolean) | undefined,
  ): Promise<RunReport> {
    const logDir = join(
      runOptions.logDir,
      "jest",
      encodeURIComponent(project.name),
    ) as AbsolutePath;
    const recorder = observed ? observeRecorder() : null;
    const out = join(logDir, "observed") as AbsolutePath;
    const observe =
      recorder !== null && makeLogDir(out) ? { recorder, out, skip: skipped(root) } : null;
    const { tempDir } = options;
    const batchSize = options.batchSize?.();
    const ran = await runJest({
      root,
      project,
      install,
      files: testFiles,
      logDir,
      timeoutMs: runOptions.timeoutMs,
      // A group's tier starts every file it holds (spec 019 D3): the scheduler sized it.
      ...(options.concurrency === undefined || isGroup(runOptions.lane)
        ? {}
        : { concurrency: options.concurrency() }),
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(project.slow === true ? { alone: () => true } : {}),
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      runEnv: {
        ...source,
        ...(tempDir === undefined ? {} : { TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir }),
      },
      childEnv: { ...options.childEnv, ...runOptions.childEnv },
      ...(runOptions.stop === undefined ? {} : { signal: runOptions.stop }),
      ...(observe === null ? {} : { observe }),
      ...(warmPool === undefined ? {} : { warmPool, hasGlobalHooks: hasGlobalHooks(read) }),
      ...(covered === undefined
        ? {}
        : { coverage: { dir: join(logDir, "cov") as AbsolutePath, covered } }),
    });
    const { report } = ran;
    if (covered !== undefined) coverage.collect(runOptions.runId, ran.coverage, paths);
    if (observe === null) return report;
    const recorded = withoutBuiltinProbes(
      observedInputs(takeRecorded(out), report.completedFiles, paths),
      paths,
    );
    const withTransform = withReads(recorded, ran.transformReads ?? [], paths, observe.skip);
    const seen = withHostModules(withTransform, ran.hostObserved ?? [], paths, observe.skip);
    addDirs(loadedDirs, root, seen);
    return seen.length === 0 ? report : { ...report, observed: seen };
  }
}

/**
 * Row 028-08 (F5): `source-map-support` asks `fs.existsSync` about a stack
 * frame's `node:internal/...` name, which the recorder resolves under the
 * working directory. No such file is the test's input: one that is not on
 * disk is dropped.
 */
function withoutBuiltinProbes(
  observed: readonly ObservedInputs[],
  paths: WorktreePaths,
): ObservedInputs[] {
  const builtin = (path: RelativePath) => BUILTIN.test(path) && !existsSync(paths.toAbsolute(path));
  return observed.map((o) =>
    o.paths.some(builtin) ? { ...o, paths: o.paths.filter((p) => !builtin(p)) } : o,
  );
}

const BUILTIN = /(?:^|\/)node:/;

/**
 * Row 028-08 (F1): each file's observations with what Jest's transform and
 * resolver read with success for it (`transformReads`), as paths: the
 * recorder sees none of their reads, so their probes of absent files are no
 * input. A path outside the project or below `skip` stays out.
 */
function withReads(
  observed: readonly ObservedInputs[],
  reads: readonly HostObserved[],
  paths: WorktreePaths,
  skip: readonly AbsolutePath[],
): ObservedInputs[] {
  if (reads.length === 0) return [...observed];
  const out = new Map(observed.map((o) => [o.testFile.path, o]));
  for (const { testFile, paths: read } of reads) {
    const kept = inProject(read, paths, skip);
    if (kept.length === 0) continue;
    const entry = out.get(testFile.path) ?? { testFile, paths: [], directories: [] };
    out.set(testFile.path, { ...entry, paths: merged(entry.paths, kept) });
  }
  return [...out.values()];
}

/** The project paths of `abs`, relative, none below `skip`. */
function inProject(
  abs: readonly AbsolutePath[],
  paths: WorktreePaths,
  skip: readonly AbsolutePath[],
): RelativePath[] {
  return abs.flatMap((file) => {
    if (!paths.isProjectFile(file) || skip.some((s) => file.startsWith(`${s}${sep}`))) return [];
    const path = paths.toRelative(file);
    return path === null ? [] : [path];
  });
}

/**
 * Review 0.1.648 B1: each file's observations with the worktree modules its
 * warm worker's Node used for it, as paths and module loads: a module Node
 * serves from its cache is read by no batch after the first, yet it decides
 * the result. A path outside the project or below `skip` stays out.
 */
function withHostModules(
  observed: readonly ObservedInputs[],
  host: readonly HostObserved[],
  paths: WorktreePaths,
  skip: readonly AbsolutePath[],
): ObservedInputs[] {
  if (host.length === 0) return [...observed];
  const out = new Map(observed.map((o) => [o.testFile.path, o]));
  for (const { testFile, paths: modules } of host) {
    const kept = inProject(modules, paths, skip);
    if (kept.length === 0) continue;
    const entry = out.get(testFile.path) ?? { testFile, paths: [], directories: [] };
    out.set(testFile.path, {
      ...entry,
      paths: merged(entry.paths, kept),
      modules: merged(entry.modules ?? [], kept),
    });
  }
  return [...out.values()];
}

function merged(a: readonly RelativePath[], b: readonly RelativePath[]): RelativePath[] {
  return [...new Set([...a, ...b])].sort(compare);
}

/** A `globalSetup` or `globalTeardown`, global or the project's: only a Jest process runs them (D7). */
function hasGlobalHooks(read: Extract<JestRead, { ok: true }>): boolean {
  return [read.global, read.project].some(
    (config) => config.globalSetup != null || config.globalTeardown != null,
  );
}

/** Jest's listed files, narrowed by the project's `include` and less its `exclude`, from `cwd`. */
function listed(
  root: AbsolutePath,
  project: JestProject,
  read: Extract<JestRead, { ok: true }>,
): RelativePath[] {
  const cwd = jestCwd(root, project);
  const include = createInputMatcher(project.include);
  const exclude = createInputMatcher(project.exclude);
  const files: RelativePath[] = [];
  for (const abs of read.testPaths) {
    if (!abs.startsWith(root + sep)) continue;
    const fromCwd = slashes(relative(cwd, abs));
    if (project.include.length > 0 && !include(fromCwd)) continue;
    if (exclude(fromCwd)) continue;
    files.push(slashes(abs.slice(root.length + 1)));
  }
  return files.sort(compare);
}

function graphOf(
  root: AbsolutePath,
  project: JestProject,
  read: Extract<JestRead, { ok: true }>,
  files: readonly RelativePath[],
): Promise<JestGraph> {
  const config = read.project;
  const array = (value: unknown) => (Array.isArray(value) ? (value as string[]) : undefined);
  const resolver = config.snapshotResolver;
  return createJestGraph({
    root,
    rootDir: String(config.rootDir) as AbsolutePath,
    testFiles: files,
    moduleNameMapper: config.moduleNameMapper as ModuleNameMapper | undefined,
    setupFiles: array(config.setupFiles),
    setupFilesAfterEnv: array(config.setupFilesAfterEnv),
    snapshotResolver: typeof resolver === "string" ? resolver : null,
    moduleFileExtensions: array(config.moduleFileExtensions),
    tsconfigPath: project.env.TS_NODE_PROJECT,
  });
}

/** Adds the folder of each path `observed` names to `dirs`. */
function addDirs(dirs: Set<string>, root: AbsolutePath, observed: readonly ObservedInputs[]): void {
  for (const o of observed) for (const path of o.paths) dirs.add(dirname(toAbsolute(root, path)));
}

/**
 * Review 0.1.653 B1: the folders of every module in the project's static
 * closures, whose transform configs Babel reads as it transforms them.
 */
function graphDirs(root: AbsolutePath, state: Opened): Set<string> {
  const dirs = new Set<string>();
  if (!state.ok) return dirs;
  for (const file of state.files) {
    try {
      for (const path of state.graph.closure(file).paths) dirs.add(dirname(toAbsolute(root, path)));
    } catch {
      // a file the graph no longer lists
    }
  }
  return dirs;
}

/** The config chain's files: a change of one reads the project again (D2.3). */
function watchedOf(
  root: AbsolutePath,
  project: JestProject,
  state: Opened,
  source: NodeJS.ProcessEnv,
  extraDirs: Iterable<string>,
): ReadonlySet<RelativePath> {
  const read: JestRead = state.ok
    ? state.read
    : { ok: false, error: "", configDeps: state.configDeps };
  const env =
    state.install === null ? source : projectProcessEnv(root, project, state.install, source);
  return new Set(configFiles(root, project, read, env, extraDirs));
}

/** An add or delete that can be a test file: under a root of the project, of an extension it runs. */
function mayList(
  read: Extract<JestRead, { ok: true }>,
  changed: readonly InvalidatedPath[],
): boolean {
  const extensions = new Set(
    (read.project.moduleFileExtensions as string[] | undefined)?.map((e) => `.${e}`) ?? [],
  );
  return changed.some(
    (p) => (p.kind === "add" || p.kind === "delete") && extensions.has(extname(p.path)),
  );
}

/** Lists the project's files again; a changed list goes to the graph. */
async function relist(
  root: AbsolutePath,
  project: JestProject,
  source: NodeJS.ProcessEnv,
  current: Extract<Opened, { ok: true }>,
): Promise<void> {
  const read = await readJestProject(root, project, current.install, source);
  if (!read.ok) return;
  const next = listed(root, project, read);
  if (sameList(next, current.files)) return;
  current.files = next;
  current.graph.setTestFiles(next);
}

/** The temp directory is skipped when it lies inside the worktree, never when the worktree lies in it. */
function skipped(root: AbsolutePath): AbsolutePath[] {
  const temp = tmpdir();
  return `${root}${sep}`.startsWith(`${temp}${sep}`) ? [] : [temp as AbsolutePath];
}

function isGroup(lane: string | undefined): boolean {
  return lane !== undefined && isGroupLane(lane);
}

/** A run of a project that cannot run: nothing completed (001 D12). */
function unavailable(failure: string): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure,
  };
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
