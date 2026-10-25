import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CHECK_COLUMNS } from "../../src/core/store/codec.js";
import { storePaths } from "../../src/core/store/index.js";
import { worktreeMetaKey } from "../../src/core/types/index.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Spec 016 D3 (row 016-15, row 007-45, review 0.1.303 B1 and its re-review):
 * each worktree records its projects' runners in one meta row,
 * `runners:<worktree>`, so no table gains a column and every older daemon of
 * the repository keeps running (011 C7). A column added under a held
 * statement drops a field from it on Node 22; `table-columns.test.ts` pins
 * every table's columns.
 */

const A = testCheck("a");

/** A connection to `commonDir`'s store as an older daemon holds one. */
function olderDaemon(commonDir: string): DatabaseSync {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const dataVersion = (db: DatabaseSync) =>
  Number(db.prepare("PRAGMA data_version").get()?.data_version);

describe("store: each worktree's project runners (spec 016 D3)", () => {
  it("records each project's runner for one worktree only", () => {
    const store = open(fakeCommonDir());
    store.checks.recordRunners(
      "wt-main",
      new Map([
        ["", "vitest"],
        ["py", "pytest"],
      ]),
    );
    store.checks.recordRunners("wt-other", new Map([["py", "vitest"]]));
    expect(store.checks.runnersOf("wt-main")).toEqual(
      new Map([
        ["", "vitest"],
        ["py", "pytest"],
      ]),
    );
    expect(store.checks.runnersOf("wt-other")).toEqual(new Map([["py", "vitest"]]));
    expect(store.checks.runnersOf("wt-third")).toEqual(new Map());
  });

  it("replaces a project's runner, and an unknown runner records nothing", () => {
    const store = open(fakeCommonDir());
    store.checks.recordRunners("wt-main", new Map([["unit", "vitest"]]));
    store.checks.recordRunners(
      "wt-main",
      new Map([
        ["unit", "node-test"],
        ["py", undefined],
      ]),
    );
    expect(store.checks.runnersOf("wt-main")).toEqual(new Map([["unit", "node-test"]]));
    store.checks.recordRunners("wt-main", new Map([["unit", undefined]]));
    expect(store.checks.runnersOf("wt-main")).toEqual(new Map([["unit", "node-test"]]));
  });

  it("writes only a change", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const other = olderDaemon(commonDir);
    store.checks.recordRunners("wt-main", new Map([["", "vitest"]]));
    const before = dataVersion(other);
    store.checks.recordRunners("wt-main", new Map([["", "vitest"]]));
    store.checks.recordRunners("wt-main", new Map([["py", undefined]]));
    expect(dataVersion(other)).toBe(before);
    store.checks.recordRunners("wt-main", new Map([["py", "pytest"]]));
    expect(dataVersion(other)).not.toBe(before);
    other.close();
  });

  it("reads an unreadable row as none, and the next record replaces it", () => {
    const store = open(fakeCommonDir());
    store.meta.set(worktreeMetaKey("runners", "wt-main"), "{ not json");
    expect(store.checks.runnersOf("wt-main")).toEqual(new Map());
    store.checks.recordRunners("wt-main", new Map([["", "vitest"]]));
    expect(store.checks.runnersOf("wt-main")).toEqual(new Map([["", "vitest"]]));
  });

  it("leaves an older daemon's held result read whole beside a new daemon (re-review B1, Node 22)", () => {
    const commonDir = fakeCommonDir();
    const first = open(commonDir);
    first.results.putMany([result(A, "k1", { outcome: "fail" })]);
    // How every released daemon reads a key's results, prepared and used before the new daemon opens.
    const older = olderDaemon(commonDir);
    const byKey = older.prepare(`
      SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
      JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
      WHERE r.key = ?`);
    const fields = Object.keys(byKey.all("k1")[0] ?? {});
    expect(fields).toContain("errors");

    const store = open(commonDir);
    store.results.putMany([result(A, "k2", { outcome: "fail" })]);
    store.checks.recordRunners("wt-main", new Map([["", "vitest"]]));

    for (const key of ["k1", "k2"]) {
      const [row] = byKey.all(key);
      expect(Object.keys(row ?? {})).toEqual(fields);
      expect(typeof row?.errors).toBe("string");
    }
    older.close();
  });
});
