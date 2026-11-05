import { describe, expect, it } from "vitest";
import { useLoad } from "./checks-load.js";

/*
 * Spec 019 D1 under the 001 D11 loader rules: a bad group is one problem
 * naming it, and it is left out; the others are kept. A group whose `after`
 * names a group left out is left out too.
 */

const load = useLoad();
const unit = { name: "unit", runner: "vitest", at: "edit" };
/** What a case is, the group, and the one problem it gives. */
type Row = [string, unknown, string];

describe("policy checks problems (spec 019 D1)", () => {
  it.each([
    [{ name: "unit" }, `"checks" must be an array of check groups, got {"name":"unit"}`],
    ["unit", `"checks" must be an array of check groups, got "unit"`],
  ])("names a value that is not a list, %j, and applies no groups", (checks, problem) => {
    const { policy, problems } = load({ checks });
    expect(problems).toEqual([problem]);
    expect(policy.checks).toEqual([]);
  });

  const at0 = `"checks[0]`;
  it.each<Row>([
    ["not an object", "unit", `${at0}" must be an object, got "unit"; it is left out`],
    [
      "both runner and lint",
      { ...unit, lint: true },
      `${at0}" has both "runner" and "lint"; a group has one; group "unit" is left out`,
    ],
    [
      "neither runner nor lint",
      { name: "unit", at: "edit" },
      `${at0}" has neither "runner" nor "lint"; a group needs one; group "unit" is left out`,
    ],
    [
      "no name",
      { runner: "vitest", at: "edit" },
      `${at0}.name" is missing; every group needs one; it is left out`,
    ],
    [
      "no moment",
      { name: "unit", runner: "vitest" },
      `${at0}.at" is missing; every group needs one; group "unit" is left out`,
    ],
    ...["", "e2e tests", "--all", "test/e2e", "-x"].map(
      (name): Row => [
        `the name ${JSON.stringify(name)}`,
        { ...unit, name },
        `${at0}.name" must be a name of letters, digits, - and _, got ${JSON.stringify(name)}; it is left out`,
      ],
    ),
    ...["tests", "slow"].map(
      (name): Row => [
        `the default group's name ${name}`,
        { ...unit, name },
        `${at0}.name" is "${name}", the name of a default group; it is left out`,
      ],
    ),
    [
      "an unknown runner",
      { ...unit, runner: "jest" },
      `${at0}.runner" must be one of "vitest", "nodeTest", "pytest", got "jest"; group "unit" is left out`,
    ],
    [
      "an unknown moment",
      { ...unit, at: "push" },
      `${at0}.at" must be one of "edit", "pause", "stop", "commit", got "push"; group "unit" is left out`,
    ],
    [
      "a project on a lint group",
      { name: "l", lint: true, at: "edit", project: "e2e" },
      `${at0}.project" needs "runner"; a lint group has none; group "l" is left out`,
    ],
    [
      "test globs on a lint group",
      { name: "l", lint: true, at: "edit", tests: ["src/**"] },
      `${at0}.tests" needs "runner"; a lint group has none; group "l" is left out`,
    ],
    // Row 019-45: a lint group key the build does not honour is a problem, never accepted and ignored.
    ...(
      [
        ["after", ["tests"]],
        ["quietMs", 0],
        ["limits", { maxParallel: 1 }],
      ] as const
    ).map(
      ([key, value]): Row => [
        `${key} on a lint group`,
        { name: "l", lint: true, at: "stop", [key]: value },
        `${at0}.${key}" applies to test groups only; a lint group has "name", "lint" and "at"; group "l" is left out`,
      ],
    ),
    ...[false, [], ["prettier"], "eslint"].map(
      (lint): Row => [
        `lint ${JSON.stringify(lint)}`,
        { name: "l", lint, at: "edit" },
        `${at0}.lint" must be true, or a non-empty array of "eslint" and "oxlint", got ${JSON.stringify(lint)}; group "l" is left out`,
      ],
    ),
    [
      "an empty project",
      { ...unit, project: "" },
      `${at0}.project" must be a non-empty string, got ""; group "unit" is left out`,
    ],
    ...[[], "test/**", [3]].map(
      (tests): Row => [
        `tests ${JSON.stringify(tests)}`,
        { ...unit, tests },
        `${at0}.tests" must be a non-empty array of strings, got ${JSON.stringify(tests)}; group "unit" is left out`,
      ],
    ),
    [
      "after that is not a list of names",
      { ...unit, after: "tests" },
      `${at0}.after" must be an array of group names, got "tests"; group "unit" is left out`,
    ],
    ...[-1, "1", null].map(
      (quietMs): Row => [
        `quietMs ${JSON.stringify(quietMs)}`,
        { ...unit, quietMs },
        `${at0}.quietMs" must be a number >= 0, got ${JSON.stringify(quietMs)}; group "unit" is left out`,
      ],
    ),
    [
      "an unknown key",
      { ...unit, test: ["a/**"] },
      `unknown key "checks[0].test"; group "unit" is left out`,
    ],
  ])("leaves out a group with %s", (_, group, problem) => {
    const { policy, problems } = load({ checks: [group, { ...unit, name: "kept" }] });
    expect(problems).toEqual([problem]);
    expect(policy.checks).toEqual([{ ...unit, name: "kept" }]);
  });

  it.each(["!test/unit/**", "test/[x.test.ts", "/abs/**"])(
    "leaves out a group with a glob that does not compile, %s",
    (glob) => {
      const { policy, problems } = load({ checks: [{ ...unit, tests: ["test/**", glob] }] });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        /^"checks\[0\]\.tests" has a glob Squeal cannot use: .+; group "unit" is left out$/,
      );
      expect(policy.checks).toEqual([]);
    },
  );

  const limit = `"checks[0].limits`;
  it.each([
    ["not an object", 1, `${limit}" must be an object, got 1`],
    ["an unknown key", { maxParalel: 1 }, `unknown key "checks[0].limits.maxParalel"`],
    [
      "maxParallel 0",
      { maxParallel: 0 },
      `${limit}.maxParallel" must be a positive integer, got 0`,
    ],
    [
      "maxWorkers 1.5",
      { maxWorkers: 1.5 },
      `${limit}.maxWorkers" must be a positive integer, got 1.5`,
    ],
    [
      "priority high",
      { priority: "high" },
      `${limit}.priority" must be one of "normal", "low", got "high"`,
    ],
    [
      "deferUnderLoad true",
      { deferUnderLoad: true },
      `${limit}.deferUnderLoad" must be an object, got true`,
    ],
    [
      "deferUnderLoad.maxLoadPerCpu 0",
      { deferUnderLoad: { maxLoadPerCpu: 0 } },
      `${limit}.deferUnderLoad.maxLoadPerCpu" must be a number > 0, got 0`,
    ],
    [
      "deferUnderLoad.maxDeferMs -1",
      { deferUnderLoad: { maxDeferMs: -1 } },
      `${limit}.deferUnderLoad.maxDeferMs" must be a number >= 0, got -1`,
    ],
    [
      "an unknown deferUnderLoad key",
      { deferUnderLoad: { maxLoad: 1 } },
      `unknown key "checks[0].limits.deferUnderLoad.maxLoad"`,
    ],
  ])("leaves out a group whose limits have %s", (_, limits, problem) => {
    const { policy, problems } = load({ checks: [{ ...unit, limits }] });
    expect(problems).toEqual([`${problem}; group "unit" is left out`]);
    expect(policy.checks).toEqual([]);
  });

  it("leaves out a later group with an earlier group's name", () => {
    const { policy, problems } = load({ checks: [unit, { ...unit, at: "stop" }] });
    expect(problems).toEqual([
      `"checks[1].name" repeats "unit" of an earlier group; it is left out`,
    ]);
    expect(policy.checks).toEqual([unit]);
  });
});
