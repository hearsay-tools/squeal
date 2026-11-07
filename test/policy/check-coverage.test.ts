import { describe, expect, it } from "vitest";
import { coverageProblems, resolveGroups } from "../../src/core/daemon/check-groups.js";
import type { GroupCheck } from "../../src/core/types/check-groups.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { useLoad } from "./checks-load.js";

/*
 * Spec 019 D1's last two problems, which need the listed checks: a group
 * that selects none of its runner's checks, and one that selects only
 * checks a group above it owns. D2's note: a group that owns files marked
 * slow does not use their marking. The daemon reports them as a note.
 */

const load = useLoad();
const groupsOf = (checks: unknown, file: object = {}) => {
  const { policy, problems } = load({ checks, ...file });
  expect(problems).toEqual([]);
  return resolveGroups(policy);
};
const vitest = (project: string, path: string): GroupCheck => ({
  kind: "test",
  runner: "vitest",
  project,
  path,
});
const CHECKS: readonly GroupCheck[] = [
  vitest("unit", "test/a.test.ts"),
  vitest("unit", "test/b.test.ts"),
  vitest("e2e", "test/e2e/login.test.ts"),
  { kind: "lint", tool: "eslint", path: "src/a.ts" },
];

describe("check group coverage (spec 019 D1, D2)", () => {
  it("has nothing to say about the default groups", () => {
    expect(coverageProblems(resolveGroups(DEFAULT_POLICY), CHECKS)).toEqual([]);
    expect(coverageProblems(resolveGroups(DEFAULT_POLICY), [])).toEqual([]);
  });

  it("has nothing to say when every group owns a check", () => {
    const groups = groupsOf([
      { name: "e2e", runner: "vitest", project: "e2e", at: "stop" },
      { name: "unit", runner: "vitest", at: "edit" },
      { name: "lint", lint: true, at: "commit" },
    ]);
    expect(coverageProblems(groups, CHECKS)).toEqual([]);
  });

  it.each([
    [{ runner: "vitest", tests: ["spec/**"] }, "it selects no check"],
    [{ runner: "nodeTest" }, "it selects no check"],
    [{ runner: "vitest", project: "unit", tests: ["test/e2e/**"] }, "it selects no check"],
    [{ runner: "vitest", project: "browser" }, `"project" names no vitest project "browser"`],
    [{ lint: ["oxlint"] }, "it selects no check"],
  ])("names a group that selects nothing: %j", (selector, why) => {
    const groups = groupsOf([{ name: "g", at: "edit", ...selector }]);
    expect(coverageProblems(groups, CHECKS)).toEqual([`"checks" group "g": ${why}`]);
  });

  it("names a lint group when no lint check is listed", () => {
    const groups = groupsOf([{ name: "lint", lint: true, at: "commit" }]);
    expect(coverageProblems(groups, CHECKS.slice(0, 3))).toEqual([
      `"checks" group "lint": it selects no check`,
    ]);
  });

  it("names a group whose every check one group above owns", () => {
    const groups = groupsOf([
      { name: "all", runner: "vitest", at: "edit" },
      { name: "e2e", runner: "vitest", project: "e2e", at: "stop" },
    ]);
    expect(coverageProblems(groups, CHECKS)).toEqual([
      `"checks" group "e2e" selects only checks group "all" above it owns`,
    ]);
  });

  it("names every group above that owns them", () => {
    const groups = groupsOf([
      { name: "a", runner: "vitest", tests: ["test/a.test.ts"], at: "edit" },
      { name: "b", runner: "vitest", project: "unit", at: "edit" },
      { name: "c", runner: "vitest", tests: ["test/*.test.ts"], at: "edit" },
    ]);
    expect(coverageProblems(groups, CHECKS)).toEqual([
      `"checks" group "c" selects only checks groups "a", "b" above it own`,
    ]);
  });

  it("notes the files marked slow a group owns, whose marking is not used", () => {
    const groups = groupsOf(
      [
        { name: "e2e", runner: "vitest", project: "e2e", at: "stop" },
        { name: "unit", runner: "vitest", at: "edit" },
      ],
      { slow: { include: ["test/e2e/**", "test/b.test.ts"] } },
    );
    expect(coverageProblems(groups, CHECKS)).toEqual([
      `"checks" group "e2e" owns 1 test file marked slow; their slow marking is not used`,
      `"checks" group "unit" owns 1 test file marked slow; their slow marking is not used`,
    ]);
    const all = groupsOf([{ name: "all", runner: "vitest", at: "edit" }], {
      slow: { include: ["test/**"] },
    });
    expect(coverageProblems(all, CHECKS)).toEqual([
      `"checks" group "all" owns 3 test files marked slow; their slow marking is not used`,
    ]);
  });
});
