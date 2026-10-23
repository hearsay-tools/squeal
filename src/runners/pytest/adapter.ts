import { realpathSync, statSync } from "node:fs";
import { compare, sameList, toAbsolute, toRelative } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  InvalidatedPath,
  InvalidateResult,
  PytestProject,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import { focusedTexts } from "../focus.js";
import { type ProjectSettings, projectSettings, sameSettings } from "./adapter-config.js";
import {
  type AdapterEnvironment,
  admit,
  admitEnvironment,
  type Clock,
  environmentDir,
  environmentSignature,
  moving,
  projectEnvironment,
  structural,
} from "./adapter-environment.js";
import { listTestFiles } from "./adapter-files.js";
import { Observed, type ObservedStore } from "./adapter-observed.js";
import { currentFingerprint, runProject, unavailable } from "./adapter-run.js";
import { enumerate } from "./enumerate.js";
import { projectDir, readEnvironment, runEnvironment } from "./environment/index.js";
import { createPytestGraph, type PytestGraph } from "./graph/index.js";
import { PYTEST_ADAPTER_VERSION } from "./version.js";

export type { ObservedPaths, ObservedStore } from "./adapter-observed.js";
export { PYTEST_ADAPTER_VERSION };

export interface PytestAdapterOptions {
  /** The worktree root. */
  readonly root: AbsolutePath;
  /** Absent: observations live only as long as the adapter. */
  readonly observed?: ObservedStore;
  /**
   * Problem notes: D2's states, the graph's notes, incomplete closures, the
   * run's notes. D2's state notes and the ready note carry the topic
   * `pytest-environment:<project>`, so the latest replaces the earlier ones
   * in status (task 007-39).
   */
  readonly note?: (text: string, topic?: string) => void;
  /**
   * The text of a topic's latest stored note, as status lists it, so a
   * restart writes an environment note only when it changes the topic's
   * latest (task 007-41); default none.
   */
  readonly latestNote?: (topic: string) => string | undefined;
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
  /** Time for D2's admission (`admit`); default the real one. */
  readonly clock?: Clock;
}

/** How many incomplete closures one note names before it only counts. */
const NAMED_INCOMPLETE = 3;

