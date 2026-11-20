import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atCommit, listingHash } from "../../src/core/ci/inputs.js";
import { ABSENT_LISTING, namesHash } from "../../src/core/keys/observed.js";
import { git, gitHashObject, initRepo, tempDir } from "../hash/git-repo.js";

/*
 * Spec 018 D32 (row 018-57): "equal to the commit", the one owner for
 * `ci record`'s `stable` and `ci export`'s rule (018-58). A file is its
 * blob id in the commit's tree, `null` when the tree holds none; a listing
 * path is the names hash of the entries the commit's tree holds directly in
 * that directory, files, symlinks, submodules and subtrees, or
 * `ABSENT_LISTING` when the tree holds no such directory.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo(): string {
  const { path, cleanup } = tempDir("squeal-at-commit-");
  cleanups.push(cleanup);
  initRepo(path, { "a.txt": "a\n", "src/b.ts": "b\n", "src/deep/c.ts": "c\n" });
  symlinkSync("a.txt", join(path, "link"));
  // A submodule entry: a gitlink, which no file stands for.
  const sub = git(path, ["rev-parse", "HEAD"]).trim();
  git(path, ["update-index", "--add", "--cacheinfo", `160000,${sub},src/sub`]);
  git(path, ["add", "link"]);
  git(path, ["commit", "-q", "-m", "more"]);
  return path;
}

describe("atCommit", () => {
  it("gives a file's blob id in the commit's tree, null for a path it does not hold", async () => {
    const root = repo();
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    const at = await atCommit(root, commit);
    expect(at("a.txt")).toBe(gitHashObject(root, "a.txt"));
    expect(at("src/deep/c.ts")).toBe(gitHashObject(root, "src/deep/c.ts"));
    // A symlink is the blob of its target path, as the stat cache hashes it.
    expect(at("link")).toBe(git(root, ["rev-parse", "HEAD:link"]).trim());
    expect(at("missing.txt")).toBeNull();
    expect(at("src/sub")).toBeNull();
    expect(at("src")).toBeNull();
  });

  it("gives a listing path the names the commit's tree holds directly in the directory", async () => {
    const root = repo();
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    const at = await atCommit(root, commit);
    expect(at("./")).toBe(namesHash(["a.txt", "link", "src"]));
    expect(at("src/")).toBe(namesHash(["b.ts", "deep", "sub"]));
    expect(at("src/deep/")).toBe(namesHash(["c.ts"]));
    expect(at("nope/")).toBe(ABSENT_LISTING);
    expect(at("a.txt/")).toBe(ABSENT_LISTING);
  });

  it("is the commit's content, not the disk's: a changed or new file does not move it", async () => {
    const root = repo();
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    const blob = gitHashObject(root, "a.txt");
    writeFileSync(join(root, "a.txt"), "changed\n");
    writeFileSync(join(root, "src/deep/new.ts"), "new\n");
    git(root, ["add", "a.txt"]);
    const at = await atCommit(root, commit);
    expect(at("a.txt")).toBe(blob);
    expect(at("src/deep/")).toBe(namesHash(["c.ts"]));
    expect(listingHash(root, "src/deep")).not.toBe(at("src/deep/"));
  });
});
