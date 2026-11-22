import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import type { Store, StoreOpenFailure } from "../types/store.js";
import { Connection, isBusy, rollback } from "./connection.js";
import { currentMark, dropStaleMark, markPath, RECOVERY_LOCK, type StoreMark } from "./mark.js";
import { type StorePaths, storePaths } from "./paths.js";
import { migrate, SCHEMA_VERSION, STORE_INDEXES, userVersion } from "./schema.js";
import { connectionOf, createStore } from "./store.js";

export interface OpenStoreOptions {
  /**
   * Create the store when it does not exist. Default `true`. Hooks pass
   * `false` so a repository without Squeal costs a few milliseconds and gets
   * `{ reason: "missing" }` (spec 001 D9).
   */
  readonly create?: boolean;
  /**
   * On the mark a found fault left (`markFault` in
   * `src/core/daemon/store-fault.ts`), or on a corruption error the open
   * itself throws, move the file aside and start a fresh store (spec 001 D12
   * as amended by row 011-391). A daemon's start passes `true`. Default
   * `false`: a corrupt file is reported, never moved, and no mark is read.
   * No check reads the whole store at a start (row 011-391: one took 82.7 s
   * cold on a 4.9 GB store); damage elsewhere is found by the daily full
   * check, which runs in its own process (`src/core/daemon/full-check.ts`,
   * row 011-226), or by the first read or write that hits it, and either
   * marks the store.
   */
  readonly recoverFaults?: boolean;
  /** Busy timeout for this connection. Default `DEFAULT_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /** Clock for the move-aside file name and the recovery note. */
  readonly now?: () => EpochMs;
  /**
   * Row 011-288: makes the store's connection from its open database, so a
   * hook can hold a delivery's transaction until its host has the text.
   * Default `new Connection(db)`.
   */
  readonly connection?: (db: DatabaseSync) => Connection;
  /**
   * Spec 024 D5: this connection never checkpoints at a commit
   * (`wal_autocheckpoint = 0`), so a short write such as a heartbeat never
   * runs a 1,000-page checkpoint under the write lock. Its owner checkpoints
   * outside its transactions (`PassiveCheckpoint`,
   * `src/core/daemon/idle-checkpoint.ts`). The daemon passes `true`.
   */
  readonly managedCheckpoint?: boolean;
}

/** Fits inside the 2 s hook budget (spec 001 D9); the daemon may pass more. */
export const DEFAULT_BUSY_TIMEOUT_MS = 1_000;

/**
 * Spec 021 D4: the WAL file is cut back to this size each time it restarts,
 * where SQLite's default keeps it at its largest. On 2026-11-11 the live WAL
 * of this host's two busiest stores peaked at 6,037 frames (24 MB) in two
 * minutes and restarted many times, while their files stood at 66 and
 * 422 MB. Per connection, so every opener sets it.
 */
