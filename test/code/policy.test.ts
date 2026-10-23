import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { createInputMatcher } from "../../src/core/keys/glob.js";
import { CODE_EXTENSIONS } from "../../src/core/types/code.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/* Spec 015 D1: the `complexity`, `coverage` and `crap` keys, off by default. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-code-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy complexity, coverage and crap (015 D1)", () => {
  it("is off by default, with D1's numbers", () => {
    const { policy, problems } = load({});
    expect(problems).toEqual([]);
    expect(policy.complexity).toEqual({
      enabled: false,
      threshold: 20,
      include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"],
      exclude: ["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
      maxFileBytes: 524_288,
      blocking: false,
    });
    expect(policy.coverage).toEqual({ enabled: false });
    expect(policy.crap).toEqual({ threshold: 30 });
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("includes by default every extension the counter reads, and no other", () => {
    const included = createInputMatcher(DEFAULT_POLICY.complexity.include);
    for (const extension of Object.keys(CODE_EXTENSIONS)) {
      expect(included(`src/deep/file${extension}`), extension).toBe(true);
    }
    for (const path of ["README.md", "src/a.json", "src/a.d", "src/a.pyc", "src/ts"]) {
      expect(included(path), path).toBe(false);
    }
    expect(Object.keys(CODE_EXTENSIONS).every((e) => extname(`a${e}`) === e)).toBe(true);
  });

  it("keeps every key as written, and a project's exclude replaces the default", () => {
    const written = {
      complexity: {
        enabled: true,
        threshold: 15,
        include: ["src/**/*.ts"],
        exclude: ["src/generated/**"],
        maxFileBytes: 1_000,
        blocking: true,
      },
      coverage: { enabled: true },
      crap: { threshold: 12.5 },
    };
    const { policy, problems } = load(written);
    expect(problems).toEqual([]);
    expect({
      complexity: policy.complexity,
      coverage: policy.coverage,
      crap: policy.crap,
    }).toEqual(written);
  });

  it("applies the default to a key it does not name", () => {
    const { policy } = load({ complexity: { enabled: true } });
    expect(policy.complexity).toEqual({ ...DEFAULT_POLICY.complexity, enabled: true });
  });

  it.each([
    [{ complexity: "on" }, `"complexity" must be an object, got "on"`],
    [{ complexity: { enabled: "yes" } }, `"complexity.enabled" must be true or false, got "yes"`],
    [{ complexity: { threshold: 0 } }, `"complexity.threshold" must be a positive integer, got 0`],
    [
      { complexity: { threshold: 20.5 } },
      `"complexity.threshold" must be a positive integer, got 20.5`,
    ],
    [
      { complexity: { include: "src/**" } },
      `"complexity.include" must be an array of strings, got "src/**"`,
    ],
    [{ complexity: { exclude: [3] } }, `"complexity.exclude" must be an array of strings, got [3]`],
    [
      { complexity: { maxFileBytes: -1 } },
      `"complexity.maxFileBytes" must be a positive integer, got -1`,
    ],
    [{ complexity: { blocking: 1 } }, `"complexity.blocking" must be true or false, got 1`],
    [{ coverage: { enabled: "true" } }, `"coverage.enabled" must be true or false, got "true"`],
    [{ crap: { threshold: 0 } }, `"crap.threshold" must be a number > 0, got 0`],
    [{ crap: { threshold: "30" } }, `"crap.threshold" must be a number > 0, got "30"`],
    [{ complexity: { treshold: 10 } }, `unknown key "complexity.treshold"`],
    [{ crap: { enabled: true } }, `unknown key "crap.enabled"`],
  ])("reports %j with the loader's message and keeps the default", (file, problem) => {
    const { policy, problems } = load(file);
    expect(problems).toEqual([problem]);
    expect(policy.complexity).toEqual(DEFAULT_POLICY.complexity);
    expect(policy.coverage).toEqual(DEFAULT_POLICY.coverage);
    expect(policy.crap).toEqual(DEFAULT_POLICY.crap);
  });

  it("reports a glob Squeal cannot use and keeps the default list", () => {
    const { policy, problems } = load({ complexity: { include: ["src/**", "/abs/**"] } });
    expect(problems).toEqual([
      `"complexity.include" has a glob Squeal cannot use: squeal: input glob must be relative: /abs/**`,
    ]);
    expect(policy.complexity.include).toEqual(DEFAULT_POLICY.complexity.include);
  });

  it("leaves coverage.enabled as written while complexity is off", () => {
    // D1's "needs complexity.enabled" is wave 2's to apply where coverage turns on: the loader is
    // on the key-validity path, where a rule needs a validity case (test/keys/key-format.test.ts).
    const { policy, problems } = load({ coverage: { enabled: true } });
    expect(problems).toEqual([]);
    expect(policy.coverage.enabled).toBe(true);
    expect(policy.complexity.enabled).toBe(false);
  });
});
