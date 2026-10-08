import { basename, join } from "node:path";
import { compare, sameList, toAbsolute } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  NodeTestProject,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import type { NodeTestAdapterOptions } from "./adapter.js";
import { type NodeProbe, probeNode, projectEnvironment } from "./adapter-environment.js";
import { listTestFiles } from "./adapter-files.js";
import { Observed } from "./adapter-observed.js";
import { enumerate } from "./enumerate.js";
import { createNodeTestGraph, MANIFEST } from "./graph/index.js";
import { projectEnv } from "./recorders.js";
import { asyncLoaders, tokenizeNodeOptions } from "./run/node-options.js";
import type { ObservedClosure } from "./run/observed.js";
import { runNodeTest } from "./run/run.js";

/** One project as `createNodeTestAdapter` resolved it. */
export interface ProjectContext {
  readonly project: NodeTestProject;
  /** The worktree root, real path. */
  readonly root: AbsolutePath;
  /** The project's `cwd`, a directory. */
  readonly cwd: AbsolutePath;
  readonly adapterVersion: string;
  /** `node-test project "<name>"`. */
  readonly label: string;
  readonly options: NodeTestAdapterOptions;
  /** Notes prefixed with the project. */
  readonly note: (text: string) => void;
}

/** How many incomplete closures one note names before it only counts (review wave 2, N4). */
const NAMED_INCOMPLETE = 3;

/**
 * The adapter of one project whose graph builds: the static graph,
 * `runNodeTest` and `enumerate` in the call order of review wave 1's
 * inputs, and the paths runs loaded beyond the graph ({@link Observed}).
 * Rejects when the graph cannot be built; `createNodeTestAdapter` turns that
 * into the project's runner failure.
 */
export async function openProject(context: ProjectContext): Promise<RunnerAdapter> {
  const { project, root, cwd, options, note } = context;
  const ref = (path: RelativePath): TestFileRef => ({ project: project.name, path });

  let files = listTestFiles(root, project);
  // Node reads `NODE_OPTIONS` before argv: its preloads and loaders are the chain's too (003-22).
  const argv = [...nodeOptionsOf(project), ...project.argv];
  const [graph, firstProbe] = await Promise.all([
    createNodeTestGraph({ root, cwd, argv, testFiles: files }),
    probeNode(project, cwd),
  ]);
  let probe: NodeProbe = firstProbe;
  if (!probe.ok) note(`${probe.error}; every check of the project is unknown until it runs`);
  const observed = new Observed(graph, options.observed, note);

  const noted = new Set<string>();
  const once = (text: string) => {
    if (noted.has(text)) return;
    noted.add(text);
    note(text);
  };
  const notes = () => {
    for (const text of graph.notes()) once(text.replace(/^node-test: /, ""));
    for (const text of loaderThreadNotes(project)) once(text);
    // B1: what the preloads load by a computed specifier is known only after a run.
    for (const reason of graph.preloads().incomplete) once(`preload closure incomplete: ${reason}`);
    const incomplete = graph.incompleteClosures();
    if (incomplete.length > 0) {
      const named = incomplete
        .slice(0, NAMED_INCOMPLETE)
        .map(([file, reasons]) => `${file} (${reasons.join("; ")})`);
      const more = incomplete.length > NAMED_INCOMPLETE ? ", ..." : "";
      once(
        `${incomplete.length} test file(s) with an incomplete static closure, keyed by what their runs load: ${named.join(", ")}${more}`,
      );
    }
  };
  notes();
  /** Test files already named by {@link bareNote}. */
  const bare = new Set<RelativePath>();

  return {
    name: "node-test",
    adapterVersion: context.adapterVersion,
    async invalidate(paths) {
      observed.refresh();
      graph.invalidate(paths);
      if (paths.some((p) => p.kind !== "change")) {
        const next = listTestFiles(root, project);
        if (!sameList(next, files)) {
          files = next;
          graph.setTestFiles(files);
        }
      }
      notes();
      const recreate = observed.takeRecreate(paths.map((p) => p.path));
      if (!probe.ok) {
        probe = await probeNode(project, cwd);
        if (probe.ok) {
          note(`${project.node ?? "node"} runs again (${probe.version})`);
          return { recreatedProjects: [project.name] };
        }
      }
      return { recreatedProjects: recreate ? [project.name] : [] };
    },
    async affected(changed) {
      observed.refresh();
      const { direct, transitive } = graph.affected(changed);
      const grown = observed.takeGrown(new Set(files)).filter((f) => !direct.includes(f));
      const rest = [...new Set([...transitive, ...grown])].sort(compare);
      return { direct: direct.map(ref), transitive: rest.map(ref) };
    },
    async closure(testFile) {
      observed.refresh();
      const closure = graph.closure(testFile.path);
      const extra = observed.of(testFile.path);
      const paths =
        extra === undefined ? closure.paths : [...new Set([...closure.paths, ...extra])];
      return {
        testFile,
        paths: [...paths].sort(compare),
        packages: graph.packages(testFile.path),
      };
    },
    enumerate: (testFile) => enumerate(toAbsolute(root, testFile.path), testFile),
    testFiles: async () => files.map(ref),
    async environment() {
      const preloads = [...new Set([...graph.preloads().paths, ...observed.preloads()])];
      const packages = graph.environmentPackages();
      return [
        projectEnvironment(
          root,
          project,
          probe,
          preloads.sort(compare),
          context.adapterVersion,
          packages,
        ),
      ];
    },
    async run(testFiles, runOptions): Promise<RunReport> {
      if (!probe.ok) return unavailable(`${context.label}: ${probe.error}`);
      const tempDir = options.tempDir;
      const { report, observed: seen } = await runNodeTest({
        root,
        project,
        files: testFiles,
        logDir: join(runOptions.logDir, "node-test", encodeURIComponent(project.name)),
        timeoutMs: runOptions.timeoutMs,
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency() }),
        ...(tempDir === undefined
          ? {}
          : { env: { ...process.env, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir } }),
      });
      observed.record(seen, new Set(files));
      const named = bareNote(seen, bare);
      if (named !== null) note(named);
      return report;
    },
    close: async () => {},
  };
}

