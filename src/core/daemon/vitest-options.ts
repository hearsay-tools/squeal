import type { VitestAdapterOptions } from "../../runners/vitest/index.js";
import { coverageOn } from "../code/coverage/runtime.js";
import type { VitestCoverageOptions } from "../code/coverage/types.js";
import type { AbsolutePath } from "../types/common.js";
import type { Policy } from "../types/policy.js";

export interface DaemonVitestInput {
  readonly root: AbsolutePath;
  /** The policy, read at each call: the daemon's changes with a reload. */
  readonly policy: () => Policy;
  /** Squeal's coverage provider (`coverageProvider()`); `null`, coverage stays off. */
  readonly provider: AbsolutePath | null;
  /** Where each instance keeps its workers' coverage payloads. */
  readonly tempDir: AbsolutePath;
  /** Each run's coverage; absent, dropped, as where no run collects any. */
  readonly collected?: VitestCoverageOptions["collected"];
}

/**
 * The Vitest adapter options the daemon builds from its policy: observing as
 * policy says, the excluded projects and files, and, with a provider,
 * coverage while policy turns it on (spec 015 D8), with `coverage.children`,
 * which the coverage marker holds (020 D12.5). Every key of the environment
 * hash the policy moves is here, so `ci export` and the gate's stored step
 * key as the daemon does. One object per call: an instance built from it
 * shares its coverage with every other one, so a provider failure turns
 * coverage off in all of them (row 015-70).
 */
export function daemonVitestOptions(input: DaemonVitestInput): VitestAdapterOptions {
  const { root, policy, provider, tempDir, collected = () => {} } = input;
  return {
    root,
    observe: () => policy().observe.runtimeInputs,
    excludeProjects: () => policy().vitest.excludeProjects,
    exclude: () => policy().vitest.exclude,
    ...(provider === null
      ? {}
      : {
          coverage: {
            enabled: () => coverageOn(policy()),
            children: () => policy().coverage.children,
            provider,
            tempDir,
            collected,
          },
        }),
  };
}
