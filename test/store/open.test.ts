import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { storeCondemned } from "../../src/core/daemon/store-file.js";
import { isBusy } from "../../src/core/store/connection.js";
import { readStoreMark } from "../../src/core/store/mark.js";
import {
  inspectConnection,
  isCorruption,
  isStoreOpenFailure,
  META_STORE_RECOVERED,
  openStore,
  setBusyTimeout,
} from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { type Migration, migrate, SCHEMA_VERSION } from "../../src/core/store/schema.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { damageHeader, damageTablePages, seedConsumer } from "./damage.js";
import { fakeCommonDir, markStore, open, seedIndexFault } from "./helpers.js";

const realPrepare = DatabaseSync.prototype.prepare;
const realExec = DatabaseSync.prototype.exec;

/** Every table spec 001 D8 names. */
const D8_TABLES = [
  "worktrees",
  "revisions",
  "file_hashes",
  "test_files",
  "test_file_keys",
  "checks",
  "results",
  "runs",
  "known_states",
  "transitions",
  "consumers",
  "consumer_views",
  "meta",
];

function tables(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    return rows.map((row) => String(row.name));
  } finally {
    db.close();
  }
}

function userVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Number(db.prepare("PRAGMA user_version").get()?.user_version);
  } finally {
    db.close();
  }
}

function seedDatabase(file: string, sql: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
}

