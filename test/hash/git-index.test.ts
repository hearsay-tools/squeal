import { chmodSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCleanIndexHashes, readObjectFormat } from "../../src/core/hash/index.js";
import { git, gitHashObject, initRepo, tempDir, writeFile } from "./git-repo.js";

describe("readObjectFormat", () => {
  const dir = tempDir();
  afterEach(() => dir.cleanup());

  it("reports sha1 and sha256 repositories", async () => {
    initRepo(join(dir.path, "a"), { x: "x" });
    initRepo(join(dir.path, "b"), { x: "x" }, { objectFormat: "sha256" });
    expect(await readObjectFormat(join(dir.path, "a"))).toBe("sha1");
    expect(await readObjectFormat(join(dir.path, "b"))).toBe("sha256");
  });
});

describe("readCleanIndexHashes", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;

  beforeEach(() => {
    dir = tempDir();
    root = join(dir.path, "repo");
  });
  afterEach(() => dir.cleanup());

  it("returns the index oid of every clean regular file", async () => {
    initRepo(root, { "a.ts": "a\n", "src/b.ts": "b\n", "bin/run": "#!/bin/sh\n" });
    chmodSync(join(root, "bin/run"), 0o755);
    git(root, ["commit", "-qam", "exec"]);
    expect(git(root, ["ls-files", "-s", "bin/run"])).toMatch(/^100755 /);

    const hashes = await readCleanIndexHashes(root);

    expect(Object.fromEntries(hashes)).toEqual({
      "a.ts": gitHashObject(root, "a.ts"),
      "src/b.ts": gitHashObject(root, "src/b.ts"),
      "bin/run": gitHashObject(root, "bin/run"),
    });
  });

  it("works in a sha256 repository", async () => {
    initRepo(root, { "a.ts": "a\n" }, { objectFormat: "sha256" });
    const hashes = await readCleanIndexHashes(root);
    expect(hashes.get("a.ts")).toBe(gitHashObject(root, "a.ts"));
    expect(hashes.get("a.ts")).toHaveLength(64);
  });

  it("leaves out modified, staged, deleted and untracked files", async () => {
    initRepo(root, { "clean.ts": "1", "modified.ts": "1", "staged.ts": "1", "deleted.ts": "1" });
    writeFile(root, "modified.ts", "2");
    writeFile(root, "staged.ts", "2");
    git(root, ["add", "staged.ts"]);
    git(root, ["rm", "-q", "--cached", "deleted.ts"]);
    writeFile(root, "untracked.ts", "1");

    const hashes = await readCleanIndexHashes(root);

    expect([...hashes.keys()]).toEqual(["clean.ts"]);
  });

  it("leaves out files under eol, text, filter, ident or working-tree-encoding attributes", async () => {
    initRepo(root, {
      ".gitattributes": [
        "*.bat eol=crlf",
        "*.txt text",
        "*.auto text=auto",
        "*.bin -text",
        "*.lfs filter=lfs",
        "*.id ident",
        "*.utf16 working-tree-encoding=UTF-16",
        "",
      ].join("\n"),
      "plain.ts": "x\n",
      "run.bat": "x\r\n",
      "notes.txt": "x\n",
      "data.auto": "x\n",
      "blob.bin": "x\n",
      "big.lfs": "x\n",
      "file.id": "x\n",
    });

    const hashes = await readCleanIndexHashes(root);

    expect([...hashes.keys()].sort()).toEqual([".gitattributes", "plain.ts"]);
  });

  it("leaves out assume-unchanged and skip-worktree entries, whose status git does not check", async () => {
    initRepo(root, { "a.ts": "1", "b.ts": "1", "c.ts": "1" });
    git(root, ["update-index", "--assume-unchanged", "a.ts"]);
    git(root, ["update-index", "--skip-worktree", "b.ts"]);
    writeFile(root, "a.ts", "changed without git noticing");

    const hashes = await readCleanIndexHashes(root);

    expect([...hashes.keys()]).toEqual(["c.ts"]);
  });

  it("leaves out symlinks and submodules", async () => {
    initRepo(root, { "a.ts": "1" });
    git(root, [
      "-c",
      "core.symlinks=true",
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${gitHashObject(root, "a.ts")},link.ts`,
    ]);
    const hashes = await readCleanIndexHashes(root);
    expect([...hashes.keys()]).toEqual(["a.ts"]);
  });

  it("is disabled when core.autocrlf converts line endings", async () => {
    initRepo(root, { "a.ts": "1\n" });
    git(root, ["config", "core.autocrlf", "input"]);
    expect((await readCleanIndexHashes(root)).size).toBe(0);
    git(root, ["config", "core.autocrlf", "true"]);
    expect((await readCleanIndexHashes(root)).size).toBe(0);
    git(root, ["config", "core.autocrlf", "false"]);
    expect((await readCleanIndexHashes(root)).size).toBe(1);
  });

  it("handles paths with spaces, newlines and non-ASCII characters", async () => {
    initRepo(root, { "with space.ts": "1", "zażółć.ts": "2", "new\nline.ts": "3" });
    const hashes = await readCleanIndexHashes(root);
    expect([...hashes.keys()].sort()).toEqual(["new\nline.ts", "with space.ts", "zażółć.ts"]);
  });

  it("fails with the root in the message when git cannot run there", async () => {
    const missing = join(dir.path, "missing");
    await expect(readCleanIndexHashes(missing)).rejects.toThrow(missing);
  });
});
