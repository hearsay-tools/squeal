import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { versionBumpProblem } from "../../../scripts/check-version-bump.js";
import { REPO_ROOT } from "../../../src/harness/build.js";
import { git, initRepo, tempDir, writeFile } from "../../hash/git-repo.js";

// Spec 024 D5: CI's version-raise rule covers the Antigravity plugin's committed bundles too.
const pkg = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function repo(): { root: string; base: string } {
  const dir = tempDir("squeal-antigravity-version-bump-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, { "package.json": pkg("0.1.0"), "plugins/antigravity/dist/stop.mjs": "a\n" });
  return { root: dir.path, base: git(dir.path, ["rev-parse", "HEAD"]).trim() };
}

function change(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
  git(root, ["commit", "-q", "-am", "change"]);
}

describe("versionBumpProblem on the Antigravity plugin", () => {
  it("fails an Antigravity bundle change that keeps the version, naming the Antigravity bundles", () => {
    const { root, base } = repo();
    change(root, { "plugins/antigravity/dist/stop.mjs": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(/^plugins\/antigravity\/dist changed/);
  });

  it("passes an Antigravity bundle change with a greater version", () => {
    const { root, base } = repo();
    change(root, { "plugins/antigravity/dist/stop.mjs": "b\n", "package.json": pkg("0.1.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });
});

describe("CI's bundle drift check on the Antigravity plugin (spec 024 D5)", () => {
  it("names plugins/antigravity/dist in both `Bundles match the build` diffs", () => {
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const runs = [
      ...ci.matchAll(/- name: Bundles match the build\n(?: {8}.*\n)*? {8}run: (.*)\n/g),
    ].map((r) => r[1]?.split(" "));
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(run).toContain("plugins/antigravity/dist");
  });
});
