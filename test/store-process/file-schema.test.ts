import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { fileSchemaReader } from "../../src/core/store-process/server.js";

/* Row 024-04 (spec 024 D4.3): the store process reads the schema again only when the file changed. */

const dirs: string[] = [];
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function walStore(version: number): { path: string; db: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), "sq-schema-"));
  dirs.push(dir);
  const path = join(dir, "code.sqlite");
  const db = new DatabaseSync(path);
  dbs.push(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (x)");
  db.exec(`PRAGMA user_version = ${version}`);
  return { path, db };
}

function counting(): { read: (path: string) => number; opens: () => number } {
  let opens = 0;
  return {
    read: (path) => {
      opens += 1;
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        return Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0] ?? 0);
      } finally {
        db.close();
      }
    },
    opens: () => opens,
  };
}

describe("fileSchemaReader", () => {
  it("opens the file once while neither it nor its WAL changed", () => {
    const { path } = walStore(7);
    const reads = counting();
    const schema = fileSchemaReader(path, reads.read);
    expect([schema(), schema(), schema()]).toEqual([7, 7, 7]);
    expect(reads.opens()).toBe(1);
  });

  it("sees a schema change still in the WAL, before any checkpoint", () => {
    const { path, db } = walStore(7);
    db.exec("PRAGMA wal_autocheckpoint = 0");
    const reads = counting();
    const schema = fileSchemaReader(path, reads.read);
    expect(schema()).toBe(7);
    db.exec("PRAGMA user_version = 8");
    expect(schema()).toBe(8);
    expect(reads.opens()).toBe(2);
  });

  it("reads 0 for a missing file and reads again once it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-schema-"));
    dirs.push(dir);
    const path = join(dir, "code.sqlite");
    const schema = fileSchemaReader(path);
    expect(schema()).toBe(0);
    const db = new DatabaseSync(path);
    dbs.push(db);
    db.exec("PRAGMA user_version = 3");
    expect(schema()).toBe(3);
  });
});
