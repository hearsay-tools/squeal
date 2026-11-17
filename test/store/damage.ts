import { closeSync, openSync, writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";

/*
 * Row 011-391: really damaged store files. The pages are found with SQLite's
 * `dbstat` table and overwritten in the file itself, after the WAL is
 * checkpointed into it, so a connection that reads them meets the damage.
 */

/** The bytes damaged pages are overwritten with. */
const GARBAGE = 0xab;

/** The size of a value whose content goes to overflow pages, which only reading it touches. */
const OVERFLOW_BYTES = 200_000;

/**
 * Writes a `meta` row `key` with a value long enough to need overflow pages,
 * creating the store when missing, and checkpoints it into the file.
 */
export function seedOverflow(commonDir: string, key: string): void {
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  try {
    store.transaction(() => store.meta.set(key, "9".repeat(OVERFLOW_BYTES)));
  } finally {
    store.close();
  }
  checkpoint(commonDir);
}

/**
 * Overwrites every overflow page of the `meta` table: the content of the
 * values `seedOverflow` wrote. Reading such a value throws SQLITE_CORRUPT; no
 * other read touches those pages. Returns how many pages it damaged.
 */
export function damageOverflow(commonDir: string): number {
  const pages = pagesOf(
    commonDir,
    "SELECT pgoffset, pgsize FROM dbstat WHERE name = 'meta' AND pagetype = 'overflow'",
  );
  if (pages.length === 0) throw new Error("the meta table has no overflow pages");
  overwrite(commonDir, pages);
  return pages.length;
}

/** Overwrites the file's first page, its header with it: the open itself fails (SQLITE_NOTADB). */
export function damageHeader(commonDir: string): void {
  checkpoint(commonDir);
  overwrite(commonDir, [{ offset: 0, size: 4096 }]);
}

function checkpoint(commonDir: string): void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

interface Page {
  readonly offset: number;
  readonly size: number;
}

function pagesOf(commonDir: string, sql: string): Page[] {
  checkpoint(commonDir);
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => ({ offset: Number(row.pgoffset), size: Number(row.pgsize) }));
  } finally {
    db.close();
  }
}

function overwrite(commonDir: string, pages: readonly Page[]): void {
  const fd = openSync(storePaths(commonDir).database, "r+");
  try {
    for (const { offset, size } of pages)
      writeSync(fd, Buffer.alloc(size, GARBAGE), 0, size, offset);
  } finally {
    closeSync(fd);
  }
}
