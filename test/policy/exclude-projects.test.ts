import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/*
 * Spec 001 D11 (task 001-349): `vitest.excludeProjects`, the Vitest project
 * names Squeal never runs. Its type is the loader's; a name no project has
 * is the runner's problem, checked once its instance knows its projects.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-exclude-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy vitest.excludeProjects (001 D11, task 001-349)", () => {
  it("excludes nothing by default", () => {
    expect(DEFAULT_POLICY.vitest).toEqual({ excludeProjects: [] });
    expect(load({}).policy.vitest.excludeProjects).toEqual([]);
  });

  it("keeps a list of names as written", () => {
    const { policy, problems } = load({ vitest: { excludeProjects: ["e2e", "Nope"] } });
    expect(problems).toEqual([]);
    expect(policy.vitest.excludeProjects).toEqual(["e2e", "Nope"]);
  });

  it.each([
    ["e2e", `"vitest.excludeProjects" must be an array of strings, got "e2e"`],
    [["e2e", 3], `"vitest.excludeProjects" must be an array of strings, got ["e2e",3]`],
  ])("reports %j with the loader's message and excludes nothing", (value, problem) => {
    const { policy, problems } = load({ vitest: { excludeProjects: value } });
    expect(problems).toEqual([problem]);
    expect(policy.vitest.excludeProjects).toEqual([]);
  });

  it("reports an unknown key under vitest", () => {
    expect(load({ vitest: { exclude: ["e2e"] } }).problems).toEqual([
      `unknown key "vitest.exclude"`,
    ]);
  });
});
