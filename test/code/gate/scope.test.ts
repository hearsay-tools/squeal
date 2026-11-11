import { describe, expect, it } from "vitest";
import {
  type GateScope,
  placeFile,
  readScope,
  resolveScope,
} from "../../../src/core/code/gate/scope.js";
import { CHECK_RUNNERS } from "../../../src/core/daemon/check-groups.js";
import type { CheckGroup } from "../../../src/core/types/check-groups.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";

/*
 * Spec 020 D14.1 (row 020-15a): the gate's scope by check group, resolved
 * from `checks` and `gate.groups` at the merge base, plus `--group`. Pure:
 * no file is listed or read.
 */

const BROWSER: CheckGroup = { name: "browser", runner: "vitest", project: "browser", at: "manual" };
/** A group of node:test files; the runner key is read from the list, as this test runs none. */
const E2E: CheckGroup = {
  name: "e2e",
  runner: CHECK_RUNNERS[1] ?? "vitest",
  project: "e2e",
  at: "stop",
};
const LINT: CheckGroup = { name: "lint", lint: true, at: "commit" };

function policy(checks: readonly CheckGroup[], groups: readonly string[] | null = null): Policy {
  return {
    ...DEFAULT_POLICY,
    slow: { ...DEFAULT_POLICY.slow, include: ["test/**/*.slow.test.ts"] },
    checks,
    gate: { groups },
  };
}

/** The scope of `p` with `added`, or the test fails. */
function scopeOf(p: Policy, added: readonly string[] = []): GateScope {
  const { base, problems } = readScope(p);
  expect(problems).toEqual([]);
  const scope = resolveScope(base, added);
  if ("error" in scope) throw new Error(scope.error);
  return scope;
}

const named = (scope: GateScope) => scope.inScope.map((g) => [g.name, g.from]);

describe("the gate's scope (spec 020 D14.1)", () => {
  it("leaves out a manual group by default and keeps every other test group", () => {
    const scope = scopeOf(policy([BROWSER, E2E, LINT]));
    expect(named(scope)).toEqual([
      ["e2e", "default"],
      ["tests", "default"],
      ["slow", "default"],
    ]);
    expect(placeFile(scope, "vitest", { project: "browser", path: "e2e/page.test.ts" })).toEqual({
      group: "browser",
      at: "manual",
      inScope: false,
    });
    expect(placeFile(scope, "vitest", { project: "server", path: "test/a.test.ts" })).toEqual({
      group: "tests",
      at: "edit",
      inScope: true,
    });
    expect(placeFile(scope, "node-test", { project: "e2e", path: "e2e/a.test.mjs" })).toEqual({
      group: "e2e",
      at: "stop",
      inScope: true,
    });
  });

  it("places a file marked slow in the default slow group", () => {
    const scope = scopeOf(policy([]));
    const ref = { project: "", path: "test/big.slow.test.ts" };
    expect(placeFile(scope, "vitest", ref)).toEqual({ group: "slow", at: "edit", inScope: true });
  });

  it("keeps tests and slow with no checks, so every file is in scope as before", () => {
    const scope = scopeOf(DEFAULT_POLICY);
    expect(named(scope)).toEqual([
      ["tests", "default"],
      ["slow", "default"],
    ]);
    const ref = { project: "", path: "test/a.test.ts" };
    expect(placeFile(scope, "vitest", ref).inScope).toBe(true);
  });

  it("lets gate.groups replace the default, a manual group included", () => {
    const scope = scopeOf(policy([BROWSER, E2E], ["browser", "tests"]));
    expect(named(scope)).toEqual([
      ["browser", "gate.groups"],
      ["tests", "gate.groups"],
    ]);
    expect(placeFile(scope, "node-test", { project: "e2e", path: "e2e/a.test.mjs" }).inScope).toBe(
      false,
    );
    const slow = { project: "", path: "test/big.slow.test.ts" };
    expect(placeFile(scope, "vitest", slow).inScope).toBe(false);
  });

  it("adds a group with --group, a manual one included, and keeps a group's first source", () => {
    const scope = scopeOf(policy([BROWSER, E2E]), ["browser", "tests", "browser"]);
    expect(named(scope)).toEqual([
      ["browser", "--group"],
      ["e2e", "default"],
      ["tests", "default"],
      ["slow", "default"],
    ]);
    const ref = { project: "browser", path: "e2e/page.test.ts" };
    expect(placeFile(scope, "vitest", ref).inScope).toBe(true);
  });

  it("drops an unknown name and a lint group from gate.groups, each a policy problem", () => {
    const { base, problems } = readScope(policy([BROWSER, LINT], ["browserr", "lint", "tests"]));
    expect(base.configured).toEqual(["tests"]);
    expect(problems).toEqual([
      'gate.groups: "browserr" names no test group of "checks", "tests" or "slow"; it is dropped',
      'gate.groups: "lint" is a lint group, and the gate runs test groups only; it is dropped',
    ]);
    const scope = resolveScope(base, []);
    expect("error" in scope ? scope.error : named(scope)).toEqual([["tests", "gate.groups"]]);
  });

  it("keeps a gate.groups list that every name left, so nothing but --test runs", () => {
    const { base } = readScope(policy([BROWSER], ["nope"]));
    expect(base.configured).toEqual([]);
    const scope = resolveScope(base, []);
    expect("error" in scope ? scope.error : named(scope)).toEqual([]);
  });

  it("refuses an unknown --group and a lint group: a usage error", () => {
    const { base } = readScope(policy([BROWSER, LINT]));
    expect(resolveScope(base, ["browserr"])).toEqual({
      error:
        "--group browserr: no test group of that name at the merge base; its test groups are browser, tests, slow",
    });
    expect(resolveScope(base, ["lint"])).toEqual({
      error: '--group lint: "lint" is a lint group, and the gate runs test groups only',
    });
  });
});
