// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// reviews/wave-13k.md S1 (the reproduction in test/scheduler/resolved-wait.test.ts),
// answered from the store instead of `rekeyedSince`.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { waitForStatus } from "../../../../../../src/cli/status-wait.js";
import {
  createRepo,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../../../../../test/scheduler/helpers.js";
import { SHADOW } from "./shadow.js";
import { type StoreSyncLog, storeSync } from "./store-sync.js";

vi.mock("../../../../../../src/core/scheduler/rekeyed-record.js", async (importOriginal) =>
  (await import("./mock.js")).shadowedRecord(importOriginal as never),
);

const MATH = "test/math.test.ts";

describe("13k S1 from the store: a result before the answer", () => {
  it.each([
    { name: "resolved entries with their commit", openOnly: false },
    { name: "control: open entries only, no resolve time", openOnly: true },
  ])("$name", SLOW, async ({ openOnly }) => {
    SHADOW.openOnly = openOnly;
    onTestFinished(() => {
      SHADOW.openOnly = false;
    });
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
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
    h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
    await h.batch("src/math.ts");
    const failed = () =>
      h.store.knownStates
        .list(h.worktreeId)
        .some((state) => state.check.testPath === MATH && state.outcome === "fail");
    expect(failed()).toBe(false);

    const log: StoreSyncLog = { sinceSeqs: [], outcomes: [] };
    const sync = storeSync(
      h.store,
      h.worktreeId,
      () => h.scheduler.status().revision,
      async () => {
        // The edit's failure lands before the answer is read.
        release();
        await expect.poll(failed, { timeout: 60_000 }).toBe(true);
      },
      log,
    );
    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    // The prototype was fed by the real commits before the wait started.
    expect(log.sinceSeqs[0]).toBeGreaterThan(0);
    expect(log.outcomes).toEqual(["answered"]);
    if (openOnly) {
      // The 13k S1 failure: the edit's failure counted as another check's news.
      expect(wait).toMatchObject({
        outcome: "quiet",
        transitions: 0,
        edit: { testFiles: 0, otherTransitions: 1 },
      });
      return;
    }
    expect(wait.outcome).toBe("news");
    expect(wait).toMatchObject({
      transitions: 1,
      edit: { testFiles: 1, pending: 0, otherTransitions: 0 },
    });
  });
});