export const JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Spec 024 D5: the page cache of each connection, in KiB as SQLite counts a
 * negative `cache_size` (16 MiB, where SQLite's default is 2 MiB), and its
 * temporary tables and sorts in memory, so a large write spills no pages
 * to disk under the write lock.
 */
export const CONNECTION_PRAGMAS = ["PRAGMA cache_size = -16384", "PRAGMA temp_store = MEMORY"];

/**
 * `meta` key written into a fresh store that replaced a corrupt one. Value:
 * JSON `{ at, movedTo, reason }`. Spec 001 D12: "status says the baseline was
 * lost."
 */
export const META_STORE_RECOVERED = "store.recovered";

/**
 * `meta` key of the full check's claim (row 011-226): when the last full
 * `integrity_check` of the store started, as epoch ms. A daemon takes it in
 * a write transaction, so one daemon runs the check in a day.
 */
export const META_FULL_CHECK = "store.full-check";

export function isStoreOpenFailure(value: Store | StoreOpenFailure): value is StoreOpenFailure {
  return "reason" in value;
}

/**
 * Opens `<commonDir>/squeal/store.sqlite` (spec 001 D1, D8): WAL,
 * `synchronous=NORMAL`, a busy timeout, a WAL size limit (spec 021 D4),
 * migrations up to `SCHEMA_VERSION`, then, for an opener that may create
 * the file, the indexes added with no version raise (`STORE_INDEXES`, row
 * 005-103). A newer `user_version` is refused without touching the file.
 */
export function openStore(
  commonDir: AbsolutePath,
  options: OpenStoreOptions = {},
): Store | StoreOpenFailure {
  const paths = storePaths(commonDir);
  if (!existsSync(paths.database)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync(paths.dir, { recursive: true });
  }
  const opened = connect(paths, options);
  if (!("corrupt" in opened)) return opened;
  if (options.recoverFaults !== true) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}

type Connected = Store | StoreOpenFailure | { readonly corrupt: string; readonly mark?: StoreMark };

function connect(paths: StorePaths, options: OpenStoreOptions): Connected {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(paths.database);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout(options)}`);
    const found = userVersion(db);
    if (found > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: SCHEMA_VERSION };
    }
    if (options.recoverFaults === true) {
      // Row 011-226: a found fault's mark moves the store aside as a fault found now does.
      // Row 011-391: only a mark that names this file; one that names another goes.
      dropStaleMark(paths.database);
      const mark = currentMark(paths.database);
      if (mark !== null) {
        db.close();
        return { corrupt: mark.problem, mark };
      }
    }
    // Spec 024 D5: an opener that may not create the file and finds it
    // current, a hook's, reads two pragmas and writes nothing.
    const current = options.create === false && found === SCHEMA_VERSION;
    // Takes effect only before the first table exists, so only on a new file;
    // on any other it still writes the header, under the write lock (task 001-141).
    if (!current && pragmaNumber(db, "page_count") === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    if (!current || journalMode(db) !== "wal") switchToWal(db, busyTimeout(options));
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
    for (const pragma of CONNECTION_PRAGMAS) db.exec(pragma);
    if (options.managedCheckpoint === true) db.exec("PRAGMA wal_autocheckpoint = 0");
    const version = current ? found : migrate(db);
    if (options.create !== false) makeIndexes(db);
    return createStore(options.connection?.(db) ?? new Connection(db), version, paths);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { corrupt: String(error) };
    throw error;
  }
}

/** Each of `STORE_INDEXES` the file lacks, looked for again under the write lock (row 005-103). */
function makeIndexes(db: DatabaseSync): void {
  const found = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  const absent = () =>
    Object.entries(STORE_INDEXES).filter(([name]) => found.get(name) === undefined);
  if (absent().length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [, sql] of absent()) db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

function busyTimeout(options: OpenStoreOptions): number {
  const ms = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`busyTimeoutMs must be >= 0: ${ms}`);
  return ms;
}

/**
 * Switches the file into WAL, retrying while it is busy for up to `ms`. The
 * switch takes a read transaction and then upgrades it to a write one; SQLite
 * skips the busy handler on that upgrade (waiting there could deadlock), so
 * another opener holding the write lock fails it at once (task 001-207). On a
 * file already in WAL it writes nothing.
 */
export function switchToWal(db: DatabaseSync, ms: number): void {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const mode = db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
      if (mode !== "wal") throw new Error(`squeal store: journal_mode is ${String(mode)}, not wal`);
      return;
    } catch (error) {
      if (!isBusy(error) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

function journalMode(db: DatabaseSync): unknown {
  return db.prepare("PRAGMA journal_mode").get()?.journal_mode;
}

function pragmaNumber(db: DatabaseSync, name: string): number {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]);
}

/** SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including extended codes. */
export function isCorruption(error: unknown): boolean {
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === "number" && [11, 26].includes(code & 0xff);
}

/**
 * Moves a corrupt store aside and creates a fresh one. Spec 001 D12: "on
 * failure the file is moved aside, a fresh store is created, status says the
 * baseline was lost."
 *
 * Holds an exclusive lock on `locks/store-recovery.sqlite` and re-checks
 * under it, so two daemons starting together never move a store the other
 * one just created. A mark moves with the file, and the note says what
 * found the fault (`found`, row 011-391): the mark's finder, else this start.
 * A full check's note keeps `check` and `checkedAt` (row 011-226).
 */
function recover(paths: StorePaths, options: OpenStoreOptions): Store | StoreOpenFailure {
  mkdirSync(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync(join(paths.locksDir, RECOVERY_LOCK));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 10_000)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, options);
    if (!("corrupt" in again)) return again;

    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh = connect(paths, { ...options, recoverFaults: false });
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt, ...foundBy(again.mark) });
      fresh.transaction(() => fresh.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh;
  } finally {
    rollback(lock);
    lock.close();
  }
}

/** The recovery note's account of what found the fault. */
function foundBy(mark: StoreMark | undefined): Record<string, unknown> {
  if (mark === undefined) return { found: "start" };
  const found = mark.found ?? "full-check";
  // Row 011-392 (d): a mark cut short has no time and no finder to name.
  if (found === "unknown") return { found };
  if (found === "full-check") return { found, check: "full", checkedAt: mark.at };
  return { found, markedAt: mark.at };
}

function moveAside(database: string, at: EpochMs): string {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  // The WAL belongs to the moved file; the shared-memory index is rebuilt.
  if (existsSync(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync(`${database}-shm`, { force: true });
  if (existsSync(markPath(database))) renameSync(markPath(database), markPath(movedTo));
  return movedTo;
}

/**
 * The database at `path` opened read-only, so no statement can write it and
 * closing it checkpoints nothing: `"missing"` when there is no file, `null`
 * when it cannot be read or is at another schema version than `version`.
 */
export function openReadOnly(path: AbsolutePath, version: number): DatabaseSync | "missing" | null {
  if (!existsSync(path)) return "missing";
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
    if (userVersion(db) === version) return db;
  } catch {
    // An unreadable store is no store to its reader.
  }
  db?.close();
  return null;
}

/**
 * Changes the busy timeout of an open store's connection: a daemon waits
 * longer while it starts than once it serves (task 001-161).
 */
export function setBusyTimeout(store: Store, ms: number): void {
  connectionOf(store).db.exec(`PRAGMA busy_timeout = ${busyTimeout({ busyTimeoutMs: ms })}`);
}

/** Connection settings of an open store, read back from SQLite. For tests and diagnostics. */
export function inspectConnection(store: Store) {
  const db = connectionOf(store).db;
  // The first column holds the value; `busy_timeout` names it `timeout`.
  const pragma = (name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
  return {
    journalMode: pragma("journal_mode"),
    synchronous: pragma("synchronous"),
    busyTimeoutMs: pragma("busy_timeout"),
    cacheSize: pragma("cache_size"),
    tempStore: pragma("temp_store"),
    walAutocheckpoint: pragma("wal_autocheckpoint"),
  };
}
