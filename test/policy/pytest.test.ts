import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

/*
 * Spec 007 D1: "`squeal.config.json` gains `pytest`, a list of projects,
 * each with `name`, `cwd`, `python`, `args`, `env`, `include` and optional
 * `exclude`, `slow`. The 001 D11 loader rules apply."
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(pytest: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-pytest-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify({ pytest }));
  return loadPolicy(dir);
}

const APP = {
  name: "app",
  cwd: "services/app",
  python: ".venv",
  args: ["-p", "acme_plugin", "--ds=settings"],
  env: { TZ: "UTC" },
  include: ["tests/**/test_*.py"],
  exclude: ["tests/slow/**"],
  slow: false,
};

describe("policy pytest (spec 007 D1)", () => {
  it("defaults to no projects", () => {
    expect(DEFAULT_POLICY.pytest).toEqual([]);
  });

  it("accepts a valid list as given and defaults args and env", () => {
    const other = { name: "other", include: ["tests/*.py"] };
    const { policy, problems } = load([APP, other]);
    expect(problems).toEqual([]);
    expect(policy.pytest).toEqual([APP, { ...other, args: [], env: {} }]);
  });

  it.each([
    ["an absolute out-of-tree environment", "/opt/envs/app"],
    ["an interpreter path inside the worktree", "../../.venv/bin/python"],
  ])("accepts python as %s", (_, python) => {
    const { policy, problems } = load([
      { name: "a", cwd: "services/app", python, include: ["t.py"] },
    ]);
    expect(problems).toEqual([]);
    expect(policy.pytest[0]?.python).toBe(python);
  });

  it.each([
    [
      "without include",
      { name: "u" },
      `"pytest[0].include" must be a non-empty array of strings, got undefined; project "u" is skipped`,
    ],
    [
      "with string args",
      { name: "u", args: "-p acme", include: ["t.py"] },
      `"pytest[0].args" must be an array of strings, got "-p acme"; project "u" is skipped`,
    ],
    [
      "with a cwd outside the worktree",
      { name: "u", cwd: "../other", include: ["t.py"] },
      `"pytest[0].cwd" must be a path inside the worktree, relative to its root, got "../other"; project "u" is skipped`,
    ],
    [
      "with an empty python",
      { name: "u", python: "", include: ["t.py"] },
      `"pytest[0].python" must be a non-empty string, got ""; project "u" is skipped`,
    ],
    [
      "with a relative python above the worktree",
      { name: "u", cwd: "services/app", python: "../../../main/.venv", include: ["t.py"] },
      `"pytest[0].python" must stay inside the worktree when relative (absolute only for an environment outside it), got "../../../main/.venv"; project "u" is skipped`,
    ],
    [
      "with the node:test key argv",
      { name: "u", argv: ["-x"], include: ["t.py"] },
      `unknown key "pytest[0].argv"; project "u" is skipped`,
    ],
  ])("skips an entry %s with one problem", (_, entry, problem) => {
    const { policy, problems } = load([entry]);
    expect(policy.pytest).toEqual([]);
    expect(problems).toEqual([problem]);
  });

  it("skips a second project with the same name", () => {
    const { policy, problems } = load([APP, { name: "app", include: ["t.py"] }]);
    expect(policy.pytest).toEqual([APP]);
    expect(problems).toEqual([
      `"pytest[1].name" repeats "app" of an earlier project; it is skipped`,
    ]);
  });

  it("is no projects with one problem when it is not a list", () => {
    const { policy, problems } = load({ app: APP });
    expect(policy.pytest).toEqual([]);
    expect(problems).toEqual([expect.stringMatching(/^"pytest" must be an array of projects/)]);
  });
});
