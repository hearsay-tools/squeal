import { afterEach, describe, expect, it } from "vitest";
import { versionBumpProblem } from "../../../scripts/check-version-bump.js";
import { git, initRepo, tempDir, writeFile } from "../../hash/git-repo.js";

// Spec 009 D1: CI's version-raise rule covers the Pi package's committed bundles too.
const pkg = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function repo(): { root: string; base: string } {
  const dir = tempDir("squeal-pi-version-bump-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, { "package.json": pkg("0.1.0"), "plugins/pi/dist/extension.mjs": "a\n" });
  return { root: dir.path, base: git(dir.path, ["rev-parse", "HEAD"]).trim() };
}

function change(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
  git(root, ["commit", "-q", "-am", "change"]);
}

describe("versionBumpProblem on the Pi package", () => {
  it("fails a Pi bundle change that keeps the version, naming the Pi bundles", () => {
    const { root, base } = repo();
    change(root, { "plugins/pi/dist/extension.mjs": "b\n" });
    expect(versionBumpProblem(base, "HEAD", root)).toMatch(/^plugins\/pi\/dist changed/);
  });

  it("passes a Pi bundle change with a greater version", () => {
    const { root, base } = repo();
    change(root, { "plugins/pi/dist/extension.mjs": "b\n", "package.json": pkg("0.1.1") });
    expect(versionBumpProblem(base, "HEAD", root)).toBeUndefined();
  });
});
