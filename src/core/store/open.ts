import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
   * Run `PRAGMA quick_check` and, on failure or on the mark a failed full
   * check left (`markStore`), move the file aside and start a fresh store
   * (spec 001 D12). A daemon's start runs it (row 011-226); too slow for
   * hooks. Default none: a corrupt file is reported, never moved.
   */
  readonly checkIntegrity?: IntegrityCheck;
  /** Busy timeout for this connection. Default `DEFAULT_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /** Clock for the move-aside file name and the recovery note. */
  readonly now?: () => EpochMs;
}

/**
 * `quick`: SQLite's `quick_check`, which skips UNIQUE constraints and whether
 * index content matches table content, 1.6 s on an 850 MB store, where
 * `integrity_check` takes 24 s (row 011-223). The full `integrity_check`
 * runs in its own process (`src/core/daemon/full-check.ts`, row 011-226).
 */
export type IntegrityCheck = "quick";

/** Fits inside the 2 s hook budget (spec 001 D9); the daemon may pass more. */
export const DEFAULT_BUSY_TIMEOUT_MS = 1_000;

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

/** What a failed full check left beside the store: when it ended and what it found. */
export interface StoreMark {
  readonly at: EpochMs;
  readonly problem: string;
}

/**
 * Row 011-226: marks the store as failing its full check. Every daemon on it
 * exits at its next heartbeat, and the next checked open moves it aside.
 */
export function markStore(commonDir: AbsolutePath, mark: StoreMark): void {
  writeFileSync(markPath(storePaths(commonDir).database), JSON.stringify(mark));
}

/** The mark a failed full check left beside the store; `null` with none. */
export function readStoreMark(commonDir: AbsolutePath): StoreMark | null {
  return readMark(markPath(storePaths(commonDir).database));
}

function markPath(database: string): string {
  return `${database}.check-failed`;
}

function readMark(path: string): StoreMark | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const { at, problem } = JSON.parse(text) as Partial<StoreMark>;
    if (typeof at === "number" && typeof problem === "string") return { at, problem };
  } catch {
    // A mark cut short still marks the store.
  }
  return { at: 0, problem: "the full integrity check failed" };
}

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
  if (options.checkIntegrity === undefined) return { reason: "corrupt", movedTo: null };
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
    if (options.checkIntegrity !== undefined) {
      // Row 011-226: a failed full check's mark moves the store aside as a fault found now does.
      const mark = readMark(markPath(paths.database));
      if (mark !== null) {
        db.close();
        return { corrupt: mark.problem, mark };
      }
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

function pragmaNumber(db: DatabaseSync, name: string): number {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]);
}

function integrityProblem(db: DatabaseSync): string | null {
  const rows = db.prepare("PRAGMA quick_check").all();
  const messages = rows.map((row) => String(row.quick_check));
  return messages.length === 1 && messages[0] === "ok" ? null : messages.join("; ");
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
 * one just created. A failed full check's mark moves with the file, and the
 * note says the full check found the fault (row 011-226).
 */
function recover(paths: StorePaths, options: OpenStoreOptions): Store | StoreOpenFailure {
  mkdirSync(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync(join(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 10_000)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: options.checkIntegrity ?? "quick" });
    if (!("corrupt" in again)) return again;

    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const { checkIntegrity: _, ...unchecked } = options;
    const fresh = connect(paths, unchecked);
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const full = again.mark === undefined ? {} : { check: "full", checkedAt: again.mark.at };
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt, ...full });
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
  if (existsSync(markPath(database))) renameSync(markPath(database), markPath(movedTo));
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
