import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, sep } from "node:path";
import { compare, sameList } from "../../core/fs/compare.js";
import { toAbsolute } from "../../core/fs/paths.js";
import { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { JestProject } from "../../core/types/policy-jest.js";
import type {
  InvalidatedPath,
  RunnerAdapter,
  RunOptions,
  RunReport,
} from "../../core/types/runner.js";
import { isGroupLane } from "../../core/types/scheduler.js";
import { makeLogDir } from "../log-dir.js";
import { observedInputs } from "../observe/inputs.js";
import { takeRecorded } from "../observe/read.js";
import { observeRecorder } from "../observe/runtime.js";
import { enumerate } from "./enumerate.js";
import {
  configFiles,
  type JestRead,
  jestCwd,
  jestEnvironment,
  projectProcessEnv,
  readJestProject,
  unavailableEnvironment,
} from "./environment.js";
import { createJestGraph, type JestGraph, type ModuleNameMapper } from "./graph/index.js";
import { type JestInstall, resolveJest } from "./resolve.js";
import { runJest } from "./run/run.js";
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
}

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
      /** The files a failed config evaluation loaded: an edit of one reads the project again. */
      readonly configDeps: readonly AbsolutePath[];
    };

/**
 * The Jest adapter of one configured project (spec 028 D1 to D6). Never
 * rejects for the project's sake: no Jest, an unsupported one or a config
 * that does not read is one note, `runnerVersion` "unavailable", no test
 * files and every run `crashed`, so its checks stay `unknown`. Each batch
 * looks again; the first that reads recreates the project. A change of any
 * file of the config chain, or of `observe.runtimeInputs`, reads the
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

  let state = await open();
  let observed = observing();
  let watched = watchedOf(root, project, state, source);
  if (!state.ok) note(state.note);

  /** Reads the project again; notes a new failure, or that it reads again. */
  const reopen = async (): Promise<void> => {
    const before = state.ok ? null : state.note;
    state = await open();
    observed = observing();
    watched = watchedOf(root, project, state, source);
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
      // No Jest yet costs a lookup per batch, no process; a config that did not read waits for an edit.
      const recreate =
        (!current.ok && current.install === null) ||
        observed !== observing() ||
        changed.some((p) => watched.has(p.path));
      if (recreate || !current.ok) {
        if (!recreate) return { recreatedProjects: [] };
        await reopen();
        // A project that stays unavailable keys as it did: nothing to recreate.
        return { recreatedProjects: current.ok || state.ok ? [project.name] : [] };
      }
      current.graph.invalidate(changed);
      if (changed.some((p) => p.kind === "add" || p.kind === "delete")) {
        if (mayList(current.read, changed)) await relist(root, project, source, current);
      }
      return { recreatedProjects: [] };
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
      });
      return [environment];
    },
    async run(testFiles, runOptions) {
      if (!state.ok) return unavailable(`${label}: ${state.note}`);
      return runProject(state.install, testFiles, runOptions);
    },
    close: async () => {},
  };

  async function runProject(
    install: JestInstall,
    testFiles: readonly TestFileRef[],
    runOptions: RunOptions,
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
    const { report } = await runJest({
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
    });
    if (observe === null) return report;
    const seen = observedInputs(takeRecorded(out), report.completedFiles, paths);
    return seen.length === 0 ? report : { ...report, observed: seen };
  }
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

/** The config chain's files: a change of one reads the project again (D2.3). */
function watchedOf(
  root: AbsolutePath,
  project: JestProject,
  state: Opened,
  source: NodeJS.ProcessEnv,
): ReadonlySet<RelativePath> {
  const read: JestRead = state.ok
    ? state.read
    : { ok: false, error: "", configDeps: state.configDeps };
  const env =
    state.install === null ? source : projectProcessEnv(root, project, state.install, source);
  return new Set(configFiles(root, project, read, env));
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