/** What `reread` found: the environment moved, the graph's settings or directory moved. */
interface Moved {
  readonly moved: boolean;
  readonly rebuild: boolean;
}

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
 * environment is admitted (`admit`) at start and whenever a batch or the
 * scheduler's `recheck` at a quiet pass (task 007-26) finds it moved; a
 * ready one's recheck reads only its fingerprint. Every state but `ready`
 * keys `runnerVersion` "unavailable", runs nothing and notes why once, so
 * its checks are `unknown` and nothing is stored (D2). A changed state or
 * hash recreates the project, which re-keys it; so does a changed pytest
 * config, which also rebuilds the graph with its settings; an edit to the
 * config lists the test files again (task 007-42). A run whose
 * environment moved before or during it stores nothing and the environment
 * is admitted again at the next call (D2's sync state).
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
  // Task 007-39: each change of D2's state is noted, under one topic per project.
  const topic = `pytest-environment:${project.name}`;
  let told: string | null = null;
  const environmentNote = (text: string) => {
    if (text === told) return;
    told = text;
    if (options.latestNote?.(topic) !== text) raw(text, topic);
  };
  const ready = `${label}: its Python environment is ready`;
  const ref = (path: RelativePath): TestFileRef => ({ project: project.name, path });
  const source = options.source ?? process.env;

  const readNow = async () =>
    admitEnvironment(root, project, await readEnvironment(root, project, source));
  const settle = async () =>
    (await admit(project, readNow, currentFingerprint, options.clock)).environment;
  const place = () => {
    const dir = environmentDir(root, project);
    return { dir, settings: projectSettings(root, project, runEnvironment(dir, project, source)) };
  };
  let { dir, settings } = place();
  /** A run found the environment moved: the next call reads it again. */
  let stale = false;
  let files = isDirectory(cwd) ? listTestFiles(root, project, note) : [];
  let built: Built | null = null;
  let failure: string | null = null;

  const announce = (env: AdapterEnvironment) => {
    if (env.state !== "ready") environmentNote(env.note);
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

  // B2: the first admission settles as every later one; the graph builds meanwhile.
  let [environment] = await Promise.all([settle(), build()]);
  // Ready at start: noted only to replace another note an earlier daemon left on the topic.
  if (environment.state !== "ready") announce(environment);
  else if (options.latestNote?.(topic) !== undefined) environmentNote(ready);

  /** D2: reads the environment and the settings again; whether either moved. */
  const reread = async (): Promise<Moved> => {
    const next = { ...place(), environment };
    const raw = stale ? null : await readNow();
    next.environment = raw === null || moving(raw, environment) ? await settle() : raw;
    const moved =
      stale || environmentSignature(next.environment) !== environmentSignature(environment);
    const rebuild = next.dir !== dir || !sameSettings(next.settings, settings);
    stale = false;
    if (moved && next.environment.state === "ready" && environment.state !== "ready") {
      environmentNote(ready);
    }
    ({ environment, dir, settings } = next);
    if (moved) announce(environment);
    return { moved, rebuild };
  };
  const invalidate = async (paths: readonly InvalidatedPath[], { moved, rebuild }: Moved) => {
    // Task 007-42: an edit to the pytest config can change `norecursedirs` or `python_files`.
    const config = settings.config === null ? null : toRelative(root, settings.config.path);
    const relist =
      built === null || rebuild || paths.some((p) => p.kind !== "change" || p.path === config);
    if (relist) {
      const listed = isDirectory(cwd) ? listTestFiles(root, project, note) : [];
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
    const grew = built.observed.takeRecreate(paths.map((p) => p.path));
    return { recreatedProjects: moved || grew ? [project.name] : [] };
  };

  // Task 007-26: a ready environment that held still costs one fingerprint read, nothing else.
  const recheck = async (): Promise<InvalidateResult> => {
    const still =
      !stale &&
      environment.state === "ready" &&
      currentFingerprint(environment) === environment.fingerprint;
    if (still) return { recreatedProjects: [] };
    const moved = await reread();
    if (!moved.moved && !moved.rebuild) return { recreatedProjects: [] };
    return invalidate([], moved);
  };

  return {
    name: "pytest",
    adapterVersion: PYTEST_ADAPTER_VERSION,
    invalidate: async (paths) => invalidate(paths, await reread()),
    recheck,
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
      // Task 007-28: nothing under the environment, whose hash covers it and whose files uv hardlinks.
      const inside = [...new Set([...paths, ...extra])].filter((p) => !outside(p));
      return {
        testFile,
        paths: inside.sort(compare),
        packages: { imports: [], builtins: [] },
      };
    },
    enumerate: (testFile) =>
      enumerate(toAbsolute(root, testFile.path), testFile, settings.names).catch(() => []),
    testFiles: async () => (built === null ? [] : files.map(ref)),
    async environment() {
      if (stale) {
        stale = false;
        environment = await settle();
        announce(environment);
      }
      return [
        projectEnvironment({
          root,
          project,
          environment,
          adapterVersion: PYTEST_ADAPTER_VERSION,
          configFile: settings.config?.path ?? null,
          envDir: dir,
          // B5: what the plugins imported at start-up beyond their static closure too.
          pluginPaths: [
            ...pluginPaths(built, environment, settings),
            ...(built?.observed.sessionPaths() ?? []),
          ].filter((p) => !outside(p)),
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
      for (const text of outcome.run.notes) once(text);
      // Spec 011 C4 (row 011-145): a file given texts observes nothing, nor does a run of only
      // such files. It ran only some checks, and the file's own run that follows reads every path
      // they read. A file run whole beside one still records its own, and the session's.
      const whole = outcome.run.observed.filter(
        (seen) => focusedTexts(runOptions.checks, seen.testFile) === null,
      );
      if (testFiles.every((f) => focusedTexts(runOptions.checks, f) !== null)) {
        return outcome.report;
      }
      built.observed.record(whole, new Set(files));
      const plugins = pluginPaths(built, environment, settings);
      const session = built.observed.recordSession(outcome.run.session, plugins, files.length);
      if (session.length === 0) return outcome.report;
      // B5: the core stores nothing for a file whose key lacked one of these, re-keys and reruns it.
      return {
        ...outcome.report,
        environmentObserved: [{ project: project.name, paths: session }],
      };
    },
    // 007 D6 (row 011-135): `runPytest` takes `RunOptions.checks`.
    focuses: true,
    close: async () => {},
  };
}

/** D2: the closure inside the worktree of the `pytest11` plugins and the `-p` modules. */
function pluginPaths(
  built: Built | null,
  environment: AdapterEnvironment,
  settings: ProjectSettings,
): readonly RelativePath[] {
  if (built === null) return [];
  const modules = [
    ...(environment.state === "ready" ? environment.plugins.map((p) => p.module) : []),
    ...settings.pluginModules,
  ];
  return modules.length === 0 ? [] : built.graph.pluginClosure([...new Set(modules)]).paths;
}

function isDirectory(path: AbsolutePath): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
