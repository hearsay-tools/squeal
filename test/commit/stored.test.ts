import { readFileSync, rmSync, symlinkSync, utimesSync } from "node:fs";
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
 * D3), so the file differed from every commit. Review 0.1.401 B1: git's
 * answer counts only for the bytes the key was made of. A real repository:
 * the cache seeded as the daemon seeds it, the blobs from `git ls-tree`.
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

/** Sets each file's times a minute back, outside the racy window (`isRacy`). */
function age(root: string, ...paths: string[]): void {
  const then = new Date(Date.now() - 60_000);
  for (const path of paths) utimesSync(join(root, path), then, then);
}

/** Writes `paths` again as a checkout does, with their attributes applied, written a minute ago. */
function checkOut(root: string, ...paths: string[]): void {
  for (const path of paths) rmSync(join(root, path));
  git(root, ["checkout", "--", ...paths]);
  age(root, ...paths);
}

/** The stat cache as a new daemon seeds it. */
async function seeded(root: string): Promise<StatCache> {
  const paths = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const cache = new StatCache();
  await seedStatCache(cache, root, paths, { objectFormat: "sha1" });
  return cache;
}

/** The paths that differ from `HEAD`, with `cache` as the keys' hashes. */
async function differingFrom(root: string, cache: StatCache): Promise<string[]> {
  const view = {
    hashOf: (path: string) => cache.hashOf(path),
    paths: () => cache.paths(),
    ignoredAmong: (all: readonly string[]) => checkIgnored(root, all),
    storedBlobs: (hashes: ReadonlyMap<string, string>) => storedBlobs(root, hashes),
  };
  return [...(await differingPaths(view, await committedBlobs(root, "HEAD"))).differing].sort();
}

const differing = async (root: string) => differingFrom(root, await seeded(root));

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

    const cache = await seeded(root);
    // The bytes on disk are not the committed blob: what s1c's report compared.
    expect(cache.hashOf(BAT)).not.toBe((await committedBlobs(root, "HEAD")).get(BAT));
    expect(await differingFrom(root, cache)).toEqual([]);

    writeFile(root, BAT, "@echo off\r\nexit /b 1\r\n");
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    age(root, BAT, "src/a.ts");
    expect(await differing(root)).toEqual([BAT, "src/a.ts"]);
  });

  it("under `core.autocrlf true` every text file is the commit's on a clean tree", async () => {
    const root = repo({ "src/a.ts": "a\nb\n", "src/b.ts": "b\n", "README.md": "r\n" });
    git(root, ["config", "core.autocrlf", "true"]);
    checkOut(root, "src/a.ts", "src/b.ts", "README.md");
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("a\r\nb\r\n");
    expect(git(root, ["status", "--porcelain"])).toBe("");
    expect(await differing(root)).toEqual([]);
  });
});

describe("git's answer counts only for the bytes the key was made of (review 0.1.401 B1)", () => {
  it("a file restored to the commit's bytes after its key was made stays a difference", async () => {
    const root = repo({ ".gitattributes": "*.bat text eol=crlf\n", [BAT]: "@echo off\n" });
    writeFile(root, BAT, "@echo on\r\n");
    age(root, BAT);
    const dirty = await seeded(root);
    // Restored, outside the racy window, and the cache not told: its hash is the edit's.
    checkOut(root, BAT);
    expect(git(root, ["status", "--porcelain"])).toBe("");
    expect(await differingFrom(root, dirty)).toEqual([BAT]);
    expect(await differing(root)).toEqual([]);
  });

  it("a file written within the racy window stays a difference until it is older", async () => {
    const root = repo({ ".gitattributes": "*.bat text eol=crlf\n", [BAT]: "@echo off\n" });
    rmSync(join(root, BAT));
    git(root, ["checkout", "--", BAT]);
    const cache = await seeded(root);
    expect(await differingFrom(root, cache)).toEqual([BAT]);
    age(root, BAT);
    expect(await differingFrom(root, await seeded(root))).toEqual([]);
  });

  it("asks git only for regular files at their key's bytes: a symlink, a missing path, a newline and a moved file are left out", async () => {
    const root = repo({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
    symlinkSync("src/a.ts", join(root, "link.ts"));
    age(root, "src/a.ts", "src/b.ts");
    const blob = (path: string) => git(root, ["rev-parse", `HEAD:${path}`]).trim();
    const hashes = new Map([
      ["src/a.ts", blob("src/a.ts")],
      ["src/b.ts", "0".repeat(40)],
      ["link.ts", blob("src/a.ts")],
      ["gone.ts", blob("src/a.ts")],
      ["x\ny.ts", blob("src/a.ts")],
    ]);
    expect(await storedBlobs(root, hashes)).toEqual({
      blobs: new Map([["src/a.ts", blob("src/a.ts")]]),
      unanswered: new Set(),
    });
    expect(await storedBlobs(root, new Map())).toEqual({ blobs: new Map(), unanswered: new Set() });
  });
});
