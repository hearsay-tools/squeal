import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { META_STORE_RECOVERED, SCHEMA_VERSION } from "../../src/core/store/index.js";
import type { StatusResult, StatusSnapshot, Store } from "../../src/core/types/index.js";
import { tempDir } from "../store/helpers.js";
import {
  appendRevisions,
  check,
  type FakeRepo,
  fakeRepo,
  fileCheck,
  seedStore,
  state,
} from "./helpers.js";

/** `test_file_keys` rows for `paths`, as a daemon writes them once it listed the test files. */
function setKeys(store: Store, worktreeId: string, paths: string[]) {
  store.testFileKeys.upsertMany(
    paths.map((path) => ({
      worktreeId,
      testFile: { project: "", path },
      key: `key-${path}`,
      revision: 0,
      pending: null,
    })),
  );
}

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const COMMIT = "abc1234def5678abc1234def5678abc1234def56";

function snapshotOf(result: StatusResult): StatusSnapshot {
  if (!result.available) throw new Error(`unavailable: ${result.message}`);
  return result;
}

/**
 * Worktree `b` of a repository whose main worktree produced results that `b`
 * inherited. Every count class, a known failure of a test and one of a
 * file-level check, a pending test file
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
    // Spec 005 D1: file-level checks, counted apart from tests.
    state(b.id, fileCheck("src/broken.test.ts"), {
      outcome: "fail",
      observedAt: 2,
      summary: "Cannot find module './gone'",
      fingerprint: "Error: Cannot find module './gone'",
    }),
    state(b.id, fileCheck("src/auth.test.ts"), { observedAt: 2 }),
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
    [
      "src/auth.test.ts",
      "src/math.test.ts",
      "src/util.test.ts",
      "src/empty.test.ts",
      "src/never.test.ts",
    ].map((path) => ({
      worktreeId: b.id,
      testFile: { project: "", path },
      key: `key-${path}`,
      revision: 2,
      pending: path === "src/empty.test.ts" ? ("queued" as const) : null,
    })),
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
    `notes.${b.id}`,
    JSON.stringify([
      { at: Date.UTC(2026, 9, 4, 10, 0, 0), revision: 1, text: "runner environment failed: x" },
      { at: Date.UTC(2026, 9, 4, 11, 0, 0), revision: null, text: "watcher dropped events" },
    ]),
  );
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
      commit: { head: COMMIT, sinceHead: 0, dirty: true },
      head: COMMIT,
      dirty: true,
      dirtyObservedAt: 2,
      daemon: { state: "alive", lastHeartbeatAt: NOW - 2_000 },
      counts: { current: 7, pending: 2, stale: 1, unknown: 1 },
      fileLevelCounts: { current: 2, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 1, unknown: 1 },
      // Row 011-26: the keyed files by class; `src/broken.test.ts` has checks and no key row.
      testFileCounts: { current: 1, pending: 2, stale: 0, unknown: 2 },
      testFilesByPhase: { running: 1, queued: 1 },
      testsByPhase: { running: 1, queued: 1 },
      runsOpen: 0,
      unknownTestFiles: {
        total: 2,
        // Task 011-12 (issue 24): a key with no result says so; an unknown check that kept no reason says that.
        files: (
          [
            [
              "src/never.test.ts",
              "never run at this key: the baseline is lookup-only, so nothing queued it",
            ],
            ["src/util.test.ts", null],
          ] as const
        ).map(([path, reason]) => ({
          testFile: { project: "", path },
          ran: false,
          reason,
          samples: [],
          // Row 011-27: the structured cause of a key that never had a result.
          ...(reason === null ? {} : { cause: "never-run" }),
        })),
      },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: 1 },
      testFilesListed: true,
      inheritedCount: 2,
      inheritedFileLevelCount: 0,
      refinedRevision: null,
      runnerPartPending: false,
      knownFailures: [
        {
          check: check("src/auth.test.ts", "auth > expired token"),
          outcome: "fail",
          validity: "current",
          observedAt: 2,
          summary: "expected 401, received 500",
          fingerprint: "AssertionError: expected 401, received 500 @ src/auth.ts:12:5",
          location: { path: "src/auth.ts", line: 12, column: 5 },
          // Review 001-417 B3: no stored result produced it.
          recordedUnknown: true,
        },
        {
          check: fileCheck("src/broken.test.ts"),
          outcome: "fail",
          validity: "current",
          observedAt: 2,
          summary: "Cannot find module './gone'",
          fingerprint: "Error: Cannot find module './gone'",
          location: null,
          // Review 001-417 B3: no stored result produced it.
          recordedUnknown: true,
        },
      ],
      knownFailureCounts: { current: 2, pending: 0, stale: 0 },
      inherited: {
        count: 2,
        sources: [
          {
            worktreeId: repo.mainId,
            worktreeRoot: repo.main,
            commit: COMMIT,
            count: 2,
            fileLevelCount: 0,
          },
        ],
      },
      breakdown: {
        currentByOutcome: { pass: 4, fail: 2, skip: 1, unknown: 0 },
        pendingByPhase: { queued: 1, running: 1 },
        fileLevelByOutcome: { pass: 1, fail: 1, skip: 0, unknown: 0 },
        fileLevelByPhase: { queued: 0, running: 0 },
        testFiles: 5,
        testFilesWithoutChecks: 2,
        testFilesWithoutChecksRunning: 0,
      },
      closureMethod: "static imports plus declared inputs",
      storeSchemaVersion: SCHEMA_VERSION,
      notes: [
        "store was recovered from corruption at 2026-10-04T09:00:00.000Z; the baseline was lost (corrupt file moved to /repo/.git/squeal/store.sqlite.corrupt-1)",
      ],
      daemonNotes: [
        { at: Date.UTC(2026, 9, 4, 10, 0, 0), revision: 1, text: "runner environment failed: x" },
        { at: Date.UTC(2026, 9, 4, 11, 0, 0), revision: null, text: "watcher dropped events" },
      ],
      // Row 011-29: each test file not current, in a group with where it stands.
      outstanding: [
        {
          standing: { kind: "no-result", reason: "no result: no reason was kept", notCurrent: 4 },
          files: [{ project: "", path: "src/util.test.ts" }],
        },
        {
          standing: { kind: "never-run", lookupOnly: true, notCurrent: 4 },
          files: [{ project: "", path: "src/never.test.ts" }],
        },
        {
          standing: { kind: "running", lane: "vitest", since: null },
          files: [{ project: "", path: "src/math.test.ts" }],
        },
        {
          standing: { kind: "queued", lane: "vitest", behind: null },
          files: [{ project: "", path: "src/empty.test.ts" }],
        },
      ],
      // Row 011-58 (gh-61): the running and queued files beside `testFilesByPhase`.
      pendingTestFiles: {
        running: { files: [{ project: "", path: "src/math.test.ts" }], omitted: 0 },
        queued: { files: [{ project: "", path: "src/empty.test.ts" }], omitted: 0 },
      },
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
      "Revision: 2 · abc1234d + 0, dirty
      Known failures: 2 (1 test, 1 test file that did not load); not current: 4 of 5 test files (1 running, 1 queued, 2 unknown), 4 tests (1 running, 1 queued, 1 stale, 1 unknown)
        FAIL  src/auth.test.ts > auth > expired token
              expected 401, received 500
              at src/auth.ts:12:5, observed at revision 2, current
              recorded at an unknown time and load: the result that produced it is no longer identifiable in the store
        FAIL  src/broken.test.ts (file-level)
              Cannot find module './gone'
              observed at revision 2, current
              recorded at an unknown time and load: the result that produced it is no longer identifiable in the store
      Affected checks: 4 passed (3 tests, 1 test file loaded), 1 running (1 test), 1 queued (1 test), 1 skipped (1 test), 1 stale (1 test), 1 unknown (1 test)
      Full-suite checkpoint: none completed since revision 1 (the counts are for revision 2; \`squeal run --all\` requests one)
      Running: 1 test file: src/math.test.ts
      Queued: 1 test file: src/empty.test.ts
      Outstanding:
        1 test file without a result: no reason was kept: src/util.test.ts; \`squeal retry src/util.test.ts\` runs it once
        1 test file never run at its inputs, nothing queued it (the baseline is lookup-only): src/never.test.ts; \`squeal retry src/never.test.ts\` runs it once
        1 test file running in the vitest lane: src/math.test.ts
        1 test file queued; no run is open and nothing recorded holds it: src/empty.test.ts; the store records no reason the daemon has not taken it (\`squeal status --json\` lists each file's state)
      More: \`squeal status --full\` adds the worktree and daemon, the 2 current results inherited from 1 worktree, the 2 test files without a result one by one and 3 notes
      "
    `);
  });

  it("reproduces the vision example, with the full-suite line as a checkpoint (lessons, surprise 7)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      // "3 running": a daemon validates; without one the dirty flag is not known (task 011-05).
      daemon: {
        socketPath: "/run/squeal.sock",
        startedAt: 1,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0",
      },
    });
    appendRevisions(store, repo.mainId, 187, { head: COMMIT, dirty: false });
    // Spec 005 D1: each test file has its file-level check, counted apart from its tests.
    const states = [state(repo.mainId, fileCheck("src/a.test.ts"))];
    for (let n = 0; n < 46; n++) states.push(state(repo.mainId, check("src/a.test.ts", `p${n}`)));
    for (const [path, phase, tests] of [
      ["src/b.test.ts", "running", 2],
      ["src/c.test.ts", "queued", 11],
    ] as const) {
      const pending = { validity: "pending", pendingPhase: phase } as const;
      states.push(state(repo.mainId, fileCheck(path), pending));
      for (let n = 0; n < tests; n++) {
        states.push(state(repo.mainId, check(path, `${phase}${n}`), pending));
      }
    }
    store.knownStates.upsertMany(states);
    // Each file's key row, as the daemon writes them, so the line counts the files (row 011-26).
    store.testFileKeys.upsertMany(
      (
        [
          ["src/a.test.ts", null],
          ["src/b.test.ts", "running"],
          ["src/c.test.ts", "queued"],
        ] as const
      ).map(([path, pending]) => ({
        worktreeId: repo.mainId,
        testFile: { project: "", path: path as never },
        key: `key-${path}` as never,
        revision: 187,
        pending,
      })),
    );
    store.checkpoints.start({
      id: "cp-170",
      worktreeId: repo.mainId,
      revision: 170,
      kind: "run-all",
      testFiles: [],
      startedAt: 1,
    });
    store.checkpoints.finish("cp-170", "completed", 2);

    const lines = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW, "squeal", {
      full: true,
    }).split("\n");

    expect(lines.slice(0, 4)).toEqual([
      "Revision: 187 · abc1234d + 0",
      // Row 011-26 (gh-45): the vision's line, then what is not current.
      "Known failures: 0; not current: 2 of 3 test files (1 running, 1 queued), 13 tests (2 running, 11 queued)",
      "Affected checks: 47 passed (46 tests, 1 test file loaded), 3 running (2 tests, 1 test file loaded), 12 queued (11 tests, 1 test file loaded)",
      "Full-suite checkpoint: none completed since revision 170 (the counts are for revision 187; `squeal run --all` requests one)",
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
    const lines = formatStatus(status, NOW, "squeal", { full: true }).split("\n");
    expect(lines[3]).toBe("Full-suite checkpoint: completed at revision 3");
    expect(lines).toContain(
      "Inherited from other worktrees: none (every current result here was run in this worktree)",
    );
  });

  it("says no full-suite checkpoint completed at any revision", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    appendRevisions(store, repo.mainId, 3, { head: null, dirty: false });
    setKeys(store, repo.mainId, ["src/a.test.ts"]);

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(formatStatus(status, NOW).split("\n")[3]).toBe(
      "Full-suite checkpoint: none completed at any revision (the counts are for revision 3; `squeal run --all` requests one)",
    );
  });

  it("says the daemon has not listed the test files instead of zero counts (lessons, defect 4)", () => {
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

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.testFilesListed).toBe(false);
    expect(formatStatus(status, NOW).split("\n").slice(0, 3)).toEqual([
      "Revision: 0",
      "Known failures: 0; the daemon has not listed this worktree's test files yet",
      "Affected checks: none counted; the daemon has not listed this worktree's test files yet",
    ]);

    setKeys(store, repo.mainId, ["src/a.test.ts"]);
    const listed = snapshotOf(readStatus(repo.main, { now: () => NOW }));
    expect(listed.testFilesListed).toBe(true);
    expect(formatStatus(listed, NOW).split("\n")[2]).toBe(
      "Affected checks: 0 passed, 0 running, 0 queued",
    );
  });

  it("labels the dirty flag with its revision and calls it not known without a daemon (lessons, defect 7)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const daemon = (heartbeatAt: number) => ({
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    });
    const worktree = (heartbeatAt: number | null) =>
      store.worktrees.upsert({
        id: repo.mainId,
        root: repo.main,
        commonDir: repo.commonDir,
        isMain: true,
        registeredAt: 1,
        daemon: heartbeatAt === null ? null : daemon(heartbeatAt),
      });
    appendRevisions(store, repo.mainId, 4, { head: COMMIT, dirty: false });
    const worktreeLine = () => {
      const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));
      const line = formatStatus(status, NOW, "squeal", { full: true })
        .split("\n")
        .find((l) => l.startsWith("Worktree: "));
      return { dirty: status.dirty, at: status.dirtyObservedAt, line };
    };

    worktree(NOW - 1_000);
    expect(worktreeLine()).toEqual({
      dirty: false,
      at: 4,
      line: `Worktree: ${repo.main} (HEAD abc1234, clean at revision 4)`,
    });

    worktree(NOW - 60_000);
    expect(worktreeLine()).toEqual({
      dirty: null,
      at: null,
      line: `Worktree: ${repo.main} (HEAD abc1234, dirty state not known: no daemon is validating)`,
    });

    worktree(null);
    expect(worktreeLine().line).toContain("dirty state not known: no daemon is validating");
  });

  it("says no revision is recorded when the dirty flag has none", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/run/squeal.sock",
        startedAt: 1,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0",
      },
    });

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.dirty).toBeNull();
    expect(formatStatus(status, NOW, "squeal", { full: true })).toContain(
      ", dirty state not known: no revision recorded yet)",
    );
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

      expect(result).toMatchObject({ schemaVersion: 1, available: false, reason: "timeout" });
      // 011-01: the time it really waited, not the budget it might have.
      expect(result.available ? "" : result.message).toMatch(
        /^status unavailable, store busy, waited \d+ ms: another process holds the store's lock; run the command again once it is released$/,
      );
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
    expect(formatStatus(status, NOW, "squeal", { full: true })).toContain(
      "\nDaemon: no daemon running\n",
    );
  });

  it("says since when no daemon is running after squeal stop cleared the daemon (review wave 4.5, N5)", () => {
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
    store.worktrees.setDaemon(repo.mainId, null);
    // A clean exit keeps the daemon's identity (task 001-268); it is no daemon all the same.
    expect(store.worktrees.lastDaemon(repo.mainId)).not.toBeNull();

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.daemon).toEqual({ state: "down", since: heartbeatAt });
    expect(formatStatus(status, NOW, "squeal", { full: true })).toContain(
      "\nDaemon: no daemon running since 2026-10-04T11:59:00.000Z\n",
    );
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
    expect(formatStatus(status, NOW, "squeal", { full: true })).toContain(
      "\nDaemon: no daemon running since 2026-10-04T11:59:00.000Z\n",
    );
  });

  it("reads at most the 20 newest daemon notes and ignores malformed ones", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const notes = Array.from({ length: 25 }, (_, i) => ({ at: i, revision: i, text: `n${i}` }));
    store.meta.set(
      `notes.${repo.mainId}`,
      JSON.stringify([...notes.slice(0, 24), { at: "x", text: 1 }, notes[24]]),
    );

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status.daemonNotes.map((n) => n.text)).toEqual(notes.slice(5).map((n) => n.text));
    store.meta.set(`notes.${repo.mainId}`, "{not json");
    expect(snapshotOf(readStatus(repo.main, { now: () => NOW })).daemonNotes).toEqual([]);
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
      testFilesListed: false,
      daemon: { state: "down", since: null },
      notes: [
        "this worktree is not registered in the store; no daemon has run here",
        "no revision recorded for this worktree yet",
      ],
    });
    const lines = formatStatus(status, NOW, "squeal", { full: true }).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "Revision: 0",
      "Known failures: 0; the daemon has not listed this worktree's test files yet",
      "Affected checks: none counted; the daemon has not listed this worktree's test files yet",
      "Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)",
    ]);
    expect(lines).toContain(
      `Worktree: ${repo.main} (HEAD no commit, dirty state not known: no daemon is validating)`,
    );
  });
});
