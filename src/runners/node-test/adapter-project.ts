import { basename, join } from "node:path";
import { compare, sameList, toAbsolute } from "../../core/fs/index.js";
import { isInputList } from "../../core/keys/closure.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import {
  type AbsolutePath,
  isSlowLane,
  type NodeTestProject,
  type PolicyInputs,
  type RelativePath,
  type RunnerAdapter,
  type RunReport,
  type TestFileRef,
} from "../../core/types/index.js";
import { asyncLoaders, tokenizeNodeOptions } from "../process/node-options.js";
import type { NodeTestAdapterOptions } from "./adapter.js";
import { type NodeProbe, probeNode, projectEnvironment } from "./adapter-environment.js";
import { listTestFiles } from "./adapter-files.js";
import { ProjectCoverage } from "./coverage.js";
import { enumerate } from "./enumerate.js";
import { createNodeTestGraph, MANIFEST } from "./graph/index.js";
import { projectEnv } from "./recorders.js";
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
  /** Notes prefixed with the project; a `topic`'s latest note replaces its earlier ones (007-39). */
  readonly note: (text: string, topic?: string) => void;
}

/** How many incomplete closures one note names before it only counts (review wave 2, N4). */
const NAMED_INCOMPLETE = 3;

/**
 * The adapter of one project whose graph builds: the static graph,
 * `runNodeTest` and `enumerate` in the call order of review wave 1's
 * inputs. What runs loaded beyond the graph it reports to the core
 * (`RunReport.observed`, `environmentObserved`), which keeps it, joins it to
 * closures and environments and marks `direct` (spec 016 D4); the adapter
 * keeps none of it. Rejects when the graph cannot be built;
 * `createNodeTestAdapter` turns that into the project's runner failure.
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
  const coverage = new ProjectCoverage(options.coverage, argv, note);

  const noted = new Set<string>();
  const once = (text: string, topic?: string) => {
    if (noted.has(text)) return;
    noted.add(text);
    note(text, topic);
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
      // Task 001-413: one per project, however many daemons started and wrote it.
      once(
        `${incomplete.length} test file(s) with an incomplete static closure, keyed by what their runs load: ${named.join(", ")}${more}`,
        `node-test-closure:${project.name}`,
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
      graph.invalidate(paths);
      if (paths.some((p) => p.kind !== "change")) {
        const next = listTestFiles(root, project);
        if (!sameList(next, files)) {
          files = next;
          graph.setTestFiles(files);
        }
      }
      notes();
      if (!probe.ok) {
        probe = await probeNode(project, cwd);
        if (probe.ok) {
          note(`${project.node ?? "node"} runs again (${probe.version})`);
          return { recreatedProjects: [project.name] };
        }
      }
      // Row 015-86: a policy that turned coverage on or off re-keys the project's checks once.
      return { recreatedProjects: coverage.changed() ? [project.name] : [] };
    },
    async affected(changed) {
      const { direct, transitive } = graph.affected(changed);
      return { direct: direct.map(ref), transitive: transitive.map(ref) };
    },
    async closure(testFile) {
      const closure = graph.closure(testFile.path);
      return { testFile, paths: closure.paths, packages: graph.packages(testFile.path) };
    },
    enumerate: (testFile) => enumerate(toAbsolute(root, testFile.path), testFile),
    testFiles: async () => files.map(ref),
    async environment() {
      const packages = graph.environmentPackages();
      return [
        projectEnvironment(
          root,
          project,
          probe,
          graph.preloads().paths,
          context.adapterVersion,
          packages,
          coverage.key(),
        ),
      ];
    },
    async run(testFiles, runOptions): Promise<RunReport> {
      if (!probe.ok) return unavailable(`${context.label}: ${probe.error}`);
      const env = childEnvOf(options, runOptions.childEnv);
      const covered = coverage.covered(graph);
      const {
        report: ran,
        observed: seen,
        reads,
        coverage: payloads,
      } = await runNodeTest({
        root,
        project,
        files: testFiles,
        logDir: join(runOptions.logDir, "node-test", encodeURIComponent(project.name)),
        timeoutMs: runOptions.timeoutMs,
        // A slow tier starts every file it holds (004 D2, D4): the scheduler sized it to the
        // slot's permits, and a file queued here would start after an edit or a close.
        ...(options.concurrency === undefined || slowLane(runOptions.lane)
          ? {}
          : { concurrency: options.concurrency() }),
        ...(env === undefined ? {} : { env }),
        ...(runOptions.observeIgnored === true ? { observeIgnored: true } : {}),
        ...(runOptions.stop === undefined ? {} : { signal: runOptions.stop }),
        ...(covered === undefined ? {} : { covered }),
      });
      coverage.collect(runOptions.runId, payloads ?? [], root);
      const named = bareNote(seen, bare, declaresInputs(options.inputs?.() ?? []));
      if (named !== null) note(named);
      const observed = observedOf(seen, files, graph.preloads().paths);
      return { ...ran, ...(reads === undefined ? {} : { reads }), ...observed };
    },
    close: async () => {},
  };
}

/**
 * Spec 016 D4: what each completed, listed file loaded, per file in
 * `observed`, and what its preloads loaded beyond `preloadStatic`, their
 * static closure, for the project in `environmentObserved`: every such path
 * of the run, keyed or not, so the core stores nothing for a file whose key
 * lacked one and runs it again under the key that holds it (task 003-43).
 */
