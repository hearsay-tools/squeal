import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AbsolutePath, EpochMs, Store, StoreOpenFailure } from "../types/index.js";
import { Connection, isBusy, rollback } from "./connection.js";
import { type StorePaths, storePaths } from "./paths.js";
import { migrate, SCHEMA_VERSION, userVersion } from "./schema.js";
import { connectionOf, createStore } from "./store.js";

export interface OpenStoreOptions {
  /**
   * Create the store when it does not exist. Default `true`. Hooks pass
   * `false` so a repository without Squeal costs a few milliseconds and gets
   * `{ reason: "missing" }` (spec 001 D9).
   */
  readonly create?: boolean;
  /**
   * Run `PRAGMA integrity_check` and, on failure, move the file aside and
   * start a fresh store (spec 001 D12). For daemon start; too slow for hooks.
   * Default `false`: a corrupt file is reported, never moved.
   */
  readonly checkIntegrity?: boolean;
  /** Busy timeout for this connection. Default `DEFAULT_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /** Clock for the move-aside file name and the recovery note. */
  readonly now?: () => EpochMs;
}

/** Fits inside the 2 s hook budget (spec 001 D9); the daemon may pass more. */
export const DEFAULT_BUSY_TIMEOUT_MS = 1_000;

/**
 * `meta` key written into a fresh store that replaced a corrupt one. Value:
 * JSON `{ at, movedTo, reason }`. Spec 001 D12: "status says the baseline was
 * lost."
 */
export const META_STORE_RECOVERED = "store.recovered";

export function isStoreOpenFailure(value: Store | StoreOpenFailure): value is StoreOpenFailure {
  return "reason" in value;
}

/**
 * Opens `<commonDir>/squeal/store.sqlite` (spec 001 D1, D8): WAL,
 * `synchronous=NORMAL`, a busy timeout, and migrations up to
 * `SCHEMA_VERSION`. A newer `user_version` is refused without touching the
 * file.
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
  if (options.checkIntegrity !== true) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}

type Connected = Store | StoreOpenFailure | { readonly corrupt: string };

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
    if (options.checkIntegrity === true) {
      const problem = integrityProblem(db);
      if (problem !== null) {
        db.close();
        return { corrupt: problem };
      }
    }
    // Takes effect only before the first table exists, so only on a new file;
    // on any other it still writes the header, under the write lock (task 001-141).
    if (pragmaNumber(db, "page_count") === 0) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    switchToWal(db, busyTimeout(options));
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db);
    return createStore(new Connection(db), version, paths);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { corrupt: String(error) };
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
function switchToWal(db: DatabaseSync, ms: number): void {
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

function pragmaNumber(db: DatabaseSync, name: string): number {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]);
}

function integrityProblem(db: DatabaseSync): string | null {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const messages = rows.map((row) => String(row.integrity_check));
  return messages.length === 1 && messages[0] === "ok" ? null : messages.join("; ");
}

/** SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including extended codes. */
function isCorruption(error: unknown): boolean {
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
 * one just created.
 */
function recover(paths: StorePaths, options: OpenStoreOptions): Store | StoreOpenFailure {
  mkdirSync(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync(join(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 10_000)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: true });
    if (!("corrupt" in again)) return again;

    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh = connect(paths, { ...options, checkIntegrity: false });
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt });
      fresh.transaction(() => fresh.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh;
  } finally {
    rollback(lock);
    lock.close();
  }
}

function moveAside(database: string, at: EpochMs): string {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  // The WAL belongs to the moved file; the shared-memory index is rebuilt.
  if (existsSync(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync(`${database}-shm`, { force: true });
  return movedTo;
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
  };
}
