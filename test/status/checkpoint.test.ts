import { describe, expect, it } from "vitest";
import { describe as describeStop } from "../../src/core/daemon/terminate.js";
import { appendNote } from "../../src/core/notes.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  type CheckpointProgress,
  checkpointMetaKey,
  type StatusResult,
  type StatusSnapshot,
  type StoppedProcesses,
  type Store,
} from "../../src/core/types/index.js";
import { appendRevisions, type FakeRepo, fakeRepo, seedStore } from "./helpers.js";

/*
 * Task 001-217: status names a checkpoint in progress and counts files
 * running that have no checks yet; task 001-219: one a stopped daemon owes;
 * task 001-222: stopped-process notes fold by command, `--notes` lists each.
 */

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

function snapshotOf(result: StatusResult): StatusSnapshot {
  if (!result.available) throw new Error(`unavailable: ${result.message}`);
  return result;
}

function worktree(repo: FakeRepo, store: Store, alive: boolean): void {
  if (store.revisions.latest(repo.mainId) === null)
    appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt: alive ? NOW - 1_000 : NOW - 60_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    },
  });
}

/** A baseline of 200 fresh files at revision 3, 40 with results, 30 running and none with checks. */
function seedBaseline(repo: FakeRepo, store: Store, progress: Partial<CheckpointProgress> = {}) {
  const record =
    store.checkpoints.get("cp-1") ??
    store.checkpoints.start({
      id: "cp-1",
      worktreeId: repo.mainId,
      revision: 3,
      kind: "baseline",
      testFiles: [],
      startedAt: NOW - 90_000,
    });
  const value: CheckpointProgress = {
    id: record.id,
    kind: "baseline",
    revision: 3,
    startedAt: record.startedAt,
    done: 40,
    total: 200,
    ...progress,
  };
  store.meta.set(checkpointMetaKey(repo.mainId), JSON.stringify(value));
  store.testFileKeys.upsertMany(
    Array.from({ length: 160 }, (_, i) => ({
      worktreeId: repo.mainId,
      testFile: { project: "", path: `test/f${i}.test.ts` },
      key: `key-${i}`,
      revision: 3,
      pending: i < 30 ? ("running" as const) : ("queued" as const),
    })),
  );
}

const status = (repo: FakeRepo) => snapshotOf(readStatus(repo.main, { now: () => NOW }));

describe("status names the checkpoint in progress (task 001-217)", () => {
  it("names its kind, start and files done of total, and counts running files without checks", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, true);
    seedBaseline(repo, store);

    const snapshot = status(repo);
    expect(snapshot.checkpoint).toEqual({
      id: "cp-1",
      kind: "baseline",
      revision: 3,
      startedAt: NOW - 90_000,
      done: 40,
      total: 200,
      owed: false,
    });
    expect(snapshot.breakdown.testFilesWithoutChecksRunning).toBe(30);
    const lines = formatStatus(snapshot, NOW).split("\n");
    expect(lines[2]).toBe(
      "Affected checks: 0 passed, 0 running, 0 queued; 160 test files without checks yet: 30 running, 130 queued",
    );
    // Row 011-29: an outstanding group, before the groups of the files it runs.
    expect(lines.slice(lines.indexOf("Outstanding:"), lines.indexOf("Outstanding:") + 2)).toEqual([
      "Outstanding:",
      "  a checkpoint in progress: the baseline from revision 3, started 90 s ago: 40 of 200 test files done; `squeal run --all --wait` waits for it",
    ]);
  });

  it("calls a baseline a run --all joined explicit, and says nothing once the checkpoint ended", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, true);
    seedBaseline(repo, store, { kind: "run-all" });
    expect(formatStatus(status(repo), NOW)).toContain(
      "  a checkpoint in progress: `run --all` requested at revision 3, started 90 s ago",
    );

    store.checkpoints.finish("cp-1", "completed", NOW);
    expect(status(repo).checkpoint).toBeUndefined();
  });

  it("names nothing a killed daemon left open, and what a stopped daemon owes the next", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, false);
    seedBaseline(repo, store);
    expect(status(repo).checkpoint).toBeUndefined();

    const remaining = [{ project: "", path: "test/f1.test.ts" }];
    seedBaseline(repo, store, {
      kind: "run-all",
      owed: { ids: ["cp-1"], remaining, strict: [] },
    });
    expect(status(repo).checkpoint).toMatchObject({ owed: true, done: 40, total: 200 });
    expect(formatStatus(status(repo), NOW)).toContain(
      "Checkpoint owed: `run --all` requested at revision 3, 40 of 200 test files done when its daemon stopped; the next daemon resumes it",
    );

    // A daemon validates again: it took the checkpoint up, and its own progress names it.
    worktree(repo, store, true);
    expect(status(repo).checkpoint).toBeUndefined();
  });
});

