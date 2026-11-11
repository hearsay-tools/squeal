import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runsVitest } from "../../src/core/daemon/runner.js";
import { daemonVitestOptions } from "../../src/core/daemon/vitest-options.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { Policy, PytestProject } from "../../src/core/types/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";

/*
 * Row proposed-runs-vitest (020-21): one owner for "Vitest runs here when no
 * other runner is configured, or Vitest is detected" (spec 003 D7), and one
 * set of the daemon's Vitest options for the daemon, `ci export` and the
 * gate's stored step.
 */

function rootWith(files: Readonly<Record<string, string>>): AbsolutePath {
  const root = mkdtempSync(join(tmpdir(), "squeal-runs-vitest-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

/** Another runner configured: `runsVitest` counts every configured project alike. */
const PYTEST = { ...DEFAULT_POLICY, pytest: [{ name: "py" } as PytestProject] };

describe("runsVitest (spec 003 D7)", () => {
  it.each([
    ["no other runner configured, no Vitest", DEFAULT_POLICY, {}, true],
    ["another runner configured, no Vitest", PYTEST, {}, false],
    ["another runner configured and a Vitest config", PYTEST, { "vitest.config.ts": "" }, true],
  ] as const)("is %s -> %s", (_, policy, files, expected) => {
    expect(runsVitest(rootWith(files), policy)).toBe(expected);
  });
});

describe("daemonVitestOptions", () => {
  const root = "/repo" as AbsolutePath;
  const tempDir = "/tmp/squeal" as AbsolutePath;
  const provider = "/plugin/coverage/provider.mjs" as AbsolutePath;

  it("reads the policy at each call, as a reload moves it", () => {
    let policy: Policy = DEFAULT_POLICY;
    const options = daemonVitestOptions({ root, policy: () => policy, provider, tempDir });
    expect(options.root).toBe(root);
    expect(options.observe?.()).toBe(true);
    expect(options.coverage?.enabled()).toBe(true);
    expect(options.coverage?.children?.()).toBe(false);
    policy = {
      ...DEFAULT_POLICY,
      observe: { ...DEFAULT_POLICY.observe, runtimeInputs: false },
      vitest: { excludeProjects: ["e2e"], exclude: ["slow/**"] },
      complexity: { ...DEFAULT_POLICY.complexity, enabled: false },
      coverage: { ...DEFAULT_POLICY.coverage, children: true },
    };
    expect(options.observe?.()).toBe(false);
    expect(options.excludeProjects?.()).toEqual(["e2e"]);
    expect(options.exclude?.()).toEqual(["slow/**"]);
    // Spec 015 D1: coverage acts only with complexity.
    expect(options.coverage?.enabled()).toBe(false);
    expect(options.coverage?.children?.()).toBe(true);
  });

  it("gives the provider and temp directory, and hands each run's coverage over", () => {
    const runs: unknown[] = [];
    const options = daemonVitestOptions({
      root,
      policy: () => DEFAULT_POLICY,
      provider,
      tempDir,
      collected: (run) => runs.push(run),
    });
    expect(options.coverage).toMatchObject({ provider, tempDir });
    options.coverage?.collected({ runId: "r1", files: [] });
    expect(runs).toEqual([{ runId: "r1", files: [] }]);
  });

  it("has no coverage without a provider", () => {
    const options = daemonVitestOptions({
      root,
      policy: () => DEFAULT_POLICY,
      provider: null,
      tempDir,
    });
    expect(options.coverage).toBeUndefined();
  });
});
