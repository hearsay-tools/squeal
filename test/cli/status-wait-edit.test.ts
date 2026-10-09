import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import { tellRevision } from "../../src/core/delivery/liveness.js";
import {
  type CheckKey,
  type DaemonRecord,
  MAIN_AGENT,
  type PendingPhase,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Lessons, defect 32, decided by the human (2026-10-09, task 001-186): a
 * wait ends when the test files its window's edits re-keyed have their
 * results, while a backlog or a slow file still runs; only their checks'
 * transitions end it early. The daemon names the files (`SyncState.rekeyed`).
 */

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const A = "src/a.test.ts";
const B = "src/b.test.ts";
const C = "src/c.test.ts";
const SLOW_FILE = "test/slow.test.ts";
const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
const ADDS = check(A, "adds");
const BACKLOG = check(B, "holds");

const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-test.sock",
  startedAt: NOW - 60_000,
  heartbeatAt: NOW - 1_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
};

/** A worktree at revision 4, the edit's, with `pending` test files queued and their checks pending. */
function repoWith(pending: readonly string[], done: readonly string[] = []) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: LIVE,
  });
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  for (const path of pending) key(store, repo.mainId, path, "queued");
  for (const path of done) key(store, repo.mainId, path, null);
  store.knownStates.upsertMany(
    [...pending, ...done].map((path) =>
      state(repo.mainId, check(path, "holds"), {
        validity: pending.includes(path) ? "pending" : "current",
        pendingPhase: pending.includes(path) ? "queued" : null,
        observedAt: 3,
      }),
    ),
  );
  if (pending.includes(A) || done.includes(A)) {
    store.knownStates.upsertMany([
      state(repo.mainId, ADDS, {
        validity: pending.includes(A) ? "pending" : "current",
        pendingPhase: pending.includes(A) ? "queued" : null,
        observedAt: 3,
      }),
    ]);
  }
  return { repo, store };
}

function key(store: Store, worktreeId: string, path: string, pending: PendingPhase | null) {
  store.testFileKeys.upsertMany([
    {
      worktreeId,
      testFile: ref(path),
      key: `key-${path}-${pending ?? "done"}` as CheckKey,
      revision: 4 as RevisionNumber,
      pending,
    },
  ]);
}

/** The file's run ended with the outcome it had: no transition. */
function finish(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, null);
  const checks = path === A ? [ADDS, check(A, "holds")] : [check(path, "holds")];
  store.knownStates.upsertMany(checks.map((c) => state(worktreeId, c, { observedAt: 4 })));
}

function fail(store: Store, worktreeId: string, c: ReturnType<typeof check>) {
  store.knownStates.upsertMany([
    state(worktreeId, c, { outcome: "fail", observedAt: 4, fingerprint: "Error: x" }),
  ]);
}

function later(ms: number, fn: () => void) {
  setTimeout(fn, ms);
}

/** A daemon that answers the pass at once, naming `rekeyed`; records the asked window. */
function answering(rekeyed: readonly string[] | null, current?: SyncState) {
  const asked: RevisionNumber[] = [];
  const state: SyncState = current ?? {
    state: "synced",
    revision: 4 as RevisionNumber,
    rekeyed: rekeyed === null ? null : rekeyed.map(ref),
  };
  const sync = (_root: unknown, _pollMs: number, after: RevisionNumber): DaemonSync => {
    asked.push(after);
    return { current: () => state, stop: () => {} };
  };
  return { asked, sync };
}

const options = (sync: ReturnType<typeof answering>["sync"], timeoutMs = 5_000) => ({
  timeoutMs,
  pollMs: 20,
  now: () => NOW,
  sync,
});

