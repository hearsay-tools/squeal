// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// 001-228 bounds each call of a revision's runner part, not `run --all`'s retry
// of a failed runner (`retryRunner`, run by `afterTier` under the lock). Does a
// held answer still reach the one-hour backstop? The runner is broken from the
// baseline (`environment` rejects), then `environment` never answers. A
// revision's runner part is abandoned at its bound (2 s here); a `run --all`
// queued during it retries the runner and hangs; a sync answer taken after it
// (`rekeyedOnceRefined`, as the daemon calls it) waits behind the retry. The
// same moment read from the store: its refined revision already covers the
// capture.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { HOLD_MS, INCOMPLETE_ANSWER } from "../../../../../../src/core/scheduler/discharges.js";
import type { EpochMs } from "../../../../../../src/core/types/index.js";
import { refinedMetaKey } from "../../../../../../src/core/types/index.js";
import { settle, spyDischarges } from "../../../../../../test/scheduler/held-socket.js";
import {
  createRepo,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../../../../../test/scheduler/helpers.js";
import { answerFromStore, readShadow } from "./shadow.js";

vi.mock("../../../../../../src/core/scheduler/rekeyed-record.js", async (importOriginal) =>
  (await import("./mock.js")).shadowedRecord(importOriginal as never),
);

describe("001-228's unbounded retry and the one-hour backstop", () => {
  it("a held answer behind a hung run --all retry ends only at the hour", SLOW, async () => {
    const instance = spyDischarges();
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      failing: ["environment"],
      allowErrors: true,
      runnerPartMs: 2_000,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    // From now on `environment` never answers: a wedged runner.
    h.runner.failing.clear();
    let environmentCalls = 0;
    const hung: ((error: Error) => void)[] = [];
    h.runner.environment = () => {
      environmentCalls += 1;
      return new Promise((_, reject) => hung.push(reject));
    };
    // Registered before the fake clock's, so it runs after it: the scheduler can close.
    onTestFinished(() => {
      for (const reject of hung) reject(new Error("probe over"));
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    onTestFinished(() => {
      vi.useRealTimers();
    });

    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
    await h.batch("src/strings.ts");
    const revision = h.scheduler.status().revision;
    // The revision's runner part is in its runner phase, its `environment` hung.
    await expect.poll(() => environmentCalls, { timeout: 30_000 }).toBe(1);
    // `run --all` while the runner is broken: its retry queues behind the runner part.
    void h.scheduler.requestFullSuite().catch(() => {});
    await settle();
    // A wait's sync, as the daemon takes it after its reconciliation pass.
    const since = (Date.now() - 1) as EpochMs;
    const sinceSeq = readShadow(h.store, h.worktreeId).seq;
    let ended: string | null = null;
    void h.scheduler.rekeyedOnceRefined(0, revision, since).then(
      () => {
        ended = "answered";
      },
      (error: Error) => {
        ended = error.message;
      },
    );
    await settle();
    expect(instance.discharges?.holds).toBe(1);

    // The runner part is abandoned at its bound and the revision recorded refined.
    await expect
      .poll(() => Number(h.store.meta.get(refinedMetaKey(h.worktreeId))), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(revision);
    // The retry has started and hangs in `environment`, under the lock.
    await expect.poll(() => environmentCalls, { timeout: 30_000 }).toBe(2);
    // The store answers now; the held answer does not.
    const fromStore = answerFromStore(h.store, h.worktreeId, 0, revision, sinceSeq);
    expect(fromStore.state).toBe("answered");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ended).toBeNull();
    expect(instance.discharges?.holds).toBe(1);

    // Only the hour ends it.
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await settle();
    expect(ended).toBe(INCOMPLETE_ANSWER);
    expect(instance.discharges?.holds).toBe(0);
    expect(environmentCalls).toBe(2);

    // Over: the hung calls fail, the queued run --all drains, and the scheduler can close.
    vi.useRealTimers();
    h.runner.environment = () => Promise.reject(new Error("probe over"));
    for (const reject of hung) reject(new Error("probe over"));
    await h.scheduler.idle();
  });
});
