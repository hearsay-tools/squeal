import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactGlobs,
  ignoredInputs,
  literalPrefix,
  reachesBelow,
} from "../../src/core/keys/index.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

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

/** A worktree whose ignored `dist` links to an ignored build beside it (reviews/wave-4.md B3). */
function linkedRepo(gitignore = "dist\nreal-build/\nnode_modules/\n"): string {
  const dir = tempDir("squeal-ignored-links-");
  cleanups.push(dir.cleanup);
  const root = join(dir.path, "repo");
  initRepo(root, { ".gitignore": gitignore, "src/a.ts": "" });
  writeFile(root, "real-build/index.js", "a\n");
  writeFile(root, "real-build/sub/chunk.js", "b\n");
  symlinkSync("real-build", join(root, "dist"));
  return root;
}

describe("ignoredInputs through a symlinked directory (reviews/wave-4.md B3)", () => {
  it("returns the files beyond an ignored link under the declared paths", async () => {
    const root = linkedRepo();
    expect(await ignoredInputs(root, ["dist/**"])).toEqual(["dist/index.js", "dist/sub/chunk.js"]);
    expect(await ignoredInputs(root, ["dist/sub/*.js"])).toEqual(["dist/sub/chunk.js"]);
    expect(await ignoredInputs(root, ["**/index.js"])).toEqual([
      "dist/index.js",
      "real-build/index.js",
    ]);
  });

  it("follows a link git ignores only as a directory, and one above the glob's literal part", async () => {
    const root = linkedRepo("dist/\nreal-build/\nout/\n");
    writeFile(root, "real-out/lib/z.js", "z\n");
    git(root, ["add", "real-out"]);
    git(root, ["commit", "-qm", "real-out"]);
    symlinkSync("real-out", join(root, "out"));
    expect(await ignoredInputs(root, ["dist/**"])).toEqual(["dist/index.js", "dist/sub/chunk.js"]);
    expect(await ignoredInputs(root, ["**/dist/**"])).toEqual([
      "dist/index.js",
      "dist/sub/chunk.js",
    ]);
    expect(await ignoredInputs(root, ["out/lib/**"])).toEqual(["out/lib/z.js"]);
  });

  it("follows a link git tracks, whatever the glob's shape (reviews/wave-4.5.md B1)", async () => {
    const root = linkedRepo("dist/\nreal-build/\n");
    git(root, ["add", "dist"]);
    git(root, ["commit", "-qm", "track the build link"]);
    expect(git(root, ["ls-files", "dist"]).trim()).toBe("dist");
    const build = ["dist/index.js", "dist/sub/chunk.js"];
    expect(await ignoredInputs(root, ["dist/**"])).toEqual(build);
    expect(await ignoredInputs(root, ["**/dist/**"])).toEqual(build);
    expect(await ignoredInputs(root, ["*/sub/*.js"])).toEqual([
      "dist/sub/chunk.js",
      "real-build/sub/chunk.js",
    ]);
    // Nothing beyond the link that the globs name.
    expect(await ignoredInputs(root, ["src/**", "**/*.md"])).toEqual([]);
  });

  it("follows no link git does not ignore: the watcher observes it as a project directory", async () => {
    const root = linkedRepo("real-build/\n");
    expect(await ignoredInputs(root, ["dist/**"])).toEqual([]);
  });

  it("keeps the watcher's limits: no loop, no other repository, no installed package, no nested link", async () => {
    const root = linkedRepo("dist\nreal-build/\nloop\nother\nnode_modules/\n");
    symlinkSync(".", join(root, "loop"));
    initRepo(join(root, "..", "elsewhere"), { "x.js": "" });
    symlinkSync(join(root, "..", "elsewhere"), join(root, "other"));
    writeFile(root, "real-pkg/index.js", "p\n");
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(root, "real-pkg"), join(root, "node_modules/pkg"));
    symlinkSync("..", join(root, "real-build/up"));
    expect(await ignoredInputs(root, ["**/*.js"])).toEqual([
      "dist/index.js",
      "dist/sub/chunk.js",
      "real-build/index.js",
      "real-build/sub/chunk.js",
    ]);
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

describe("reachesBelow", () => {
  it("is true when the glob can match a path below the directory", () => {
    expect(reachesBelow("**/dist/**", "dist")).toBe(true);
    expect(reachesBelow("**/dist/**", "packages/p/dist")).toBe(true);
    expect(reachesBelow("dist/sub/*.js", "dist")).toBe(true);
    expect(reachesBelow("./dist/*.js", "dist")).toBe(true);
    expect(reachesBelow("*/sub/*.js", "out")).toBe(true);
    expect(reachesBelow("{dist,out}/**", "out")).toBe(true);
    expect(reachesBelow("{dist/a,out}/x.js", "lib")).toBe(true);
  });

  it("is false when no path below the directory can match", () => {
    expect(reachesBelow("dist/**", "out")).toBe(false);
    expect(reachesBelow("dist/index.js", "dist/index.js")).toBe(false);
    expect(reachesBelow("src/**", "dist")).toBe(false);
    expect(reachesBelow("packages/*/dist/**", "packages/p/lib")).toBe(false);
  });
});

describe("artifactGlobs (lessons defect 10)", () => {
  const files = ["test/e2e/a.test.ts", "test/unit/b.test.ts", "plugins/x.js"];
  const isSlow = (path: string) => path.startsWith("test/e2e/");

  it("keeps the input globs of entries whose test-file glob selects a slow file", () => {
    const inputs = {
      "test/e2e/*.test.ts": ["plugins/**", "test/fixtures/e2e/**"],
      "test/unit/**": ["test/fixtures/unit/**"],
      "test/**/*.test.ts": ["shared/**", "plugins/**"],
    };
    expect(artifactGlobs(inputs, files, isSlow)).toEqual([
      "plugins/**",
      "test/fixtures/e2e/**",
      "shared/**",
    ]);
  });

  it("keeps every glob of a list once a file is slow, and none without a slow file", () => {
    expect(artifactGlobs(["dist/**"], files, isSlow)).toEqual(["dist/**"]);
    expect(artifactGlobs(["dist/**"], files, () => false)).toEqual([]);
    expect(artifactGlobs({ "test/e2e/**": ["dist/**"] }, files, () => false)).toEqual([]);
  });
});
