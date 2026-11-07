import { describe, expect, it } from "vitest";
import { groupOf, resolveGroups } from "../../src/core/daemon/check-groups.js";
import type { GroupCheck } from "../../src/core/types/check-groups.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { API_PROJECT, EXAMPLE, useLoad } from "./checks-load.js";

/*
 * Spec 019 D2: with no `checks` key, two default groups reproduce today's
 * behaviour: `tests`, every file not marked slow, at `edit`; `slow`, every
 * file marked slow (`slow.include`, `nodeTest[].slow`, `pytest[].slow`), at
 * the moment `slow.trigger` and `stop.requireSlowSuite` give, after
 * `tests`, with today's slow limits. D1: the first group that selects a
 * check owns it; the defaults own what no group does.
 */

const load = useLoad();
const policyOf = (file: unknown): Policy => {
  const { policy, problems } = load(file);
  expect(problems).toEqual([]);
  return policy;
};
const test = (
  runner: "vitest" | "nodeTest" | "pytest",
  project: string,
  path: string,
): GroupCheck => ({
  kind: "test",
  runner,
  project,
  path,
});
const owner = (policy: Policy, check: GroupCheck) =>
  groupOf(resolveGroups(policy), check)?.name ?? null;

describe("default check groups (spec 019 D2)", () => {
  it("are tests at edit, then slow after tests with today's slow limits", () => {
    expect(resolveGroups(DEFAULT_POLICY)).toEqual([
      {
        name: "tests",
        index: null,
        at: "edit",
        stopRequires: false,
        after: [],
        quietMs: 0,
        limits: { maxParallel: null, maxWorkers: null, priority: "normal", deferUnderLoad: null },
        select: { kind: "marked", slow: false, include: [], projects: [] },
      },
      {
        name: "slow",
        index: null,
        at: "edit",
        stopRequires: false,
        after: ["tests"],
        quietMs: 3_000,
        limits: {
          maxParallel: 4,
          maxWorkers: 2,
          priority: "low",
          deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 600_000 },
        },
        select: { kind: "marked", slow: true, include: [], projects: [] },
      },
    ]);
  });

  it.each([
    ["continuous", false, "edit", false, 1_500],
    ["continuous", true, "edit", true, 1_500],
    ["idle", false, "pause", false, 0],
    ["idle", true, "stop", true, 0],
  ])(
    "puts slow under slow.trigger %s, requireSlowSuite %s at %s, Stop waiting %s, quiet %d ms",
    (trigger, requireSlowSuite, at, stopRequires, quietMs) => {
      const policy = policyOf({ slow: { trigger, quietMs: 1_500 }, stop: { requireSlowSuite } });
      const slow = resolveGroups(policy).at(-1);
      expect(slow).toMatchObject({ name: "slow", at, stopRequires, quietMs, after: ["tests"] });
    },
  );

  it("gives slow the limits of slow.maxParallel, maxWorkers, maxLoadPerCpu and maxDeferMs", () => {
    const policy = policyOf({
      slow: { maxParallel: 1, maxWorkers: 3, maxLoadPerCpu: 0.5, maxDeferMs: 60_000 },
    });
    expect(resolveGroups(policy).at(-1)?.limits).toEqual({
      maxParallel: 1,
      maxWorkers: 3,
      priority: "low",
      deferUnderLoad: { maxLoadPerCpu: 0.5, maxDeferMs: 60_000 },
    });
  });

  const marked = () =>
    policyOf({
      slow: { include: ["test/e2e/**"] },
      nodeTest: [
        { name: "browser", include: ["test/**/*.test.mjs"], slow: true },
        { name: "unit", include: ["unit/**/*.test.mjs"] },
      ],
      pytest: [
        { name: "api", include: ["tests/**"], slow: true },
        { name: "core", include: ["core/**"] },
      ],
    });
  it.each([
    ["a Vitest file under slow.include", test("vitest", "", "test/e2e/login.test.ts"), "slow"],
    ["a Vitest file outside it", test("vitest", "", "test/unit/a.test.ts"), "tests"],
    [
      "a node:test file under slow.include",
      test("nodeTest", "unit", "test/e2e/a.test.mjs"),
      "slow",
    ],
    [
      "a file of a nodeTest entry marked slow",
      test("nodeTest", "browser", "test/b.test.mjs"),
      "slow",
    ],
    ["a file of a nodeTest entry not marked", test("nodeTest", "unit", "unit/a.test.mjs"), "tests"],
    ["a file of a pytest entry marked slow", test("pytest", "api", "tests/test_a.py"), "slow"],
    ["a file of a pytest entry not marked", test("pytest", "core", "core/test_a.py"), "tests"],
    [
      "a Vitest file of a project named like a slow entry",
      test("vitest", "api", "a.test.ts"),
      "tests",
    ],
    [
      "a lint check, which keeps lint's own moments",
      { kind: "lint", tool: "eslint", path: "src/a.ts" } as GroupCheck,
      null,
    ],
  ])("gives %s to %s", (_, check, group) => {
    expect(owner(marked(), check)).toBe(group);
  });
});