describe("openStore", () => {
  it("creates <common-dir>/squeal/store.sqlite at the current schema version", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    const { database } = storePaths(commonDir);
    expect(userVersion(database)).toBe(1);
    expect(tables(database)).toEqual(expect.arrayContaining(D8_TABLES));
  });

  it("configures WAL, synchronous=NORMAL and a busy timeout on the connection", () => {
    const commonDir = fakeCommonDir();
    const store = openStore(commonDir, { busyTimeoutMs: 1234 });
    if (isStoreOpenFailure(store)) throw new Error("open failed");
    try {
      expect(inspectConnection(store)).toMatchObject({
        journalMode: "wal",
        synchronous: 1,
        busyTimeoutMs: 1234,
      });
    } finally {
      store.close();
    }
  });

  it("changes the busy timeout of an open store, as a daemon does once started (task 001-161)", () => {
    const store = openStore(fakeCommonDir(), { busyTimeoutMs: 120_000 });
    if (isStoreOpenFailure(store)) throw new Error("open failed");
    try {
      setBusyTimeout(store, 5_000);
      expect(inspectConnection(store).busyTimeoutMs).toBe(5_000);
      expect(() => setBusyTimeout(store, -1)).toThrow(RangeError);
    } finally {
      store.close();
    }
  });

  it("applies a default busy timeout when none is given", () => {
    const store = openStore(fakeCommonDir());
    if (isStoreOpenFailure(store)) throw new Error("open failed");
    try {
      expect(inspectConnection(store).busyTimeoutMs).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("reports a missing store without creating one when create is false", () => {
    const commonDir = fakeCommonDir();
    expect(openStore(commonDir, { create: false })).toEqual({ reason: "missing" });
    expect(existsSync(storePaths(commonDir).dir)).toBe(false);
  });

  it("migrates an empty database file", () => {
    const commonDir = fakeCommonDir();
    const { dir, database } = storePaths(commonDir);
    mkdirSync(dir);
    writeFileSync(database, "");
    const store = open(commonDir);
    expect(store.schemaVersion).toBe(1);
    expect(tables(database)).toEqual(expect.arrayContaining(D8_TABLES));
  });

  it("migrates a database at user_version 0 and leaves unrelated tables alone", () => {
    const commonDir = fakeCommonDir();
    const { database } = storePaths(commonDir);
    seedDatabase(database, "CREATE TABLE scratch(x); INSERT INTO scratch VALUES (42);");
    expect(userVersion(database)).toBe(0);

    const store = open(commonDir);
    expect(store.schemaVersion).toBe(1);
    store.meta.set("k", "v");
    expect(store.meta.get("k")).toBe("v");
    expect(tables(database)).toEqual(expect.arrayContaining([...D8_TABLES, "scratch"]));
  });

  it("opens an existing current store without re-running migrations", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    expect(open(commonDir).meta.get("kept")).toBe("yes");
  });

  it("opens an existing store, checked, while another connection holds the write lock", () => {
    // Task 001-141: `PRAGMA auto_vacuum = INCREMENTAL` on every open took the
    // write lock, so a hook's or a status read's open waited behind a writer.
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    const writer = new DatabaseSync(storePaths(commonDir).database);
    writer.exec("BEGIN IMMEDIATE");
    try {
      const store = openStore(commonDir, { busyTimeoutMs: 0, recoverFaults: true });
      if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
      expect(store.meta.get("kept")).toBe("yes");
      store.close();
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  it("creates the store with incremental auto_vacuum", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    expect(db.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum).toBe(2);
    db.close();
  });

  it("refuses a newer user_version and leaves the file untouched", () => {
    const commonDir = fakeCommonDir();
    const { database } = storePaths(commonDir);
    seedDatabase(database, "CREATE TABLE future(x); PRAGMA user_version = 99;");

    expect(openStore(commonDir)).toEqual({ reason: "newer-schema", found: 99, supported: 1 });
    expect(openStore(commonDir, { create: false, recoverFaults: true })).toEqual({
      reason: "newer-schema",
      found: 99,
      supported: 1,
    });
    expect(userVersion(database)).toBe(99);
    expect(tables(database)).toEqual(["future"]);
  });

  it("reports a file that is not a database as corrupt without moving it", () => {
    const commonDir = fakeCommonDir();
    const { dir, database } = storePaths(commonDir);
    mkdirSync(dir);
    writeFileSync(database, Buffer.alloc(8192, 7));

    expect(openStore(commonDir)).toEqual({ reason: "corrupt", movedTo: null });
    expect(existsSync(database)).toBe(true);
  });

  it("moves a store whose open fails with corruption aside on a checked open and starts fresh", () => {
    const commonDir = fakeCommonDir();
    const { dir, database } = storePaths(commonDir);
    mkdirSync(dir);
    writeFileSync(database, Buffer.alloc(8192, 7));

    const store = openStore(commonDir, { recoverFaults: true, now: () => 1_700_000_000_000 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.schemaVersion).toBe(1);
      const note = JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null");
      expect(note).toEqual({
        at: 1_700_000_000_000,
        movedTo: join(dir, "store.sqlite.corrupt-1700000000000"),
        reason: expect.stringContaining("file is not a database"),
        found: "start",
      });
      expect(readdirSync(dir)).toContain("store.sqlite.corrupt-1700000000000");
    } finally {
      store.close();
    }
  });

  it("moves a store whose header is damaged aside on a checked open (row 011-391)", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    damageHeader(commonDir);

    const store = openStore(commonDir, { recoverFaults: true, now: () => 5 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBeNull();
      expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toMatchObject({
        movedTo: expect.stringContaining("store.sqlite.corrupt-5"),
        found: "start",
      });
    } finally {
      store.close();
    }
  });

  it("opens a store with damaged pages on a checked open, reading none of them; the read that hits them throws corruption (row 011-391)", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    // A table page no open reads; on Node 22 and 24 any meta read near a damaged meta value
    // reads its overflow chain, so the damage is not in meta.
    seedConsumer(commonDir, "w1");
    expect(damageTablePages(commonDir, "consumers")).toBe(1);

    const sql: string[] = [];
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    prepare.mockImplementation(function (this: DatabaseSync, text: string) {
      sql.push(text);
      return realPrepare.call(this, text);
    });
    exec.mockImplementation(function (this: DatabaseSync, text: string) {
      sql.push(text);
      return realExec.call(this, text);
    });
    let store: ReturnType<typeof openStore>;
    try {
      store = openStore(commonDir, { recoverFaults: true, now: () => 5 });
    } finally {
      prepare.mockRestore();
      exec.mockRestore();
    }
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(sql.filter((text) => /quick_check|integrity_check/i.test(text))).toEqual([]);
      expect(sql.length).toBeGreaterThan(0);
      expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
      expect(store.meta.get("kept")).toBe("yes");
      let thrown: unknown;
      try {
        store.consumers.list("w1" as WorktreeId);
      } catch (error) {
        thrown = error;
      }
      expect(isCorruption(thrown)).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("the full check's mark at a checked open (row 011-226)", () => {
  /** Opens a store that must open, and closes it after `fn`. */
  function opened<T>(
    commonDir: string,
    options: Parameters<typeof openStore>[1],
    fn: (store: Store) => T,
  ): T {
    const store = openStore(commonDir, options);
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      return fn(store);
    } finally {
      store.close();
    }
  }

  // The full check finds this fault in its own process (`test/daemon/full-check.test.ts`), and
  // the next start moves the store aside (`full-check-daemon.test.ts`).
  it("opens a store with only an index fault on a checked open", () => {
    const commonDir = fakeCommonDir();
    const { dir } = storePaths(commonDir);
    seedIndexFault(commonDir);

    opened(commonDir, { recoverFaults: true, now: () => 7 }, (store) => {
      expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
    });
    expect(readdirSync(dir).filter((name) => name.includes("corrupt"))).toEqual([]);
  });

  it("moves a marked store aside on the next checked open, the mark beside it, and names the full check", () => {
    const commonDir = fakeCommonDir();
    const { dir } = storePaths(commonDir);
    opened(commonDir, {}, (store) => store.meta.set("kept", "yes"));
    markStore(commonDir, { at: 5, problem: "row 1 missing from index fault_a" });
    expect(readStoreMark(commonDir)).toEqual({
      at: 5,
      problem: "row 1 missing from index fault_a",
    });

    // A hook's open checks nothing and leaves the store where it is.
    opened(commonDir, { create: false }, (store) => expect(store.meta.get("kept")).toBe("yes"));

    opened(commonDir, { recoverFaults: true, now: () => 9 }, (store) => {
      expect(store.meta.get("kept")).toBeNull();
      expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toEqual({
        at: 9,
        movedTo: join(dir, "store.sqlite.corrupt-9"),
        reason: "row 1 missing from index fault_a",
        found: "full-check",
        check: "full",
        checkedAt: 5,
      });
    });
    expect(readStoreMark(commonDir)).toBeNull();
    expect(readdirSync(dir)).toContain("store.sqlite.corrupt-9.check-failed");

    // The fresh store is not moved again.
    opened(commonDir, { recoverFaults: true, now: () => 10 }, (store) => {
      expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toMatchObject({ at: 9 });
    });
  });
});

describe("a mark that a read or write left (row 011-391)", () => {
  it("moves the store aside on the next checked open, and the note names what found it", () => {
    const commonDir = fakeCommonDir();
    const { dir } = storePaths(commonDir);
    open(commonDir).meta.set("kept", "yes");
    markStore(commonDir, { at: 4, problem: "database disk image is malformed", found: "daemon" });
    expect(readStoreMark(commonDir)).toEqual({
      at: 4,
      problem: "database disk image is malformed",
      found: "daemon",
    });

    const store = openStore(commonDir, { recoverFaults: true, now: () => 8 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBeNull();
      expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toEqual({
        at: 8,
        movedTo: join(dir, "store.sqlite.corrupt-8"),
        reason: "database disk image is malformed",
        found: "daemon",
        markedAt: 4,
      });
    } finally {
      store.close();
    }
  });

  it("ignores and removes a mark that names another file (review of cand/0.1.545, B1)", () => {
    const commonDir = fakeCommonDir();
    const { database } = storePaths(commonDir);
    open(commonDir).meta.set("kept", "yes");
    markStore(commonDir, { at: 4, problem: "p", found: "daemon", file: { dev: 1, ino: 2 } });

    expect(readStoreMark(commonDir)).toBeNull();
    expect(existsSync(`${database}.check-failed`)).toBe(true);
    const store = openStore(commonDir, { recoverFaults: true, now: () => 8 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBe("yes");
      expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
    } finally {
      store.close();
    }
    expect(existsSync(`${database}.check-failed`)).toBe(false);
    expect(
      readdirSync(storePaths(commonDir).dir).filter((name) => name.includes("check-failed")),
    ).toEqual([]);
  });

  it("moves the store aside on a mark that names its own file", () => {
    const commonDir = fakeCommonDir();
    const { database } = storePaths(commonDir);
    open(commonDir).meta.set("kept", "yes");
    const own = statSync(database);
    markStore(commonDir, {
      at: 4,
      problem: "p",
      found: "hook",
      file: { dev: own.dev, ino: own.ino },
    });

    const store = openStore(commonDir, { recoverFaults: true, now: () => 8 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBeNull();
      expect(JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null")).toMatchObject({
        found: "hook",
        markedAt: 4,
      });
    } finally {
      store.close();
    }
  });

  it("reads an unknown finder as the full check's, as a mark from before row 011-391", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    writeFileSync(
      `${storePaths(commonDir).database}.check-failed`,
      JSON.stringify({ at: 3, problem: "p", found: "elsewhere" }),
    );
    expect(readStoreMark(commonDir)).toEqual({ at: 3, problem: "p" });
  });

  it("keeps a parsed mark's unknown finder, never the full check's (review 0.1.559 S1)", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    writeFileSync(
      `${storePaths(commonDir).database}.check-failed`,
      JSON.stringify({ at: 1, problem: "p", found: "unknown" }),
    );

    expect(readStoreMark(commonDir)).toEqual({ at: 1, problem: "p", found: "unknown" });
    expect(storeCondemned(commonDir)).toBe(
      "daemon stopped: a fault was marked on the store (p); " +
        "the next start moves the store aside and starts a fresh one",
    );
    const store = openStore(commonDir, { recoverFaults: true, now: () => 8 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBeNull();
      const note = JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null");
      expect(note).toMatchObject({ found: "unknown" });
      expect(note).not.toHaveProperty("check");
      expect(note).not.toHaveProperty("checkedAt");
      expect(note).not.toHaveProperty("markedAt");
    } finally {
      store.close();
    }
  });

  it("reads a mark cut short as one whose finder is unknown, never the full check's (row 011-392 d)", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    writeFileSync(`${storePaths(commonDir).database}.check-failed`, '{"at":1,');

    expect(readStoreMark(commonDir)).toEqual({
      at: 0,
      problem: "the mark beside the store could not be read",
      found: "unknown",
    });
    expect(storeCondemned(commonDir)).toBe(
      "daemon stopped: a fault was marked on the store (the mark beside the store could not be read); " +
        "the next start moves the store aside and starts a fresh one",
    );
    const store = openStore(commonDir, { recoverFaults: true, now: () => 8 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("kept")).toBeNull();
      const note = JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null");
      expect(note).toMatchObject({ found: "unknown" });
      expect(note).not.toHaveProperty("check");
      expect(note).not.toHaveProperty("checkedAt");
      expect(note).not.toHaveProperty("markedAt");
    } finally {
      store.close();
    }
  });
});

describe("migrate", () => {
  it("rolls a failing migration back entirely and keeps user_version", () => {
    const db = new DatabaseSync(":memory:");
    const migrations: Migration[] = [
      (d) => d.exec("CREATE TABLE a(x)"),
      (d) => {
        d.exec("CREATE TABLE b(x)");
        throw new Error("boom");
      },
    ];
    expect(() => migrate(db, migrations)).toThrow("boom");
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master").get()?.n).toBe(0);
    db.close();
  });

  it("applies only the steps above the current version", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA user_version = 1");
    const ran: number[] = [];
    migrate(db, [() => ran.push(1), () => ran.push(2), () => ran.push(3)]);
    expect(ran).toEqual([2, 3]);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    db.close();
  });
});

describe("isBusy", () => {
  it("is true for a write lock another connection holds, false for other errors", () => {
    const file = join(fakeCommonDir(), "busy.db");
    const holder = new DatabaseSync(file);
    const other = new DatabaseSync(file, { timeout: 0 });
    holder.exec("CREATE TABLE t (x); BEGIN IMMEDIATE");
    let busy: unknown;
    try {
      other.exec("BEGIN IMMEDIATE");
    } catch (error) {
      busy = error;
    }
    expect(isBusy(busy)).toBe(true);
    expect(isBusy(new Error("plain"))).toBe(false);
    expect(isBusy(null)).toBe(false);
    holder.close();
    other.close();
  });
});
