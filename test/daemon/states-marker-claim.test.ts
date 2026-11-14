import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { statesMark } from "../../src/core/store/states-marker.js";
import { daemonIncarnation } from "../../src/core/types/daemon.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Row 011-45: a daemon claims its worktree's states marker when it
 * registers, so a fallback `status --wait` trusts the marker while that
 * daemon is registered; an older daemon's registration, which claims
 * nothing, leaves it untrusted.
 */

describe("a daemon's registration claims the states marker (row 011-45)", SLOW, () => {
  it("is trusted while that daemon is registered, and not after an older one registers", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    onTestFinished(() => store.close());

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;

    const incarnation = daemonIncarnation(store.worktrees.get(repo.worktreeId)?.daemon ?? null);
    expect(incarnation).not.toBeNull();
    expect(statesMark(store, repo.worktreeId)?.split("@").slice(1).join("@")).toBe(incarnation);

    await daemon.stop("stop-requested");
    // A clean exit clears the record: no daemon vouches for the marker.
    expect(statesMark(store, repo.worktreeId)).toBeNull();
    store.worktrees.setDaemon(repo.worktreeId, {
      socketPath: repo.socketPath,
      startedAt: 2,
      heartbeatAt: 2,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.1.112",
    });
    expect(statesMark(store, repo.worktreeId)).toBeNull();
  });
});
