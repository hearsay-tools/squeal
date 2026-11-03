import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { API_PROJECT, EXAMPLE, useLoad } from "./checks-load.js";

/*
 * Spec 019 D1: `checks` accepts each selector, moment, `after`, `quietMs`
 * and limit as given; D4 step 3: `stop.maxHolds`, default 1, at least 1.
 * Every bad value is one problem under the 001 D11 loader rules; those are
 * test/policy/checks-problems.test.ts.
 */

const load = useLoad();
const unit = { name: "unit", runner: "vitest", at: "edit" };

describe("policy checks (spec 019 D1)", () => {
  it("defaults to no groups", () => {
    expect(DEFAULT_POLICY.checks).toEqual([]);
  });

  it("accepts the spec's example as given", () => {
    const { policy, problems } = load({ checks: EXAMPLE, pytest: [API_PROJECT] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual(EXAMPLE);
  });

  it.each([
    ["a runner alone", { runner: "vitest" }],
    ["each runner: nodeTest", { runner: "nodeTest" }],
    ["each runner: pytest", { runner: "pytest" }],
    ["a Vitest project", { runner: "vitest", project: "e2e" }],
    ["a nodeTest entry", { runner: "nodeTest", project: "browser" }],
    ["test globs", { runner: "vitest", tests: ["test/e2e/**", "test/*.e2e.ts"] }],
    ["a project and test globs", { runner: "vitest", project: "e2e", tests: ["test/a/**"] }],
    ["every lint check", { lint: true }],
    ["named lint tools", { lint: ["oxlint"] }],
    ["both lint tools", { lint: ["eslint", "oxlint"] }],
  ])("accepts a selector: %s", (_, selector) => {
    const group = { name: "g", at: "edit", ...selector };
    const nodeTest = [{ name: "browser", include: ["test/**/*.test.mjs"] }];
    const { policy, problems } = load({ checks: [group], nodeTest });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([group]);
  });

  it.each(["edit", "pause", "stop", "commit"])("accepts the moment %s", (at) => {
    const { policy, problems } = load({ checks: [{ ...unit, at }] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([{ ...unit, at }]);
  });

  it.each([
    ["no group", [], "edit"],
    ["a group at the same moment", ["unit"], "edit"],
    ["a group at an earlier moment", ["unit"], "stop"],
    ["two groups", ["unit", "api"], "commit"],
    ["the default tests group", ["tests"], "pause"],
    ["the default slow group, at edit by default", ["slow"], "edit"],
  ])("accepts after naming %s", (_, after, at) => {
    const api = { name: "api", runner: "pytest", at: "pause" };
    const group = { name: "e2e", runner: "vitest", project: "e2e", at, after };
    const { policy, problems } = load({ checks: [unit, api, group] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([unit, api, group]);
  });

  it.each([
    ["idle", false, "pause"],
    ["idle", true, "stop"],
    ["continuous", true, "edit"],
  ])(
    "accepts after naming slow under slow.trigger %s, requireSlowSuite %s, from %s",
    (trigger, requireSlowSuite, at) => {
      const group = { name: "e2e", runner: "vitest", at, after: ["slow"] };
      const { policy, problems } = load({
        checks: [group],
        slow: { trigger },
        stop: { requireSlowSuite },
      });
      expect(problems).toEqual([]);
      expect(policy.checks).toEqual([group]);
    },
  );

  it.each([0, 3_000])("accepts quietMs %d", (quietMs) => {
    const { policy, problems } = load({ checks: [{ ...unit, quietMs }] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([{ ...unit, quietMs }]);
  });

  it.each([
    { maxParallel: 1 },
    { maxWorkers: 2 },
    { priority: "normal" },
    { priority: "low" },
    { deferUnderLoad: {} },
    { deferUnderLoad: { maxLoadPerCpu: 0.5 } },
    { deferUnderLoad: { maxDeferMs: 0 } },
    { deferUnderLoad: { maxLoadPerCpu: 1.5, maxDeferMs: 60_000 } },
    {
      maxParallel: 1,
      maxWorkers: 1,
      priority: "low",
      deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 600_000 },
    },
    {},
  ])("accepts limits %j", (limits) => {
    const { policy, problems } = load({ checks: [{ ...unit, limits }] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([{ ...unit, limits }]);
  });

  it("keeps the order of the list, which decides ownership", () => {
    const groups = ["c", "a", "b"].map((name) => ({ ...unit, name }));
    expect(load({ checks: groups }).policy.checks.map((g) => g.name)).toEqual(["c", "a", "b"]);
  });
});

describe("policy stop.maxHolds (spec 019 D4 step 3)", () => {
  it("defaults to one hold", () => {
    expect(DEFAULT_POLICY.stop.maxHolds).toBe(1);
  });

  it.each([1, 2, 8])("accepts %d", (maxHolds) => {
    const { policy, problems } = load({ stop: { maxHolds } });
    expect(problems).toEqual([]);
    expect(policy.stop).toEqual({ ...DEFAULT_POLICY.stop, maxHolds });
  });

  it.each([
    [0, "0"],
    [-1, "-1"],
    [1.5, "1.5"],
    ["2", `"2"`],
    [null, "null"],
  ])("rejects %j with one problem and the default", (maxHolds, shown) => {
    const { policy, problems } = load({ stop: { maxHolds } });
    expect(problems).toEqual([`"stop.maxHolds" must be a positive integer, got ${shown}`]);
    expect(policy.stop.maxHolds).toBe(1);
  });
});
