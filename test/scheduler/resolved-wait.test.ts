import { describe, expect, it, onTestFinished } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13k, S1 (task 001-196): a result clears its file's
 * attribution, so a result that landed after the wait started and before the
 * daemon's sync answer left the file out of the answer, and the edit's own
 * failure was another check's news: the wait ended quiet. The answer now
 * names the files whose move had its result since the wait started. The
 * scheduler, store and sink are real; the sync is the daemon's sequence.
 */

const MATH = "test/math.test.ts";

describe("status --wait over a result that lands before the sync answer (task 001-196)", () => {
  it("returns on the edit's own news", SLOW, async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    // A live daemon record: without one a wait never reports quiet (D7).
    h.store.worktrees.upsert({
      id: h.worktreeId,
      root: h.root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: Date.now(),
      daemon: {
        socketPath: "/tmp/squeal-test.sock",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 600_000,
        squealVersion: "0.0.0-test",
      },
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.runner.beforeRun = () => held;
    onTestFinished(release);
    // The edit breaks math; its tier starts and is held.
    h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
    await h.batch("src/math.ts");
    const failed = () =>
      h.store.knownStates
        .list(h.worktreeId)
        .some((state) => state.check.testPath === MATH && state.outcome === "fail");
    expect(failed()).toBe(false);

    let state: SyncState = { state: "pending" };
    const sync = (
      _root: unknown,
      _pollMs: number,
      after: RevisionNumber,
      resolvedSince: EpochMs,
    ): DaemonSync => {
      void (async () => {
        const revision = h.scheduler.status().revision;
        // The edit's failure lands while the pass waits for the runner part.
        release();
        await expect.poll(failed, { timeout: 60_000 }).toBe(true);
        await h.scheduler.refined();
        state = {
          state: "synced",
          revision,
          rekeyed: h.scheduler.rekeyedSince(after, revision, resolvedSince),
        };
      })();
      return { current: () => state, stop: () => {} };
    };

    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    expect(wait.outcome).toBe("news");
    expect(wait).toMatchObject({
      transitions: 1,
      edit: { testFiles: 1, pending: 0, otherTransitions: 0 },
    });
  });
});
