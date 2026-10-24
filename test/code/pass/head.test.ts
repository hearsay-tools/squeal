import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { committedPaths } from "../../../src/core/code/pass/head.js";
import type { PassSource } from "../../../src/core/code/pass/index.js";
import { blobHash } from "../../../src/core/hash/index.js";
import { git, initRepo, tempDir, writeFile } from "../../hash/git-repo.js";

/*
 * Spec 015 D6 as amended by 015-19 and 015-34: the files whose blob is
 * their blob at the `HEAD` a revision moved to, or at the commit an
 * operation under way brings, read with `git cat-file`.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const blob = (text: string) => blobHash(Buffer.from(text), "sha1");

/** A repository whose Squeal root is `sub`, below its top, with these files committed under it. */
function repo(files: Record<string, string>) {
  const dir = tempDir();
  cleanups.push(dir.cleanup);
  initRepo(
    dir.path,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [`sub/${path}`, text])),
  );
  return { root: join(dir.path, "sub"), head: git(dir.path, ["rev-parse", "HEAD"]).trim() };
}

function ctx(root: string, head: string | null) {
  const log: string[] = [];
  const source = { movedHead: () => head } as unknown as PassSource;
  return { root, source, log: (text: string) => log.push(text), logged: log };
}

describe("the files a move of HEAD brought (015-19)", () => {
  it("names each file whose blob is the one at the new HEAD, from a root below the top", async () => {
    const { root, head } = repo({ "src/a.ts": "a\n", "src/b c.ts": "b\n", "src/d.ts": "d\n" });
    const c = ctx(root, head);
    const paths = await committedPaths(c, 1, 2, [
      { path: "src/a.ts", blob: blob("a\n") },
      { path: "src/b c.ts", blob: blob("b\n") },
      { path: "src/d.ts", blob: blob("d, edited\n") },
      { path: "src/untracked.ts", blob: blob("u\n") },
    ]);
    expect(paths).toEqual(new Set(["src/a.ts", "src/b c.ts"]));
    expect(c.logged).toEqual([]);
  });

  it("names a file gone at the new HEAD, and not a gone one HEAD still holds (015-38)", async () => {
    const { root, head } = repo({ "src/a.ts": "a\n" });
    const c = ctx(root, head);
    const paths = await committedPaths(c, 1, 2, [
      { path: "src/a.ts", blob: null },
      { path: "src/deleted.ts", blob: null },
    ]);
    expect(paths).toEqual(new Set(["src/deleted.ts"]));
    expect(c.logged).toEqual([]);
  });

  it("asks nothing when HEAD stayed", async () => {
    const c = ctx("/nonexistent", null);
    expect(await committedPaths(c, 1, 2, [{ path: "src/a.ts", blob: blob("a\n") }])).toEqual(
      new Set(),
    );
    expect(c.logged).toEqual([]);
  });

  it("asks nothing for a path holding a line feed, so the next paths keep their lines", async () => {
    const { root, head } = repo({ "src/a.ts": "a\n" });
    const paths = await committedPaths(ctx(root, head), 1, 2, [
      { path: "src/x\nsrc/a.ts", blob: blob("a\n") },
      { path: "src/a.ts", blob: blob("a\n") },
    ]);
    expect(paths).toEqual(new Set(["src/a.ts"]));
  });

  it("keeps every edit when git cannot say, and logs why", async () => {
    const dir = tempDir();
    cleanups.push(dir.cleanup);
    const c = ctx(dir.path, "0123456789012345678901234567890123456789");
    expect(await committedPaths(c, 1, 2, [{ path: "src/a.ts", blob: blob("a\n") }])).toEqual(
      new Set(),
    );
    expect(c.logged).toEqual([
      expect.stringContaining("complexity: could not read the files at 0123456789"),
    ]);
  });

  it("names the files a merge stopped in a linked worktree brings, with HEAD unmoved (015-34)", async () => {
    const dir = tempDir();
    cleanups.push(dir.cleanup);
    const main = join(dir.path, "main");
    initRepo(main, { "sub/src/a.ts": "a\n", "sub/src/b.ts": "b\n", "notes.md": "base\n" });
    git(main, ["checkout", "-q", "-b", "topic"]);
    writeFile(main, "sub/src/a.ts", "a, topic\n");
    writeFile(main, "notes.md", "topic\n");
    git(main, ["commit", "-q", "-am", "topic"]);
    git(main, ["checkout", "-q", "main"]);
    writeFile(main, "notes.md", "main\n");
    git(main, ["commit", "-q", "-am", "main"]);
    const linked = join(dir.path, "linked");
    git(main, ["worktree", "add", "-q", "-b", "wt", linked, "main"]);
    expect(() => git(linked, ["merge", "-q", "topic"])).toThrow();
    const c = ctx(join(linked, "sub"), null);
    const paths = await committedPaths(c, 1, 2, [
      { path: "src/a.ts", blob: blob("a, topic\n") },
      { path: "src/b.ts", blob: blob("b, edited\n") },
    ]);
    expect(paths).toEqual(new Set(["src/a.ts"]));
    expect(c.logged).toEqual([]);
  });
});
