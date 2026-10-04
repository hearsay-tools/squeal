import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS, fakeCommonDir, open, result, tempDir, testCheck, worktree } from "./helpers.js";

/*
 * Spec 001 D5: "An unkeyed or `unknown` file is always work to do". The
 * scheduler keeps a `test_file_keys` row with `key: null` for a test file it
 * cannot key, so status and headers count it (review wave 2, B1).
 */
describe("unkeyed test_file_keys rows", () => {
  it("round-trip with a null key", () => {
    const store = open(fakeCommonDir());
    const row = {
      worktreeId: "wt",
      testFile: { project: "", path: "test/a.test.ts" },
      key: null,
      revision: 3,
      pending: null,
    };
    store.testFileKeys.upsertMany([row]);
    expect(store.testFileKeys.list("wt")).toEqual([row]);
    expect(store.results.byKey(null)).toEqual([]);
  });

  it("do not stop pruning: an unkeyed row protects nothing", () => {
    const store = open(fakeCommonDir());
    const root = tempDir();
    writeFileSync(join(root, ".git"), "gitdir: /repo/.git/worktrees/wt\n");
    store.worktrees.upsert(worktree("wt", root));
    store.testFileKeys.upsertMany([
      {
        worktreeId: "wt",
        testFile: { project: "", path: "a" },
        key: null,
        revision: 1,
        pending: null,
      },
      {
        worktreeId: "wt",
        testFile: { project: "", path: "b" },
        key: "k-live",
        revision: 1,
        pending: null,
      },
    ]);
    const now = 100 * DAY_MS;
    store.results.putMany([
      result(testCheck("live"), "k-live", { worktreeId: "wt", recordedAt: now - 30 * DAY_MS }),
      result(testCheck("old"), "k-old", { worktreeId: "wt", recordedAt: now - 30 * DAY_MS }),
    ]);

    const report = store.prune({ now, retentionDays: 7, maxSizeMb: null });

    expect(report.resultsRemoved).toBe(1);
    expect(store.results.byKey("k-live")).toHaveLength(1);
    expect(store.results.byKey("k-old")).toEqual([]);
  });
});
