import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { rekeyedMovesMetaKey } from "../../src/core/scheduler/rekeyed-moves.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import { daemonIncarnation } from "../../src/core/types/index.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Task 001-268, as decided by the human (2026-10-11): a daemon reads the
 * registration before its own, and its ledger's first commit takes in what
 * was left (dropping the history before it) only when that registration is
 * not the re-key moves' writer. Real daemons, one after another, on one
 * worktree: a fresh start and a restart after a clean exit take nothing in;
 * a start after an older daemon registered does.
 */

describe("a daemon's first commit after the daemon before it (task 001-268)", SLOW, () => {
  it("takes nothing in on a fresh worktree or after a clean exit, and does after an older one", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    onTestFinished(() => store.close());
    const moves = () => JSON.parse(store.meta.get(rekeyedMovesMetaKey(repo.worktreeId)) ?? "{}");
    const run = async () => {
      const daemon = await startDaemon({ root: repo.root, env: repo.env });
      if ("reason" in daemon) throw new Error(daemon.message);
      await daemon.ready;
      const record = store.worktrees.get(repo.worktreeId)?.daemon ?? null;
      await daemon.stop("stop-requested");
      return daemonIncarnation(record);
    };

    const first = await run();
    expect(moves()).toMatchObject({ writer: first, dropped: 0 });
    // Cleared on exit, its identity kept.
    expect(store.worktrees.get(repo.worktreeId)?.daemon).toBeNull();

    const second = await run();
    expect(second).not.toBe(first);
    expect(moves()).toMatchObject({ writer: second, dropped: 0 });

    // An older daemon registers and leaves, as a crash does; the moves are not its.
    const before = moves().seq as number;
    store.worktrees.setDaemon(repo.worktreeId, {
      socketPath: repo.socketPath,
      startedAt: 2,
      heartbeatAt: 2,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.1.112",
    });
    const third = await run();
    expect(moves().writer).toBe(third);
    expect(moves().dropped).toBeGreaterThan(before);
  });
});
