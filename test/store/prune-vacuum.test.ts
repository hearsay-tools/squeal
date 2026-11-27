import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Connection } from "../../src/core/store/connection.js";
import { VACUUM_PAGES, VACUUM_SLICE_MS } from "../../src/core/store/prune-rules.js";
import { vacuum } from "../../src/core/store/prune-vacuum.js";
import { tempDir } from "./helpers.js";

/*
 * Row 022-08: a vacuum slice runs `incremental_vacuum(VACUUM_PAGES)` steps
 * in one write transaction until `VACUUM_SLICE_MS` passed, so no slice holds
 * the store's lock for long, however much the deletes freed.
 */

/** A store with `rows` freed rows of about 3 KB, each between kept rows, so the vacuum moves pages. */
function storeWithFreePages(rows: number, autoVacuum = true): Connection {
  const db = new DatabaseSync(join(tempDir(), "store.sqlite"));
  if (autoVacuum) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE gone (id INTEGER PRIMARY KEY, body BLOB)");
  db.exec("CREATE TABLE kept (id INTEGER PRIMARY KEY, body BLOB)");
  const gone = db.prepare("INSERT INTO gone (body) VALUES (?)");
  const kept = db.prepare("INSERT INTO kept (body) VALUES (?)");
  db.exec("BEGIN");
  for (let i = 0; i < rows; i++) {
    gone.run(Buffer.alloc(3000, i));
    kept.run(Buffer.alloc(500, i));
  }
  db.exec("COMMIT");
  db.exec("DELETE FROM gone");
  return new Connection(db);
}

function freePages(conn: Connection): number {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count);
}

describe("the prune's vacuum slices (row 022-08)", () => {
  it("stops a slice at the budget, and the next slice continues", () => {
    const conn = storeWithFreePages(400);
    const start = freePages(conn);
    expect(start).toBeGreaterThan(4 * VACUUM_PAGES);
    // Each reading is 0.6 budgets later: a slice's second step ends past it.
    let now = 0;
    const clock = () => (now += 0.6 * VACUUM_SLICE_MS);
    const freed: number[] = [];
    for (const slice of vacuum(conn, clock)) {
      const before = freePages(conn);
      slice();
      freed.push(before - freePages(conn));
      if (freed.length === 4) break;
    }
    // Row 022-08r: each vacuum slice is followed by its checkpoint slice, which frees nothing.
    expect(freed).toEqual([2 * VACUUM_PAGES, 0, 2 * VACUUM_PAGES, 0]);
    expect(freePages(conn)).toBe(start - 4 * VACUUM_PAGES);
  });

  it("stops at once on a store without auto_vacuum", () => {
    const conn = storeWithFreePages(50, false);
    const start = freePages(conn);
    expect(start).toBeGreaterThan(0);
    let slices = 0;
    for (const slice of vacuum(conn, () => 0)) {
      slice();
      slices++;
    }
    expect(slices).toBe(1);
    expect(freePages(conn)).toBe(start);
  });

  // Row 011-429 (G1): a slice is judged by the steps it ran on a clock the test moves, not by
  // the wall time it held, which failed on CI at 505 ms against 300 on a shared runner. How long
  // a step holds the lock on a large store is the `bench/` churn cell's `store.longWrite.maxMs`.
  it("frees every page of a real store, each slice a budget's steps", () => {
    const conn = storeWithFreePages(4000);
    expect(freePages(conn)).toBeGreaterThan(3000);
    // Each reading is a tenth of the budget later: a slice runs ten steps.
    let now = 0;
    const clock = () => (now += VACUUM_SLICE_MS / 10);
    const freed: number[] = [];
    for (const slice of vacuum(conn, clock)) {
      const before = freePages(conn);
      slice();
      freed.push(before - freePages(conn));
    }
    expect(freePages(conn)).toBe(0);
    expect(Math.max(...freed)).toBe(10 * VACUUM_PAGES);
  });
});
