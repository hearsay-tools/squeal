import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/*
 * Spec 003 D1: "`squeal.config.json` gains `nodeTest`, a list of projects
 * [...]. The 001 policy loader rules apply: a bad entry is a problem note
 * with that project skipped, never a crash."
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(nodeTest: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-node-test-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify({ nodeTest }));
  return loadPolicy(dir);
}

const UNIT = {
  name: "test:unit",
  cwd: "packages/demo",
  node: "/usr/bin/node",
  argv: ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx"],
  env: { TZ: "UTC" },
  include: ["test/unit/*.test.ts"],
  exclude: ["test/unit/slow.test.ts"],
};

describe("policy nodeTest (spec 003 D1)", () => {
  it("defaults to no projects", () => {
    expect(DEFAULT_POLICY.nodeTest).toEqual([]);
  });

  it("accepts a valid list as given", () => {
    const e2e = { name: "test:package", include: ["test/e2e/*.test.ts"] };
    const { policy, problems } = load([UNIT, e2e]);
    expect(problems).toEqual([]);
    expect(policy.nodeTest).toEqual([UNIT, { ...e2e, argv: [], env: {} }]);
  });

  it("notes a bad entry and keeps the rest", () => {
    const { policy, problems } = load([
      UNIT,
      { name: "test:package", argv: "--import tsx", include: ["test/e2e/*.test.ts"] },
    ]);
    expect(policy.nodeTest).toEqual([UNIT]);
    expect(problems).toEqual([
      `"nodeTest[1].argv" must be an array of strings, got "--import tsx"; project "test:package" is skipped`,
    ]);
  });

  it.each([
    ["not an object", "unit", `"nodeTest[0]" must be an object, got "unit"; it is skipped`],
    [
      "without a name",
      { include: ["a.test.ts"] },
      `"nodeTest[0].name" must be a non-empty string, got undefined; it is skipped`,
    ],
    [
      "without include",
      { name: "u" },
      `"nodeTest[0].include" must be a non-empty array of strings, got undefined; project "u" is skipped`,
    ],
    [
      "with an empty include",
      { name: "u", include: [] },
      `"nodeTest[0].include" must be a non-empty array of strings, got []; project "u" is skipped`,
    ],
    [
      "with a glob Squeal cannot use",
      { name: "u", include: ["test/[a.test.ts"] },
      /^"nodeTest\[0\]\.include" has a glob Squeal cannot use: .+; project "u" is skipped$/,
    ],
    [
      "with an absolute cwd",
      { name: "u", cwd: "/srv/demo", include: ["a.test.ts"] },
      `"nodeTest[0].cwd" must be a path inside the worktree, relative to its root, got "/srv/demo"; project "u" is skipped`,
    ],
    [
      "with a cwd outside the worktree",
      { name: "u", cwd: "packages/../../demo", include: ["a.test.ts"] },
      `"nodeTest[0].cwd" must be a path inside the worktree, relative to its root, got "packages/../../demo"; project "u" is skipped`,
    ],
    [
      "with an empty node",
      { name: "u", node: "", include: ["a.test.ts"] },
      `"nodeTest[0].node" must be a non-empty string, got ""; project "u" is skipped`,
    ],
    [
      "with a non-string env value",
      { name: "u", env: { PORT: 3000 }, include: ["a.test.ts"] },
      `"nodeTest[0].env" must be an object from variable name to string, got {"PORT":3000}; project "u" is skipped`,
    ],
    [
      "with a bad exclude",
      { name: "u", include: ["a.test.ts"], exclude: "b.test.ts" },
      `"nodeTest[0].exclude" must be a non-empty array of strings, got "b.test.ts"; project "u" is skipped`,
    ],
    [
      "with an unknown key",
      { name: "u", inclde: ["a.test.ts"], include: ["b.test.ts"] },
      `unknown key "nodeTest[0].inclde"; project "u" is skipped`,
    ],
  ])("skips an entry %s with one problem", (_, entry, problem) => {
    const { policy, problems } = load([entry]);
    expect(policy.nodeTest).toEqual([]);
    expect(problems).toHaveLength(1);
    if (typeof problem === "string") expect(problems[0]).toBe(problem);
    else expect(problems[0]).toMatch(problem);
  });

  it("skips a second project with the same name", () => {
    const { policy, problems } = load([UNIT, { name: UNIT.name, include: ["other.test.ts"] }]);
    expect(policy.nodeTest).toEqual([UNIT]);
    expect(problems).toEqual([
      `"nodeTest[1].name" repeats "test:unit" of an earlier project; it is skipped`,
    ]);
  });

  it("is no projects with one problem when it is not a list", () => {
    const { policy, problems } = load({ unit: UNIT });
    expect(policy.nodeTest).toEqual([]);
    expect(problems).toEqual([
      expect.stringMatching(/^"nodeTest" must be an array of projects, got \{/),
    ]);
  });

  it("keeps the other keys when one entry is bad", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-policy-node-test-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, POLICY_FILE),
      JSON.stringify({ runner: { tierSize: 2 }, nodeTest: [{ name: "u" }] }),
    );
    const { policy, problems } = loadPolicy(dir);
    expect(policy.runner.tierSize).toBe(2);
    expect(problems).toHaveLength(1);
  });
});
