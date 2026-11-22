import { statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Connection } from "../../src/core/store/connection.js";
import { checkpointAfterWrites } from "../../src/core/store/prune-checkpoint.js";
import { vacuum } from "../../src/core/store/prune-vacuum.js";
import { tempDir } from "./helpers.js";

/*
 * Row 022-08r: a prune's write slice commits without SQLite's automatic WAL
 * checkpoint, and the checkpoint runs as the next slice, outside the write
 * transaction.
 */

/** A WAL store whose own automatic checkpoint runs at every commit. */
function walStore(): { conn: Connection; path: string } {
  const path = join(tempDir(), "store.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, body BLOB)");
  db.exec("PRAGMA wal_autocheckpoint = 1");
  return { conn: new Connection(db), path };
}

const autoCheckpoint = (conn: Connection) =>
  Number(conn.get("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint);

describe("checkpointAfterWrites (row 022-08r)", () => {
  it("runs each write slice with the automatic checkpoint off, then restores it", () => {
    const { conn } = walStore();
    const seen: number[] = [];
    const inner = [() => void conn.transaction(() => seen.push(autoCheckpoint(conn)))];
    for (const slice of checkpointAfterWrites(conn, inner)) slice();
    expect(seen).toEqual([0]);
    expect(autoCheckpoint(conn)).toBe(1);
  });

  it("restores the setting when a slice throws", () => {
    const { conn } = walStore();
    const failing = () => {
      throw new Error("boom");
    };
    const [slice] = checkpointAfterWrites(conn, [failing]);
    expect(() => slice?.()).toThrow("boom");
    expect(autoCheckpoint(conn)).toBe(1);
  });

  it("follows a slice that wrote with a checkpoint slice, and a read-only one with none", () => {
    const { conn } = walStore();
    const order: string[] = [];
    const write = () => {
      order.push("write");
      conn.transaction(() => conn.run("INSERT INTO t (body) VALUES (x'00')"));
    };
    const read = () => {
      order.push("read");
      conn.read(() => conn.all("SELECT * FROM t"));
    };
    let slices = 0;
    for (const slice of checkpointAfterWrites(conn, [write, read, write])) {
      slice();
      slices++;
    }
    expect(order).toEqual(["write", "read", "write"]);
    expect(slices).toBe(5);
  });

  it("leaves the database file to the checkpoint slice, not to the vacuum's commit", () => {
    const { conn, path } = walStore();
    conn.transaction(() => {
      for (let i = 0; i < 300; i++)
        conn.run("INSERT INTO t (body) VALUES (?)", Buffer.alloc(3000, i));
    });
    conn.transaction(() => conn.run("DELETE FROM t"));
    conn.get("PRAGMA wal_checkpoint(TRUNCATE)");
    const full = statSync(path).size;
    // Each slice runs before the next is asked for: whether one follows depends on it.
    const sizes: number[] = [];
    for (const slice of vacuum(conn)) {
      slice();
      sizes.push(statSync(path).size);
    }
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBe(full);
    expect(sizes[1]).toBeLessThan(full);
  });
});
