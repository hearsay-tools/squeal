import { appendFileSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobHash, createFsHasher, type Hasher, StatCache } from "../../src/core/hash/index.js";
import {
  diffBatch,
  type ReconcileContext,
  reconcile,
  statCandidates,
} from "../../src/core/revision/index.js";
import {
  changedSince,
  snapshotInputs,
  touchedUnchanged,
} from "../../src/core/scheduler/stability.js";
import type { RelativePath } from "../../src/core/types/index.js";
import { FakeStore } from "../hash/fakes.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

/*
 * Row 011-204 (task 011-203): a pass stores a hash only beside a stat taken
 * before its read and one taken after it that agree. Stored beside a stat
 * from before a write, the write's own batch would see a moved stat over
 * unchanged bytes, a touch (001-159), and the edit's file would run twice.
 * Stored beside a stat from after a write it did not read, the write would
 * be lost (review 0.1.310 B1). Stored with no usable stat, a tier's snapshot
 * would miss a later write and its restore (review 0.1.310-r2 N1).
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
  const changes = () => store.revisions.rows.map((r) => r.changes);
  /** Moves the file's `mtime` `aheadMs` ahead, so its stat moves whatever the clock's tick. */
  const moveMtime = (aheadMs: number) => {
    const later = new Date(Date.now() + aheadMs);
    utimesSync(join(root, path), later, later);
  };
  /** `inner`, calling `after` once each read is done, counting the reads. */
  const afterEachRead = (inner: Hasher, after: (read: number) => void) => {
    const counted = { reads: 0 };
    const spy: Hasher = {
      ...inner,
      hash: async (p) => {
        const hash = await inner.hash(p);
        counted.reads += 1;
        after(counted.reads);
        return hash;
      },
    };
    return { spy, counted };
  };

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

    expect(changes()).toEqual([
      [{ path, oldHash: null, newHash: hashOf("it();\n") }],
      [{ path, oldHash: hashOf("it();\n"), newHash: hashOf("it();\n// edited\n") }],
    ]);
    expect(cache.hashOf(path)).toBe(hashOf(readFileSync(join(root, path), "utf8")));
  });

  it("finds a write and its restore after a tier's snapshot as a touch (review 0.1.310-r2 N1)", async () => {
    const cache = new StatCache();
    writeFile(root, path, "it();\n");
    await reconcile(await batch(), cache, hasher, context);
    expect(cache.isRacy(path)).toBe(true);

    // A write between the pass's stat and its read; the tier for its change snapshots its inputs.
    const before = await batch();
    writeFile(root, path, "it(2);\n");
    await reconcile(before, cache, hasher, context);
    const snapshot = snapshotInputs(cache, [path]);

    // While the tier runs, other bytes, then the keyed bytes again, and no batch yet.
    writeFile(root, path, "it(other);\n");
    writeFile(root, path, "it(2);\n");
    moveMtime(60_000);
    const moved = await changedSince(snapshot, [path], hasher);

    expect([...moved.changed]).toEqual([]);
    expect([...moved.touched]).toEqual([path]);
    expect(changes().at(-1)).toEqual([
      { path, oldHash: hashOf("it();\n"), newHash: hashOf("it(2);\n") },
    ]);
  });

  it.each([
    ["with the cache in memory", false],
    ["after the cache is reloaded from the store (review 0.1.310 B1)", true],
  ] as const)(
    "reports a write after the read in the pass that read it, with no touch after, %s",
    async (_, reload) => {
      // A clock far past every mtime: only what the pass stored can make the next one hash again.
      hasher = { ...createFsHasher(root, "sha1"), now: () => Date.now() + 3_600_000 };
      let cache = new StatCache();
      writeFile(root, path, "it();\n");
      await reconcile(await batch(), cache, hasher, context);

      writeFile(root, path, "it(2);\n// two\n");
      const { spy: writing, counted } = afterEachRead(hasher, (read) => {
        if (read === 1) writeFile(root, path, "it(3);\n// three\n");
      });
      await reconcile(await batch(), cache, writing, context);
      expect(counted.reads).toBe(2);
      if (reload) cache = StatCache.load(store.fileHashes, "wt");

      const next = await diffBatch(await batch(), cache, hasher);
      expect(next.changes).toEqual([]);
      expect(touchedUnchanged(next, cache)).toEqual([]);

      // The second read saw the write: the pass that read it reports it.
      expect(changes()).toEqual([
        [{ path, oldHash: null, newHash: hashOf("it();\n") }],
        [{ path, oldHash: hashOf("it();\n"), newHash: hashOf("it(3);\n// three\n") }],
      ]);
    },
  );

  it.each([
    ["with the cache in memory", false],
    ["after the cache is reloaded from the store", true],
  ] as const)(
    "reads a file that never settles three times, then touches it and hashes it again, %s",
    async (_, reload) => {
      hasher = { ...createFsHasher(root, "sha1"), now: () => Date.now() + 3_600_000 };
      let cache = new StatCache();
      writeFile(root, path, "it();\n");
      await reconcile(await batch(), cache, hasher, context);

      // Each read is followed by a write of the same bytes: no stat after a read is the one before it.
      writeFile(root, path, "it(2);\n");
      const { spy: rewriting, counted } = afterEachRead(hasher, (read) => {
        writeFile(root, path, "it(2);\n");
        moveMtime(60_000 + read * 1_000);
      });
      await reconcile(await batch(), cache, rewriting, context);
      expect(counted.reads).toBe(3);
      if (reload) cache = StatCache.load(store.fileHashes, "wt");

      // Settled now, with the bytes the pass read: hashed again, and a touch, not a change.
      const { spy: counting, counted: again } = afterEachRead(hasher, () => {});
      const next = await diffBatch(await batch(), cache, counting);
      expect(again.reads).toBe(1);
      expect(next.changes).toEqual([]);
      expect(touchedUnchanged(next, cache)).toEqual([path]);
      await reconcile(await batch(), cache, hasher, context);

      const { spy: settled, counted: last } = afterEachRead(hasher, () => {});
      expect((await diffBatch(await batch(), cache, settled)).updates).toEqual([]);
      expect(last.reads).toBe(0);
      expect(changes()).toEqual([
        [{ path, oldHash: null, newHash: hashOf("it();\n") }],
        [{ path, oldHash: hashOf("it();\n"), newHash: hashOf("it(2);\n") }],
      ]);
    },
  );
});
