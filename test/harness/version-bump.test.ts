import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { versionBumpProblem } from "../../scripts/check-version-bump.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

// 001-76: CI fails when the shipped bundles change and the version Claude Code compares does not.
// Spec 002 D7 (row 002-31): the fixed Codex plugin has its own version, raised for any change.
const SCRIPT = join(REPO_ROOT, "scripts/check-version-bump.ts");
const pkg = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;
const ADAPTER_MANIFEST = "plugins/codex/.codex-plugin/plugin.json";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/**
 * A repository at version 0.1.0 with one bundle per plugin, the Codex runtime and the fixed
 * Codex plugin at adapter version 1.0.0; returns it and its first commit.
 */
function repo(): { root: string; base: string } {
  const dir = tempDir("squeal-version-bump-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, {
    "package.json": pkg("0.1.0"),
    "plugins/claude-code/dist/stop.mjs": "a\n",
    "plugins/codex-runtime/dist/stop.mjs": "a\n",
    "plugins/codex-runtime/skills/squeal/SKILL.md": "a\n",
    [ADAPTER_MANIFEST]: pkg("1.0.0"),
    "plugins/codex/dist/stop.mjs": "a\n",
    "plugins/codex/seed/runtime.json": "a\n",
    "plugins/codex/README.md": "a\n",
    "src/index.ts": "a\n",
  });
  return { root: dir.path, base: head(dir.path) };
}

function commit(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
  git(root, ["commit", "-q", "-am", "change"]);
  return head(root);
}

const head = (root: string) => git(root, ["rev-parse", "HEAD"]).trim();

describe("versionBumpProblem", () => {
  it("fails a bundle change that keeps the version", () => {
    const { root, base } = repo();
    commit(root, { "plugins/claude-code/dist/stop.mjs": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(/0\.1\.0.*not greater than 0\.1\.0/);
  });

  it("fails a bundle change that lowers the version", () => {
    const { root, base } = repo();
    commit(root, { "plugins/claude-code/dist/stop.mjs": "b\n", "package.json": pkg("0.0.9") });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(/0\.0\.9.*not greater than 0\.1\.0/);
  });

  it("passes a bundle change with a greater version, compared numerically", () => {
    const { root, base } = repo();
    commit(root, { "plugins/claude-code/dist/stop.mjs": "b\n", "package.json": pkg("0.1.10") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it("fails a Codex runtime change that keeps the version, naming the runtime", () => {
    const { root, base } = repo();
    commit(root, { "plugins/codex-runtime/skills/squeal/SKILL.md": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(
      /^plugins\/codex-runtime changed but package\.json version 0\.1\.0 is not greater than 0\.1\.0/,
    );
  });

  it("passes a Codex runtime change with a greater root version and the adapter's unchanged", () => {
    const { root, base } = repo();
    commit(root, { "plugins/codex-runtime/dist/stop.mjs": "b\n", "package.json": pkg("0.1.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it.each([
    ["an adapter bundle", "plugins/codex/dist/stop.mjs"],
    ["the seed", "plugins/codex/seed/runtime.json"],
    ["the README", "plugins/codex/README.md"],
  ])("fails a change to %s of the fixed plugin that keeps the adapter version", (_, path) => {
    const { root, base } = repo();
    commit(root, { [path]: "b\n", "package.json": pkg("0.1.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBe(
      `plugins/codex changed but its adapter version in ${ADAPTER_MANIFEST} 1.0.0 is not greater than 1.0.0: any change to the fixed Codex plugin is an adapter release, which users approve again (spec 002 D7)`,
    );
  });

  it("passes a fixed plugin change with a greater adapter version and the root version unchanged", () => {
    const { root, base } = repo();
    commit(root, { "plugins/codex/dist/stop.mjs": "b\n", [ADAPTER_MANIFEST]: pkg("1.0.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it("names both problems when the runtime and the fixed plugin change with neither raised", () => {
    const { root, base } = repo();
    commit(root, {
      "plugins/codex-runtime/dist/stop.mjs": "b\n",
      "plugins/codex/dist/stop.mjs": "b\n",
    });
    expect(versionBumpProblem(base, "HEAD", root)?.split("\n")).toEqual([
      expect.stringMatching(/^plugins\/codex-runtime changed but package\.json version/),
      expect.stringMatching(/^plugins\/codex changed but its adapter version/),
    ]);
  });

  it("passes the migration from a plugin at the root version to adapter 1.0.0", () => {
    const { root } = repo();
    const base = commit(root, { [ADAPTER_MANIFEST]: pkg("0.1.0") });
    commit(root, { "plugins/codex/dist/stop.mjs": "b\n", [ADAPTER_MANIFEST]: pkg("1.0.0") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it("passes a change outside the bundles without a bump", () => {
    const { root, base } = repo();
    commit(root, { "src/index.ts": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it("names a version that is not major.minor.patch", () => {
    const { root, base } = repo();
    commit(root, { "plugins/claude-code/dist/stop.mjs": "b\n", "package.json": pkg("0.2.0-rc.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(
      /"0\.2\.0-rc\.1" is not major\.minor\.patch/,
    );
  });
});

describe("scripts/check-version-bump.ts as CI runs it", () => {
  const run = (root: string, args: string[]) =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SCRIPT, ...args],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );

  it("exits 1 on a bundle change without a bump and 0 after the bump", () => {
    const { root, base } = repo();
    commit(root, { "plugins/claude-code/dist/stop.mjs": "b\n" });
    expect(() => run(root, [base])).toThrow(/not greater than 0\.1\.0/);
    commit(root, { "package.json": pkg("0.1.1") });
    expect(run(root, [base])).toMatch(
      /0\.1\.0 -> 0\.1\.1, ok\nadapter version: 1\.0\.0 -> 1\.0\.0, ok/,
    );
  });

  it("skips with no base commit, as on a new branch's first push", () => {
    const { root } = repo();
    expect(run(root, ["0000000000000000000000000000000000000000"])).toMatch(/no base/);
  });
});
