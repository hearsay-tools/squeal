import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DEFAULT_POLICY, type Policy, type Store } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { claimRepo, fileName } from "./claims-fixture.js";
import { RecordingSink } from "./recording-sink.js";
import { WallRunner, wallOf } from "./wall-fixture.js";

/*
 * Row 011-154 (`research/stored-nothing.md` finding 2): a daemon's first
 * start in a new worktree has no previous key, so its misses kept no
 * duration, the backlog budget (C4 step 5) counted each as 0 and the first
 * baseline tier filled to `runner.backlogTierSize`. With no previous key, a
 * miss takes its duration from the file's newest stored result, from any
 * worktree, without advancing last-used.
 */
const BUDGET_MS = 120_000;
const FILES = 200;
const DURATION_MS = 10_000;
const SLOTS = 4;

const policy: Policy = {
  ...DEFAULT_POLICY,
  runner: { ...DEFAULT_POLICY.runner, tierSize: SLOTS, backlogTierSize: FILES },
};

/** A lone daemon at `root` over the shared store, its pool `SLOTS` wide. */
function daemonAt(root: string, store: Store, commonDir: string) {
  const dir = join(mkdtempSync(join(tmpdir(), "squeal-fresh-pool-")), "squeal-uid");
  onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: root.endsWith("main"),
    registeredAt: Date.now(),
    daemon: {
      socketPath: `/tmp/squeal-fresh-${worktreeId}.sock`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 60_000,
      squealVersion: "0.0.0-test",
    },
  });
  const files = Array.from({ length: FILES }, (_, i) => ({ project: "", path: fileName(i) }));
  const runner = new WallRunner(files, () => DURATION_MS);
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    capacity: { dir, hostSlots: SLOTS },
  });
  onTestFinished(async () => {
    runner.release();
    await scheduler.close();
  });
  return { runner, scheduler, worktreeId };
}

describe("scheduler: a new worktree's misses take the file's newest stored duration (011-154)", () => {
  it("cuts the first baseline tier to the budget, not to backlogTierSize", async () => {
    const { main, other } = claimRepo(FILES);
    const commonDir = join(main, ".git");
    const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
    const store: Store = opened;
    onTestFinished(() => store.close());

    // The main worktree's daemon ran every file: the store holds 200 durations.
    const first = daemonAt(main, store, commonDir);
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(first.runner.runs.flatMap((run) => run.files)).toHaveLength(FILES);
    await first.scheduler.close();

    // The new worktree is at a later commit that moved every key: 200 misses, no previous key.
    for (let i = 0; i < FILES; i++) writeFileSync(join(other, fileName(i)), `// file ${i}, v2\n`);
    git(other, ["commit", "-qam", "every file changed"]);
    const usedBefore = lastUsed(store, first.worktreeId);
    // Each file's test and its file-level check (row 013-03).
    expect(usedBefore).toHaveLength(2 * FILES);
    const fresh = daemonAt(other, store, commonDir);
    expect(store.testFileKeys.list(fresh.worktreeId)).toEqual([]);
    await fresh.scheduler.start();
    await fresh.scheduler.idle();

    const tiers = fresh.runner.runs.map((run) => run.files.length);
    let fits = SLOTS;
    while (wallOf(Array(fits + 1).fill(DURATION_MS), SLOTS) <= BUDGET_MS) fits++;
    expect(fits).toBeLessThan(FILES);
    expect(tiers[0]).toBe(fits);
    expect(tiers.reduce((a, b) => a + b, 0)).toBe(FILES);
    // Reading a duration is not a lookup hit (D8): the main worktree's rows keep their last-used.
    expect(lastUsed(store, first.worktreeId)).toEqual(usedBefore);
  });
});

/** The last-used time of each row `worktreeId` stored, by check and key. */
function lastUsed(store: Store, worktreeId: string): unknown[] {
  return connectionOf(store).all(
    "SELECT check_id, key, last_used_at FROM results WHERE worktree_id = ? ORDER BY check_id, key",
    worktreeId,
  );
}
