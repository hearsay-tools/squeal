import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { META_STORE_RECOVERED, SCHEMA_VERSION } from "../../src/core/store/index.js";
import type { StatusResult, StatusSnapshot, Store } from "../../src/core/types/index.js";
import { tempDir } from "../store/helpers.js";
import { appendRevisions, check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const COMMIT = "abc1234def5678abc1234def5678abc1234def56";

function snapshotOf(result: StatusResult): StatusSnapshot {
  if (!result.available) throw new Error(`unavailable: ${result.message}`);
  return result;
}

/**
 * Worktree `b` of a repository whose main worktree produced results that `b`
 * inherited. Every count class, one known failure, a pending test file
 * without checks, a completed checkpoint at an older revision, a live daemon
 * and a recovery note.
 */
function seedBusyWorktree(repo: FakeRepo, store: Store) {
  const b = repo.addWorktree("b");
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.worktrees.upsert({
    id: b.id,
    root: b.root,
    commonDir: repo.commonDir,
    isMain: false,
    registeredAt: 2,
    daemon: {
      socketPath: "/run/squeal-b.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 2_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    },
  });
  appendRevisions(store, b.id, 2, { head: COMMIT, dirty: true });
  const inherited = { kind: "inherited", worktreeId: repo.mainId, commit: COMMIT } as const;
  store.knownStates.upsertMany([
    state(b.id, check("src/auth.test.ts", "auth > expired token"), {
      outcome: "fail",
      observedAt: 2,
      summary: "expected 401, received 500",
      fingerprint: "AssertionError: expected 401, received 500 @ src/auth.ts:12:5",
      location: { path: "src/auth.ts", line: 12, column: 5 },
    }),
    state(b.id, check("src/auth.test.ts", "auth > login"), { origin: inherited }),
    state(b.id, check("src/auth.test.ts", "auth > logout"), { origin: inherited }),
    state(b.id, check("src/math.test.ts", "adds"), { observedAt: 2 }),
    state(b.id, check("src/math.test.ts", "slow"), {
      validity: "pending",
      pendingPhase: "running",
    }),
    state(b.id, check("src/math.test.ts", "big"), {
      outcome: "unknown",
      validity: "pending",
      pendingPhase: "queued",
      observedAt: null,
      origin: null,
    }),
    state(b.id, check("src/util.test.ts", "old"), { validity: "stale" }),
    state(b.id, check("src/util.test.ts", "never"), {
      outcome: "unknown",
      validity: "unknown",
      observedAt: null,
      origin: null,
    }),
    state(b.id, check("src/util.test.ts", "todo"), { outcome: "skip" }),
  ]);
  store.testFileKeys.upsertMany(
    ["src/auth.test.ts", "src/math.test.ts", "src/util.test.ts", "src/empty.test.ts"].map(
      (path) => ({
        worktreeId: b.id,
        testFile: { project: "", path },
        key: `key-${path}`,
        revision: 2,
        pending: path === "src/empty.test.ts" ? ("queued" as const) : null,
      }),
    ),
  );
  store.checkpoints.start({
    id: "cp-1",
    worktreeId: b.id,
    revision: 1,
    kind: "baseline",
    testFiles: [],
    startedAt: NOW - 50_000,
  });
  store.checkpoints.finish("cp-1", "completed", NOW - 40_000);
  store.meta.set(
    META_STORE_RECOVERED,
    JSON.stringify({
      at: Date.UTC(2026, 9, 4, 9, 0, 0),
      movedTo: "/repo/.git/squeal/store.sqlite.corrupt-1",
      reason: "database disk image is malformed",
    }),
  );
  return b;
}

describe("readStatus", () => {
  it("builds the D7 snapshot from the store, with no daemon involved", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedBusyWorktree(repo, store);

    const result = readStatus(join(b.root, "src"), { now: () => NOW });

    expect(result).toEqual({
      schemaVersion: 1,
      available: true,
      worktreeId: b.id,
      worktreeRoot: b.root,
      revision: 2,
      head: COMMIT,
      dirty: true,
      daemon: { state: "alive", lastHeartbeatAt: NOW - 2_000 },
      counts: { current: 5, pending: 2, stale: 1, unknown: 1 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: 1 },
      knownFailures: [
        {
          check: check("src/auth.test.ts", "auth > expired token"),
          outcome: "fail",
          validity: "current",
          observedAt: 2,
          summary: "expected 401, received 500",
          fingerprint: "AssertionError: expected 401, received 500 @ src/auth.ts:12:5",
          location: { path: "src/auth.ts", line: 12, column: 5 },
        },
      ],
      inherited: {
        count: 2,
        sources: [{ worktreeId: repo.mainId, worktreeRoot: repo.main, commit: COMMIT, count: 2 }],
      },
      breakdown: {
        currentByOutcome: { pass: 3, fail: 1, skip: 1, unknown: 0 },
        pendingByPhase: { queued: 1, running: 1 },
        testFiles: 4,
        testFilesWithoutChecks: 1,
      },
      closureMethod: "static imports plus declared inputs",
      storeSchemaVersion: SCHEMA_VERSION,
      notes: [
        "store was recovered from corruption at 2026-10-04T09:00:00.000Z; the baseline was lost (corrupt file moved to /repo/.git/squeal/store.sqlite.corrupt-1)",
      ],
    } satisfies StatusSnapshot);
  });

  it("renders the snapshot for humans, vision lines first", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedBusyWorktree(repo, store);

    const text = formatStatus(readStatus(b.root, { now: () => NOW }), NOW)
      .replaceAll(b.root, "<b>")
      .replaceAll(repo.main, "<main>");

    expect(text).toMatchInlineSnapshot(`
      "Revision: 2
      Known failures: 1
        FAIL  src/auth.test.ts > auth > expired token
              expected 401, received 500
              at src/auth.ts:12:5, observed at revision 2, current
      Affected checks: 3 passed, 1 running, 1 queued, 1 skipped, 1 stale, 1 unknown
      Last full suite: completed at revision 1
      Current revision has not completed a full-suite run

      Worktree: <b> (HEAD abc1234, dirty)
      Daemon: running, last heartbeat 2 s ago
      Inherited: 2 current results
        2 from <main> at abc1234
      Test files without known checks: 1
      Closure method: static imports plus declared inputs
      Store schema: 1
      Note: store was recovered from corruption at 2026-10-04T09:00:00.000Z; the baseline was lost (corrupt file moved to /repo/.git/squeal/store.sqlite.corrupt-1)
      "
    `);
  });

  it("reproduces the vision example line for line", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, repo.mainId, 187, { head: COMMIT, dirty: false });
    const states = [];
    for (let n = 0; n < 47; n++) states.push(state(repo.mainId, check("src/a.test.ts", `p${n}`)));
    for (let n = 0; n < 3; n++) {
      states.push(
        state(repo.mainId, check("src/b.test.ts", `r${n}`), {
          validity: "pending",
          pendingPhase: "running",
        }),
      );
    }
    for (let n = 0; n < 12; n++) {
      states.push(
        state(repo.mainId, check("src/c.test.ts", `q${n}`), {
          validity: "pending",
          pendingPhase: "queued",
        }),
      );
    }
    store.knownStates.upsertMany(states);
    store.checkpoints.start({
      id: "cp-170",
      worktreeId: repo.mainId,
      revision: 170,
      kind: "run-all",
      testFiles: [],
      startedAt: 1,
    });
    store.checkpoints.finish("cp-170", "completed", 2);

    const lines = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW).split("\n");

    expect(lines.slice(0, 5)).toEqual([
      "Revision: 187",
      "Known failures: 0",
      "Affected checks: 47 passed, 3 running, 12 queued",
      "Last full suite: completed at revision 170",
      "Current revision has not completed a full-suite run",
    ]);
  });

  it("says a full suite completed at the current revision", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    appendRevisions(store, repo.mainId, 3, { head: null, dirty: false });
    store.checkpoints.start({
      id: "cp",
      worktreeId: repo.mainId,
      revision: 3,
      kind: "run-all",
      testFiles: [],
      startedAt: 1,
    });
    store.checkpoints.finish("cp", "completed", 2);

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.fullSuite).toEqual({ atCurrentRevision: true, lastCompletedRevision: 3 });
    expect(formatStatus(status, NOW).split("\n").slice(3, 5)).toEqual([
      "Last full suite: completed at revision 3",
      "Current revision has completed a full-suite run",
    ]);
  });

  it("reports no store without creating one", () => {
    const repo = fakeRepo();

    const result = readStatus(repo.main, { now: () => NOW });

    expect(result).toEqual({
      schemaVersion: 1,
      available: false,
      reason: "no-store",
      message: `status unavailable, no Squeal store at ${join(repo.commonDir, "squeal", "store.sqlite")}`,
    });
    expect(existsSync(join(repo.commonDir, "squeal"))).toBe(false);
    expect(formatStatus(result, NOW)).toBe(
      `Status unavailable, no Squeal store at ${join(repo.commonDir, "squeal", "store.sqlite")}\n`,
    );
  });

  it("reports no store where no git common dir can be resolved", () => {
    // The temp dir may itself sit inside a checkout, so give it a `.git` that leads nowhere.
    const dir = tempDir();
    writeFileSync(join(dir, ".git"), "not a gitdir line\n");

    const result = readStatus(dir, { now: () => NOW });

    expect(result).toMatchObject({ available: false, reason: "no-store" });
    expect(result.available === false && result.message).toBe(
      `status unavailable, ${dir} is not inside a git worktree`,
    );
  });

  it("reports a store with a newer user_version as unavailable, untouched", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const database = join(repo.commonDir, "squeal", "store.sqlite");
    const db = new DatabaseSync(database);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    const result = readStatus(repo.main, { now: () => NOW });

    expect(result).toEqual({
      schemaVersion: 1,
      available: false,
      reason: "store-newer",
      message: `status unavailable, store version newer than this Squeal (store ${SCHEMA_VERSION + 1}, supported ${SCHEMA_VERSION})`,
    });
    const after = new DatabaseSync(database);
    expect(after.prepare("PRAGMA user_version").get()?.user_version).toBe(SCHEMA_VERSION + 1);
    after.close();
  });

  it("reports an unreadable store", () => {
    const repo = fakeRepo();
    mkdirSync(join(repo.commonDir, "squeal"));
    writeFileSync(join(repo.commonDir, "squeal", "store.sqlite"), "not a database ".repeat(512));

    const result = readStatus(repo.main, { now: () => NOW });

    expect(result).toMatchObject({ available: false, reason: "store-unreadable" });
  });

  it("gives up with a timeout when the store stays locked", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const locker = new DatabaseSync(join(repo.commonDir, "squeal", "store.sqlite"));
    locker.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
    locker.exec("INSERT INTO meta (key, value) VALUES ('lock', 'held')");
    try {
      const started = Date.now();
      const result = readStatus(repo.main, { now: () => NOW, busyTimeoutMs: 50 });

      expect(result).toEqual({
        schemaVersion: 1,
        available: false,
        reason: "timeout",
        message: "status unavailable, store busy for more than 50 ms",
      });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
  });

  it("says no daemon is running when none ever recorded a heartbeat", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, repo.mainId, 1, { head: COMMIT, dirty: false });

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.daemon).toEqual({ state: "down", since: null });
    expect(formatStatus(status, NOW)).toContain("\nDaemon: no daemon running\n");
  });

  it("says since when no daemon is running once the heartbeat is too old", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const heartbeatAt = NOW - 60_000;
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/run/squeal.sock",
        startedAt: 1,
        heartbeatAt,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0",
      },
    });

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.daemon).toEqual({ state: "down", since: heartbeatAt });
    expect(formatStatus(status, NOW)).toContain(
      "\nDaemon: no daemon running since 2026-10-04T11:59:00.000Z\n",
    );
  });

  it("is honest about a worktree the store has never seen", () => {
    const repo = fakeRepo();
    seedStore(repo);

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status).toMatchObject({
      revision: 0,
      head: null,
      counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      daemon: { state: "down", since: null },
      notes: [
        "this worktree is not registered in the store; no daemon has run here",
        "no revision recorded for this worktree yet",
      ],
    });
    const lines = formatStatus(status, NOW).split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "Revision: 0",
      "Known failures: 0",
      "Affected checks: 0 passed, 0 running, 0 queued",
      "Last full suite: none recorded",
      "Current revision has not completed a full-suite run",
    ]);
    expect(lines).toContain(`Worktree: ${repo.main}`);
  });
});
