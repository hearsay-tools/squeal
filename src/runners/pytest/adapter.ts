import { realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { compare, sameList, toAbsolute, toRelative } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  InvalidatedPath,
  PytestProject,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import { type ProjectSettings, projectSettings, sameSettings } from "./adapter-config.js";
import { environmentDir, environmentSignature, projectEnvironment } from "./adapter-environment.js";
import { listTestFiles } from "./adapter-files.js";
import { Observed, type ObservedStore } from "./adapter-observed.js";
import { runProject, unavailable } from "./adapter-run.js";
import { enumerate } from "./enumerate.js";
import {
  type PytestEnvironment,
  projectDir,
  readEnvironment,
  runEnvironment,
} from "./environment/index.js";
import { createPytestGraph, type PytestGraph } from "./graph/index.js";
import { PYTEST_ADAPTER_VERSION } from "./version.js";

export type { ObservedPaths, ObservedStore } from "./adapter-observed.js";
export { PYTEST_ADAPTER_VERSION };

export interface PytestAdapterOptions {
  /** The worktree root. */
  readonly root: AbsolutePath;
  /** Absent: observations live only as long as the adapter. */
  readonly observed?: ObservedStore;
  /** Problem notes: D2's states, the graph's notes, incomplete closures, the run's notes. */
  readonly note?: (text: string) => void;
  /** Batches at once, read per run: policy `runner.tierSize`. Default every batch. */
  readonly concurrency?: () => number;
  /** Files per batch, read per run (D6); default 5. */
  readonly batchSize?: () => number;
  /** Spec 001 D10: the daemon's temp directory, every child's `TMPDIR`, `TMP` and `TEMP`. */
  readonly tempDir?: AbsolutePath;
  /** Spec 001 D12: the mark every child carries. */
  readonly childEnv?: Readonly<Record<string, string>>;
  /**
   * pytest's cache and the bytecode of this worktree's project, under
   * Squeal's state directory (007 status, open question 3). Default under
   * the OS temp directory.
   */
  readonly cacheDir?: AbsolutePath;
  /** The environment runs inherit before D2's clean-up; default the daemon's. */
  readonly source?: NodeJS.ProcessEnv;
}

/** How many incomplete closures one note names before it only counts. */
const NAMED_INCOMPLETE = 3;

/** The graph of a project whose `cwd` exists, with what its runs observed beyond it. */
interface Built {
  readonly graph: PytestGraph;
  readonly observed: Observed;
}

/**
 * The pytest adapter of one configured project (spec 007 D2 to D7). Never
 * rejects for the project's sake, as 003's adapter does not.
 *
 * The graph builds with or without an environment (D4, as amended). The
 * environment is read from files at start and at every batch: every state
 * but `ready` keys `runnerVersion` "unavailable", runs nothing and notes
 * why once, so its checks are `unknown` and nothing is stored (D2). A
 * changed state or hash recreates the project, which re-keys it; so does a
 * changed pytest config, which also rebuilds the graph with its settings.
 * A run whose environment moved before or during it stores nothing and
 * reads the environment again at the next batch (D2's sync state).
 */
export async function createPytestAdapter(
  project: PytestProject,
  options: PytestAdapterOptions,
): Promise<RunnerAdapter> {
  const root = realpathSync(options.root);
  const cwd = projectDir(root, project);
  const label = `pytest project ${JSON.stringify(project.name)}`;
  const raw = options.note ?? (() => {});
  const noted = new Set<string>();
  const once = (text: string) => {
    if (noted.has(text)) return;
    noted.add(text);
    raw(text);
  };
  const note = (text: string) => once(`${label}: ${text}`);
  const ref = (path: RelativePath): TestFileRef => ({ project: project.name, path });
  const source = options.source ?? process.env;

  const read = async () => {
    const dir = environmentDir(root, project);
    return {
      environment: await readEnvironment(root, project, source),
      dir,
      settings: projectSettings(root, project, runEnvironment(dir, project, source)),
    };
  };
  let { environment, dir, settings } = await read();
  /** A run found the environment moved: the next call reads it again. */
  let stale = false;
  let files = isDirectory(cwd) ? listTestFiles(root, project) : [];
  let built: Built | null = null;
  let failure: string | null = null;

  const announce = (env: PytestEnvironment) => {
    if (env.state !== "ready") once(env.note);
  };
  const build = async (): Promise<boolean> => {
    const previous = failure;
    if (!isDirectory(cwd)) failure = `cwd ${toRelative(root, cwd) ?? cwd} is not a directory`;
    else {
      try {
        const graph = await createPytestGraph({
          root,
          cwd,
          env: dir,
          testFiles: files,
          rootdir: settings.rootdir,
          importMode: settings.importMode,
          pythonpath: settings.pythonpath,
          configFile: settings.config?.path ?? null,
        });
        built = { graph, observed: new Observed(graph, options.observed, outside, note) };
        failure = null;
        notes();
        return true;
      } catch (error) {
        failure = `its module graph cannot be built: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (failure !== previous) note(`${failure}; the project is skipped until that changes`);
    built = null;
    return false;
  };
  /** Paths under the environment: its hash covers them, so no closure holds them. */
  const outside = (path: RelativePath) => {
    const env = toRelative(root, dir);
    return env !== null && (path === env || path.startsWith(`${env}/`));
  };
  const notes = () => {
    if (built === null) return;
    for (const text of built.graph.notes()) note(text.replace(/^pytest: /, ""));
    const incomplete = built.graph.incompleteClosures();
    if (incomplete.length === 0) return;
    const named = incomplete
      .slice(0, NAMED_INCOMPLETE)
      .map(([file, reasons]) => `${file} (${reasons.join("; ")})`);
    const more = incomplete.length > NAMED_INCOMPLETE ? ", ..." : "";
    note(
      `${incomplete.length} test file(s) with an incomplete static closure, keyed by what their runs import: ${named.join(", ")}${more}`,
    );
  };

  announce(environment);
  await build();

  return {
    name: "pytest",
    adapterVersion: PYTEST_ADAPTER_VERSION,
    async invalidate(paths) {
      const next = await read();
      const moved =
        stale || environmentSignature(next.environment) !== environmentSignature(environment);
      const rebuild = next.dir !== dir || !sameSettings(next.settings, settings);
      stale = false;
      if (moved && next.environment.state === "ready" && environment.state !== "ready") {
        note("its Python environment is ready");
      }
      ({ environment, dir, settings } = next);
      if (moved) announce(environment);
      if (paths.some((p) => p.kind !== "change") || built === null) {
        const listed = isDirectory(cwd) ? listTestFiles(root, project) : [];
        if (!sameList(listed, files)) {
          files = listed;
          built?.graph.setTestFiles(files);
        }
      }
      if (built === null || rebuild) {
        const was = built !== null;
        if (!(await build())) return { recreatedProjects: was ? [project.name] : [] };
        return { recreatedProjects: [project.name] };
      }
      built.observed.refresh();
      built.graph.invalidate(moved ? [...paths, ...structural(root, dir)] : paths);
      notes();
      return { recreatedProjects: moved ? [project.name] : [] };
    },
    async affected(changed) {
      if (built === null) return { direct: [], transitive: [] };
      built.observed.refresh();
      const { direct, transitive } = built.graph.affected(changed);
      const grown = built.observed.takeGrown(new Set(files)).filter((f) => !direct.includes(f));
      const rest = [...new Set([...transitive, ...grown])].sort(compare);
      return { direct: direct.map(ref), transitive: rest.map(ref) };
    },
    async closure(testFile) {
      if (built === null) throw new Error(`${label}: ${failure ?? "not started"}`);
      built.observed.refresh();
      const { paths } = built.graph.closure(testFile.path);
      const extra = built.observed.of(testFile.path) ?? [];
      return {
        testFile,
        paths: [...new Set([...paths, ...extra])].sort(compare),
        packages: { imports: [], builtins: [] },
      };
    },
    enumerate: (testFile) =>
      enumerate(toAbsolute(root, testFile.path), testFile, settings.names).catch(() => []),
    testFiles: async () => (built === null ? [] : files.map(ref)),
    async environment() {
      if (stale) {
        stale = false;
        ({ environment } = await read());
      }
      return [
        projectEnvironment({
          root,
          project,
          environment,
          adapterVersion: PYTEST_ADAPTER_VERSION,
          configFile: settings.config?.path ?? null,
          envDir: dir,
          pluginPaths: pluginPaths(built, environment, settings).filter((p) => !outside(p)),
        }),
      ];
    },
    async run(testFiles, runOptions): Promise<RunReport> {
      if (built === null) return unavailable(`${label}: ${failure ?? "not started"}`);
      if (environment.state !== "ready") return unavailable(environment.note);
      const outcome = await runProject(
        { root, project, environment, names: settings.names, options },
        testFiles,
        runOptions,
      );
      if (outcome.kind === "moved") {
        stale = true;
        once(outcome.report.failure ?? "");
        return outcome.report;
      }
      built.observed.record(outcome.run.observed, new Set(files));
      for (const text of outcome.run.notes) once(text);
      return outcome.report;
    },
    close: async () => {},
  };
}

/** D2: the closure inside the worktree of the `pytest11` plugins and the `-p` modules. */
function pluginPaths(
  built: Built | null,
  environment: PytestEnvironment,
  settings: ProjectSettings,
): readonly RelativePath[] {
  if (built === null) return [];
  const modules = [
    ...(environment.state === "ready" ? environment.plugins.map((p) => p.module) : []),
    ...settings.pluginModules,
  ];
  return modules.length === 0 ? [] : built.graph.pluginClosure([...new Set(modules)]).paths;
}

/** A change to `pyvenv.cfg`, which re-derives the graph's search path (D5). */
function structural(root: AbsolutePath, dir: AbsolutePath): InvalidatedPath[] {
  // An environment outside the worktree too: the graph reads the name, not the place.
  return [{ path: relative(root, join(dir, "pyvenv.cfg")).split(sep).join("/"), kind: "change" }];
}

function isDirectory(path: AbsolutePath): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
