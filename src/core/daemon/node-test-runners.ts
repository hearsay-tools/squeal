import {
  createNodeTestAdapter,
  type NodeTestAdapterOptions,
} from "../../runners/node-test/adapter.js";
import type { NodeTestCoverage } from "../../runners/node-test/coverage.js";
import { nodeTestTraits } from "../../runners/node-test/traits.js";
import { NODE_TEST_ADAPTER_VERSION } from "../../runners/node-test/version.js";
import { createHostedNodeTest, type ProcessHost } from "../runner-host/process-host.js";
import { runnerHostGone } from "../runner-host/proxy.js";
import type { AbsolutePath } from "../types/common.js";
import type { NodeTestProject, PolicyInputs } from "../types/policy.js";
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
  /** Spec 021 D8 (row 021-12): each project's adapter in a runner host; absent, in this process. */
  readonly host?: ProcessHost | undefined;
  /** Spec 021 D20 (row 021-26): how long a host stays up with no call; absent, for good. */
  readonly idleMs?: () => number;
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
  return opened(() => projects, options.note)().map((project) => nodeTestRunner(project, options));
}

/** The runners of the live `nodeTest` entries, which a reload reconciles (011 C10, row 011-78). */
export function createNodeTestRunnerSet(
  projects: () => readonly NodeTestProject[],
  options: NodeTestRunnersOptions,
): RunnerSet<RecoveringRunner> {
  return createRunnerSet(opened(projects, options.note), (project) =>
    nodeTestRunner(project, options),
  );
}

/**
 * Spec 020 D15.6 (row 020-16b): the entries the daemon opens. One with a
 * `prepare` is left out, so none of its files is listed or run, and is
 * noted once per entry name: only `squeal code --base` runs its command.
 */
function opened(
  projects: () => readonly NodeTestProject[],
  note: (text: string) => void,
): () => readonly NodeTestProject[] {
  const noted = new Set<string>();
  return () =>
    projects().filter((project) => {
      if (project.prepare === undefined) return true;
      if (!noted.has(project.name)) {
        noted.add(project.name);
        note(
          `node-test project ${JSON.stringify(project.name)} has a prepare command, so Squeal does not run its tests in the background; squeal code --base runs the prepare, then them`,
        );
      }
      return false;
    });
}

function nodeTestRunner(
  project: NodeTestProject,
  options: NodeTestRunnersOptions,
): RecoveringRunner {
  const adapterOptions: NodeTestAdapterOptions = {
    root: options.root,
    note: options.note,
    concurrency: options.tierSize,
    tempDir: options.tempDir,
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
  };
  const { host } = options;
  return createRecoveringRunner({
    name: "node-test",
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
    create: () =>
      host === undefined
        ? createNodeTestAdapter(project, adapterOptions)
        : createHostedNodeTest(host, project, adapterOptions),
    // Spec 021 D7: a host that exited or missed a deadline is replaced; D20: an idle one closes.
    ...(host === undefined ? {} : hosted(options.idleMs)),
    traits: nodeTestTraits({ tierSize: options.tierSize }),
    onFailure: (text) =>
      options.note(`${text} (node-test project ${JSON.stringify(project.name)})`),
    onRecovered: () => options.note(`node-test project ${JSON.stringify(project.name)} started`),
  });
}

/**
 * `createRecoveringRunner`'s options for an adapter in a local runner host:
 * one gone is replaced (spec 021 D7), one idle closes (D20). pytest's too.
 */
export function hosted(idleMs: (() => number) | undefined): {
  readonly gone: typeof runnerHostGone;
  readonly idleMs?: () => number;
} {
  return { gone: runnerHostGone, ...(idleMs === undefined ? {} : { idleMs }) };
}
