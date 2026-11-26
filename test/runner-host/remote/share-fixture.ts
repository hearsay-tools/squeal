import { onTestFinished } from "vitest";
import type { HostedAdapter } from "../../../src/core/runner-host/host.js";
import type { HostAdmission } from "../../../src/core/runner-host/remote/admission.js";
import {
  type RemoteHost,
  type RemoteHostOptions,
  remoteHostOver,
} from "../../../src/core/runner-host/remote/connect.js";
import type { RemoteRunner } from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { inProcessHost } from "../fake-channel.js";

/*
 * Spec 026 D8 (row 026-11): what the tests of a machine shared by several
 * lanes use. Each lane's remote host is served in this process over one
 * remote tree, through a real proxy and tree host, as `startRemoteHost`
 * would start it; the runners here and there answer equal environments.
 */

export const VERSION = "0.0.0-test";

/** The project of each runner's one test file. */
export const PROJECTS: Record<RemoteRunner, string> = {
  vitest: "",
  "node-test": "unit",
  pytest: "py",
  jest: "jest",
};

export const refOf = (runner: RemoteRunner) => ({
  project: PROJECTS[runner],
  path: "test/a.test.ts",
});

const envOf = (runner: RemoteRunner): RunnerEnvironment => ({
  project: PROJECTS[runner],
  runnerName: runner,
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
});

/** A runner's adapter, here or there: equal environments, one closure. */
export function fake(runner: RemoteRunner, run: HostedAdapter["run"]): HostedAdapter {
  return {
    name: runner,
    adapterVersion: "1",
    traits: NO_TRAITS,
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: ["src/a.ts", "test/a.test.ts"] }),
    enumerate: async () => [],
    testFiles: async () => [refOf(runner)],
    environment: async () => [envOf(runner)],
    run,
    close: async () => {},
  };
}

/**
 * A `startRemoteHost` whose hosts are served here over the tree at
 * `remoteRoot`, each running with `run`; `closed` gets each host's runner
 * and the time it closed; `admission`, the machine's (row 026-30), else
 * one that admits every run.
 */
export function servedHosts(
  root: string,
  remoteRoot: string,
  run: (options: RemoteHostOptions) => HostedAdapter["run"],
  closed: [string, number][] = [],
  admission?: HostAdmission,
): (options: RemoteHostOptions) => Promise<RemoteHost> {
  return async (options) => {
    const served = inProcessHost(async () => fake(options.runner, run(options)), VERSION, {
      tree: createTreeHost(remoteRoot, () => {}),
      ...(admission === undefined ? {} : { admission }),
    });
    onTestFinished(() => served.channel.kill());
    const host = await remoteHostOver(served.channel, "v-test", {
      target: options.target,
      version: VERSION,
      root,
      runner: options.runner,
      options: options.options,
      policy: options.policy,
    });
    const close = host.adapter.close.bind(host.adapter);
    host.adapter.close = async () => {
      closed.push([options.runner, Date.now()]);
      await close();
    };
    return host;
  };
}
