import { describe, expect, it, onTestFinished } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { captureSync, liveDaemon } from "./store-wait.js";

/*
 * Review wave 13k, S1 (task 001-196): a result clears its file's
 * attribution, so a result that landed after the wait started and before the
 * daemon's sync answer left the file out of the answer, and the edit's own
 * failure was another check's news: the wait ended quiet. The store's moves
 * name the files whose move was resolved after the wait's start view (task
 * 001-258). The scheduler, store and sink are real; the sync captures the
 * revision when the wait asks, as the daemon's pass does.
 */

const MATH = "test/math.test.ts";

describe("status --wait over a result that lands before the sync answer (task 001-196)", () => {
  it("returns on the edit's own news", SLOW, async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
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

    const sync = captureSync(
      () => h.scheduler.status().revision,
      async () => {
        // The edit's failure lands before the wait reads its files.
        release();
        await expect.poll(failed, { timeout: 60_000 }).toBe(true);
      },
    );
    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    expect(wait.outcome).toBe("news");
    expect(wait).toMatchObject({
      transitions: 1,
      edit: { testFiles: 1, pending: 0, otherTransitions: 0 },
    });
  });
});
