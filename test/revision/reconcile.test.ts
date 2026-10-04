import { mkdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blobHash,
  createFsHasher,
  type FileStat,
  type Hasher,
  StatCache,
} from "../../src/core/hash/index.js";
import { type ReconcileContext, reconcile } from "../../src/core/revision/index.js";
import type { FileHash, RelativePath } from "../../src/core/types/index.js";
import { FakeRevisionRepo } from "../hash/fakes.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

/** Wraps a hasher to count hash reads. */
const counting = (inner: Hasher) => {
  const hashed: RelativePath[] = [];
  const hasher: Hasher = {
    stat: (path) => inner.stat(path),
    hash: (path) => {
      hashed.push(path);
      return inner.hash(path);
    },
    now: () => inner.now(),
  };
  return { hasher, hashed };
};

describe("reconcile", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let cache: StatCache;
  let revisions: FakeRevisionRepo;
  let headCalls: number;
  let context: ReconcileContext;
  /** Hasher whose clock runs well past every mtime, so no entry is racy unless a test says so. */
  let hasher: Hasher;

  const hashOf = (path: string) => blobHash(readFileSync(join(root, path)), "sha1");
  /** Moves a file's mtime to a distinct future second, so a same-size rewrite still changes its stat. */
  let tick = 0;
  const later = (path: string) => {
    const t = new Date(Date.now() + 60_000 + ++tick * 1_000);
    utimesSync(join(root, path), t, t);
  };

  beforeEach(async () => {
    dir = tempDir();
    root = dir.path;
    writeFile(root, "src/a.ts", "export const a = 1;\n");
    writeFile(root, "src/b.ts", "export const b = 1;\n");
    const fs = createFsHasher(root, "sha1");
    hasher = { ...fs, now: () => Date.now() + 3_600_000 };
    cache = new StatCache();
    for (const path of ["src/a.ts", "src/b.ts"]) {
      const stat = (await hasher.stat(path)) as FileStat;
      cache.set({ path, ...stat, hash: (await hasher.hash(path)) as FileHash });
    }
    revisions = new FakeRevisionRepo();
    headCalls = 0;
    context = {
      worktreeId: "wt",
      trigger: "watch",
      revisions,
      head: async () => {
        headCalls++;
        return { head: "abc123", dirty: true };
      },
    };
  });
  afterEach(() => dir.cleanup());

  it("creates no revision for a touch, and remembers the new stat", async () => {
    later("src/a.ts");
    const { hasher: spy, hashed } = counting(hasher);

    expect(await reconcile(["src/a.ts"], cache, spy, context)).toBeNull();
    expect(revisions.rows).toEqual([]);
    expect(headCalls).toBe(0);
    expect(hashed).toEqual(["src/a.ts"]);

    expect(await reconcile(["src/a.ts"], cache, spy, context)).toBeNull();
    expect(hashed).toEqual(["src/a.ts"]);
  });

  it("creates no revision for a save that writes the same bytes", async () => {
    writeFile(root, "src/a.ts", "export const a = 1;\n");
    later("src/a.ts");
    expect(await reconcile(["src/a.ts"], cache, hasher, context)).toBeNull();
  });

  it("does not hash a file whose stat is unchanged", async () => {
    const { hasher: spy, hashed } = counting(hasher);
    expect(await reconcile(["src/a.ts", "src/b.ts"], cache, spy, context)).toBeNull();
    expect(hashed).toEqual([]);
  });

  it("creates one revision with one FileChange for a content change", async () => {
    const oldHash = hashOf("src/a.ts");
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    later("src/a.ts");

    const revision = await reconcile(["src/a.ts", "src/b.ts"], cache, hasher, context);

    expect(revision).toMatchObject({
      worktreeId: "wt",
      number: 1,
      head: "abc123",
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash, newHash: hashOf("src/a.ts") }],
    });
    expect(oldHash).not.toBe(hashOf("src/a.ts"));
    expect(revisions.rows).toHaveLength(1);
    expect(cache.hashOf("src/a.ts")).toBe(hashOf("src/a.ts"));
  });

  it("records adds and deletes with a null hash on the missing side", async () => {
    writeFile(root, "src/c.ts", "export const c = 1;\n");
    rmSync(join(root, "src/b.ts"));
    const oldB = cache.hashOf("src/b.ts");

    const revision = await reconcile(["src/c.ts", "src/b.ts"], cache, hasher, context);

    expect(revision?.changes).toEqual([
      { path: "src/b.ts", oldHash: oldB, newHash: null },
      { path: "src/c.ts", oldHash: null, newHash: hashOf("src/c.ts") },
    ]);
    expect(cache.get("src/b.ts")).toBeUndefined();
    expect(cache.hashOf("src/c.ts")).toBe(hashOf("src/c.ts"));
  });

  it("treats a directory where a file was as a delete", async () => {
    rmSync(join(root, "src/b.ts"));
    mkdirSync(join(root, "src/b.ts"));
    const revision = await reconcile(["src/b.ts"], cache, hasher, context);
    expect(revision?.changes).toEqual([
      { path: "src/b.ts", oldHash: expect.any(String), newHash: null },
    ]);
  });

  it("ignores a path that is neither cached nor on disk", async () => {
    expect(await reconcile(["src/none.ts"], cache, hasher, context)).toBeNull();
  });

  it("numbers consecutive revisions and reports each path once, sorted", async () => {
    writeFile(root, "src/b.ts", "b2");
    writeFile(root, "src/a.ts", "a2");
    later("src/a.ts");
    const first = await reconcile(["src/b.ts", "src/a.ts", "src/b.ts"], cache, hasher, context);
    expect(first?.changes.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);

    writeFile(root, "src/a.ts", "a3");
    later("src/a.ts");
    const second = await reconcile(["src/a.ts"], cache, hasher, context);
    expect(second?.number).toBe(2);
    expect(second?.changes[0]?.oldHash).toBe(first?.changes[0]?.newHash);
  });

  it("re-hashes a racy entry even when its stat did not change", async () => {
    // A hasher whose clock equals the files' mtime marks entries racy when it hashes them.
    const stat = (await hasher.stat("src/a.ts")) as FileStat;
    let content = "racy-1";
    let hashes = 0;
    const scripted: Hasher = {
      stat: async () => stat,
      hash: async () => {
        hashes++;
        return blobHash(Buffer.from(content), "sha1");
      },
      now: () => stat.mtimeMs,
    };
    const racyCache = new StatCache();

    const first = await reconcile(["src/a.ts"], racyCache, scripted, context);
    expect(first?.changes).toHaveLength(1);
    expect(racyCache.isRacy("src/a.ts")).toBe(true);

    // Same size, same stat, new bytes: only the racy mark makes this visible.
    content = "racy-2";
    const second = await reconcile(["src/a.ts"], racyCache, scripted, context);
    expect(hashes).toBe(2);
    expect(second?.changes).toEqual([
      {
        path: "src/a.ts",
        oldHash: blobHash(Buffer.from("racy-1"), "sha1"),
        newHash: blobHash(Buffer.from("racy-2"), "sha1"),
      },
    ]);
  });

  it("catches a same-size rewrite right after hashing, with the real clock", async () => {
    const real = createFsHasher(root, "sha1");
    const fresh = new StatCache();
    writeFile(root, "src/c.ts", "c-1");
    expect((await reconcile(["src/c.ts"], fresh, real, context))?.changes).toHaveLength(1);

    writeFile(root, "src/c.ts", "c-2");
    const revision = await reconcile(["src/c.ts"], fresh, real, context);

    expect(revision?.changes).toEqual([
      {
        path: "src/c.ts",
        oldHash: blobHash(Buffer.from("c-1"), "sha1"),
        newHash: blobHash(Buffer.from("c-2"), "sha1"),
      },
    ]);
  });

  it("leaves the stat cache untouched when the revision cannot be stored", async () => {
    const before = cache.get("src/a.ts");
    writeFile(root, "src/a.ts", "export const a = 3;\n");
    later("src/a.ts");
    const failing: ReconcileContext = {
      ...context,
      revisions: {
        append: () => {
          throw new Error("store is busy");
        },
        latest: (id) => revisions.latest(id),
        get: (id, n) => revisions.get(id, n),
      },
    };
    await expect(reconcile(["src/a.ts"], cache, hasher, failing)).rejects.toThrow("store is busy");
    expect(cache.get("src/a.ts")).toEqual(before);

    const revision = await reconcile(["src/a.ts"], cache, hasher, context);
    expect(revision?.changes).toHaveLength(1);
  });
});
