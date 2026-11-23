import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { AbsolutePath, RelativePath, WorktreeId } from "../types/common.js";
import { slotFiles } from "./slot-files.js";

/*
 * Rows 023-77 and 023-78 (round 10 Z1, Z2): a permit's lock file records
 * the files its holder runs, beside the holder row `takePermit` writes. The
 * record is its own table, `holding`, stamped with the holder row's pid and
 * `since`: a daemon of an older release takes the permit, rewrites only the
 * holder row and leaves `holding` as it was, so a record whose stamp is not
 * the holder row's is an earlier holder's and is not read. A lock file
 * without the table (written before this row) reads as a holder with no
 * files.
 */

/** One file a holder runs under the slot: its project and path, and its stored duration then. */
export interface SlotFile {
  readonly project: string;
  readonly path: RelativePath;
  /** The file's last known run time at its key when the run started; `null` when none. */
  readonly durationMs: number | null;
}

/** A permit's holder as its lock file last recorded it, held now or not. */
export interface SlotHolderRecord {
  readonly pid: number;
  readonly worktreeId: WorktreeId;
  /** When it took the permit. */
  readonly since: number;
  /** What it ran under the permit, when its daemon recorded it (`recordHolding`). */
  readonly files?: readonly SlotFile[];
}

/**
 * Records `files` as what the holder of the permit open in `db` runs. `db`
 * holds the permit's exclusive lock (`takePermit`), so no reader sees the
 * write half made. Best effort: a failure leaves the record without files.
 */
export function recordHolding(db: DatabaseSync, files: readonly SlotFile[]): void {
  try {
    const holder = db.prepare("SELECT pid, since FROM holder LIMIT 1").get();
    if (holder === undefined) return;
    db.exec("BEGIN");
    db.exec(
      "CREATE TABLE IF NOT EXISTS holding (pid INTEGER NOT NULL, since INTEGER NOT NULL, files TEXT NOT NULL)",
    );
    db.exec("DELETE FROM holding");
    db.prepare("INSERT INTO holding (pid, since, files) VALUES (?, ?, ?)").run(
      holder.pid as number,
      holder.since as number,
      JSON.stringify(files),
    );
    db.exec("COMMIT");
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No transaction was open.
    }
  }
}

/**
 * The files the `holding` table of `db` records for the holder `pid` that
 * took the permit at `since`; `undefined` when it has none for that holder
 * (no table, an earlier holder's record, or a row that does not parse).
 */
export function holdingOf(db: DatabaseSync, pid: number, since: number): SlotFile[] | undefined {
  let row: Record<string, unknown> | undefined;
  try {
    row = db.prepare("SELECT pid, since, files FROM holding LIMIT 1").get();
  } catch {
    return undefined;
  }
  if (row === undefined || row.pid !== pid || row.since !== since) return undefined;
  if (typeof row.files !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(row.files);
    return Array.isArray(parsed) && parsed.every(isSlotFile) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSlotFile(value: unknown): value is SlotFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const duration = v.durationMs === null || typeof v.durationMs === "number";
  return typeof v.project === "string" && typeof v.path === "string" && duration;
}

/**
 * Row 023-78: each of `group`'s first `permits` permits in `dir` whose lock
 * file records a holder, the last one whether it holds the permit now or
 * not. Read through SQLite's `immutable` URI, taking no lock, as
 * `heldPermits` reads a held one; a file being written as it is read, or
 * one that is not a database, records none. Never creates a file.
 */
export function lastHolders(
  dir: AbsolutePath,
  group: string | undefined,
  permits: number,
): SlotHolderRecord[] {
  const files = slotFiles(group);
  const records: SlotHolderRecord[] = [];
  for (let i = 0; i < Math.max(1, permits); i++) {
    const path = join(dir, files.permit(i));
    if (!existsSync(path)) continue;
    const record = readRecord(path);
    if (typeof record !== "string") records.push(record);
  }
  return records;
}

/**
 * The holder row of the lock file `path` with its files, read without a
 * lock (row 011-58's reading): `missing` when it records no holder,
 * `unreadable` when the file or its row does not read as one.
 */
export function readRecord(path: AbsolutePath): SlotHolderRecord | "missing" | "unreadable" {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(immutableUrl(path), { readOnly: true });
  } catch {
    return "unreadable";
  }
  try {
    const row = db.prepare("SELECT pid, worktree_id, since FROM holder LIMIT 1").get();
    if (row === undefined) return "missing";
    const { pid, worktree_id: worktreeId, since } = row;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(since)) return "unreadable";
    if (typeof worktreeId !== "string") return "unreadable";
    const files = holdingOf(db, pid as number, since as number);
    return {
      pid: pid as number,
      worktreeId: worktreeId as WorktreeId,
      since: since as number,
      ...(files === undefined ? {} : { files }),
    };
  } catch (error) {
    return String(error).includes("no such table") ? "missing" : "unreadable";
  } finally {
    db.close();
  }
}

/** SQLite's `immutable` URI of the database `path`: a reader of it takes no lock and opens no other file. */
export function immutableUrl(path: AbsolutePath): URL {
  const url = pathToFileURL(path);
  url.search = "immutable=1";
  return url;
}