function observedOf(
  seen: readonly ObservedClosure[],
  files: readonly RelativePath[],
  preloadStatic: readonly RelativePath[],
): Pick<RunReport, "observed" | "environmentObserved"> {
  const listed = new Set(files);
  const own = seen.filter((c) => listed.has(c.testFile.path));
  const project = own[0]?.testFile.project;
  const known = new Set(preloadStatic);
  const preloads = [...new Set(own.flatMap((c) => c.preloadPaths))]
    .filter((path) => !known.has(path))
    .sort(compare);
  const observed = own.map(({ testFile, paths, direct, written }) => ({
    testFile,
    paths,
    directories: [],
    ...(direct.length > 0 ? { direct } : {}),
    ...(written.length > 0 ? { written } : {}),
  }));
  return {
    ...(observed.length > 0 ? { observed } : {}),
    ...(project === undefined || preloads.length === 0
      ? {}
      : { environmentObserved: [{ project, paths: preloads }] }),
  };
}

/** A run in a slow file's lane (task 004-18). */
function slowLane(lane: string | undefined): boolean {
  return lane !== undefined && isSlowLane(lane);
}

/**
 * The inherited env with the daemon's temp directory and child mark, the
 * run's lane mark over the adapter's (task 004-18); absent when none is given.
 */
function childEnvOf(
  options: NodeTestAdapterOptions,
  runEnv: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv | undefined {
  const { tempDir, childEnv } = options;
  if (tempDir === undefined && childEnv === undefined && runEnv === undefined) return undefined;
  return {
    ...process.env,
    ...childEnv,
    ...runEnv,
    ...(tempDir === undefined ? {} : { TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir }),
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
 * `inputs`. A file `declared` already has inputs for is left out, silently
 * (task 001-365): its declaration is not proof that every read is covered.
 * `null` when this run found none not named before.
 */
function bareNote(
  seen: readonly ObservedClosure[],
  named: Set<RelativePath>,
  declared: (testFile: RelativePath) => boolean,
): string | null {
  const found = seen
    .filter(({ testFile, paths }) =>
      paths.every((p) => p === testFile.path || MANIFEST.test(basename(p))),
    )
    .map((c) => c.testFile.path)
    .filter((path) => !named.has(path) && !declared(path));
  if (found.length === 0) return null;
  for (const path of found) named.add(path);
  return `${found.length} test file(s) loaded nothing beyond themselves and a manifest when they ran, so what they reach through a spawned process or a file read enters no key; declare it in inputs: ${found.sort(compare).join(", ")}`;
}

/**
 * Whether policy `inputs` declare an input glob for a test file: a list
 * applies to every test file, a map entry to those its test-file glob
 * matches (001 D11 as amended). An entry whose globs select no file is the
 * scheduler's unmatched-inputs note, not this one's.
 */
function declaresInputs(inputs: PolicyInputs): (testFile: RelativePath) => boolean {
  if (isInputList(inputs)) return () => inputs.length > 0;
  return createInputMatcher(
    Object.entries(inputs).flatMap(([testGlob, globs]) => (globs.length > 0 ? [testGlob] : [])),
  );
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
