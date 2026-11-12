import { describe, expect, it } from "vitest";
import { coverageMarker } from "../../../src/core/code/coverage/record.js";
import {
  type EnvironmentSide,
  environmentDifferences,
} from "../../../src/core/runner-host/remote/environment.js";
import type { CoreEnvironmentInputs } from "../../../src/core/types/keys.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";

/*
 * Spec 021 D11.2 with D12 (row 021-22): the remote runs with coverage off, so
 * the comparison takes the `coverage` field out of both resolved configs; with
 * coverage on here, the default, every remote run was refused
 * (`research/boat-trial.md` D1). Every other part still refuses.
 */

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0.1.450",
  nodeVersion: "v26.13.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps-1",
  env: {},
};

/** What Vitest resolves for `coverage` with coverage off: its own options, not Squeal's marker. */
const VITEST_COVERAGE_OFF = { enabled: false, provider: "v8", reportsDirectory: "coverage" };

/** A Vitest project's environment whose resolved config holds `config`. */
function vitest(config: Record<string, unknown>): RunnerEnvironment {
  return {
    project: "",
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "1",
    resolvedConfig: JSON.stringify(config),
    files: ["vitest.config.ts"],
  };
}

function side(
  runner: RunnerEnvironment,
  core: Partial<CoreEnvironmentInputs> = {},
  blob = "blob-1",
): EnvironmentSide {
  return { core: { ...CORE, ...core }, runners: [runner], blob: () => blob };
}

const BASE = { allowOnly: false, root: ".", testTimeout: 5000 };
/** Here: coverage on with Squeal's provider, as the daemon runs by default. */
const HERE = vitest({ ...BASE, coverage: coverageMarker(false) });
/** There: coverage off (D12). */
const THERE = vitest({ ...BASE, coverage: VITEST_COVERAGE_OFF });

describe("environmentDifferences", () => {
  it("is equal with coverage on here and off on the remote", () => {
    expect(environmentDifferences(side(THERE), side(HERE))).toEqual([]);
  });

  it("is equal when only this side's config holds a coverage field, as node:test's without coverage", () => {
    const here = vitest({ ...BASE, coverage: coverageMarker(true) });
    expect(environmentDifferences(side(vitest(BASE)), side(here))).toEqual([]);
  });

  it("still refuses another Node, named alone beside the coverage that differs", () => {
    expect(environmentDifferences(side(THERE, { nodeVersion: "v24.22.1" }), side(HERE))).toEqual([
      "Node v24.22.1 on the remote, v26.13.0 here",
    ]);
  });

  it("still refuses another config field, named without coverage", () => {
    const there = vitest({ ...BASE, testTimeout: 10_000, coverage: VITEST_COVERAGE_OFF });
    expect(environmentDifferences(side(there), side(HERE))).toEqual([
      "config fields testTimeout differ",
    ]);
  });

  it("still refuses other installed dependencies and another config file", () => {
    expect(
      environmentDifferences(side(THERE, { installedDependencies: "deps-2" }), side(HERE)),
    ).toEqual(["installed dependencies differ"]);
    expect(environmentDifferences(side(THERE, {}, "blob-2"), side(HERE))).toEqual([
      "config and setup files differ: vitest.config.ts",
    ]);
  });

  it("compares a config that is not a JSON object as a whole", () => {
    const fake = (config: string): RunnerEnvironment => ({ ...HERE, resolvedConfig: config });
    expect(environmentDifferences(side(fake("same")), side(fake("same")))).toEqual([]);
    expect(environmentDifferences(side(fake("a")), side(fake("b")))).toEqual([
      "config fields (config) differ",
    ]);
  });
});
