import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { batchSeq, GuardedWriter, markKey } from "../../src/core/store-process/guard.js";

/*
 * Spec 021 D22.4 (row 021-36): a batch is written once. Whoever writes it,
 * the store process or its client, tests the worktree's mark under the
 * write lock and sets it with the batch.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function database(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "squeal-guard-"));
  const db = new DatabaseSync(join(dir, "code.sqlite"));
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE TABLE n (v INTEGER NOT NULL)");
  return db;
}

const add = (v: number) => ({ sql: "INSERT INTO n (v) VALUES (?)", params: [v] });
const rows = (db: DatabaseSync) =>
  (db.prepare("SELECT v FROM n ORDER BY rowid").all() as { v: number }[]).map((r) => r.v);

describe("the batch mark", () => {
  it("orders numbers as text as they order as numbers", () => {
    expect(batchSeq(1_000, 9) < batchSeq(1_000, 10)).toBe(true);
    expect(batchSeq(1_000, 99_999) < batchSeq(1_001, 0)).toBe(true);
  });

  it("writes a batch once: a second writer of it finds the mark and writes nothing", () => {
    const db = database();
    const store = new GuardedWriter(db);
    const client = new GuardedWriter(db);
    const seq = batchSeq(5, 1);
    expect(store.write("w1", seq, [add(1), add(2)])).toEqual({ end: "written" });
    expect(client.write("w1", seq, [add(1), add(2)])).toEqual({ end: "superseded" });
    expect(rows(db)).toEqual([1, 2]);
    expect(store.mark("w1")).toBe(seq);
  });

  it("never writes a batch after a later one of its worktree", () => {
    const db = database();
    const writer = new GuardedWriter(db);
    writer.write("w1", batchSeq(5, 2), [add(2)]);
    expect(writer.write("w1", batchSeq(5, 1), [add(1)])).toEqual({ end: "superseded" });
    // Another worktree's mark is its own.
    expect(writer.write("w2", batchSeq(5, 1), [add(3)])).toEqual({ end: "written" });
    expect(rows(db)).toEqual([2, 3]);
  });

  it("rolls a failed batch back whole, mark included", () => {
    const db = database();
    const writer = new GuardedWriter(db);
    const bad = { sql: "INSERT INTO missing (v) VALUES (?)", params: [1] };
    expect(() => writer.write("w1", batchSeq(5, 1), [add(1), bad])).toThrow(/missing/);
    expect(rows(db)).toEqual([]);
    expect(writer.mark("w1")).toBeNull();
  });

  it("cuts a splittable batch into slices and sets the mark with the last", () => {
    const db = database();
    const writer = new GuardedWriter(db);
    let clock = 0;
    const now = () => (clock += 150);
    const seq = batchSeq(5, 1);
    const batch = [add(1), add(2), add(3)];
    const first = writer.write("w1", seq, batch, { sliceMs: 250, now });
    expect(first).toEqual({ end: "partial", next: 2 });
    expect(writer.mark("w1")).toBeNull();
    expect(writer.write("w1", seq, batch, { from: 2, sliceMs: 250, now })).toEqual({
      end: "written",
    });
    expect(rows(db)).toEqual([1, 2, 3]);
    expect(db.prepare("SELECT value FROM meta WHERE key = ?").get(markKey("w1"))).toEqual({
      value: seq,
    });
  });
});