describe("status folds stopped-process notes by command (task 001-222)", () => {
  const STOPPED = (pid: number, command: string) =>
    `${pid} ${command} (parent 1 node daemon, 4.2 s old, SIGTERM, run r${pid})`;
  const TIER = "a test left running after its tier";
  const EXIT = "the runners left running when the daemon exited";

  /** A note as the daemon writes it (task 001-255): `describe`'s text and its processes. */
  function stopNote(store: Store, repo: FakeRepo, at: number, what: string, commands: string[]) {
    const stopped = commands.map((args, i) => ({
      pid: 11 + i,
      args,
      ppid: 1,
      parent: "node daemon",
      ageSeconds: 4.2,
      killed: false,
      run: `run r${11 + i}`,
    }));
    const note = describeStop(stopped, what);
    if (note === null) throw new Error("nothing stopped");
    appendNote(store, repo.mainId, { at: NOW - at, revision: 4, ...note });
  }

  function seedNotes(repo: FakeRepo, store: Store) {
    worktree(repo, store, true);
    stopNote(store, repo, 5_000, TIER, ["node a.mjs", "sleep 100"]);
    appendNote(store, repo.mainId, {
      at: NOW - 4_000,
      revision: 4,
      text: "runner failure: vitest.config.ts: Unexpected token",
    });
    stopNote(store, repo, 3_000, TIER, ["node a.mjs"]);
    stopNote(store, repo, 2_000, EXIT, ["node b.mjs"]);
  }

  it("counts each kind by command in one line, keeping other notes and a single note as they are", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    seedNotes(repo, store);
    const text = formatStatus(status(repo), NOW, "squeal", { full: true });
    const notes = text.slice(text.indexOf("Notes:")).split("\n");
    expect(notes).toEqual([
      "Notes:",
      "  2026-10-10T11:59:56.000Z, revision 4: runner failure: vitest.config.ts: Unexpected token",
      `  2026-10-10T11:59:58.000Z, revision 4: stopped 1 process ${EXIT}: ${STOPPED(11, "node b.mjs")}`,
      `  stopped 3 processes ${TIER}, in 2 notes since 2026-10-10T11:59:55.000Z: ` +
        "2 × node a.mjs; 1 × sleep 100 (`squeal status --notes` lists each)",
      "",
    ]);
  });

  it("folds a command line holding `; ` and ` (` under that command (task 001-255)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, true);
    const shell = 'sh -c "a; b (c)"';
    stopNote(store, repo, 3_000, TIER, [shell]);
    stopNote(store, repo, 2_000, TIER, [shell, "node a.mjs"]);
    const text = formatStatus(status(repo), NOW, "squeal", { full: true });
    expect(text).toContain(
      `stopped 3 processes ${TIER}, in 2 notes since 2026-10-10T11:59:57.000Z: ` +
        `2 × ${shell}; 1 × node a.mjs (`,
    );
  });

  it("leaves an older daemon's note, prose only, unfolded (task 001-255)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, true);
    const prose = `stopped 1 process ${TIER}: ${STOPPED(13, "node a.mjs")}`;
    for (const at of [3_000, 2_000]) {
      appendNote(store, repo.mainId, { at: NOW - at, revision: 4, text: prose });
    }
    const text = formatStatus(status(repo), NOW, "squeal", { full: true });
    expect(text).toContain(`  2026-10-10T11:59:57.000Z, revision 4: ${prose}\n`);
    expect(text).toContain(`  2026-10-10T11:59:58.000Z, revision 4: ${prose}\n`);
    expect(text).not.toContain("lists each");
  });

  it("leaves a note whose processes are malformed unfolded (task 001-255)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    worktree(repo, store, true);
    const text = `stopped 1 process ${TIER}: ${STOPPED(13, "node a.mjs")}`;
    const malformed = { what: TIER, commands: [13] } as unknown as StoppedProcesses;
    for (const at of [3_000, 2_000]) {
      appendNote(store, repo.mainId, { at: NOW - at, revision: 4, text, stopped: malformed });
    }
    const out = formatStatus(status(repo), NOW, "squeal", { full: true });
    expect(out).toContain(`  2026-10-10T11:59:57.000Z, revision 4: ${text}\n`);
    expect(out).not.toContain("lists each");
  });

  it("lists every note in full with --notes", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    seedNotes(repo, store);
    const text = formatStatus(status(repo), NOW, "squeal", { allNotes: true });
    expect(text).toContain(
      `stopped 2 processes ${TIER}: ${STOPPED(11, "node a.mjs")}; ${STOPPED(12, "sleep 100")}`,
    );
    expect(text).toContain(`stopped 1 process ${TIER}: ${STOPPED(11, "node a.mjs")}`);
    expect(text).not.toContain("lists each");
  });
});