describe("check groups from checks (spec 019 D1)", () => {
  const example = () =>
    policyOf({ checks: EXAMPLE, pytest: [API_PROJECT], slow: { include: ["test/slow/**"] } });

  it("orders the groups as listed, then the defaults", () => {
    expect(resolveGroups(example()).map((g) => [g.name, g.index])).toEqual([
      ["e2e", 0],
      ["unit", 1],
      ["api", 2],
      ["lint", 3],
      ["tests", null],
      ["slow", null],
    ]);
  });

  it("resolves each group with its defaults applied", () => {
    expect(resolveGroups(example()).slice(0, 4)).toEqual([
      {
        name: "e2e",
        index: 0,
        at: "stop",
        stopRequires: true,
        after: ["unit"],
        quietMs: 0,
        limits: { maxParallel: 1, maxWorkers: null, priority: "normal", deferUnderLoad: null },
        select: { kind: "tests", runner: "vitest", project: "e2e", tests: null },
      },
      expect.objectContaining({
        name: "unit",
        at: "edit",
        stopRequires: false,
        after: [],
        select: { kind: "tests", runner: "vitest", project: null, tests: ["test/**"] },
      }),
      expect.objectContaining({
        name: "api",
        at: "pause",
        select: { kind: "tests", runner: "pytest", project: "api", tests: null },
      }),
      expect.objectContaining({
        name: "lint",
        at: "commit",
        select: { kind: "lint", tools: null },
      }),
    ]);
  });

  it.each([
    [
      "a file of the e2e project, which unit's glob also reaches",
      test("vitest", "e2e", "test/a.test.ts"),
      "e2e",
    ],
    ["a Vitest file under test/", test("vitest", "", "test/a.test.ts"), "unit"],
    ["a file marked slow that a group selects", test("vitest", "", "test/slow/a.test.ts"), "unit"],
    ["a Vitest file outside test/", test("vitest", "", "src/a.test.ts"), "tests"],
    ["a pytest file of the api entry", test("pytest", "api", "tests/test_a.py"), "api"],
    ["a node:test file", test("nodeTest", "unit", "test/a.test.mjs"), "tests"],
    ["an ESLint check", { kind: "lint", tool: "eslint", path: "src/a.ts" } as GroupCheck, "lint"],
    ["an oxlint check", { kind: "lint", tool: "oxlint", path: "src/a.ts" } as GroupCheck, "lint"],
  ])("gives %s to %s", (_, check, group) => {
    expect(owner(example(), check)).toBe(group);
  });

  it("gives a file marked slow that no group selects to the default slow group", () => {
    const policy = policyOf({ checks: EXAMPLE.slice(1, 2), slow: { include: ["spec/**"] } });
    expect(owner(policy, test("vitest", "", "spec/a.test.ts"))).toBe("slow");
  });

  it.each([
    ["eslint", null],
    ["oxlint", "l"],
  ] as const)("gives a %s check to %s when the group names only oxlint", (tool, group) => {
    const policy = policyOf({ checks: [{ name: "l", lint: ["oxlint"], at: "commit" }] });
    expect(owner(policy, { kind: "lint", tool, path: "src/a.ts" })).toBe(group);
  });

  const none = { maxParallel: null, maxWorkers: null, priority: "normal", deferUnderLoad: null };
  it.each([
    [{}, none],
    [{ maxParallel: 2 }, { ...none, maxParallel: 2 }],
    [{ maxWorkers: 2 }, { ...none, maxWorkers: 2 }],
    [{ priority: "low" }, { ...none, priority: "low" }],
    [
      { deferUnderLoad: {} },
      { ...none, deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 600_000 } },
    ],
    [
      { deferUnderLoad: { maxDeferMs: 5 } },
      { ...none, deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 5 } },
    ],
    [
      { deferUnderLoad: { maxLoadPerCpu: 2 } },
      { ...none, deferUnderLoad: { maxLoadPerCpu: 2, maxDeferMs: 600_000 } },
    ],
  ])("resolves limits %j", (limits, resolved) => {
    const policy = policyOf({ checks: [{ name: "g", runner: "vitest", at: "edit", limits }] });
    expect(resolveGroups(policy)[0]?.limits).toEqual(resolved);
  });

  it("resolves quietMs as given, 0 when absent", () => {
    const policy = policyOf({
      checks: [
        { name: "a", runner: "vitest", at: "edit", quietMs: 2_000 },
        { name: "b", runner: "vitest", at: "edit" },
      ],
    });
    expect(resolveGroups(policy).map((g) => g.quietMs)).toEqual([2_000, 0, 0, 3_000]);
  });
});
