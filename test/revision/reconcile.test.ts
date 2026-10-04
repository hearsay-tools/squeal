import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobHash, createFsHasher, type Hasher, StatCache } from "../../src/core/hash/index.js";
import {
  commitBatch,
  diffBatch,
  type ReconcileContext,
  reconcile,
  statCandidates,
} from "../../src/core/revision/index.js";
import type {
  CandidateBatch,
  FileHash,
  FileStat,
  RelativePath,
  RevisionTrigger,
} from "../../src/core/types/index.js";
import { FakeStore } from "../hash/fakes.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

/** Wraps a hasher to count hash reads and refuse stats: reconcile must use the batch's stats. */
const counting = (inner: Hasher) => {
  const hashed: RelativePath[] = [];
  const hasher: Hasher = {
    stat: () => Promise.reject(new Error("reconcile stat'ed a path the batch described")),
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
  let store: FakeStore;
  let headCalls: number;
  let context: ReconcileContext;
  /** Hasher whose clock runs well past every mtime, so no entry is racy unless a test says so. */
  let hasher: Hasher;

  const hashOf = (path: string) => blobHash(readFileSync(join(root, path)), "sha1");
  /** A batch as the watcher builds it: each path `lstat`ed once. */
  const batch = async (
    paths: readonly RelativePath[],
    trigger: RevisionTrigger = "watch",
  ): Promise<CandidateBatch> => ({ trigger, paths: await statCandidates(paths, hasher) });
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
    store = new FakeStore();
    cache.flush(store.fileHashes, "wt");
    headCalls = 0;
    context = {
      worktreeId: "wt",
      store,
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

    expect(await reconcile(await batch(["src/a.ts"]), cache, spy, context)).toBeNull();
    expect(store.revisions.rows).toEqual([]);
    expect(headCalls).toBe(0);
    expect(hashed).toEqual(["src/a.ts"]);
    expect(store.fileHashes.get("wt", "src/a.ts")?.mtimeMs).toBe(cache.get("src/a.ts")?.mtimeMs);

    expect(await reconcile(await batch(["src/a.ts"]), cache, spy, context)).toBeNull();
    expect(hashed).toEqual(["src/a.ts"]);
  });

  it("creates no revision for a save that writes the same bytes", async () => {
    writeFile(root, "src/a.ts", "export const a = 1;\n");
    later("src/a.ts");
    expect(await reconcile(await batch(["src/a.ts"]), cache, hasher, context)).toBeNull();
  });

  it("does not hash a file whose stat is unchanged", async () => {
    const { hasher: spy, hashed } = counting(hasher);
    expect(await reconcile(await batch(["src/a.ts", "src/b.ts"]), cache, spy, context)).toBeNull();
    expect(hashed).toEqual([]);
  });

  it("creates one revision with one FileChange for a content change", async () => {
    const oldHash = hashOf("src/a.ts");
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    later("src/a.ts");
    const { hasher: spy } = counting(hasher);

    const revision = await reconcile(await batch(["src/a.ts", "src/b.ts"]), cache, spy, context);

    expect(revision).toMatchObject({
      worktreeId: "wt",
      number: 1,
      head: "abc123",
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash, newHash: hashOf("src/a.ts") }],
    });
    expect(oldHash).not.toBe(hashOf("src/a.ts"));
    expect(store.revisions.rows).toHaveLength(1);
    expect(store.transactions).toBe(1);
    expect(cache.hashOf("src/a.ts")).toBe(hashOf("src/a.ts"));
    expect(store.fileHashes.get("wt", "src/a.ts")?.hash).toBe(hashOf("src/a.ts"));
  });

  it("takes the trigger from the batch", async () => {
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    later("src/a.ts");
    const revision = await reconcile(await batch(["src/a.ts"], "interval"), cache, hasher, context);
    expect(revision?.trigger).toBe("interval");
  });

  it("records adds and deletes with a null hash on the missing side", async () => {
    writeFile(root, "src/c.ts", "export const c = 1;\n");
    rmSync(join(root, "src/b.ts"));
    const oldB = cache.hashOf("src/b.ts");

    const revision = await reconcile(await batch(["src/c.ts", "src/b.ts"]), cache, hasher, context);

    expect(revision?.changes).toEqual([
      { path: "src/b.ts", oldHash: oldB, newHash: null },
      { path: "src/c.ts", oldHash: null, newHash: hashOf("src/c.ts") },
    ]);
    expect(cache.get("src/b.ts")).toBeUndefined();
    expect(cache.hashOf("src/b.ts")).toBeNull();
    expect(store.fileHashes.get("wt", "src/b.ts")).toBeNull();
    expect(cache.hashOf("src/c.ts")).toBe(hashOf("src/c.ts"));
  });

  it("treats a directory where a file was as a delete", async () => {
    rmSync(join(root, "src/b.ts"));
    mkdirSync(join(root, "src/b.ts"));
    const revision = await reconcile(await batch(["src/b.ts"]), cache, hasher, context);
    expect(revision?.changes).toEqual([
      { path: "src/b.ts", oldHash: expect.any(String), newHash: null },
    ]);
  });

  it("treats a file deleted after the watcher's stat as a delete", async () => {
    const stale = await batch(["src/b.ts"]);
    writeFile(root, "src/b.ts", "export const b = 2;\n");
    later("src/b.ts");
    const moved = await batch(["src/b.ts"]);
    rmSync(join(root, "src/b.ts"));
    expect(stale.paths[0]?.stat).not.toEqual(moved.paths[0]?.stat);

    const revision = await reconcile(moved, cache, hasher, context);
    expect(revision?.changes).toEqual([
      { path: "src/b.ts", oldHash: expect.any(String), newHash: null },
    ]);
  });

  it("marks a path that is neither cached nor on disk known absent, without a revision", async () => {
    expect(cache.hashOf("src/none.ts")).toBeUndefined();
    expect(await reconcile(await batch(["src/none.ts"]), cache, hasher, context)).toBeNull();
    expect(cache.hashOf("src/none.ts")).toBeNull();
  });

  it("hashes a symlink as git does, by its target path, and sees it retargeted", async () => {
    symlinkSync("a.ts", join(root, "src/link.ts"));
    const first = await reconcile(await batch(["src/link.ts"]), cache, hasher, context);
    expect(first?.changes).toEqual([
      { path: "src/link.ts", oldHash: null, newHash: blobHash(Buffer.from("a.ts"), "sha1") },
    ]);

    // A different length: this test's clock disables the racy check that catches equal stats.
    rmSync(join(root, "src/link.ts"));
    symlinkSync("./b.ts", join(root, "src/link.ts"));
    const second = await reconcile(await batch(["src/link.ts"]), cache, hasher, context);
    expect(second?.changes).toEqual([
      {
        path: "src/link.ts",
        oldHash: blobHash(Buffer.from("a.ts"), "sha1"),
        newHash: blobHash(Buffer.from("./b.ts"), "sha1"),
      },
    ]);

    // Editing the target is a change to the target, not to the link.
    writeFile(root, "src/b.ts", "export const b = 2;\n");
    later("src/b.ts");
    const third = await reconcile(await batch(["src/b.ts", "src/link.ts"]), cache, hasher, context);
    expect(third?.changes.map((c) => c.path)).toEqual(["src/b.ts"]);
  });

  it("numbers consecutive revisions and reports each path once, sorted", async () => {
    writeFile(root, "src/b.ts", "b2");
    writeFile(root, "src/a.ts", "a2");
    later("src/a.ts");
    const first = await reconcile(
      await batch(["src/b.ts", "src/a.ts", "src/b.ts"]),
      cache,
      hasher,
      context,
    );
    expect(first?.changes.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);

    writeFile(root, "src/a.ts", "a3");
    later("src/a.ts");
    const second = await reconcile(await batch(["src/a.ts"]), cache, hasher, context);
    expect(second?.number).toBe(2);
    expect(second?.changes[0]?.oldHash).toBe(first?.changes[0]?.newHash);
  });

  it("re-hashes a racy entry even when its stat did not change", async () => {
    // A hasher whose clock equals the files' mtime marks entries racy when it hashes them.
    const stat = (await hasher.stat("src/a.ts")) as FileStat;
    const sameStat: CandidateBatch = { trigger: "watch", paths: [{ path: "src/a.ts", stat }] };
    let content = "racy-1";
    let hashes = 0;
    const scripted: Hasher = {
      stat: () => Promise.reject(new Error("unexpected stat")),
      hash: async () => {
        hashes++;
        return blobHash(Buffer.from(content), "sha1");
      },
      now: () => stat.mtimeMs,
    };
    const racyCache = new StatCache();

    const first = await reconcile(sameStat, racyCache, scripted, context);
    expect(first?.changes).toHaveLength(1);
    expect(racyCache.isRacy("src/a.ts")).toBe(true);

    // Same size, same stat, new bytes: only the racy mark makes this visible.
    content = "racy-2";
    const second = await reconcile(sameStat, racyCache, scripted, context);
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
    hasher = real;
    const fresh = new StatCache();
    writeFile(root, "src/c.ts", "c-1");
    expect(
      (await reconcile(await batch(["src/c.ts"]), fresh, real, context))?.changes,
    ).toHaveLength(1);

    writeFile(root, "src/c.ts", "c-2");
    const revision = await reconcile(await batch(["src/c.ts"]), fresh, real, context);

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
    const append = store.revisions.append.bind(store.revisions);
    store.revisions.append = () => {
      throw new Error("store is busy");
    };
    const changed = await batch(["src/a.ts"]);
    await expect(reconcile(changed, cache, hasher, context)).rejects.toThrow("store is busy");
    expect(cache.get("src/a.ts")).toEqual(before);

    store.revisions.append = append;
    const revision = await reconcile(changed, cache, hasher, context);
    expect(revision?.changes).toHaveLength(1);
  });

  it("rolls the revision back and leaves the cache untouched when the stat cache write fails", async () => {
    const before = cache.get("src/a.ts");
    writeFile(root, "src/a.ts", "export const a = 3;\n");
    later("src/a.ts");
    const upsertMany = store.fileHashes.upsertMany.bind(store.fileHashes);
    store.fileHashes.upsertMany = () => {
      throw new Error("disk full");
    };
    const changed = await batch(["src/a.ts"]);
    await expect(reconcile(changed, cache, hasher, context)).rejects.toThrow("disk full");
    expect(store.revisions.rows).toEqual([]);
    expect(cache.get("src/a.ts")).toEqual(before);

    // Without the rollback, this retry would see an equal stat and lose the change.
    store.fileHashes.upsertMany = upsertMany;
    const revision = await reconcile(changed, cache, hasher, context);
    expect(revision?.number).toBe(1);
    expect(store.fileHashes.get("wt", "src/a.ts")?.hash).toBe(hashOf("src/a.ts"));
  });
});

