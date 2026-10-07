import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { versionBumpProblem } from "../../scripts/check-version-bump.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

// 001-76: CI fails when the shipped bundles change and the version Claude Code compares does not.
const SCRIPT = join(REPO_ROOT, "scripts/check-version-bump.ts");
const pkg = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** A repository at version 0.1.0 with one bundle per plugin; returns it and its first commit. */
function repo(): { root: string; base: string } {
  const dir = tempDir("squeal-version-bump-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, {
    "package.json": pkg("0.1.0"),
    "plugins/claude-code/dist/stop.mjs": "a\n",
    "plugins/codex/dist/stop.mjs": "a\n",
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

  it("fails a Codex bundle change that keeps the version, naming the Codex bundles", () => {
    const { root, base } = repo();
    commit(root, { "plugins/codex/dist/stop.mjs": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(
      /^plugins\/codex\/dist changed but package\.json version 0\.1\.0 is not greater than 0\.1\.0/,
    );
  });

  it("passes a Codex bundle change with a greater version", () => {
    const { root, base } = repo();
    commit(root, { "plugins/codex/dist/stop.mjs": "b\n", "package.json": pkg("0.1.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });

  it("passes a change outside the bundles without a bump", () => {
    const { root, base } = repo();
    commit(root, { "src/index.ts": "b\n", "plugins/codex/README.md": "b\n" });
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
    expect(run(root, [base])).toMatch(/0\.1\.0 -> 0\.1\.1/);
  });

  it("skips with no base commit, as on a new branch's first push", () => {
    const { root } = repo();
    expect(run(root, ["0000000000000000000000000000000000000000"])).toMatch(/no base/);
  });
});
