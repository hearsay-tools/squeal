import { type PartProject, snapshotFields } from "../../../src/core/ci/parts.js";
import type { GateEnvironment } from "../../../src/core/code/gate/parts-environment.js";
import { coreEnvironmentInputs } from "../../../src/core/keys/environment.js";
import { describeEnvironment } from "../../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D13.2 (review 0.1.427 B1): one project's environment as the
 * gate's runner gives it, and as a part of a run of it holds it.
 */

/** The gate runner's environment of the one project, which does not observe. */
export const RUNNER: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "9",
  resolvedConfig: JSON.stringify({ root: "", snapshotOptions: { updateSnapshot: "none" } }),
  files: [],
};

/** The runner's environments as the collector gives them. */
export const ENVIRONMENT = async (): Promise<readonly RunnerEnvironment[]> => [RUNNER];

/** The gate's variables, an allow-listed one among them, and this Squeal's recorder. */
export const GATE: GateEnvironment = {
  env: { PROBE: "yes", OTHER: "x" },
  allowlist: ["PROBE"],
  observedSuffix: "+observe.6",
};

/**
 * The project of a run of `runner` that observed, with `env`, as `ci
 * record` describes it (`ci-runs.ts`, `partProject`).
 */
export function partProject(
  env: NodeJS.ProcessEnv = GATE.env,
  runner: RunnerEnvironment = RUNNER,
): PartProject {
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: "none",
    allowlist: GATE.allowlist,
    env,
  });
  const observing = { ...runner, adapterVersion: `${runner.adapterVersion}+observe.6` };
  const full = describeEnvironment(KEY_FORMAT_VERSION, core, observing, [], false);
  const { installedDependencies: _installed, files: _files, ...descriptor } = full;
  return {
    descriptor,
    updateSnapshot: "none",
    snapshotOptions: snapshotFields(runner.resolvedConfig),
  };
}
