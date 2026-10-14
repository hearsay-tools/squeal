import { realpathSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import type {
  AbsolutePath,
  InvalidatedPath,
  NodeTestProject,
  RelativePath,
  RunnerAdapter,
} from "../../core/types/index.js";
import { projectEnvironment } from "./adapter-environment.js";
import { projectCwd } from "./adapter-files.js";
import { openProject, type ProjectContext, unavailable } from "./adapter-project.js";
import { NODE_TEST_ADAPTER_VERSION } from "./version.js";

export { NODE_TEST_ADAPTER_VERSION };

/** Observed-only paths per test file of one project, worktree-relative (spec 003 D3). */
export type ObservedPaths = Readonly<Record<RelativePath, readonly RelativePath[]>>;

/**
 * The project's `nodeTest.observed.<project>` and
 * `nodeTest.observedPreloads.<project>` meta keys, kept by the daemon so the
 * adapter never opens the store (spec 003 D3 as amended).
 */
export interface ObservedStore {
  /**
   * Every worktree's observations so far: read when the adapter starts and
   * again at each refinement (review wave 2, S2), so it must be cheap.
   */
  read(): ObservedPaths;
  /** Merges `additions` into the key in one transaction. */
  write(additions: ObservedPaths): void;
  /** Paths the project's preloads loaded outside their static closure, every worktree's (B1). */
  readPreloads(): readonly RelativePath[];
  /** Merges `additions` into the preload key in one transaction. */
  writePreloads(additions: readonly RelativePath[]): void;
}

export interface NodeTestAdapterOptions {
  /** The worktree root. */
  readonly root: AbsolutePath;
  /** Absent: observations live only as long as the adapter. */
  readonly observed?: ObservedStore;
  /**
   * Problem notes: a missing Node or `cwd`, a graph that cannot be built, an
   * unrecognized loader, incomplete closures, a failed observation write.
   */
  readonly note?: (text: string) => void;
  /**
   * Processes at once, read per run: policy `runner.tierSize`. Default every
   * file of the tier; a slow lane's run always starts every file (task 004-37).
   */
  readonly concurrency?: () => number;
  /** Spec 001 D10: the daemon's temp directory, every child's `TMPDIR`, `TMP` and `TEMP`. */
  readonly tempDir?: AbsolutePath;
  /**
   * Spec 001 D12: the mark every child carries so the daemon finds what a
   * test leaves running, as its Vitest workers do (task 003-38).
   */
  readonly childEnv?: Readonly<Record<string, string>>;
}

/**
 * The node:test adapter of one configured project (spec 003 D1 to D6); see
 * `openProject`. Never rejects for the project's sake: D1, "a bad entry is a
 * problem note with that project skipped, never a crash", and the composite
 * rejects a call as a whole when one adapter rejects (review wave 2, S1).
 *
 * A project whose `cwd` is not a directory, or whose graph cannot be built,
 * lists no files, keys `runnerVersion` "unavailable", and notes why once.
 * Each batch that could change that (the directory appears, or a path under
 * it changed) builds it again; the first that succeeds recreates the project.
 *
 * A Node that cannot run is D1's runner failure for this project only: one
 * note, `runnerVersion` "unavailable", and every run of its files `crashed`,
 * so its checks go `unknown`. Each batch probes again; the first that finds
 * it recreates the project, which re-keys it.
 */
export async function createNodeTestAdapter(
  project: NodeTestProject,
  options: NodeTestAdapterOptions,
): Promise<RunnerAdapter> {
  const root = realpathSync(options.root);
  const cwd = projectCwd(root, project);
  const where = slashes(relative(root, cwd)) || ".";
  const label = `node-test project ${JSON.stringify(project.name)}`;
  const note = options.note ?? (() => {});
  const context: ProjectContext = {
    project,
    root,
    cwd,
    label,
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
    options,
    note: (text) => note(`${label}: ${text}`),
  };

  let inner: RunnerAdapter | null = null;
  /** Why the project cannot be built; `missing` when its `cwd` is no directory. */
  let failure: { readonly text: string; readonly missing: boolean } | null = null;
  const attempt = async (): Promise<boolean> => {
    const previous = failure?.text;
    if (!isDirectory(cwd)) {
      failure = { text: `cwd ${where} is not a directory`, missing: true };
    } else {
      try {
        inner = await openProject(context);
        failure = null;
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failure = { text: `its module graph cannot be built: ${reason}`, missing: false };
      }
    }
    if (failure.text !== previous) {
      context.note(`${failure.text}; the project is skipped until that changes`);
    }
    return false;
  };
  await attempt();

  /** A batch that may fix the project: its directory appeared, or a path under it changed. */
  const mayFix = (paths: readonly InvalidatedPath[]) =>
    failure?.missing === true
      ? isDirectory(cwd)
      : where === "." || paths.some((p) => p.path.startsWith(`${where}/`));

  const broken = () => failure?.text ?? "not started";
  return {
    name: "node-test",
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
    async invalidate(paths) {
      if (inner !== null) return inner.invalidate(paths);
      if (!mayFix(paths) || !(await attempt())) return { recreatedProjects: [] };
      context.note(`${where} builds again; the project started`);
      return { recreatedProjects: [project.name] };
    },
    affected: async (changed) =>
      inner === null ? { direct: [], transitive: [] } : inner.affected(changed),
    async closure(testFile) {
      if (inner === null) throw new Error(`${label}: ${broken()}`);
      return inner.closure(testFile);
    },
    enumerate: async (testFile) => (inner === null ? [] : inner.enumerate(testFile)),
    testFiles: async () => (inner === null ? [] : inner.testFiles()),
    environment: async () =>
      inner === null
        ? [
            projectEnvironment(
              root,
              project,
              { ok: false, error: broken() },
              [],
              NODE_TEST_ADAPTER_VERSION,
            ),
          ]
        : inner.environment(),
    run: async (testFiles, runOptions) =>
      inner === null ? unavailable(`${label}: ${broken()}`) : inner.run(testFiles, runOptions),
    close: async () => inner?.close(),
  };
}

function isDirectory(path: AbsolutePath): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
