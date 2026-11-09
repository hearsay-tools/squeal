import { describe, expect, it } from "vitest";
import {
  describeDifferences,
  type EnvironmentDescriptor,
  importDifferences,
} from "../../src/core/keys/environment-descriptor.js";
import { environmentRecord } from "../../src/core/keys/environment-hash.js";
import type { CoreEnvironmentInputs } from "../../src/core/types/keys.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";

/*
 * Spec 018 D10: for an imported pass, the resolved Vitest fields `CI=true`
 * sets (`allowOnly`, `watch`, `browser` while the browser is disabled) and
 * the coverage options compare as equal; every other part must be equal. A
 * browser-mode project keeps `browser` keyed (`research/ci-step.md` 3).
 */

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0.0.0-test",
  nodeVersion: "v24.22.1",
  platform: "linux",
  arch: "x64",
  installedDependencies: "a".repeat(64),
  env: {},
};

/** A resolved Vitest config as a developer's daemon has it: no CI, Squeal's coverage provider. */
const HERE = {
  allowOnly: true,
  watch: false,
  browser: { enabled: false, headless: false, ui: true, screenshotFailures: false },
  coverage: { provider: "squeal", version: 3 },
  snapshotOptions: { updateSnapshot: "none" },
  root: "<root>",
};

/** The same config as CI resolves it (`ci-step.md` 3, measured). */
const CI = {
  ...HERE,
  allowOnly: false,
  watch: undefined,
  browser: { enabled: false, headless: true, ui: false, screenshotFailures: true },
  coverage: { provider: "v8", enabled: false },
};

function descriptor(
  config: object,
  options: { runnerName?: string; core?: Partial<CoreEnvironmentInputs> } = {},
): EnvironmentDescriptor {
  const runner: RunnerEnvironment = {
    project: "web",
    runnerName: options.runnerName ?? "vitest",
    runnerVersion: "4.1.10",
    adapterVersion: "7",
    resolvedConfig: JSON.stringify(config),
    files: [],
  };
  return environmentRecord({ ...CORE, ...options.core }, runner, () => null, false).descriptor;
}

const browserOn = (fields: object) => ({ ...HERE.browser, enabled: true, ...fields });

describe("import tolerance (018 D10)", () => {
  it("records whether the browser is enabled; a config without one has none", () => {
    expect(descriptor(HERE).browser).toBe(false);
    expect(descriptor({ ...HERE, browser: browserOn({}) }).browser).toBe(true);
    expect(descriptor({ allowOnly: true }).browser).toBe(false);
  });

  for (const [name, fields] of [
    ["allowOnly", { allowOnly: CI.allowOnly }],
    ["watch", { watch: true }],
    ["browser, disabled on both sides", { browser: CI.browser }],
    ["coverage", { coverage: CI.coverage }],
  ] as const) {
    it(`a pass made with another ${name} compares as equal`, () => {
      const exported = descriptor({ ...HERE, ...fields });
      expect(describeDifferences(exported, descriptor(HERE))).not.toEqual([]);
      expect(importDifferences(exported, descriptor(HERE))).toEqual([]);
    });
  }

  it("CI's whole resolved config compares as equal to a developer's", () => {
    expect(importDifferences(descriptor(CI), descriptor(HERE))).toEqual([]);
  });

  it("a browser-mode project keeps browser keyed", () => {
    const here = descriptor({ ...HERE, browser: browserOn({ headless: false, ui: true }) });
    const ci = descriptor({ ...CI, browser: browserOn({ headless: true, ui: false }) });
    expect(importDifferences(ci, here)).toMatchObject([{ part: "config", names: ["browser"] }]);
    const off = descriptor(CI);
    expect(importDifferences(off, here)).toMatchObject([{ part: "config", names: ["browser"] }]);
  });

  it("a descriptor recorded before the browser part keeps browser keyed", () => {
    const { browser: _browser, ...older } = descriptor(CI);
    expect(importDifferences(older, descriptor(HERE))).toMatchObject([
      { part: "config", names: ["browser"] },
    ]);
  });

  it("every other config field stays keyed and is named alone", () => {
    const exported = descriptor({
      ...CI,
      snapshotOptions: { updateSnapshot: "new" },
      root: "<other>",
    });
    expect(importDifferences(exported, descriptor(HERE))).toMatchObject([
      { part: "config", names: ["root", "snapshotOptions"] },
    ]);
  });

  it("tolerates no part beside the config", () => {
    const exported = descriptor(CI, { core: { nodeVersion: "v26.13.0" } });
    expect(importDifferences(exported, descriptor(HERE))).toMatchObject([
      { part: "nodeVersion", text: "Node v26.13.0 in the export, v24.22.1 here" },
    ]);
  });

  it("tolerates only Vitest's fields", () => {
    const fake = (config: object) => descriptor(config, { runnerName: "node:test" });
    expect(importDifferences(fake({ allowOnly: false }), fake({ allowOnly: true }))).toMatchObject([
      { part: "config", names: ["allowOnly"] },
    ]);
  });
});
