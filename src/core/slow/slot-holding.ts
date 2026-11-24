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
export function recordHolding(
  db: DatabaseSync,
  files: readonly SlotFile[],
  at: number = Date.now(),
): void {
  try {
    const holder = db.prepare("SELECT pid, worktree_id, since FROM holder LIMIT 1").get();
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
    appendRan(db, holder.worktree_id, files, at);
    db.exec("COMMIT");
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No transaction was open.
    }
  }
}

/*
 * Row 023-83 (round 11, AA2): the `ran` table keeps, beside the last
 * holder's files, every file a holder ran under the permit, by its worktree
 * and when, the newest `RAN_KEPT`. A side that takes the slot follows the
 * file its partner ran first, not the latest (`followPartner`), so the
 * first file the leader ran is the first compared, however late the
 * follower came.
 */

/** The `ran` rows a lock file keeps, the newest. */
const RAN_KEPT = 256;

/** How long a run counts for a follower: a commit daemon's longest life (spec 023 D7.2). */
export const RAN_FRESH_MS = 3 * 60 * 60_000;

/** One file another worktree ran under the slot, and when its run started. */
export interface SlotRun {
  readonly worktreeId: WorktreeId;
  readonly project: string;
  readonly path: RelativePath;
  readonly at: number;
}

function appendRan(
  db: DatabaseSync,
  worktreeId: unknown,
  files: readonly SlotFile[],
  at: number,
): void {
  if (typeof worktreeId !== "string") return;
  db.exec(
    "CREATE TABLE IF NOT EXISTS ran (seq INTEGER PRIMARY KEY, worktree_id TEXT NOT NULL, project TEXT NOT NULL, path TEXT NOT NULL, at INTEGER NOT NULL)",
  );
  const insert = db.prepare("INSERT INTO ran (worktree_id, project, path, at) VALUES (?, ?, ?, ?)");
  for (const file of files) insert.run(worktreeId, file.project, file.path, at);
  db.prepare("DELETE FROM ran WHERE seq <= (SELECT MAX(seq) FROM ran) - ?").run(RAN_KEPT);
}

/**
 * Row 023-83: the runs `group`'s first `permits` permits in `dir` record of
 * worktrees other than `own` since `now - RAN_FRESH_MS`, each file once at
 * its first run, the first run first. Read as `lastHolders` reads, with no
 * lock; a lock file without the table (an older release's) records none.
 */
export function partnerRuns(
  dir: AbsolutePath,
  group: string | undefined,
  permits: number,
  own: WorktreeId,
  now: number = Date.now(),
): SlotRun[] {
  const files = slotFiles(group);
  const first = new Map<string, SlotRun>();
  for (let i = 0; i < Math.max(1, permits); i++) {
    const path = join(dir, files.permit(i));
    if (!existsSync(path)) continue;
    for (const run of ranOf(path, own, now - RAN_FRESH_MS)) {
      const id = `${run.project}\0${run.path}`;
      const known = first.get(id);
      if (known === undefined || run.at < known.at) first.set(id, run);
    }
  }
  return [...first.values()].sort((a, b) => a.at - b.at);
}

function ranOf(path: AbsolutePath, own: WorktreeId, since: number): SlotRun[] {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(immutableUrl(path), { readOnly: true });
  } catch {
    return [];
  }
  try {
    const rows = db
      .prepare(
        "SELECT worktree_id, project, path, at FROM ran WHERE worktree_id != ? AND at >= ? ORDER BY seq",
      )
      .all(own, since);
    return rows.flatMap((row) =>
      typeof row.worktree_id === "string" &&
      typeof row.project === "string" &&
      typeof row.path === "string" &&
      typeof row.at === "number"
        ? [
            {
              worktreeId: row.worktree_id as WorktreeId,
              project: row.project,
              path: row.path as RelativePath,
              at: row.at,
            },
          ]
        : [],
    );
  } catch {
    return [];
  } finally {
    db.close();
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
