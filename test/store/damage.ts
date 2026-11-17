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
 * Registers a consumer of `worktreeId`, the only row of the `consumers`
 * table, and checkpoints it into the file. Another worktree's lookup goes
 * through the primary key's index, finds no row, and never loads the
 * table's page that `damageTablePages(commonDir, "consumers")` damages.
 */
export function seedConsumer(commonDir: string, worktreeId: string): void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.prepare(
      "INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at) VALUES (?, ?, 'main', ?, ?)",
    ).run(worktreeId, "s1", Date.now(), Date.now());
  } finally {
    db.close();
  }
  checkpoint(commonDir);
}

/**
 * Overwrites every overflow page of `table` (default `meta`): the content of
 * values too long for their page, such as `seedOverflow` writes. Reading such
 * a value throws SQLITE_CORRUPT; no other read touches those pages. Returns
 * how many pages it damaged.
 */
export function damageOverflow(commonDir: string, table = "meta"): number {
  const pages = pagesOf(
    commonDir,
    `SELECT pgoffset, pgsize FROM dbstat WHERE name = '${table}' AND pagetype = 'overflow'`,
  );
  if (pages.length === 0) throw new Error(`the ${table} table has no overflow pages`);
  overwrite(commonDir, pages);
  return pages.length;
}

/**
 * Overwrites every b-tree page of `table` itself (its leaves and interior
 * pages, not its indexes' or its overflow pages). Loading such a page throws
 * SQLITE_CORRUPT on every SQLite, wherever the read stops in a row; a lookup
 * that an index answers with no row never loads it. Returns how many pages
 * it damaged.
 */
export function damageTablePages(commonDir: string, table: string): number {
  const pages = pagesOf(
    commonDir,
    `SELECT pgoffset, pgsize FROM dbstat WHERE name = '${table}' AND pagetype IN ('leaf', 'internal')`,
  );
  if (pages.length === 0) throw new Error(`the ${table} table has no pages`);
  overwrite(commonDir, pages);
  return pages.length;
}

/** Overwrites the file's first page, its header with it: the open itself fails (SQLITE_NOTADB). */
export function damageHeader(commonDir: string): void {
  checkpoint(commonDir);
  overwrite(commonDir, [{ offset: 0, size: 4096 }]);
}

/** Checkpoints the WAL into the store file, so the file holds every page. */
export function checkpoint(commonDir: string): void {
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
