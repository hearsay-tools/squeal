import { describe, expect, it, onTestFinished } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import type { RunnerEnvironment } from "../../src/core/types/index.js";
import { type DaemonNote, notesMetaKey } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { HARNESS_INCARNATION, liveDaemon } from "./store-wait.js";

/*
 * Task 001-259 (`research/wait-from-store.md` question 3): 001-228 bounded a
 * revision's runner part only. A `run --all` retry and the baseline call
 * the runner under the lock with no bound, so a wedged runner held the lock
 * and every `status --wait` whose daemon pass needs it to the wait's own
 * timeout. Both are bounded now: abandoned at the bound with a note, and a
 * wait queued behind them answers.
 */

const BOUND_MS = 1_000;
const ABANDONED = /^runner environment failed: no answer within 1 s; the call was abandoned$/;

function notes(h: Harness): string[] {
  const raw = h.store.meta.get(notesMetaKey(h.worktreeId));
  return raw === null ? [] : (JSON.parse(raw) as DaemonNote[]).map((note) => note.text);
}

/**
 * The next `environment` never answers (until the test ends); later ones
 * reach the adapter. Returns how many were made.
 */
function wedgeNextEnvironment(h: Harness): () => number {
  const real = h.runner.environment.bind(h.runner);
  const hung: ((error: Error) => void)[] = [];
  onTestFinished(() => {
    for (const reject of hung) reject(new Error("test over"));
  });
  let calls = 0;
  h.runner.environment = () => {
    calls += 1;
    if (calls > 1) return real();
    return new Promise<readonly RunnerEnvironment[]>((_, reject) => hung.push(reject));
  };
  return () => calls;
}

/**
 * A wait's daemon pass as the daemon runs it: a reconciliation of `path`,
 * which needs the scheduler lock, then the revision it left.
 */
function passSync(h: Harness, path: string) {
  return (): DaemonSync => {
    let state: SyncState = { state: "pending" };
    void h.batch(path).then(() => {
      state = {
        state: "synced",
        revision: h.scheduler.status().revision,
        incarnation: HARNESS_INCARNATION,
      };
    });
    return { current: () => state, stop: () => {} };
  };
}

describe("the runner-part bound covers the retry and the baseline (task 001-259)", () => {
  it(
    "abandons a wedged run --all retry at the bound, and a wait behind it answers",
    SLOW,
    async () => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        failing: ["environment"],
        allowErrors: true,
        runnerPartMs: BOUND_MS,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
      // The runner is broken: `run --all` retries it first, and its `environment` wedges.
      h.runner.failing.clear();
      const calls = wedgeNextEnvironment(h);
      const started = Date.now();
      const request = h.scheduler.requestFullSuite();
      await expect.poll(calls, { timeout: 30_000 }).toBe(1);

      // A wait whose pass is queued behind the retry, under the lock.
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
      const wait = waitForStatus(h.root, {
        timeoutMs: 60_000,
        pollMs: 20,
        settleMs: 0,
        sync: passSync(h, "src/strings.ts"),
      });
      await request;
      expect(Date.now() - started).toBeGreaterThanOrEqual(BOUND_MS - 50);
      expect(notes(h)).toContainEqual(expect.stringMatching(ABANDONED));

      const answer = await wait;
      expect(["quiet", "news"]).toContain(answer.outcome);
      await h.scheduler.idle();
    },
  );

  it(
    "abandons a wedged baseline at the bound, and a wait behind the start answers",
    SLOW,
    async () => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        allowErrors: true,
        runnerPartMs: BOUND_MS,
      });
      liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
      const calls = wedgeNextEnvironment(h);
      const started = Date.now();
      const start = h.scheduler.start();
      await expect.poll(calls, { timeout: 30_000 }).toBe(1);

      // A wait whose pass is queued behind the baseline, which holds the lock.
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
      const wait = waitForStatus(h.root, {
        timeoutMs: 60_000,
        pollMs: 20,
        settleMs: 0,
        sync: passSync(h, "src/strings.ts"),
      });
      await start;
      expect(Date.now() - started).toBeGreaterThanOrEqual(BOUND_MS - 50);
      expect(notes(h)).toContainEqual(expect.stringMatching(ABANDONED));

      const answer = await wait;
      expect(["quiet", "news"]).toContain(answer.outcome);
      // The next refinement retried the runner: the files are listed and keyed again.
      await h.scheduler.idle();
      expect(h.header().counts.unknown).toBe(0);
    },
  );
});