/**
 * The tokens of the `NODE_OPTIONS` the project's processes get, without
 * Squeal's own recorders (task 003-35); none when Node would reject it.
 */
function nodeOptionsOf(project: NodeTestProject): string[] {
  return tokenizeNodeOptions(projectEnv(project, process.env).NODE_OPTIONS ?? "") ?? [];
}

/**
 * One note per async loader of the project's argv or `NODE_OPTIONS` (review
 * wave 2.6, S1): the recorder skips Node's loader thread, so what the loader
 * loads is in no key unless declared. `module.register` shows in no flag; a
 * preload whose closure imports `node:module` has the graph's note (review
 * wave 2.7, S1).
 */
function loaderThreadNotes(project: NodeTestProject): string[] {
  const loaders = [...asyncLoaders(project.argv), ...asyncLoaders(nodeOptionsOf(project))];
  return [...new Set(loaders)].map(
    (loader) =>
      `async loader ${JSON.stringify(loader)}: Squeal does not record in Node's loader thread, so what the loader loads enters no key; declare it in inputs`,
  );
}

/**
 * Lessons.md defect 6: test files whose run loaded nothing beyond themselves
 * and a manifest, each named once (`named`), so their author can declare
 * what they reach through a spawned process or a `readFileSync` in
 * `inputs`. `null` when this run found none not named before.
 */
function bareNote(seen: readonly ObservedClosure[], named: Set<RelativePath>): string | null {
  const found = seen
    .filter(({ testFile, paths }) =>
      paths.every((p) => p === testFile.path || MANIFEST.test(basename(p))),
    )
    .map((c) => c.testFile.path)
    .filter((path) => !named.has(path));
  if (found.length === 0) return null;
  for (const path of found) named.add(path);
  return `${found.length} test file(s) loaded nothing beyond themselves and a manifest when they ran, so what they reach through a spawned process or a file read enters no key; declare it in inputs: ${found.sort(compare).join(", ")}`;
}

/** A run of a project that cannot run: nothing completed (001 D12). */
export function unavailable(failure: string): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure,
  };
}
