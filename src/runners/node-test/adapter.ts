import { realpathSync } from "node:fs";
import { join } from "node:path";
import { compare, sameList, toAbsolute } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  NodeTestProject,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import { type NodeProbe, probeNode, projectEnvironment } from "./adapter-environment.js";
import { listTestFiles, projectCwd } from "./adapter-files.js";
import { enumerate } from "./enumerate.js";
import { createNodeTestGraph } from "./graph/index.js";
import type { ObservedClosure } from "./run/observed.js";
import { runNodeTest } from "./run/run.js";

/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check (001 D3).
 */
export const NODE_TEST_ADAPTER_VERSION = "1";

/** Observed-only paths per test file of one project, worktree-relative (spec 003 D3). */
export type ObservedPaths = Readonly<Record<RelativePath, readonly RelativePath[]>>;

/**
 * The project's `nodeTest.observed.<project>` meta key, kept by the daemon so
 * the adapter never opens the store (spec 003 D3 as amended).
 */
export interface ObservedStore {
  /** Every worktree's observations so far; read once, when the adapter starts. */
  read(): ObservedPaths;
  /** Merges `additions` into the key in one transaction. */
  write(additions: ObservedPaths): void;
}

export interface NodeTestAdapterOptions {
  /** The worktree root. */
  readonly root: AbsolutePath;
  /** Absent: observations live only as long as the adapter. */
  readonly observed?: ObservedStore;
  /** Problem notes: a missing Node, an unrecognized loader, a failed observation write. */
  readonly note?: (text: string) => void;
  /** Processes at once, read per run: policy `runner.tierSize`. Default every file of the tier. */
  readonly concurrency?: () => number;
  /** Spec 001 D10: the daemon's temp directory, every child's `TMPDIR`, `TMP` and `TEMP`. */
  readonly tempDir?: AbsolutePath;
}

/**
 * The node:test adapter of one configured project (spec 003 D1 to D6),
 * assembled from the static graph, `runNodeTest` and `enumerate` in the call
 * order of review wave 1's inputs: `invalidate` before `affected`,
 * `setTestFiles` after a listing change, one `logDir` subdirectory per
 * project, and the observed paths a run loaded outside the static closure
 * recorded in the graph, the store and later closures.
 *
 * A Node that cannot run is D1's runner failure for this project only: one
 * note, `runnerVersion` "unavailable", and every run of its files `crashed`,
 * so its checks go `unknown`. Each batch probes again; the first that finds
 * it recreates the project, which re-keys it. Rejects only when the graph
 * cannot be built.
 */
export async function createNodeTestAdapter(
  project: NodeTestProject,
  options: NodeTestAdapterOptions,
): Promise<RunnerAdapter> {
  const root = realpathSync(options.root);
  const cwd = projectCwd(root, project);
  const note = options.note ?? (() => {});
  const label = `node-test project ${JSON.stringify(project.name)}`;
  const ref = (path: RelativePath): TestFileRef => ({ project: project.name, path });

  let files = listTestFiles(root, project);
  const [graph, firstProbe] = await Promise.all([
    createNodeTestGraph({ root, cwd, argv: project.argv, testFiles: files }),
    probeNode(project, cwd),
  ]);
  let probe: NodeProbe = firstProbe;
  if (!probe.ok)
    note(`${label}: ${probe.error}; every check of the project is unknown until it runs`);

  const observed = new Map<RelativePath, Set<RelativePath>>();
  for (const [testFile, paths] of Object.entries(options.observed?.read() ?? {})) {
    observed.set(testFile, new Set(paths));
    graph.recordObserved(testFile, paths);
  }

  const noted = new Set<string>();
  const notes = () => {
    for (const text of graph.notes()) {
      if (noted.has(text)) continue;
      noted.add(text);
      note(`${label}: ${text}`);
    }
  };
  notes();

  /** D3, D5: what each completed file loaded beyond its static closure joins its closure. */
  const record = (seen: readonly ObservedClosure[]) => {
    const listed = new Set(files);
    const additions: Record<RelativePath, RelativePath[]> = {};
    for (const { testFile, paths } of seen) {
      if (!listed.has(testFile.path)) continue;
      const known = observed.get(testFile.path) ?? new Set<RelativePath>();
      const closure = new Set(graph.closure(testFile.path).paths);
      const added = paths.filter((p) => !closure.has(p) && !known.has(p));
      if (added.length === 0) continue;
      for (const path of added) known.add(path);
      observed.set(testFile.path, known);
      graph.recordObserved(testFile.path, [...known]);
      additions[testFile.path] = added;
    }
    if (Object.keys(additions).length === 0 || options.observed === undefined) return;
    try {
      options.observed.write(additions);
    } catch (error) {
      note(`${label}: could not store observed paths: ${String(error)}`);
    }
  };

  return {
    name: "node-test",
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
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
      if (probe.ok) return { recreatedProjects: [] };
      probe = await probeNode(project, cwd);
      if (!probe.ok) return { recreatedProjects: [] };
      note(`${label}: ${project.node ?? "node"} runs again (${probe.version})`);
      return { recreatedProjects: [project.name] };
    },
    async affected(changed) {
      const { direct, transitive } = graph.affected(changed);
      return { direct: direct.map(ref), transitive: transitive.map(ref) };
    },
    async closure(testFile) {
      const closure = graph.closure(testFile.path);
      const extra = observed.get(testFile.path);
      const paths =
        extra === undefined ? closure.paths : [...new Set([...closure.paths, ...extra])];
      return { testFile, paths: [...paths].sort(compare) };
    },
    enumerate: (testFile) => enumerate(toAbsolute(root, testFile.path), testFile),
    testFiles: async () => files.map(ref),
    environment: async () => [
      projectEnvironment(root, project, probe, graph.preloads().paths, NODE_TEST_ADAPTER_VERSION),
    ],
    async run(testFiles, runOptions): Promise<RunReport> {
      if (!probe.ok) return unavailable(`${label}: ${probe.error}`);
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
      record(seen);
      return report;
    },
    close: async () => {},
  };
}

/** A run of a project whose Node cannot run: nothing completed (001 D12). */
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
