import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { createInputMatcher } from "../../src/core/keys/glob.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/* Spec 017 D1: the `lint` keys, off by default (goal 1). */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-lint-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy lint (017 D1)", () => {
  it("with no lint section, is off with D1's defaults, and the rest of the policy is unchanged", () => {
    const { policy, problems } = load({ complexity: { enabled: true } });
    expect(problems).toEqual([]);
    expect(policy.lint).toEqual({ enabled: false, include: ["**"], exclude: [], blocking: false });
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("narrows nothing by default: ESLint's own config decides", () => {
    const included = createInputMatcher(DEFAULT_POLICY.lint.include);
    for (const path of ["a.ts", "src/deep/b.mjs", ".config/c.js", "README.md"]) {
      expect(included(path), path).toBe(true);
    }
  });

  it("keeps every key as written, independent of complexity", () => {
    const lint = { enabled: true, include: ["src/**"], exclude: ["src/gen/**"], blocking: true };
    const { policy, problems } = load({ complexity: { enabled: false }, lint });
    expect(problems).toEqual([]);
    expect(policy.lint).toEqual(lint);
    expect(policy.complexity.enabled).toBe(false);
  });

  it("reports a wrong type or an unknown key as a problem, and that key's default applies", () => {
    const { policy, problems } = load({
      lint: { enabled: "yes", include: "src", exclude: ["!src/a.ts"], blocking: 1, fix: true },
    });
    expect(policy.lint).toEqual(DEFAULT_POLICY.lint);
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toMatch(/lint\.enabled.*true or false/);
    expect(problems.join("\n")).toMatch(/lint\.include.*an array of strings/);
    expect(problems.join("\n")).toMatch(/lint\.exclude/);
    expect(problems.join("\n")).toMatch(/lint\.blocking.*true or false/);
    expect(problems.join("\n")).toMatch(/lint\.fix/);
  });
});
