import { describe, expect, it } from "vitest";
import { useLoad } from "./checks-load.js";

/*
 * Spec 019 D1's problems that need the other keys or the other groups: a
 * `project` the runner does not have, a lint tool `lint.tools` does not
 * run, and `after` naming an unknown group, a group at a later moment, or
 * making a cycle. Each leaves the group out, and a group whose `after`
 * names a group left out is left out in turn.
 */

const load = useLoad();
const group = (name: string, at: string, after?: string[]) => ({
  name,
  runner: "vitest",
  at,
  ...(after === undefined ? {} : { after }),
});
const leftOut = (name: string, why: string) => `"checks" group "${name}": ${why}; it is left out`;

describe("policy checks across keys (spec 019 D1)", () => {
  it.each([
    ["nodeTest", { nodeTest: [{ name: "unit", include: ["test/**"] }] }],
    ["pytest", { pytest: [{ name: "unit", include: ["tests/**"] }] }],
  ])("leaves out a %s group whose project the runner does not have", (runner, projects) => {
    const checks = [{ name: "g", runner, project: "api", at: "edit" }];
    const { policy, problems } = load({ checks, ...projects });
    expect(problems).toEqual([leftOut("g", `"project" names no ${runner} project "api"`)]);
    expect(policy.checks).toEqual([]);
  });

  it("leaves a Vitest project to the daemon, which lists the projects", () => {
    const checks = [{ name: "g", runner: "vitest", project: "nowhere", at: "edit" }];
    expect(load({ checks }).problems).toEqual([]);
  });

  it("leaves out a lint group naming a tool lint.tools does not run", () => {
    const checks = [{ name: "l", lint: ["eslint", "oxlint"], at: "commit" }];
    const { policy, problems } = load({ checks, lint: { tools: ["eslint"] } });
    expect(problems).toEqual([
      leftOut("l", `"lint" names "oxlint", which "lint.tools" does not run`),
    ]);
    expect(policy.checks).toEqual([]);
  });

  it("leaves out a group whose after names no group", () => {
    const { policy, problems } = load({
      checks: [group("unit", "edit"), group("e2e", "stop", ["unti"])],
    });
    expect(problems).toEqual([leftOut("e2e", `"after" names no group "unti"`)]);
    expect(policy.checks).toEqual([group("unit", "edit")]);
  });

  // Row 019-45: a lint group has no lane, so a test group could never wait for one.
  it("leaves out a group whose after names a lint group", () => {
    const lint = { name: "lint", lint: true, at: "stop" };
    const { policy, problems } = load({ checks: [lint, group("e2e", "stop", ["lint"])] });
    expect(problems).toEqual([
      leftOut("e2e", `"after" names "lint", a lint group; a group follows test groups only`),
    ]);
    expect(policy.checks).toEqual([lint]);
  });

  it.each([
    ["edit", "pause"],
    ["edit", "stop"],
    ["pause", "stop"],
    ["stop", "commit"],
    ["edit", "commit"],
  ])("leaves out a group at %s after a group at %s, a later moment", (at, later) => {
    const { policy, problems } = load({ checks: [group("a", later), group("b", at, ["a"])] });
    expect(problems).toEqual([
      leftOut("b", `"after" names "a", a group at "${later}", later than its own "${at}"`),
    ]);
    expect(policy.checks).toEqual([group("a", later)]);
  });

  it.each([
    ["idle", false, "pause"],
    ["idle", true, "stop"],
  ])(
    "knows the default slow group's moment under %s, requireSlowSuite %s: %s",
    (trigger, requireSlowSuite, slowAt) => {
      const { problems } = load({
        checks: [group("b", "edit", ["slow"])],
        slow: { trigger },
        stop: { requireSlowSuite },
      });
      expect(problems).toEqual([
        leftOut("b", `"after" names "slow", a group at "${slowAt}", later than its own "edit"`),
      ]);
    },
  );

  it.each([
    ["itself", [group("a", "edit", ["a"])], ["a after a"]],
    [
      "two groups",
      [group("a", "edit", ["b"]), group("b", "edit", ["a"])],
      ["a after b after a", "b after a after b"],
    ],
    [
      "three groups",
      [group("a", "stop", ["c"]), group("b", "stop", ["a"]), group("c", "stop", ["b"])],
      ["a after c after b after a", "b after a after c after b", "c after b after a after c"],
    ],
  ])("leaves out every group of an after cycle through %s", (_, checks, cycles) => {
    const { policy, problems } = load({ checks });
    expect(problems).toEqual(
      checks.map((g, i) => leftOut(g.name, `"after" makes a cycle (${cycles[i]})`)),
    );
    expect(policy.checks).toEqual([]);
  });

  it("leaves out a group after a group left out, and keeps the others", () => {
    const checks = [
      { name: "api", runner: "pytest", project: "apii", at: "pause" },
      group("e2e", "stop", ["api"]),
      group("smoke", "stop", ["e2e"]),
      group("unit", "edit"),
      group("x", "edit", ["y"]),
      group("y", "edit", ["x"]),
      group("z", "edit", ["x", "unit"]),
    ];
    const { policy, problems } = load({ checks, pytest: [{ name: "api", include: ["t/**"] }] });
    expect(problems).toEqual([
      leftOut("api", `"project" names no pytest project "apii"`),
      leftOut("e2e", `"after" names "api", a group that is left out`),
      leftOut("smoke", `"after" names "e2e", a group that is left out`),
      leftOut("x", `"after" makes a cycle (x after y after x)`),
      leftOut("y", `"after" makes a cycle (y after x after y)`),
      leftOut("z", `"after" names "x", a group that is left out`),
    ]);
    expect(policy.checks).toEqual([group("unit", "edit")]);
  });

  it("does not count a group that only leads into a cycle as part of it", () => {
    const checks = [
      group("a", "edit", ["b"]),
      group("b", "edit", ["c"]),
      group("c", "edit", ["b"]),
    ];
    expect(load({ checks }).problems).toEqual([
      leftOut("a", `"after" names "b", a group that is left out`),
      leftOut("b", `"after" makes a cycle (b after c after b)`),
      leftOut("c", `"after" makes a cycle (c after b after c)`),
    ]);
  });

  it("names a group after one the checks leaf left out as no group", () => {
    const checks = [{ name: "unit", runner: "jest", at: "edit" }, group("e2e", "stop", ["unit"])];
    expect(load({ checks }).problems).toEqual([
      `"checks[0].runner" must be one of "vitest", "nodeTest", "pytest", got "jest"; group "unit" is left out`,
      leftOut("e2e", `"after" names no group "unit"`),
    ]);
  });
});
