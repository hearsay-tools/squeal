import { realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsHasher, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { reconcile } from "../../src/core/revision/index.js";
import type { CandidateBatch, Revision } from "../../src/core/types/index.js";
import { isAtomicSaveTemp } from "../../src/core/watcher/atomic-save.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/index.js";
import { FakeStore } from "../hash/fakes.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";
import { delay, waitFor } from "./helpers.js";

/** Claude Code's temp file, as row 001-216 saw it. */
const TEMP = "src/a.ts.tmp.126736.8a6039186c60";

/** Row 001-216: the feed straight into `reconcile`, as the daemon loop runs it. */
describe("an atomic save's temp file", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let feed: ChangeFeed | null;
  let batches: CandidateBatch[];
  let revisions: Revision[];
  let errors: Error[];

  const startFeed = async (atomicSaveHoldMs: number) => {
    const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    const cache = new StatCache();
    await seedStatCache(cache, root, tracked, { objectFormat: "sha1" });
    const hasher = createFsHasher(root, "sha1");
    const store = new FakeStore();
    feed = createChangeFeed({
      root,
      onBatch: async (batch) => {
        batches.push(batch);
        const revision = await reconcile(batch, cache, hasher, {
          worktreeId: "wt",
          store,
          head: async () => ({ head: "abc123", dirty: true }),
        });
        if (revision) revisions.push(revision);
      },
      onError: (error) => errors.push(error),
      trackedPaths: () => cache.paths(),
      timings: { reconcileIntervalMs: 60_000, atomicSaveHoldMs },
    });
    await feed.start();
  };
  const changed = () => revisions.map((r) => r.changes.map((c) => c.path));

  beforeEach(() => {
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    initRepo(root, { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    feed = null;
    batches = [];
    revisions = [];
    errors = [];
  });
  afterEach(async () => {
    await feed?.close();
    dir.cleanup();
    expect(errors).toEqual([]);
  });

  it("has Claude Code's shape and no other", () => {
    expect(isAtomicSaveTemp(TEMP)).toBe(true);
    expect(isAtomicSaveTemp("scripts/changelog.mjs.tmp.414450.024803dafc3a")).toBe(true);
    for (const path of ["src/a.ts", "src/a.ts.tmp", "src/a.tmp.ts", "src/tmp.1.ts", "a.tmp.12"]) {
      expect(isAtomicSaveTemp(path)).toBe(false);
    }
  });

  it("makes exactly one revision, naming the real file, when create and rename land in different batches", async () => {
    await startFeed(5_000);
    writeFile(root, TEMP, "export const a = 2;\n");
    // Past the 500 ms maximum batch: the create's batch closes before the rename, as at load.
    await delay(800);
    renameSync(join(root, TEMP), join(root, "src/a.ts"));

    await waitFor(() => revisions.length >= 1);
    await delay(400);
    expect(changed()).toEqual([["src/a.ts"]]);
    expect(batches.some((b) => b.paths.some((p) => p.path === TEMP && p.stat !== null))).toBe(
      false,
    );
  });

  it("does not hold a real file added alone", async () => {
    // A hold far longer than the wait below: the add's revision cannot be waiting on it.
    await startFeed(600_000);
    writeFile(root, "src/new.ts", "export const n = 1;\n");

    await waitFor(() => revisions.length >= 1);
    expect(changed()).toEqual([["src/new.ts"]]);
  });

  it("reports a temp-shaped file still there after the hold as a new file", async () => {
    await startFeed(300);
    writeFile(root, TEMP, "left behind\n");

    await waitFor(() => revisions.length >= 1);
    expect(changed()).toEqual([[TEMP]]);
  });

  it("keeps a held temp file out of a reconciliation pass too", async () => {
    await startFeed(600_000);
    writeFile(root, TEMP, "export const a = 2;\n");
    await delay(400);
    await feed?.reconcile("interval");
    rmSync(join(root, TEMP));
    await feed?.reconcile("interval");

    expect(changed()).toEqual([]);
  });
});
