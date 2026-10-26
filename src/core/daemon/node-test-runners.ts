import {
  createNodeTestAdapter,
  NODE_TEST_ADAPTER_VERSION,
} from "../../runners/node-test/adapter.js";
import type { NodeTestCoverage } from "../../runners/node-test/coverage.js";
import type { AbsolutePath, NodeTestProject, PolicyInputs } from "../types/index.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";
import { createRunnerSet, type RunnerSet } from "./runner-set.js";

export interface NodeTestRunnersOptions {
  readonly root: AbsolutePath;
  /** Spec 001 D10: the daemon's temp directory, the children's `TMPDIR`. */
  readonly tempDir: AbsolutePath;
  /** Spec 001 D12: the mark the daemon's sweep finds a test's leftovers by (task 003-38). */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  /** Policy `inputs`, read per run (task 001-365). */
  readonly inputs?: () => PolicyInputs;
  readonly note: (text: string, topic?: string) => void;
  /** Spec 015 D8 (row 015-86): coverage in the runs the projects make anyway; absent, none. */
  readonly coverage?: NodeTestCoverage;
}

/**
 * One runner per `nodeTest` entry (spec 003 D7), each behind
 * `createRecoveringRunner` as Vitest is: building the graph waits for the
 * first call or `open()`. A missing Node, a missing `cwd` and a graph that
 * cannot be built are handled inside the adapter (review wave 2, S1), so
 * each costs that project's checks only and never rejects a composite call.
 */
export function createNodeTestRunners(
  projects: readonly NodeTestProject[],
  options: NodeTestRunnersOptions,
): RecoveringRunner[] {
  return projects.map((project) => nodeTestRunner(project, options));
}

/** The runners of the live `nodeTest` entries, which a reload reconciles (011 C10, row 011-78). */
export function createNodeTestRunnerSet(
  projects: () => readonly NodeTestProject[],
  options: NodeTestRunnersOptions,
): RunnerSet<RecoveringRunner> {
  return createRunnerSet(projects, (project) => nodeTestRunner(project, options));
}

function nodeTestRunner(
  project: NodeTestProject,
  options: NodeTestRunnersOptions,
): RecoveringRunner {
  return createRecoveringRunner({
    name: "node-test",
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
    create: () =>
      createNodeTestAdapter(project, {
        root: options.root,
        note: options.note,
        concurrency: options.tierSize,
        tempDir: options.tempDir,
        ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
        ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
        ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
      }),
    // A run starts `runner.tierSize` files at once whatever its grant (task 001-366).
    tierWidth: () => options.tierSize(),
    // It cannot cancel a run: an edit's tier starts beside a backlog tier (task 011-21).
    besideBacklog: true,
    // A process per file: the backlog runs in one-file slots (task 011-21 slice 2).
    backlogSlot: 1,
    onFailure: (text) =>
      options.note(`${text} (node-test project ${JSON.stringify(project.name)})`),
    onRecovered: () => options.note(`node-test project ${JSON.stringify(project.name)} started`),
  });
}
