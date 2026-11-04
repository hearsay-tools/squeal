import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { committedBlobs, differingPaths } from "../../src/core/commit/index.js";
import { storedBlobs } from "../../src/core/commit/stored.js";
import { StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { checkIgnored } from "../../src/core/watcher/git.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

/*
 * Row 019-37 (lessons P11): s1c's clean cezarion tree read a test file "not
 * determined (unstaged changes)". Its `packages/mobile/android/gradlew.bat`
 * has `eol=crlf`: a checkout writes CRLF, each commit holds LF, git reads
 * the file as unchanged, and the stat cache hashes the CRLF bytes (spec 001
 * D3), so the file differed from every commit. A real repository: the cache
 * seeded as the daemon seeds it, the blobs from `git ls-tree`.
 */

const BAT = "app/gradlew.bat";
let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function repo(files: Record<string, string>): string {
  const { path, cleanup } = tempDir("squeal-stored-");
  cleanups.push(cleanup);
  initRepo(path, files);
  return path;
}

/** Writes `paths` again as a checkout does, with their attributes applied. */
function checkOut(root: string, ...paths: string[]): void {
  for (const path of paths) rmSync(join(root, path));
  git(root, ["checkout", "--", ...paths]);
}

/** The stat cache as a new daemon seeds it, and the paths that differ from `HEAD`. */
async function differing(root: string) {
  const paths = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const cache = new StatCache();
  await seedStatCache(cache, root, paths, { objectFormat: "sha1" });
  const committed = await committedBlobs(root, "HEAD");
  const view = {
    hashOf: (path: string) => cache.hashOf(path),
    paths: () => cache.paths(),
    ignoredAmong: (all: readonly string[]) => checkIgnored(root, all),
    storedBlobs: (all: readonly string[]) => storedBlobs(root, all),
  };
  return { cache, committed, differing: [...(await differingPaths(view, committed))].sort() };
}

describe("a file git converts at checkout is the commit's (019-37, P11)", () => {
  it("an `eol=crlf` file on a clean tree differs in nothing; an edit of it still differs", async () => {
    const root = repo({
      ".gitattributes": "*.bat text eol=crlf\n",
      [BAT]: "@echo off\nexit /b 0\n",
      "src/a.ts": "export const a = 1;\n",
    });
    checkOut(root, BAT);
    expect(readFileSync(join(root, BAT), "utf8")).toBe("@echo off\r\nexit /b 0\r\n");
    expect(git(root, ["status", "--porcelain"])).toBe("");

    const clean = await differing(root);
    // The bytes on disk are not the committed blob: what s1c's report compared.
    expect(clean.cache.hashOf(BAT)).not.toBe(clean.committed.get(BAT));
    expect(clean.differing).toEqual([]);

    writeFile(root, BAT, "@echo off\r\nexit /b 1\r\n");
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    expect((await differing(root)).differing).toEqual([BAT, "src/a.ts"]);
  });

  it("under `core.autocrlf true` every text file is the commit's on a clean tree", async () => {
    const root = repo({ "src/a.ts": "a\nb\n", "src/b.ts": "b\n", "README.md": "r\n" });
    git(root, ["config", "core.autocrlf", "true"]);
    checkOut(root, "src/a.ts", "src/b.ts", "README.md");
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("a\r\nb\r\n");
    expect(git(root, ["status", "--porcelain"])).toBe("");
    expect((await differing(root)).differing).toEqual([]);
  });

  it("asks git only for regular files: a symlink, a missing path and a newline are left out", async () => {
    const root = repo({ "src/a.ts": "a\n" });
    symlinkSync("src/a.ts", join(root, "link.ts"));
    const blobs = await storedBlobs(root, ["src/a.ts", "link.ts", "gone.ts", "x\ny.ts"]);
    expect([...blobs.keys()]).toEqual(["src/a.ts"]);
    expect(blobs.get("src/a.ts")).toBe(git(root, ["rev-parse", "HEAD:src/a.ts"]).trim());
    expect(await storedBlobs(root, [])).toEqual(new Map());
  });
});
