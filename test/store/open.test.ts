import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  isBusy,
  isStoreOpenFailure,
  META_STORE_RECOVERED,
  openStore,
  SCHEMA_VERSION,
  storePaths,
} from "../../src/core/store/index.js";
import { inspectConnection } from "../../src/core/store/open.js";
import { type Migration, migrate } from "../../src/core/store/schema.js";
import { fakeCommonDir, open } from "./helpers.js";

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
      expect(inspectConnection(store)).toEqual({
        journalMode: "wal",
        synchronous: 1,
        busyTimeoutMs: 1234,
      });
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

  it("refuses a newer user_version and leaves the file untouched", () => {
    const commonDir = fakeCommonDir();
    const { database } = storePaths(commonDir);
    seedDatabase(database, "CREATE TABLE future(x); PRAGMA user_version = 99;");

    expect(openStore(commonDir)).toEqual({ reason: "newer-schema", found: 99, supported: 1 });
    expect(openStore(commonDir, { create: false, checkIntegrity: true })).toEqual({
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

  it("moves a corrupt store aside on an integrity-checked open and starts fresh", () => {
    const commonDir = fakeCommonDir();
    const { dir, database } = storePaths(commonDir);
    mkdirSync(dir);
    writeFileSync(database, Buffer.alloc(8192, 7));

    const store = openStore(commonDir, { checkIntegrity: true, now: () => 1_700_000_000_000 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.schemaVersion).toBe(1);
      const note = JSON.parse(store.meta.get(META_STORE_RECOVERED) ?? "null");
      expect(note).toEqual({
        at: 1_700_000_000_000,
        movedTo: join(dir, "store.sqlite.corrupt-1700000000000"),
        reason: expect.any(String),
      });
      expect(readdirSync(dir)).toContain("store.sqlite.corrupt-1700000000000");
    } finally {
      store.close();
    }
  });

  it("detects page-level corruption with integrity_check", () => {
    const commonDir = fakeCommonDir();
    const first = open(commonDir);
    first.meta.set("big", "x".repeat(200_000));
    first.close();
    const { database } = storePaths(commonDir);
    // Checkpoint the WAL into the main file, then damage pages in the middle of it.
    const raw = new DatabaseSync(database);
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    raw.close();
    const fd = openSync(database, "r+");
    writeSync(fd, Buffer.alloc(4096 * 3, 0xab), 0, 4096 * 3, 4096 * 4);
    closeSync(fd);

    const store = openStore(commonDir, { checkIntegrity: true, now: () => 5 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    try {
      expect(store.meta.get("big")).toBeNull();
      expect(store.meta.get(META_STORE_RECOVERED)).toContain("store.sqlite.corrupt-5");
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
