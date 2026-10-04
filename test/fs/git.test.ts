import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit, splitNul } from "../../src/core/fs/index.js";
import { initRepo, tempDir } from "../hash/git-repo.js";

describe("splitNul", () => {
  it("drops only the empty field after the final NUL", () => {
    expect(splitNul("")).toEqual([]);
    expect(splitNul("a\0")).toEqual(["a"]);
    expect(splitNul("a\0b")).toEqual(["a", "b"]);
  });

  // The watcher copy dropped every empty field; check-attr triples need the empty value.
  it("keeps empty fields in the middle", () => {
    expect(splitNul("a.txt\0foo\0\0b.txt\0foo\0bar\0")).toEqual([
      "a.txt",
      "foo",
      "",
      "b.txt",
      "foo",
      "bar",
    ]);
  });
});

describe("runGit", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  const saved = process.env.GIT_OBJECT_DIRECTORY;

  beforeEach(() => {
    dir = tempDir();
    root = realpathSync(dir.path);
    initRepo(root, { "a.txt": "a\n" });
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.GIT_OBJECT_DIRECTORY;
    else process.env.GIT_OBJECT_DIRECTORY = saved;
    dir.cleanup();
  });

  // The watcher copy did not clear GIT_OBJECT_DIRECTORY.
  it("ignores an inherited GIT_OBJECT_DIRECTORY", async () => {
    process.env.GIT_OBJECT_DIRECTORY = join(root, "elsewhere");
    const out = await runGit(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "objects",
    ]);
    expect(out.trim()).toBe(join(root, ".git", "objects"));
  });

  it("passes input on stdin", async () => {
    const out = await runGit(root, ["check-ignore", "-z", "--stdin"], {
      input: "a.txt\0",
      okCodes: [0, 1],
    });
    expect(out).toBe("");
  });

  it("resolves on an exit code in okCodes and rejects with context otherwise", async () => {
    const args = ["config", "--get", "squeal.unset"];
    await expect(runGit(root, args, { okCodes: [0, 1] })).resolves.toBe("");
    await expect(runGit(root, args)).rejects.toThrow(
      `squeal: git config --get squeal.unset exited 1 in ${root}`,
    );
  });
});
