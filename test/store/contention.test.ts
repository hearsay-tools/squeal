import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DAEMON_BUSY_TIMEOUT_MS } from "../../src/core/daemon/open.js";
import { storePaths } from "../../src/core/store/index.js";
import type { PruneReport } from "../../src/core/types/index.js";
import { report, spawnWorker } from "./child/spawn.js";
import { fakeCommonDir, open, tempDir, worktree } from "./helpers.js";

const REMOVED_RESULTS = 200_000;

interface WaiterReport {
  writes: number;
  busy: number;
  longestMs: number;
}

/** `count` results owned by `worktreeId`, written straight into the file. */
function seedResults(commonDir: string, worktreeId: string, count: number): void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA busy_timeout = 60000");
  db.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO results (check_id, key, outcome, duration_ms, worktree_id, revision, dirty,
                          run_id, recorded_at, last_used_at)
     SELECT i, ? || '-' || i, 'pass', 1, ?, 1, 0, ? || '-run-' || (i / 100), 1000, 1000 FROM n`,
  ).run(count, worktreeId, worktreeId, worktreeId);
  db.close();
}

/**
 * 003 lessons, defect 5 (task 001-141): a second daemon's first prune
 * dropped a removed worktree's results in one `DELETE` and freed every page
 * in one `incremental_vacuum`, holding the write lock for 15 s on cezar's
 * 150 MB store. The running daemon's tier write waited past its 5 s busy
 * timeout and failed with "database is locked".
 */
describe("a prune beside other writers (spec 001 D8, task 001-141)", () => {
  // The old single `DELETE` of these rows held the lock for 6.2 s at load 70; the batches, 0.16 s.
  it(`drops ${REMOVED_RESULTS} results of a removed worktree while a daemon's writes never time out`, async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const removedRoot = tempDir();
    writeFileSync(join(removedRoot, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
    store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
    store.worktrees.upsert(worktree("removed", removedRoot, { commonDir }));
    rmSync(removedRoot, { recursive: true });
    seedResults(commonDir, "removed", REMOVED_RESULTS);

    const waiter = spawnWorker(["waiter", commonDir, String(DAEMON_BUSY_TIMEOUT_MS)]);
    await waiter.waitFor("ready");
    const pruned = report<PruneReport>(await spawnWorker(["pruner", commonDir]).done);
    writeFileSync(join(commonDir, "stop"), "");
    const waited = report<WaiterReport>(await waiter.done);

    expect(pruned.resultsRemoved).toBe(REMOVED_RESULTS);
    expect(pruned.worktreesRemoved).toBe(1);
    expect(waited.writes).toBeGreaterThan(0);
    expect(waited).toMatchObject({ busy: 0 });
  }, 180_000);
});
