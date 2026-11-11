import type { NodeTestAdapterOptions } from "../../runners/node-test/adapter.js";
import type { PytestAdapterOptions } from "../../runners/pytest/adapter.js";
import type { CoverageRun } from "../code/coverage/types.js";
import type { AbsolutePath } from "../types/common.js";
import type { NodeTestProject, PytestProject } from "../types/policy.js";
import type { RunnerAdapter } from "../types/runner.js";
import { type RunnerHostLaunch, spawnRunnerHost } from "./channel.js";
import type { HostAdapterOptions, HostPolicy, HostRunner } from "./protocol.js";
import { type HostDeadlines, startHostProxy } from "./proxy.js";

/*
 * Spec 021 D8 (row 021-12): the daemon's node:test and pytest adapters as
 * local runner hosts, by the cut Vitest's took (`vitest-host.ts`). Each
 * takes the options the daemon would give the adapter in its own process:
 * the options that are data go at `start`, the functions it reads per run
 * (`concurrency`, `inputs`, coverage's `enabled`) go as the policy before
 * each request, and the callbacks come back as events. The adapter's
 * processes, files and kills stay in the host (`runner-split.md` Q5).
 */

/** How the daemon starts a node:test or pytest host. */
export interface ProcessHost {
  readonly launch: RunnerHostLaunch;
  /** This Squeal's version; a host of another is refused. */
  readonly version: string;
  /** The host's environment, which pytest's runs inherit (`PytestAdapterOptions.source`); default the daemon's. */
  readonly env?: NodeJS.ProcessEnv;
  readonly deadlines?: Partial<HostDeadlines>;
}

/** A pytest project's topic for its environment's state (task 007-39), as its adapter names it. */
export function pytestEnvironmentTopic(project: PytestProject): string {
  return `pytest-environment:${project.name}`;
}

/** A node:test adapter for `project` in a runner host. */
export function createHostedNodeTest(
  host: ProcessHost,
  project: NodeTestProject,
  options: NodeTestAdapterOptions,
): Promise<RunnerAdapter> {
  const { coverage } = options;
  return hosted(host, "node-test", options.root, {
    options: {
      childEnv: options.childEnv ?? {},
      process: {
        project,
        ...(options.tempDir === undefined ? {} : { tempDir: options.tempDir }),
        ...(coverage === undefined ? {} : { coverage: true }),
      },
    },
    policy: () => ({
      ...NO_VITEST_POLICY,
      coverage: coverage?.enabled() ?? false,
      coverageChildren: coverage?.children?.() ?? false,
      ...(options.concurrency === undefined ? {} : { tierSize: options.concurrency() }),
      ...(options.inputs === undefined ? {} : { inputs: options.inputs() }),
    }),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(coverage === undefined ? {} : { coverage: coverage.collected }),
  });
}

/**
 * What a hosted pytest adapter takes: the host reads the files per batch
 * from the project's `batchSize`, as the daemon gives them, and its runs
 * inherit the host's environment (`ProcessHost.env`) and real clock.
 */
export type HostedPytestOptions = Omit<PytestAdapterOptions, "batchSize" | "source" | "clock">;

/**
 * A pytest adapter for `project` in a runner host. Its environment topic's
 * latest stored note goes at `start`; the host keeps it current from the
 * notes it sends, as the store would be.
 */
export function createHostedPytest(
  host: ProcessHost,
  project: PytestProject,
  options: HostedPytestOptions,
): Promise<RunnerAdapter> {
  const topic = pytestEnvironmentTopic(project);
  const latest = options.latestNote?.(topic);
  return hosted(host, "pytest", options.root, {
    options: {
      childEnv: options.childEnv ?? {},
      process: {
        project,
        ...(options.tempDir === undefined ? {} : { tempDir: options.tempDir }),
        ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
        ...(latest === undefined ? {} : { latestNotes: { [topic]: latest } }),
      },
    },
    policy: () => ({
      ...NO_VITEST_POLICY,
      ...(options.concurrency === undefined ? {} : { tierSize: options.concurrency() }),
    }),
    ...(options.note === undefined ? {} : { note: options.note }),
  });
}

/** The policy values only Vitest reads. */
const NO_VITEST_POLICY: HostPolicy = {
  observe: false,
  exclude: [],
  excludeProjects: [],
  coverage: false,
  coverageChildren: false,
};

interface Hosted {
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
  readonly note?: (text: string, topic?: string) => void;
  readonly coverage?: (run: CoverageRun) => void;
}

function hosted(
  host: ProcessHost,
  runner: HostRunner,
  root: AbsolutePath,
  proxy: Hosted,
): Promise<RunnerAdapter> {
  return startHostProxy({
    channel: spawnRunnerHost(host.launch, root, runner, host.env),
    runner,
    version: host.version,
    ...proxy,
    ...(host.deadlines === undefined ? {} : { deadlines: host.deadlines }),
  });
}
