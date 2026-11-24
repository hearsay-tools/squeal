import { describe, expect, it } from "vitest";
import { coverageMarker } from "../../../src/core/code/coverage/record.js";
import {
  type EnvironmentSide,
  environmentDifferences,
} from "../../../src/core/runner-host/remote/environment.js";
import { meetsPin } from "../../../src/core/runner-host/remote/remote-key.js";
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

/*
 * Spec 026 D10 (row 026-14): under `remote-key` the remote's machine may
 * differ (a macOS laptop with a Linux remote); every other part still
 * refuses, as under the default `match-local`.
 */
describe("environmentDifferences under remote-key", () => {
  const MAC = { platform: "darwin", arch: "arm64" };
  const REMOTE_KEY = { mode: "remote-key" } as const;

  it("refuses another platform and arch under match-local, the default", () => {
    const differences = environmentDifferences(side(THERE), side(HERE, MAC));
    expect(differences).toEqual([
      "platform linux on the remote, darwin here",
      "arch x64 on the remote, arm64 here",
    ]);
    expect(environmentDifferences(side(THERE), side(HERE, MAC), { mode: "match-local" })).toEqual(
      differences,
    );
  });

  it("is equal with darwin/arm64 here and linux/x64 on the remote", () => {
    expect(environmentDifferences(side(THERE), side(HERE, MAC), REMOTE_KEY)).toEqual([]);
  });

  it("still refuses another config file, resolved config, install or allow-listed variable", () => {
    const mac = (core: Partial<CoreEnvironmentInputs> = {}) => side(HERE, { ...MAC, ...core });
    expect(environmentDifferences(side(THERE, {}, "blob-2"), mac(), REMOTE_KEY)).toEqual([
      "config and setup files differ: vitest.config.ts",
    ]);
    const there = vitest({ ...BASE, testTimeout: 10_000, coverage: VITEST_COVERAGE_OFF });
    expect(environmentDifferences(side(there), mac(), REMOTE_KEY)).toEqual([
      "config fields testTimeout differ",
    ]);
    expect(
      environmentDifferences(side(THERE, { installedDependencies: "deps-2" }), mac(), REMOTE_KEY),
    ).toEqual(["installed dependencies differ"]);
    const env = environmentDifferences(side(THERE, { env: { TZ: "UTC" } }), mac(), REMOTE_KEY);
    expect(env).toHaveLength(1);
    expect(env[0]).toMatch(/TZ/);
  });

  it("still refuses a project missing on either side", () => {
    const other: RunnerEnvironment = { ...HERE, project: "e2e" };
    const local: EnvironmentSide = { ...side(HERE, MAC), runners: [HERE, other] };
    expect(environmentDifferences(side(THERE), local, REMOTE_KEY)).toEqual([
      'project "e2e" is not on the remote',
    ]);
    const remote: EnvironmentSide = { ...side(THERE), runners: [THERE, other] };
    expect(environmentDifferences(remote, side(HERE, MAC), REMOTE_KEY)).toEqual([
      'project "e2e" is only on the remote',
    ]);
  });

  it("refuses another Node without a pin, and one the project's pin does not allow", () => {
    const node = (version: string, nodePins: readonly string[]) =>
      environmentDifferences(side(THERE, { nodeVersion: version }), side(HERE, MAC), {
        mode: "remote-key",
        nodePins,
      });
    expect(node("v24.22.1", [])).toEqual(["Node v24.22.1 on the remote, v26.13.0 here"]);
    expect(node("v24.22.1", [">=26"])).toEqual([
      'Node v24.22.1 on the remote does not meet the project\'s Node pin ">=26" (v26.13.0 here)',
    ]);
    expect(node("v26.14.0", ["26.13.0"])).toHaveLength(1);
    expect(node("v26.14.0", ["lts/*"])).toHaveLength(1);
  });

  it("takes another Node that meets every pin of the project", () => {
    const node = (version: string, nodePins: readonly string[]) =>
      environmentDifferences(side(THERE, { nodeVersion: version }), side(HERE, MAC), {
        mode: "remote-key",
        nodePins,
      });
    expect(node("v26.14.0", ["26"])).toEqual([]);
    expect(node("v26.14.0", ["v26", ">=24 <27"])).toEqual([]);
    expect(node("v26.14.0", ["^26.1.0 || ^28"])).toEqual([]);
    expect(node("v26.14.0", ["26", ">=27"])).toHaveLength(1);
  });
});

describe("meetsPin", () => {
  it.each([
    ["v26.13.0", "26.13.0", true],
    ["v26.13.0", "v26.13.1", false],
    ["v26.13.0", "26", true],
    ["v26.13.0", "26.x", true],
    ["v26.13.0", "26.12", false],
    ["v26.13.0", ">=26.13.0", true],
    ["v26.13.0", ">26.13.0", false],
    ["v26.13.0", ">25", true],
    ["v26.13.0", ">26", false],
    ["v26.13.0", "<=26", true],
    ["v26.13.0", "<26", false],
    ["v26.13.0", "^26.1.0", true],
    ["v26.13.0", "^25.0.0", false],
    ["v26.13.0", "~26.13.0", true],
    ["v26.13.0", "~26.12.0", false],
    ["v26.13.0", ">= 20.0.0 < 27", true],
    ["v26.13.0", "^22 || ^24 || ^26", true],
    ["v26.13.0", "*", true],
    ["v26.13.0", "lts/*", null],
    ["v26.13.0", "20 - 26", null],
  ])("Node %s meets %j: %s", (version, pin, met) => {
    expect(meetsPin(version, pin)).toBe(met);
  });
});