describe("status --wait holds for the edit's own test files (lessons, defect 32)", () => {
  it("returns quiet once the edited file's result is in, while a backlog runs", async () => {
    const { repo, store } = repoWith([A, B, C]);
    later(300, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, options(answering([A]).sync));

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(300);
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait).toMatchObject({
      transitions: 0,
      edit: { since: 4, testFiles: 1, pending: 0, otherTransitions: 0 },
    });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on quiet: nothing the edits since revision 4 re-keyed is pending \(1 test file\) at revision 4 after \d+\.\d s; 2 checks pending in all$/,
    );
  });

  it("does not end on a backlog file's news, and reports it", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));
    later(500, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, options(answering([A]).sync));

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(500);
    expect(wait).toMatchObject({ edit: { otherTransitions: 1 } });
    expect(waitLine(wait as EndedWait)).toMatch(/; 1 transition of other checks$/);
  });

  it("ends on news of the edit's own checks", async () => {
    const { repo, store } = repoWith([A, B]);
    later(200, () => fail(store, repo.mainId, ADDS));

    const wait = await waitForStatus(repo.main, options(answering([A]).sync));

    expect(wait.outcome).toBe("news");
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait).toMatchObject({ transitions: 1, edit: { pending: 1 } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on news: 1 transition in the 1 test file the edits since revision 4 re-keyed, at revision 4 after \d+\.\d s; /,
    );
  });

  it("does not hold for a slow file the edit re-keyed (spec 004 D9, as Stop)", async () => {
    const { repo, store } = repoWith([A, SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE] } }),
    );
    later(200, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, options(answering([A, SLOW_FILE]).sync));

    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 2, pending: 0 } });
  });

  it("holds for every file an environment edit re-keyed, and its timeout counts them", async () => {
    const { repo, store } = repoWith([A, B, C]);
    later(100, () => finish(store, repo.mainId, A));

    const wait = await waitForStatus(repo.main, options(answering([A, B, C]).sync, 800));

    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { testFiles: 3, pending: 2 } });
    expect(waitLine(wait as EndedWait)).toMatch(
      /^Returned on timeout after 0\.\d s: 2 of the 3 test files the edits since revision 4 re-keyed pending at revision 4; 2 checks pending in all$/,
    );
  });

  it("is not quiet before the window's runner part is applied", async () => {
    const { repo, store } = repoWith([], [A]);
    store.meta.set(refinedMetaKey(repo.mainId), "3");
    later(300, () => store.meta.set(refinedMetaKey(repo.mainId), "4"));

    const wait = await waitForStatus(repo.main, options(answering([A]).sync));

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(300);
  });

  it("counts no check's news before the daemon named the files", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));

    const pending = answering(null, { state: "pending" });
    const wait = await waitForStatus(repo.main, options(pending.sync, 600));

    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("counts any check's news from a daemon that names no files", async () => {
    const { repo, store } = repoWith([A, B]);
    later(100, () => fail(store, repo.mainId, BACKLOG));

    const wait = await waitForStatus(repo.main, options(answering(null).sync));

    expect(wait.outcome).toBe("news");
    expect(wait).not.toHaveProperty("edit");
  });
});

describe("the wait's window starts where the session was last told (task 001-186)", () => {
  it("asks for the revisions from the oldest one its consumers were told about", async () => {
    const { repo, store } = repoWith([], [A]);
    const told = (agentId: string, revision: number) => {
      const consumer = { worktreeId: repo.mainId, sessionId: "s1", agentId };
      store.consumers.register(consumer, NOW);
      tellRevision(store, consumer, revision as RevisionNumber);
    };
    told(MAIN_AGENT, 3);
    told("subagent", 2);
    const other = { worktreeId: repo.mainId, sessionId: "s2", agentId: MAIN_AGENT };
    store.consumers.register(other, NOW);
    tellRevision(store, other, 1 as RevisionNumber);

    const mine = answering([A]);
    const wait = await waitForStatus(repo.main, { ...options(mine.sync), session: "s1" });
    const unknown = answering([A]);
    await waitForStatus(repo.main, { ...options(unknown.sync), session: "nobody" });

    expect(mine.asked).toEqual([1]);
    expect(wait).toMatchObject({ edit: { since: 2 } });
    // No consumer of the session: the window starts at the revision current when the wait did.
    expect(unknown.asked).toEqual([3]);
  });
});
