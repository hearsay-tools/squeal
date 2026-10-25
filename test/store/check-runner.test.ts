import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hasColumn } from "../../src/core/store/columns.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { MIGRATIONS, SCHEMA_VERSION } from "../../src/core/store/schema.js";
import type { CheckId, SetupCheckId } from "../../src/core/types/index.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Spec 016 D3 (row 016-15, row 007-45): the runner whose run stored a check's
 * result is recorded with the check, in `checks.runner`, a column added with
 * no `user_version` raise so every older daemon of the repository keeps
 * running (011 C7). An older daemon's statements name their columns: it
 * leaves the column empty, and an empty record reads as none.
 */

/** How every released daemon stores a check (`ensureCheckId` before the column). */
const OLDER_INSERT = `INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at)
  VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`;

const A = testCheck("a");
const B = testCheck("b", "src/b.test.ts");
const SETUP: SetupCheckId = { kind: "setup", project: "", testPath: "test/global-setup.ts" };

/** A connection to `commonDir`'s store as an older daemon holds one. */
function olderDaemon(commonDir: string): DatabaseSync {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** The schema every released daemon wrote: `user_version` 1, no `checks.runner`. */
function olderStore(commonDir: string): DatabaseSync {
  mkdirSync(storePaths(commonDir).dir, { recursive: true });
  const db = olderDaemon(commonDir);
  db.exec("PRAGMA journal_mode = WAL");
  for (const step of MIGRATIONS.slice(0, 1)) step(db);
  db.exec("PRAGMA user_version = 1");
  return db;
}

function olderInsert(db: DatabaseSync, check: CheckId & { fullName?: string }): void {
  db.prepare(OLDER_INSERT).run(check.project, check.testPath, check.kind, check.fullName ?? "", 1);
}

const userVersion = (db: DatabaseSync) =>
  Number(db.prepare("PRAGMA user_version").get()?.user_version);

describe("store: a check's runner (spec 016 D3)", () => {
  it("a store an older daemon made opens with no version raise, and its checks have none", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    olderInsert(older, A);
    older.close();

    const store = open(commonDir);
    expect(store.checks.runnerOf(A)).toBeNull();
    store.results.putMany([result(B, "k1")], "pytest");
    expect(store.checks.runnerOf(B)).toBe("pytest");

    const db = olderDaemon(commonDir);
    expect(userVersion(db)).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
    expect(hasColumn(db, "checks", "runner")).toBe(true);
    db.close();
  });

  it("an older daemon holding the store goes on beside the step, and leaves its own checks empty", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    // Prepared before the column exists, as a running daemon's statements are.
    const listing = older.prepare("SELECT * FROM checks ORDER BY id");
    olderInsert(older, A);

    const store = open(commonDir);
    store.results.putMany([result(A, "k1")], "vitest");
    olderInsert(older, A);
    olderInsert(older, B);

    expect(listing.all().map((row) => [row.test_path, row.runner])).toEqual([
      ["src/a.test.ts", "vitest"],
      ["src/b.test.ts", null],
    ]);
    expect(store.checks.runnerOf(A)).toBe("vitest");
    expect(store.checks.runnerOf(B)).toBeNull();
    expect(older.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    older.close();

    // Its next start: the integrity check passes and the version is one it understands.
    const again = openStore(commonDir, { checkIntegrity: true });
    expect(isStoreOpenFailure(again)).toBe(false);
    if (!isStoreOpenFailure(again)) again.close();
  });

  it("records the runner of each newest result; a write that names none keeps it", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([result(A, "k1")], "pytest");
    expect(store.checks.runnerOf(A)).toBe("pytest");
    store.results.putMany([result(A, "k2")], "node-test");
    expect(store.checks.runnerOf(A)).toBe("node-test");
    store.results.putMany([result(A, "k3")]);
    expect(store.checks.runnerOf(A)).toBe("node-test");
    expect(store.checks.runnerOf(B)).toBeNull();
  });

  it("records a setup check's runner, which has no stored result", () => {
    const store = open(fakeCommonDir());
    store.checks.recordRunner(SETUP, "vitest");
    expect(store.checks.runnerOf(SETUP)).toBe("vitest");
    store.checks.recordRunner(B, undefined);
    expect(store.checks.listByTestFile({ project: "", path: B.testPath })).toEqual([]);
  });

  it("an opener that cannot take the write lock fails as on a busy migration, and adds it later", () => {
    const commonDir = fakeCommonDir();
    const older = olderStore(commonDir);
    olderInsert(older, A);
    older.exec("BEGIN IMMEDIATE");

    expect(() => openStore(commonDir, { create: false, busyTimeoutMs: 0 })).toThrow(/locked/);
    expect(hasColumn(older, "checks", "runner")).toBe(false);

    older.exec("COMMIT");
    const daemon = open(commonDir);
    expect(daemon.checks.runnerOf(A)).toBeNull();
    daemon.results.putMany([result(A, "k1")], "vitest");
    expect(daemon.checks.runnerOf(A)).toBe("vitest");
    older.close();
  });
});
