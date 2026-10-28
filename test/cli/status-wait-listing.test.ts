import { afterEach, describe, expect, it } from "vitest";
import type { SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { readHeld, startView } from "../../src/cli/status-wait-held.js";
import { recordMoves } from "../../src/core/scheduler/rekeyed-moves.js";
import {
  awaitingInstallMetaKey,
  awaitingInstallValue,
  type DaemonRecord,
  daemonIncarnation,
  refinedMetaKey,
} from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "../status/helpers.js";
import { timed } from "./wait-clock.js";

const timers = new Set<ReturnType<typeof setTimeout>>();
afterEach(() => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
});

/** Cancel unfinished discovery timers even when an early return fails the test. */
function later(ms: number, fn: () => void) {
  const ran = { at: Number.POSITIVE_INFINITY };
  timers.add(
    setTimeout(() => {
      fn();
      ran.at = performance.now();
    }, ms),
  );
  return ran;
}

const NOW = Date.UTC(2026, 9, 28, 12);
const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-listing-test.sock",
  startedAt: NOW - 1_000,
  heartbeatAt: NOW,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "listing-test",
};

function fresh(mode: "edit" | "fallback", refined: null | 0 = null) {
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
  if (refined !== null) store.meta.set(refinedMetaKey(repo.mainId), String(refined));
  const incarnation = daemonIncarnation(LIVE);
  store.transaction(() => recordMoves(store, repo.mainId, [], [], 0, NOW, { writer: incarnation }));
  const current: SyncState =
    mode === "edit" ? { state: "synced", revision: 0, incarnation } : { state: "unsupported" };
  const options = {
    timeoutMs: 2_000,
    pollMs: 5,
    settleMs: 0,
    now: () => NOW,
    sync: () => ({ current: () => current, stop() {} }),
  };
  const list = (pending: "queued" | null = null) =>
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.mainId,
        testFile: { project: "", path: "unrelated.test.ts" },
        key: "unrelated-key",
        revision: 0,
        pending,
      },
    ]);
  const checkpoint = () =>
    store.checkpoints.start({
      id: "empty-baseline",
      worktreeId: repo.mainId,
      revision: 0,
      kind: "baseline",
      testFiles: [],
      startedAt: NOW,
    });
  return { repo, store, options, list, checkpoint };
}

describe.each(["edit", "fallback"] as const)("status --wait initial listing (%s)", (mode) => {
  it.each([null, 0] as const)("waits for listing with refinement %s", async (refined) => {
    const { repo, store, options, list } = fresh(mode, refined);
    const listed = later(80, list);

    const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options));

    expect(wait.outcome).toBe("quiet");
    expect(endedBy).toBeGreaterThanOrEqual(listed.at);
    expect(wait.result).toMatchObject({
      revision: 0,
      testFilesListed: true,
      testFilesWithoutChecks: { pending: 0, unknown: 1 },
    });
    expect(store.testFileKeys.list(repo.mainId)[0]?.pending).toBeNull();
    if (mode === "edit") {
      expect(wait).toMatchObject({ edit: { testFiles: 0, pending: 0 } });
      expect(readHeld(store, repo.mainId, startView([]), []).header.testFilesListed).toBe(false);
    } else expect(wait).not.toHaveProperty("edit");
  });

  it.each([0, 40])("times out after %s ms when no listing completes", async (timeoutMs) => {
    const { repo, options } = fresh(mode);

    const wait = await waitForStatus(repo.main, { ...options, timeoutMs });

    expect(wait.outcome).toBe("timeout");
    expect(wait.result).toMatchObject({ revision: 0, testFilesListed: false });
    expect(wait.waitedMs).toBeGreaterThanOrEqual(timeoutMs);
  });

  it("waits for an empty baseline to complete", async () => {
    const { repo, store, options, checkpoint } = fresh(mode);
    checkpoint();
    const completed = later(80, () => store.checkpoints.finish("empty-baseline", "completed", NOW));

    const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options));

    expect(wait.outcome).toBe("quiet");
    expect(endedBy).toBeGreaterThanOrEqual(completed.at);
    expect(wait.result).toMatchObject({
      testFilesListed: true,
      fullSuite: { atCurrentRevision: true },
    });
  });

  it("does not count a completed empty checkpoint while awaiting install", async () => {
    const { repo, store, options, checkpoint } = fresh(mode);
    checkpoint();
    store.checkpoints.finish("empty-baseline", "completed", NOW);
    store.meta.set(awaitingInstallMetaKey(repo.mainId), awaitingInstallValue(["."]));

    const wait = await waitForStatus(repo.main, { ...options, timeoutMs: 40 });

    expect(wait.outcome).toBe("timeout");
    expect(wait.result).toMatchObject({ testFilesListed: false, awaitingInstall: true });
  });

  it("does not count keys listed only in another worktree", async () => {
    const { repo, store, options } = fresh(mode);
    const other = repo.addWorktree("other");
    store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: { project: "", path: "other.test.ts" },
        key: "other-key",
        revision: 0,
        pending: null,
      },
    ]);

    const wait = await waitForStatus(repo.main, { ...options, timeoutMs: 40 });

    expect(wait.outcome).toBe("timeout");
    expect(wait.result).toMatchObject({ testFilesListed: false });
  });

  it("returns without a daemon while discovery is incomplete", async () => {
    const { repo, store, options } = fresh(mode);
    store.worktrees.setDaemon(repo.mainId, null);

    const wait = await waitForStatus(repo.main, options);

    expect(wait.outcome).toBe("no-daemon");
    expect(wait.result).toMatchObject({ testFilesListed: false });
  });
});

it("ends an empty edit window after listing, while an unrelated backlog stays queued", async () => {
  const { repo, store, options, list } = fresh("edit");
  const listed = later(80, () => list("queued"));

  const { wait, endedBy } = await timed(() => waitForStatus(repo.main, options));

  expect(wait.outcome).toBe("quiet");
  expect(endedBy).toBeGreaterThanOrEqual(listed.at);
  expect(wait).toMatchObject({ edit: { testFiles: 0, pending: 0 } });
  expect(wait.result).toMatchObject({
    testFilesListed: true,
    testFilesWithoutChecks: { pending: 1 },
  });
  expect(store.testFileKeys.list(repo.mainId)[0]?.pending).toBe("queued");
});
