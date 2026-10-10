import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { Liveness } from "../../src/core/types/index.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Task 001-205, research `shared-runs.md` test 7 (D10 as amended): a
 * daemon killed mid-tier leaves its rows `running`. Its successor's first
 * heartbeat would make them live claims again until its baseline rewrites
 * them, and other worktrees would skip those files meanwhile; the successor
 * sets them `queued` in the transaction that registers it.
 */

const KEY = "k-restart";
const OTHER = "fedcba9876543210";
const live = (): Liveness => ({ now: Date.now(), graceIntervals: 2 });

describe("a restarted daemon's leftover claims (task 001-205)", SLOW, () => {
  it("7. stop blocking other worktrees before its baseline", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    onTestFinished(() => store.close());
    // The predecessor, killed during a tier: its record and its rows as it left them.
    store.worktrees.upsert({
      id: repo.worktreeId,
      root: repo.root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: repo.socketPath,
        startedAt: 1,
        heartbeatAt: 1,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-killed",
      },
    });
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.worktreeId,
        testFile: { project: "", path: "test/math.test.ts" },
        key: KEY,
        revision: 1,
        pending: "running",
      },
    ]);
    expect(store.testFileKeys.claimed(OTHER, KEY, live())).toBe(false);

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    // Registered and heartbeating, its baseline not yet committed.
    expect(store.worktrees.get(repo.worktreeId)?.daemon?.heartbeatAt).toBeGreaterThan(1);
    expect(store.testFileKeys.claimed(OTHER, KEY, live())).toBe(false);
    const row = store.testFileKeys.list(repo.worktreeId).find((r) => r.key === KEY);
    expect(row?.pending).toBe("queued");
  });
});
