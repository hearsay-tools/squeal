import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobHash, createFsHasher, type Hasher, StatCache } from "../../src/core/hash/index.js";
import {
  diffBatch,
  type ReconcileContext,
  reconcile,
  statCandidates,
} from "../../src/core/revision/index.js";
import { touchedUnchanged } from "../../src/core/scheduler/stability.js";
import type { RelativePath } from "../../src/core/types/index.js";
import { FakeStore } from "../hash/fakes.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

/*
 * Row 011-204 (task 011-203): a pass that stats a file before a write and
 * reads its bytes after it must not store that stat beside those bytes. If
 * it did, the write's own batch would see a moved stat over unchanged
 * bytes, a touch (001-159), and the edit's file would run twice.
 */

describe("a write between a pass's stat and its read (row 011-204)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let store: FakeStore;
  let context: ReconcileContext;
  /** The real clock: an entry hashed right after its write is racy. */
  let hasher: Hasher;

  const path = "test/held.test.ts" as RelativePath;
  const hashOf = (bytes: string) => blobHash(Buffer.from(bytes), "sha1");
  const batch = async () => ({
    trigger: "watch" as const,
    paths: await statCandidates([path], hasher),
  });

  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    hasher = createFsHasher(root, "sha1");
    store = new FakeStore();
    context = {
      worktreeId: "wt",
      store,
      head: async () => ({ head: "abc123", dirty: true }),
    };
  });
  afterEach(() => dir.cleanup());

  it("gives the write's own batch no touch, and its change one revision", async () => {
    const cache = new StatCache();
    writeFile(root, path, "it();\n");
    await reconcile(await batch(), cache, hasher, context);
    expect(cache.isRacy(path)).toBe(true);

    // The pass's stat before the write; the racy entry makes it read the bytes after it.
    const before = await batch();
    appendFileSync(join(root, path), "// edited\n");
    await reconcile(before, cache, hasher, context);

    const own = await diffBatch(await batch(), cache, hasher);
    expect(touchedUnchanged(own, cache)).toEqual([]);
    await reconcile(await batch(), cache, hasher, context);

    expect(store.revisions.rows.map((r) => r.changes)).toEqual([
      [{ path, oldHash: null, newHash: hashOf("it();\n") }],
      [{ path, oldHash: hashOf("it();\n"), newHash: hashOf("it();\n// edited\n") }],
    ]);
    expect(cache.hashOf(path)).toBe(hashOf(readFileSync(join(root, path), "utf8")));
  });

  it.each([
    ["with the cache in memory", false],
    ["after the cache is reloaded from the store (review 0.1.310 B1)", true],
  ] as const)(
    "reports a write after the read as a change at the next pass, not a touch, %s",
    async (_, reload) => {
      // A clock far past every mtime: only what the pass stored can make the next one hash again.
      hasher = { ...createFsHasher(root, "sha1"), now: () => Date.now() + 3_600_000 };
      let cache = new StatCache();
      writeFile(root, path, "it();\n");
      await reconcile(await batch(), cache, hasher, context);

      writeFile(root, path, "it(2);\n// two\n");
      const writing: Hasher = {
        ...hasher,
        hash: async (p) => {
          const hash = await hasher.hash(p);
          writeFile(root, path, "it(3);\n// three\n");
          return hash;
        },
      };
      await reconcile(await batch(), cache, writing, context);
      if (reload) cache = StatCache.load(store.fileHashes, "wt");

      const next = await diffBatch(await batch(), cache, hasher);
      expect(touchedUnchanged(next, cache)).toEqual([]);
      await reconcile(await batch(), cache, hasher, context);

      expect(store.revisions.rows.map((r) => r.changes)).toEqual([
        [{ path, oldHash: null, newHash: hashOf("it();\n") }],
        [{ path, oldHash: hashOf("it();\n"), newHash: hashOf("it(2);\n// two\n") }],
        [{ path, oldHash: hashOf("it(2);\n// two\n"), newHash: hashOf("it(3);\n// three\n") }],
      ]);
    },
  );
});
