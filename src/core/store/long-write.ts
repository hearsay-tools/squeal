import { closeSync, openSync, readSync } from "node:fs";
import { endianness } from "node:os";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/*
 * Spec 021 D3: a write transaction that holds a store's write lock longer
 * than `LONG_WRITE_MS` names itself in the daemon log, with its duration and
 * the WAL frames it wrote, so the next contention incident names its holder
 * (`store-contention.md`: daemons' holds of up to 1.2 s that wrote nothing).
 * Only the daemon sets a sink; hooks and commands measure nothing.
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
  /** WAL frames it appended (`mxFrame` of the wal-index); `null` when not read. */
  readonly frames: number | null;
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
  readonly file: string;
  readonly at: number;
  readonly frames: number | null;
}

/** Called once `db`'s `BEGIN IMMEDIATE` returned, so the lock is held. */
export function startWrite(db: DatabaseSync): WriteStart | null {
  if (sink === null) return null;
  const file = fileOf(db);
  return { file, at: performance.now(), frames: walFrames(file) };
}

/** Called once the transaction `start` began ended; past `LONG_WRITE_MS`, tells the sink. */
export function endWrite(start: WriteStart | null): void {
  if (start === null || sink === null) return;
  const ms = performance.now() - start.at;
  if (ms <= LONG_WRITE_MS) return;
  const after = walFrames(start.file);
  // The lock was held throughout, so only this transaction restarted the WAL when it shrank.
  const frames =
    after === null || start.frames === null
      ? null
      : after >= start.frames
        ? after - start.frames
        : after;
  sink({
    database: basename(start.file),
    operation: operationOf(new Error().stack ?? ""),
    ms: Math.round(ms),
    frames,
  });
}

/** The daemon log's line for `write`. */
export function longWriteLine(write: LongWrite): string {
  const frames =
    write.frames === null
      ? "WAL frames written not known"
      : `${write.frames} WAL ${write.frames === 1 ? "frame" : "frames"} written`;
  const database = write.database === "" ? "a database in memory" : write.database;
  return `long write: ${database} write lock held ${write.ms} ms by ${write.operation}; ${frames}`;
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

/** `mxFrame` at offset 16 of the wal-index header, in the host's byte order; `null` when unread. */
function walFrames(file: string): number | null {
  if (file === "") return null;
  let fd: number | undefined;
  try {
    fd = openSync(`${file}-shm`, "r");
    const buffer = Buffer.alloc(4);
    if (readSync(fd, buffer, 0, 4, 16) !== 4) return null;
    return endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
  } catch {
    // No wal-index (a store not in WAL, or one just closed): the line says frames are not known.
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
