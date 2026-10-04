import { realpathSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsHasher, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { reconcile } from "../../src/core/revision/index.js";
import type { CandidateBatch, Revision } from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/index.js";
import { FakeStore } from "../hash/fakes.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";
import { delay, waitFor } from "../watcher/helpers.js";

/** The daemon loop in miniature: every `ChangeFeed` batch goes straight into `reconcile`. */
describe("ChangeFeed batches into reconcile", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let feed: ChangeFeed | null;
  let batches: CandidateBatch[];
  let revisions: (Revision | null)[];
  let errors: Error[];

  beforeEach(async () => {
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    initRepo(root, { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    const cache = new StatCache();
    await seedStatCache(cache, root, tracked, { objectFormat: "sha1" });
    const hasher = createFsHasher(root, "sha1");
    const store = new FakeStore();
    batches = [];
    revisions = [];
    errors = [];
    feed = createChangeFeed({
      root,
      onBatch: async (batch) => {
        batches.push(batch);
        revisions.push(
          await reconcile(batch, cache, hasher, {
            worktreeId: "wt",
            store,
            head: async () => ({ head: "abc123", dirty: true }),
          }),
        );
      },
      onError: (error) => errors.push(error),
      trackedPaths: () => cache.paths(),
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
    expect(batches.map((b) => b.trigger)).toEqual(["start"]);
    expect(revisions).toEqual([null]);
  });
  afterEach(async () => {
    await feed?.close();
    dir.cleanup();
    expect(errors).toEqual([]);
  });

  const watchBatchWith = (path: string) =>
    batches.findIndex((b) => b.trigger === "watch" && b.paths.some((p) => p.path === path));

  it("creates no revision for a touch", async () => {
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "src/a.ts"), later, later);

    await waitFor(() => watchBatchWith("src/a.ts") >= 0 && revisions.length === batches.length);

    const index = watchBatchWith("src/a.ts");
    expect(batches[index]?.paths.find((p) => p.path === "src/a.ts")?.stat).not.toBeNull();
    expect(revisions[index]).toBeNull();
    expect(revisions.filter((r) => r !== null)).toEqual([]);
  });

  it("creates one revision with exactly one FileChange for a content change", async () => {
    writeFile(root, "src/a.ts", "export const a = 2;\n");

    await waitFor(() => revisions.some((r) => r !== null));
    // Past the debounce window, so a second batch for the same write would have arrived.
    await delay(300);

    const created = revisions.filter((r) => r !== null);
    expect(created).toHaveLength(1);
    expect(created[0]?.trigger).toBe("watch");
    expect(created[0]?.changes).toEqual([
      { path: "src/a.ts", oldHash: expect.any(String), newHash: expect.any(String) },
    ]);
  });
});
