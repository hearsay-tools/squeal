import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { statesMark, trustedClosureWrites } from "../../src/core/store/write-markers.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Rows 011-44 and 011-45, repaired after review 0.1.489: a daemon of this
 * release makes the write markers' triggers when it registers. They stay
 * after it exits, so every later writer, of any release, moves the markers.
 */

describe("a daemon's registration makes the write markers' triggers", SLOW, () => {
  it("leaves both markers trusted, before and after its exit", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    onTestFinished(() => store.close());
    expect(trustedClosureWrites(store)).toBeNull();

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    expect(trustedClosureWrites(store)).not.toBeNull();
    // The daemon's own writes of its baseline name the worktree's states marker.
    const before = statesMark(store, repo.worktreeId);
    await daemon.stop("stop-requested");
    expect(trustedClosureWrites(store)).not.toBeNull();
    // A write after the daemon exited, as an older writer's, still moves the marker.
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.worktreeId,
        testFile: { project: "", path: "late.test.ts" as never },
        key: null,
        revision: 1 as never,
        pending: "queued",
      },
    ]);
    const after = statesMark(store, repo.worktreeId);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
