import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/paths.js";
import { noneRemoved, pruneSlices } from "../../src/core/store/prune.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DAY_MS, fakeCommonDir, open, result, tempDir, testCheck, worktree } from "./helpers.js";
import { raceAfterRead } from "./prune-race.js";

/*
 * Row 021-33 (review 0.1.568): the results a prune found old are deleted by
 * key, and each is tested again under the write lock by searches
 * (`PRUNABLE_BY_KEY`). A result that a rule came to keep between the read
 * and the delete stays.
 */

const NOW = 100 * DAY_MS;
const OPTIONS = { now: NOW, retentionDays: 7, maxSizeMb: null };

/** A store with a main worktree and a linked one, both live. */
function twoWorktrees() {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const linkedRoot = tempDir();
  writeFileSync(join(linkedRoot, ".git"), `gitdir: ${commonDir}/worktrees/linked\n`);
  store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
  store.worktrees.upsert(worktree("linked", linkedRoot, { commonDir }));
  return { commonDir, store, conn: connectionOf(store) };
}

describe("an old result live again before its delete (row 021-33)", () => {
  it("stays when its key became a live worktree's current test-file key", () => {
    const { commonDir, store, conn } = twoWorktrees();
    store.results.putMany([
      result(testCheck("c"), "k-old", { worktreeId: "linked", recordedAt: NOW - 30 * DAY_MS }),
    ]);
    const counts = noneRemoved();
    raceAfterRead(
      conn,
      pruneSlices(conn, store.worktrees, storePaths(commonDir), OPTIONS, counts),
      "results",
      () =>
        store.testFileKeys.upsertMany([
          {
            worktreeId: "linked",
            testFile: { project: "", path: "src/a.test.ts" },
            key: "k-old",
            revision: 2,
            pending: null,
          },
        ]),
    );
    expect(counts.resultsRemoved).toBe(0);
    expect(store.results.byKey("k-old")).toHaveLength(1);
  });

  it("stays when it became its check's newest main-worktree result", () => {
    const { commonDir, store, conn } = twoWorktrees();
    store.results.putMany([
      result(testCheck("c"), "k-older", { worktreeId: "main", recordedAt: NOW - 30 * DAY_MS }),
      result(testCheck("c"), "k-newer", { worktreeId: "main", recordedAt: NOW - 20 * DAY_MS }),
    ]);
    const counts = noneRemoved();
    raceAfterRead(
      conn,
      pruneSlices(conn, store.worktrees, storePaths(commonDir), OPTIONS, counts),
      "results",
      () => conn.run("DELETE FROM results WHERE key = ?", "k-newer"),
    );
    expect(counts.resultsRemoved).toBe(0);
    expect(store.results.byKey("k-older")).toHaveLength(1);
  });
});