describe("diffBatch and commitBatch", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let hasher: Hasher;

  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    hasher = { ...createFsHasher(root, "sha1"), now: () => Date.now() + 3_600_000 };
  });
  afterEach(() => dir.cleanup());

  it("lets the caller read HEAD between the diff and one synchronous transaction", async () => {
    writeFile(root, "src/a.ts", "a");
    const cache = new StatCache();
    const store = new FakeStore();
    const batch: CandidateBatch = {
      trigger: "start",
      paths: await statCandidates(["src/a.ts"], hasher),
    };

    const diff = await diffBatch(batch, cache, hasher);
    expect(diff.trigger).toBe("start");
    expect(diff.changes).toHaveLength(1);
    expect(cache.hashOf("src/a.ts")).toBeUndefined();

    const head = diff.changes.length > 0 ? { head: "abc123", dirty: false } : null;
    const revision = store.transaction(() =>
      commitBatch(diff, cache, {
        worktreeId: "wt",
        head,
        revisions: store.revisions,
        fileHashes: store.fileHashes,
        now: () => 42,
      }),
    );

    expect(revision).toMatchObject({ number: 1, createdAt: 42, head: "abc123", trigger: "start" });
    expect(store.fileHashes.get("wt", "src/a.ts")?.hash).toBe(cache.hashOf("src/a.ts"));
  });

  it("refuses to store changes without HEAD", async () => {
    writeFile(root, "src/a.ts", "a");
    const cache = new StatCache();
    const store = new FakeStore();
    const batch = { trigger: "watch" as const, paths: await statCandidates(["src/a.ts"], hasher) };
    const diff = await diffBatch(batch, cache, hasher);
    expect(() =>
      commitBatch(diff, cache, {
        worktreeId: "wt",
        head: null,
        revisions: store.revisions,
        fileHashes: store.fileHashes,
      }),
    ).toThrow(/HEAD/);
    expect(cache.hashOf("src/a.ts")).toBeUndefined();
  });

  it("lstats each path once for statCandidates, sorted and unique", async () => {
    writeFile(root, "b.ts", "b");
    writeFile(root, "a.ts", "a");
    const stats: RelativePath[] = [];
    const counted: Hasher = {
      ...hasher,
      stat: (path) => {
        stats.push(path);
        return hasher.stat(path);
      },
    };
    const candidates = await statCandidates(["b.ts", "a.ts", "b.ts", "gone.ts"], counted);
    expect(candidates.map((c) => [c.path, c.stat === null])).toEqual([
      ["a.ts", false],
      ["b.ts", false],
      ["gone.ts", true],
    ]);
    expect(stats.sort()).toEqual(["a.ts", "b.ts", "gone.ts"]);
  });
});
