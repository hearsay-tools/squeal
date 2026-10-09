import { afterEach, describe, expect, it } from "vitest";
import { ignoredInputs, literalPrefix } from "../../src/core/keys/index.js";
import { initRepo, tempDir, writeFile } from "../hash/git-repo.js";

/*
 * Spec 004 D6, lessons defect 7: the gitignored files a declaration selects,
 * from git, with installed packages left to the environment hash.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo(): string {
  const dir = tempDir("squeal-ignored-inputs-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, { ".gitignore": "dist/\nnode_modules/\n*.log\n", "src/a.ts": "" });
  for (const path of [
    "dist/index.js",
    "dist/nested/chunk.js",
    "dist/index.js.map",
    "packages/p/dist/x.js",
    "node_modules/pkg/dist/y.js",
    "packages/p/node_modules/pkg/z.js",
    "build.log",
    "src/untracked.ts",
  ]) {
    writeFile(dir.path, path, "x\n");
  }
  return dir.path;
}

describe("ignoredInputs", () => {
  it("returns the ignored files the globs select, sorted, and no tracked or untracked file", async () => {
    const root = repo();
    expect(await ignoredInputs(root, ["dist/**/*.js", "src/**"])).toEqual([
      "dist/index.js",
      "dist/nested/chunk.js",
    ]);
  });

  it("walks the worktree for a glob that starts with a wildcard, and never node_modules", async () => {
    const root = repo();
    expect(await ignoredInputs(root, ["**/dist/**", "**/*.log"])).toEqual([
      "build.log",
      "dist/index.js",
      "dist/index.js.map",
      "dist/nested/chunk.js",
      "packages/p/dist/x.js",
    ]);
    expect(await ignoredInputs(root, ["node_modules/**", "packages/p/node_modules/**"])).toEqual(
      [],
    );
  });

  it("returns nothing for no globs or a glob that names no ignored file", async () => {
    const root = repo();
    expect(await ignoredInputs(root, [])).toEqual([]);
    expect(await ignoredInputs(root, ["missing/**"])).toEqual([]);
  });
});

describe("literalPrefix", () => {
  it("is the leading segments without a wildcard", () => {
    expect(literalPrefix("packages/cezar/dist/**")).toBe("packages/cezar/dist");
    expect(literalPrefix("./dist/*.js")).toBe("dist");
    expect(literalPrefix("dist/{a,b}/x.js")).toBe("dist");
    expect(literalPrefix("fixtures/data.json")).toBe("fixtures/data.json");
    expect(literalPrefix("**/dist/**")).toBe("");
    expect(literalPrefix("[ab]/x")).toBe("");
  });
});
