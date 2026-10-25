import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hasColumn } from "../../src/core/store/columns.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { MIGRATIONS, SCHEMA_VERSION } from "../../src/core/store/schema.js";
import type { CheckId, SetupCheckId } from "../../src/core/types/index.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Spec 016 D3 (row 016-15, row 007-45, review 0.1.303 B1): the runner whose
 * run stored a result is recorded with it, in `results.runner`, a column added
 * with no `user_version` raise so every older daemon of the repository keeps
 * running (011 C7). An older daemon's statements name their columns: it
 * leaves the column empty, and an empty record reads as none. A setup check
 * has no result: its runner is recorded per worktree.
 */

/** How every released daemon stores a check (`ensureCheckId` before the column). */
const OLDER_CHECK = `INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at)
  VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`;

/** How every released daemon stores a result (`ResultRepo.putMany` before the column). */
const OLDER_RESULT = `INSERT OR REPLACE INTO results (check_id, key, outcome, duration_ms,
    location_path, location_line, location_column, fingerprint, failure_id, worktree_id,
    revision, commit_sha, dirty, run_id, recorded_at, last_used_at)
  SELECT id, ?, 'pass', 1, NULL, NULL, NULL, NULL, NULL, 'wt-old', 1, NULL, 1, 'run-old', 1, 1
  FROM checks WHERE project = ? AND test_path = ? AND kind = ? AND full_name = ?`;

const A = testCheck("a");
const B = testCheck("b", "src/b.test.ts");
const SETUP: SetupCheckId = { kind: "setup", project: "", testPath: "test/global-setup.ts" };
const OTHER_SETUP: SetupCheckId = { kind: "setup", project: "web", testPath: "setup.ts" };

/** A connection to `commonDir`'s store as an older daemon holds one. */
function olderDaemon(commonDir: string): DatabaseSync {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** The schema every released daemon wrote: `user_version` 1, no `results.runner`. */
function olderStore(commonDir: string): DatabaseSync {
  mkdirSync(storePaths(commonDir).dir, { recursive: true });
  const db = olderDaemon(commonDir);
  db.exec("PRAGMA journal_mode = WAL");
  for (const step of MIGRATIONS.slice(0, 1)) step(db);
  db.exec("PRAGMA user_version = 1");
  return db;
}

/** An older daemon's result for `check` at `key`, its check stored first. */
function olderResult(db: DatabaseSync, check: CheckId & { fullName?: string }, key: string): void {
  const identity = [check.project, check.testPath, check.kind, check.fullName ?? ""] as const;
  db.prepare(OLDER_CHECK).run(...identity, 1);
  db.prepare(OLDER_RESULT).run(key, ...identity);
}

const userVersion = (db: DatabaseSync) =>
  Number(db.prepare("PRAGMA user_version").get()?.user_version);

describe("store: a result's runner (spec 016 D3)", () => {
  it("a store an older daemon made opens with no version raise, and its results have none", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    olderResult(older, A, "k1");
    older.close();

    const store = open(commonDir);
    expect(store.checks.runnerOf(A, "k1")).toBeNull();
    store.results.putMany([result(B, "k1")], "pytest");
    expect(store.checks.runnerOf(B, "k1")).toBe("pytest");

    const db = olderDaemon(commonDir);
    expect(userVersion(db)).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
    expect(hasColumn(db, "results", "runner")).toBe(true);
    expect(hasColumn(db, "checks", "runner")).toBe(false);
    db.close();
  });

  it("an older daemon holding the store goes on beside the step, and leaves its own results empty", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    // Prepared before the column exists, as a running daemon's statements are.
    const listing = older.prepare("SELECT * FROM results ORDER BY key");
    olderResult(older, A, "k0");

    const store = open(commonDir);
    store.results.putMany([result(A, "k1")], "vitest");
    olderResult(older, A, "k2");
    olderResult(older, B, "k3");

    expect(listing.all().map((row) => [row.key, row.runner])).toEqual([
      ["k0", null],
      ["k1", "vitest"],
      ["k2", null],
      ["k3", null],
    ]);
    expect(store.checks.runnerOf(A, "k1")).toBe("vitest");
    expect(store.checks.runnerOf(A, "k2")).toBeNull();
    expect(store.checks.runnerOf(B, "k3")).toBeNull();
    // Its run stored again at a recorded key replaces the row, record included.
    olderResult(older, A, "k1");
    expect(store.checks.runnerOf(A, "k1")).toBeNull();
    expect(older.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    older.close();

    // Its next start: the integrity check passes and the version is one it understands.
    const again = openStore(commonDir, { checkIntegrity: true });
    expect(isStoreOpenFailure(again)).toBe(false);
    if (!isStoreOpenFailure(again)) again.close();
  });

  it("records the runner with each row, so one check's keys keep their own", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([result(A, "k1")], "pytest");
    store.results.putMany([result(A, "k2", { worktreeId: "wt-other" })], "vitest");
    store.results.putMany([result(A, "k3")]);
    expect(store.checks.runnerOf(A, "k1")).toBe("pytest");
    expect(store.checks.runnerOf(A, "k2")).toBe("vitest");
    expect(store.checks.runnerOf(A, "k3")).toBeNull();
    expect(store.checks.runnerOf(A, "k4")).toBeNull();
    expect(store.checks.runnerOf(B, "k1")).toBeNull();
    // A row stored again at its key takes the new run's record.
    store.results.putMany([result(A, "k1")], "node-test");
    expect(store.checks.runnerOf(A, "k1")).toBe("node-test");
  });

  it("copies the runner with a set read as one (011-38)", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([result(A, "k1"), result(B, "k1")], "pytest");
    expect(store.results.copyNewest("k2", ["k1"])).toBe(true);
    expect(store.checks.runnerOf(A, "k2")).toBe("pytest");
    expect(store.checks.runnerOf(B, "k2")).toBe("pytest");
  });

  it("records a setup check's runner, which has no stored result, for one worktree only", () => {
    const store = open(fakeCommonDir());
    store.checks.recordSetupRunner("wt-main", SETUP, "vitest");
    store.checks.recordSetupRunner("wt-main", OTHER_SETUP, "vitest");
    expect(store.checks.setupRunnerOf("wt-main", SETUP)).toBe("vitest");
    expect(store.checks.setupRunnerOf("wt-other", SETUP)).toBeNull();

    store.checks.recordSetupRunner("wt-main", SETUP, "node-test");
    expect(store.checks.setupRunnerOf("wt-main", SETUP)).toBe("node-test");
    store.checks.recordSetupRunner("wt-main", SETUP, undefined);
    expect(store.checks.setupRunnerOf("wt-main", SETUP)).toBeNull();
    expect(store.checks.setupRunnerOf("wt-main", OTHER_SETUP)).toBe("vitest");
    // No check row is stored for it.
    expect(store.checks.listByTestFile({ project: "", path: SETUP.testPath })).toEqual([]);
  });

  it("an opener that cannot take the write lock fails as on a busy migration, and adds it later", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    olderResult(older, A, "k0");
    older.exec("BEGIN IMMEDIATE");

    expect(() => openStore(commonDir, { create: false, busyTimeoutMs: 0 })).toThrow(/locked/);
    expect(hasColumn(older, "results", "runner")).toBe(false);

    older.exec("COMMIT");
    const daemon = open(commonDir);
    expect(daemon.checks.runnerOf(A, "k0")).toBeNull();
    daemon.results.putMany([result(A, "k1")], "vitest");
    expect(daemon.checks.runnerOf(A, "k1")).toBe("vitest");
    older.close();
  });
});
