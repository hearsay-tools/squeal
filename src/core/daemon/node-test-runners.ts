import {
  createNodeTestAdapter,
  type NodeTestAdapterOptions,
} from "../../runners/node-test/adapter.js";
import type { NodeTestCoverage } from "../../runners/node-test/coverage.js";
import { nodeTestTraits } from "../../runners/node-test/traits.js";
import { NODE_TEST_ADAPTER_VERSION } from "../../runners/node-test/version.js";
import type { ContainerWiring } from "../runner-host/container/index.js";
import { createHostedNodeTest, type ProcessHost } from "../runner-host/process-host.js";
import type { HostPolicy } from "../runner-host/protocol.js";
import { runnerHostGone } from "../runner-host/proxy.js";
import type { LaneSpec, RemoteStart } from "../runner-host/remote/daemon-lane.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { NodeTestProject, PolicyInputs } from "../types/policy.js";
import type { RunnerAdapter } from "../types/runner.js";
import { createContainerGuardRunner } from "./container-guard.js";
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
  /**
   * Spec 023 D7.3 (row 023-40c; row 023-35, T2): told each project's test
   * files whose static closure is incomplete, at open and after each batch;
   * with it the adapter writes no note of them. Only in this process: an
   * adapter in a runner host does not tell it.
   */
  readonly closures?: (
    project: string,
    files: readonly (readonly [RelativePath, readonly string[]])[],
  ) => void;
  /**
   * Spec 026 D8.2 (row 026-11): puts a project's runner on the repository's
   * remote lane (`DaemonRemote.wrap`); absent, every run is here.
   */
  readonly remote?: RemoteWrap;
  /** Spec 027 D5 (row 027-06): the route of a consented container project; absent, it stays unknown. */
  readonly containers?: ContainerWiring;
}

/** `DaemonRemote.wrap`: a runner with its remote tiers on the shared machine (spec 026 D8). */
export type RemoteWrap = <R extends RunnerAdapter>(spec: LaneSpec<R>) => R;

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
  // Spec 027 D4.2 (review 0.1.643 B1): a container project never runs here or remotely.
  if (project.container !== undefined) {
    return createContainerGuardRunner({
      runner: "node-test",
      adapterVersion: NODE_TEST_ADAPTER_VERSION,
      root: options.root,
      project: { name: project.name, container: project.container },
      traits: nodeTestTraits({ tierSize: options.tierSize }),
      note: options.note,
      ...(options.containers === undefined ? {} : { containers: options.containers }),
      // Coverage stays off in a container, as on a remote (021 D12).
      start: ({ tempDir }) => ({
        options: { childEnv: options.childEnv ?? {}, process: { project, tempDir } },
        policy: () => ({
          ...NO_VITEST_POLICY,
          tierSize: options.tierSize(),
          ...(options.inputs === undefined ? {} : { inputs: options.inputs() }),
        }),
      }),
    });
  }
  const adapterOptions: NodeTestAdapterOptions = {
    root: options.root,
    note: options.note,
    concurrency: options.tierSize,
    tempDir: options.tempDir,
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
    ...(options.closures === undefined
      ? {}
      : { closures: (files) => options.closures?.(project.name, files) }),
  };
  const { host } = options;
  const runner = createRecoveringRunner({
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
  return (
    options.remote?.({
      runner: "node-test",
      name: `node-test ${project.name}`,
      local: runner,
      start: remoteStart(project, adapterOptions),
    }) ?? runner
  );
}

/**
 * What a remote host of `project` starts with (spec 026 D8.2), as a local
 * one's (`createHostedNodeTest`): coverage stays off there (021 D12), and
 * the remote moves the temp directory under its tree (`connect.ts`).
 */
function remoteStart(project: NodeTestProject, options: NodeTestAdapterOptions): RemoteStart {
  return {
    options: {
      childEnv: options.childEnv ?? {},
      process: { project, ...(options.tempDir === undefined ? {} : { tempDir: options.tempDir }) },
    },
    policy: () => ({
      ...NO_VITEST_POLICY,
      ...(options.concurrency === undefined ? {} : { tierSize: options.concurrency() }),
      ...(options.inputs === undefined ? {} : { inputs: options.inputs() }),
    }),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
}

/** The policy values only Vitest reads, off in a node:test or pytest host. */
export const NO_VITEST_POLICY: HostPolicy = {
  observe: false,
  exclude: [],
  excludeProjects: [],
  coverage: false,
  coverageChildren: false,
};

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
