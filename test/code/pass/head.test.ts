import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { committedPaths } from "../../../src/core/code/pass/head.js";
import type { PassSource } from "../../../src/core/code/pass/index.js";
import { blobHash } from "../../../src/core/hash/index.js";
import { git, initRepo, tempDir } from "../../hash/git-repo.js";

/*
 * Spec 015 D6 as amended by 015-19: the files whose blob is their blob at
 * the `HEAD` a revision moved to, read with `git cat-file`.
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
      expect.stringContaining("complexity: could not read the files at HEAD 0123456789"),
    ]);
  });
});
