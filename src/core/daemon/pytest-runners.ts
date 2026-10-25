import { createHash } from "node:crypto";
import { join } from "node:path";
import { createPytestAdapter, PYTEST_ADAPTER_VERSION } from "../../runners/pytest/adapter.js";
import { DEFAULT_BATCH_SIZE } from "../../runners/pytest/run/run.js";
import type { AbsolutePath, ProjectName, PytestProject } from "../types/index.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";
import { createRunnerSet, type RunnerSet } from "./runner-set.js";

/**
 * Where one worktree's project keeps pytest's cache and its bytecode
 * (`PYTHONPYCACHEPREFIX`): under Squeal's state directory, so a warm prefix
 * outlives the daemon's temp directory (007 status, open question 3: a cold
 * one costs 0.7 to 0.9 s once per worktree, project and Python).
 */
export function pytestCacheDir(
  stateDir: AbsolutePath,
  root: AbsolutePath,
  project: ProjectName,
): AbsolutePath {
  const id = createHash("sha256").update(`${root}\0${project}`).digest("hex").slice(0, 16);
  return join(stateDir, "pytest", id);
}

export interface PytestRunnersOptions {
  readonly root: AbsolutePath;
  /** Squeal's state directory, `<common-dir>/squeal/`: pytest's cache and bytecode go under it. */
  readonly stateDir: AbsolutePath;
  /** Spec 001 D10: the daemon's temp directory, the children's `TMPDIR`. */
  readonly tempDir: AbsolutePath;
  /** Spec 001 D12: the mark the daemon's sweep finds a test's leftovers by. */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  /** A note, with the topic that replaces the project's earlier note on it (task 007-39). */
  readonly note: (text: string, topic?: string) => void;
  /** A topic's latest stored note (the adapter's `latestNote`). */
  readonly latestNote?: (topic: string) => string | undefined;
}

/**
 * One runner per `pytest` entry (spec 007 D8, 003 D7), each behind
 * `createRecoveringRunner` as node:test's are: building the graph waits for
 * the first call or `open()`. D2's states, a missing `cwd` and a graph that
 * cannot be built are handled inside the adapter, so each costs that
 * project's checks only and never rejects a composite call.
 */
export function createPytestRunners(
  projects: readonly PytestProject[],
  options: PytestRunnersOptions,
): RecoveringRunner[] {
  return projects.map((project) => pytestRunner(project, options));
}

/** The runners of the live `pytest` entries, which a reload reconciles (011 C10, row 011-78). */
export function createPytestRunnerSet(
  projects: () => readonly PytestProject[],
  options: PytestRunnersOptions,
): RunnerSet<RecoveringRunner> {
  return createRunnerSet(projects, (project) => pytestRunner(project, options));
}

function pytestRunner(project: PytestProject, options: PytestRunnersOptions): RecoveringRunner {
  const { batchSize } = project;
  return createRecoveringRunner({
    name: "pytest",
    adapterVersion: PYTEST_ADAPTER_VERSION,
    create: () =>
      createPytestAdapter(project, {
        root: options.root,
        note: options.note,
        ...(options.latestNote === undefined ? {} : { latestNote: options.latestNote }),
        concurrency: options.tierSize,
        ...(batchSize === undefined ? {} : { batchSize: () => batchSize }),
        tempDir: options.tempDir,
        cacheDir: pytestCacheDir(options.stateDir, options.root, project.name),
        ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
      }),
    // A run starts `runner.tierSize` processes at once whatever its grant (task 001-366).
    tierWidth: () => options.tierSize(),
    // It cannot cancel a run: an edit's tier starts beside a backlog tier (task 011-21).
    besideBacklog: true,
    // A slot is one batch process (spec 007 D6): light files packed, a heavy file alone.
    backlogSlot: batchSize ?? DEFAULT_BATCH_SIZE,
    // Spec 007 D6 (row 011-145): its deselection hook runs a focused tier's texts.
    focuses: true,
    onFailure: (text) => options.note(`${text} (pytest project ${JSON.stringify(project.name)})`),
    onRecovered: () => options.note(`pytest project ${JSON.stringify(project.name)} started`),
  });
}
