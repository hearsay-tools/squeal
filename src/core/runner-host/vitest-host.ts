import type { VitestAdapterOptions } from "../../runners/vitest/index.js";
import type { RunnerAdapter } from "../types/runner.js";
import { type RunnerHostLaunch, spawnRunnerHost } from "./channel.js";
import type { HostAdapterOptions, HostPolicy } from "./protocol.js";
import { type HostDeadlines, runnerHostGone, startHostProxy } from "./proxy.js";

/*
 * Spec 021 D8 (row 021-11): the daemon's Vitest instance as a local runner
 * host. It takes `createVitestAdapter`'s options, so the daemon builds an
 * instance one way or the other from the same values: the options that are
 * data go at `start`, the functions are read as the policy before each
 * request, and the callbacks come back as events.
 */

/** A Vitest adapter in a runner host started by `launch`, built from `options`. */
export function createHostedVitest(
  launch: RunnerHostLaunch,
  version: string,
  options: VitestAdapterOptions,
  deadlines?: Partial<HostDeadlines>,
): Promise<RunnerAdapter> {
  const { coverage } = options;
  return startHostProxy({
    channel: spawnRunnerHost(launch, options.root, "vitest"),
    runner: "vitest",
    version,
    ...hostedOptions(options),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.optimizer === undefined ? {} : { optimizer: options.optimizer }),
    ...(coverage === undefined ? {} : { coverage: coverage.collected }),
    ...(deadlines === undefined ? {} : { deadlines }),
  });
}

/**
 * `createVitestAdapter`'s options as a host takes them: the data at
 * `start`, the functions as the policy read before each request (spec 021
 * D8; a remote host's too, row 021-14).
 */
export function hostedOptions(options: VitestAdapterOptions): {
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
} {
  const { coverage } = options;
  return {
    options: {
      childEnv: options.childEnv ?? {},
      ...(options.maxWorkers === undefined ? {} : { maxWorkers: options.maxWorkers }),
      ...(coverage === undefined
        ? {}
        : { coverage: { provider: coverage.provider, tempDir: coverage.tempDir } }),
    },
    policy: () => ({
      observe: options.observe?.() ?? false,
      exclude: options.exclude?.() ?? [],
      excludeProjects: options.excludeProjects?.() ?? [],
      coverage: coverage?.enabled() ?? false,
      coverageChildren: coverage?.children?.() ?? false,
    }),
  };
}

/** How the daemon builds each Vitest instance (spec 021 D8). */
export interface VitestInstances {
  /** Whether each runs in a runner host, whose working directory is the root. */
  readonly hosted: boolean;
  readonly create: (options: VitestAdapterOptions) => Promise<RunnerAdapter>;
  /** For `createRecoveringRunner`: a host that is gone is replaced (D7). */
  readonly recovery: { readonly gone?: (adapter: RunnerAdapter) => boolean };
}

/** In a runner host started by `launch`; without one, in this process through `inProcess`. */
export function vitestInstances(
  launch: RunnerHostLaunch | undefined,
  version: string,
  inProcess: (options: VitestAdapterOptions) => Promise<RunnerAdapter>,
): VitestInstances {
  if (launch === undefined) return { hosted: false, create: inProcess, recovery: {} };
  return {
    hosted: true,
    create: (options) => createHostedVitest(launch, version, options),
    recovery: { gone: runnerHostGone },
  };
}
