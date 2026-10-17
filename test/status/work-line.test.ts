import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  type CheckKey,
  type PendingPhase,
  refinedMetaKey,
  type StatusSnapshot,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 011-12 (011 C15, issue 24): status tells initial discovery from idle
 * work and names the command that advances each; a many-file worktree's
 * `unknown` files keep the reasons the store has.
 */

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const ref = (path: string) => ({ project: "", path: path as never });

function worktree(alive = true) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
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
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const row = (path: string, key: string | null, pending: PendingPhase | null = null) =>
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: ref(path), key: key as CheckKey | null, revision: 3, pending },
    ]);
  const snapshot = (): StatusSnapshot => {
    const result = readStatus(repo.main, { now: () => NOW });
    if (!result.available) throw new Error(result.message);
    return result;
  };
  const line = (prefix: string) =>
    formatStatus(snapshot(), NOW)
      .split("\n")
      .filter((l) => l.startsWith(prefix));
  return { repo, store, id, row, snapshot, line };
}

describe("status tells discovery from idle work (011-12, issue 24)", () => {
  it("names discovery while the daemon has not listed the test files, then while it keys a revision", () => {
    const w = worktree();
    expect(w.line("Discovery: ")).toEqual([
      "Discovery: the daemon is still listing this worktree's test files (`squeal status --wait 60000` waits for it)",
    ]);
    w.row("test/a.test.ts", "k1", "queued");
    w.store.meta.set(refinedMetaKey(w.id), "2");
    expect(w.line("Discovery: ")).toEqual([
      "Discovery: the daemon is still listing and keying the test files of revision 3 (`squeal status --wait 60000` waits for it)",
    ]);
    expect(w.line("Idle: ")).toEqual([]);
  });

  it("names idle queued work and unrun files, with the command that runs them", () => {
    const w = worktree();
    w.store.meta.set(refinedMetaKey(w.id), "3");
    w.row("test/a.test.ts", "k1", "queued");
    w.store.knownStates.upsertMany([
      state(w.id, check("test/a.test.ts", "x"), { validity: "pending", pendingPhase: "queued" }),
    ]);
    w.row("test/fresh.test.ts", "k2", "queued");
    w.row("test/never.test.ts", "k3");

    expect(w.line("Discovery: ")).toEqual([]);
    expect(w.line("Idle: ")).toEqual([
      "Idle: nothing is running and no run is open; 1 queued (1 test); 1 test file without checks queued; 1 test file without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)",
    ]);
  });

  it("says nothing of idle work while a run is open or a file runs, nor with no daemon", () => {
    const w = worktree();
    w.store.meta.set(refinedMetaKey(w.id), "3");
    w.row("test/a.test.ts", "k1", "queued");
    w.store.runs.start({
      id: "run-1",
      worktreeId: w.id,
      revision: 3,
      testFiles: [ref("test/b.test.ts")],
      checkpointId: null,
      logDir: "/tmp/run-1",
      startedAt: NOW - 5_000,
    });
    expect(w.snapshot().runsOpen).toBe(1);
    expect(w.line("Idle: ")).toEqual([]);

    const down = worktree(false);
    down.row("test/a.test.ts", "k1", "queued");
    expect(down.snapshot()).not.toHaveProperty("runsOpen");
    expect(down.line("Idle: ")).toEqual([]);
    expect(down.line("Discovery: ")).toEqual([]);
  });

  it("a many-file unknown worktree: retained reasons, idle told, no 'no reason was kept' for unrun files", () => {
    const w = worktree();
    w.store.meta.set(refinedMetaKey(w.id), "3");
    for (let i = 0; i < 410; i++) w.row(`test/f${1000 + i}.test.ts`, `k${i}`);
    w.row("test/unkeyed.test.ts", null);
    w.row("test/crashed.test.ts", "kc");
    w.store.knownStates.upsertMany([
      state(w.id, check("test/crashed.test.ts", "x"), {
        outcome: "unknown",
        validity: "unknown",
        summary: "run crashed",
      }),
    ]);

    const text = formatStatus(w.snapshot(), NOW);

    expect(text).toContain(
      "Test files without a result: 412 (nothing current at their inputs, none queued)",
    );
    expect(text).toContain("  test/crashed.test.ts: no result: run crashed\n");
    expect(text).toContain(
      "  test/f1000.test.ts: no result: never run at this key, and nothing queued it\n",
    );
    expect(text).not.toContain("no reason was kept");
    expect(w.line("Idle: ")).toEqual([
      "Idle: nothing is running and no run is open; 412 test files without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)",
    ]);
    expect(w.line("Discovery: ")).toEqual([]);
  });
});
