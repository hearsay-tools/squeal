import { basename } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

/*
 * Spec 021 D3: a write transaction that holds a store's write lock longer
 * than `LONG_WRITE_MS` names itself in the daemon log, with its duration and
 * the rows it wrote, so the next contention incident names its holder
 * (`store-contention.md`: daemons' holds of up to 1.2 s that wrote nothing).
 * Only the daemon sets a sink; hooks and commands measure nothing.
 *
 * Rows, not WAL frames: the frame count is in the `-shm` file, and a
 * process that opens and closes its own descriptor of that file drops every
 * POSIX lock SQLite holds on it there, the write lock and the one that
 * tells other openers the wal-index is in use. A daemon that read it died
 * of SIGBUS once another opener rebuilt the file under its mapping. A hold
 * that wrote nothing has 0 rows as it has 0 frames.
 */

/** A write transaction held longer than this writes one log line. */
export const LONG_WRITE_MS = 250;

/** A write transaction that held its lock longer than `LONG_WRITE_MS`. */
export interface LongWrite {
  /** The database file's name, such as `store.sqlite` or `code.sqlite`; `""` in memory. */
  readonly database: string;
  /** Its nearest callers outside the store layer, nearest first, as the stack names them. */
  readonly operation: string;
  /** From `BEGIN IMMEDIATE` returning to its `COMMIT` or `ROLLBACK` returning. */
  readonly ms: number;
  /** Rows it inserted, updated or deleted (`total_changes()`), the rolled back ones too. */
  readonly rows: number;
}

type Sink = (write: LongWrite) => void;

/** Per thread, since each worker thread loads its own copy of this module. */
let sink: Sink | null = null;

/** Sends this thread's long writes to `to` (the daemon's log) until the returned function runs. */
export function logLongWrites(to: Sink): () => void {
  sink = to;
  return () => {
    if (sink === to) sink = null;
  };
}

/** A write transaction's start, for `endWrite`; `null` while no sink is set. */
export interface WriteStart {
  readonly db: DatabaseSync;
  readonly at: number;
  readonly changes: number;
}

/** Called once `db`'s `BEGIN IMMEDIATE` returned, so the lock is held. */
export function startWrite(db: DatabaseSync): WriteStart | null {
  if (sink === null) return null;
  return { db, at: performance.now(), changes: totalChanges(db) };
}

/** Called once the transaction `start` began ended; past `LONG_WRITE_MS`, tells the sink. */
export function endWrite(start: WriteStart | null): void {
  if (start === null || sink === null) return;
  const ms = performance.now() - start.at;
  if (ms <= LONG_WRITE_MS) return;
  sink({
    database: basename(fileOf(start.db)),
    operation: operationOf(new Error().stack ?? ""),
    ms: Math.round(ms),
    rows: totalChanges(start.db) - start.changes,
  });
}

/** The daemon log's line for `write`. */
export function longWriteLine(write: LongWrite): string {
  const rows = `${write.rows} ${write.rows === 1 ? "row" : "rows"} written`;
  const database = write.database === "" ? "a database in memory" : write.database;
  return `long write: ${database} write lock held ${write.ms} ms by ${write.operation}; ${rows}`;
}

/** Frames of the store layer's own transaction code, skipped to reach the operation. */
const STORE_FRAME = /^(?:\w*Connection\d*\.|Object\.transaction$|transaction$|endWrite$)/;

/** The nearest three callers outside the store layer in `stack`, nearest first; `unknown` with none. */
export function operationOf(stack: string): string {
  const names = stack
    .split("\n")
    .slice(1)
    .map(frameName)
    .filter((name): name is string => name !== null && !STORE_FRAME.test(name));
  return names.slice(0, 3).join(" < ") || "unknown";
}

/** A stack line's function name, or `file:line` for one without a name. */
function frameName(line: string): string | null {
  const match = /^\s*at (?:async )?(.+?)(?: \((.+)\))?$/.exec(line);
  if (match === null) return null;
  const [, name = "", location] = match;
  if (location !== undefined) return name;
  const place = /([^/\\]+):(\d+):\d+$/.exec(name);
  return place === null ? name : `${place[1]}:${place[2]}`;
}

const files = new WeakMap<DatabaseSync, string>();

/** `db`'s main database file, `""` in memory. */
function fileOf(db: DatabaseSync): string {
  let file = files.get(db);
  if (file === undefined) {
    const rows = db.prepare("PRAGMA database_list").all() as { name?: unknown; file?: unknown }[];
    const main = rows.find((row) => row.name === "main")?.file;
    file = typeof main === "string" ? main : "";
    files.set(db, file);
  }
  return file;
}

const counters = new WeakMap<DatabaseSync, StatementSync>();

/** The rows `db` changed since it opened; one cached statement per connection. */
function totalChanges(db: DatabaseSync): number {
  let statement = counters.get(db);
  if (statement === undefined) {
    statement = db.prepare("SELECT total_changes() AS n");
    counters.set(db, statement);
  }
  return Number(statement.get()?.n);
}
