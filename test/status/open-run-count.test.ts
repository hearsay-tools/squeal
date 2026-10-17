import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot, Store } from "../../src/core/types/index.js";
import { appendRevisions, check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 011-12 (011 C15, gh-17 finding 3): a re-key queues a running file's
 * checks under its new key while its run is still open; status counted them
 * queued, so it read `queued 10, running 0` with a run open.
 */

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

function worktree(repo: FakeRepo, store: Store, alive = true): void {
  appendRevisions(store, repo.mainId, 2, { head: null, dirty: false });
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: alive ? NOW - 1_000 : NOW - 60_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    },
  });
}

/** `a` and `b` re-keyed at revision 2 while the run at revision 1 holds `a`; `b` is fresh, without checks. */
function seedRekeyed(repo: FakeRepo, store: Store, startedAt = NOW - 30_000) {
  const id = repo.mainId;
  store.testFileKeys.upsertMany(
    ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"].map((path) => ({
      worktreeId: id,
      testFile: { project: "", path },
      key: `k2-${path}`,
      revision: 2,
      pending: "queued" as const,
    })),
  );
  store.knownStates.upsertMany([
    state(id, check("src/a.test.ts", "one"), { validity: "pending", pendingPhase: "queued" }),
    state(id, check("src/a.test.ts", "two"), { validity: "pending", pendingPhase: "queued" }),
    state(id, check("src/c.test.ts", "three"), { validity: "pending", pendingPhase: "queued" }),
  ]);
  store.runs.start({
    id: "run-1",
    worktreeId: id,
    revision: 1,
    testFiles: [
      { project: "", path: "src/a.test.ts" },
      { project: "", path: "src/b.test.ts" },
    ],
    checkpointId: null,
    logDir: "/tmp/run-1",
    startedAt,
  });
}

function snapshot(repo: FakeRepo): StatusSnapshot {
  const result = readStatus(repo.main, { now: () => NOW });
  if (!result.available) throw new Error(result.message);
  return result;
}

describe("status counts a file whose run is open as running after a re-key (011-12)", () => {
  it("counts the open run's re-keyed checks and fresh files running, the rest queued", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store);
    seedRekeyed(repo, store);

    const s = snapshot(repo);

    expect(s.breakdown.pendingByPhase).toEqual({ running: 2, queued: 1 });
    expect(s.breakdown.testFilesWithoutChecksRunning).toBe(1);
    expect(formatStatus(s, NOW)).toContain("2 running (2 tests), 1 queued (1 test)");
  });

  it("counts them queued once the run ended", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store);
    seedRekeyed(repo, store);
    store.runs.finish("run-1", "completed", NOW - 1_000);

    expect(snapshot(repo).breakdown.pendingByPhase).toEqual({ running: 0, queued: 3 });
  });

  it("does not count a run an earlier daemon left open, nor one of a daemon that is down", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store);
    seedRekeyed(repo, store, NOW - 120_000);
    expect(snapshot(repo).breakdown.pendingByPhase).toEqual({ running: 0, queued: 3 });

    const down = fakeRepo();
    const other = seedStore(down);
    worktree(down, other, false);
    seedRekeyed(down, other);
    expect(snapshot(down).breakdown.pendingByPhase).toEqual({ running: 0, queued: 3 });
  });
});
