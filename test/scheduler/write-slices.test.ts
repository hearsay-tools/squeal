import { describe, expect, it } from "vitest";
import type { CacheUpdate } from "../../src/core/hash/stat-cache.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { BatchDiff } from "../../src/core/revision/reconcile.js";
import { flushStatsAhead, WRITE_SLICE_FILES } from "../../src/core/scheduler/batch.js";
import type { RelativePath, WorktreeId } from "../../src/core/types/common.js";
import type { FileHash } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import type { FileHashRecord } from "../../src/core/types/store-records.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 024 D5: a reconciliation's stat-cache updates of unchanged files go
 * ahead of the revision in transactions of `WRITE_SLICE_FILES`, an
 * event-loop turn between two.
 */

const WT = "w1" as WorktreeId;

function record(path: string, hash: string, mtimeMs = 1): FileHashRecord {
  return {
    path: path as RelativePath,
    mtimeMs,
    ctimeMs: mtimeMs,
    size: 1,
    inode: 1,
    hash: hash as FileHash,
  };
}

/** `n` files cached at mtime 1, and a diff that moves each one's stat and changes `src/changed.ts`. */
function setUp(n: number) {
  const store = open(fakeCommonDir());
  const paths = Array.from({ length: n }, (_, i) => `src/f${i}.ts`);
  const cache = new StatCache([...paths, "src/changed.ts"].map((p) => record(p, `h-${p}`)));
  const touched: CacheUpdate[] = paths.map((p) => ({
    kind: "set",
    record: record(p, `h-${p}`, 2),
    racy: false,
  }));
  const own: CacheUpdate = {
    kind: "set",
    record: record("src/changed.ts", "h-new", 2),
    racy: false,
  };
  const diff: BatchDiff = {
    trigger: "watch",
    changes: [
      {
        path: "src/changed.ts" as RelativePath,
        oldHash: "h-old" as FileHash,
        newHash: "h-new" as FileHash,
      },
    ],
    updates: [...touched, own],
  };
  return { store, cache, diff, own };
}

/** `store` with each transaction it starts, and each event-loop turn, logged in `events`. */
function logged(store: Store, events: string[]): Store {
  const transaction = store.transaction.bind(store);
  return Object.assign(Object.create(store) as Store, {
    transaction: <T>(fn: () => T): T => {
      events.push("slice");
      return transaction(fn);
    },
    fileHashes: store.fileHashes,
  });
}

describe("flushStatsAhead (spec 024 D5)", () => {
  it("writes a large batch's unchanged files ahead in slices, a turn between two", async () => {
    const n = 2 * WRITE_SLICE_FILES + 50;
    const { store, cache, diff, own } = setUp(n);
    const events: string[] = [];
    const turns = () => setImmediate(() => events.push("turn"));
    turns();
    const rest = await flushStatsAhead(logged(store, events), cache, WT, diff);

    expect(events.filter((e) => e === "slice")).toHaveLength(3);
    expect(events.slice(0, 3)).toEqual(["slice", "turn", "slice"]);
    // The change's own update is left for the revision's transaction.
    expect(rest.updates).toEqual([own]);
    expect(rest.changes).toEqual(diff.changes);
    const stored = new Map(store.fileHashes.list(WT).map((r) => [r.path, r]));
    expect(stored.get("src/f0.ts" as RelativePath)?.mtimeMs).toBe(2);
    expect(stored.get(`src/f${n - 1}.ts` as RelativePath)?.mtimeMs).toBe(2);
    expect(cache.get("src/f0.ts" as RelativePath)?.mtimeMs).toBe(2);
    // The changed file's new hash is neither stored nor in memory before its revision.
    expect(stored.get("src/changed.ts" as RelativePath)?.hash).not.toBe("h-new");
    expect(cache.get("src/changed.ts" as RelativePath)?.hash).toBe("h-src/changed.ts");
  });

  it("leaves a batch of up to a slice whole, writing nothing", async () => {
    const { store, cache, diff } = setUp(WRITE_SLICE_FILES);
    const events: string[] = [];
    const rest = await flushStatsAhead(logged(store, events), cache, WT, diff);
    expect(rest).toBe(diff);
    expect(events).toEqual([]);
    expect(cache.get("src/f0.ts" as RelativePath)?.mtimeMs).toBe(1);
  });
});
