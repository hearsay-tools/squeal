import type { EpochMs, RevisionNumber, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Row 011-325 (spec 011 `research/request-intake.md`, "Covered files"):
 * each request's covered files as the scheduler decided them when it took
 * the request, keyed by a request id, written in the transaction that
 * queues them, so one read sees both. A wait reads them by the id in the
 * daemon's answer (`readCoveredFiles`), never a raw row.
 *
 * An additive main-store table, made by the first write, with no
 * `user_version` raise: an older daemon sharing the store opens it as
 * before and never reads it. No key reads it, so it lives outside
 * `schema.ts`, which the key-format alarm bundles (the pattern of
 * `IMPORT_TABLES`).
 *
 * - `request_covered_files`: by request id, the worktree and revision the
 *   request was taken at, when, its files as JSON (`CoveredFile[]`), and
 *   `idle_since`: the time its retention counts from, `NULL` while a write
 *   found one of its files queued or running (`idleSince`).
 */
export const COVERED_FILES_TABLE = "request_covered_files";

const TABLE_SQL = `
CREATE TABLE request_covered_files (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  idle_since INTEGER,
  files TEXT NOT NULL
) STRICT;
CREATE INDEX request_covered_files_by_worktree ON request_covered_files (worktree_id, idle_since);
`;

/**
 * Condition 3 of the agreement with card 3: a record is kept while any of
 * its files is queued or running, and at least this long after. A bare
 * `--wait` has no deadline, so the bound is the time a wait needs to read
 * the end it waited for, not the wait's own.
 */
export const COVERED_FILES_KEPT_MS = 10 * 60_000;

/** One covered file, as the scheduler decided it when it took the request. */
export type CoveredFile =
  /** Queued by the request, or found queued or running. */
  | { readonly testFile: TestFileRef; readonly state: "queued" }
  /** A result stands at its key. */
  | { readonly testFile: TestFileRef; readonly state: "current" }
  /** Neither: why, as the scheduler knew it (an install wait, a runner failure, no key). */
  | { readonly testFile: TestFileRef; readonly state: "not-queued"; readonly reason: string };

/** What the scheduler knows of the files now, for the prune (`writeCoveredFiles`). */
export interface CoveredActivity {
  /** Whether the scheduler lists `testFile` now. */
  listed(testFile: TestFileRef): boolean;
  /** Whether `testFile` is queued or running now. */
  pending(testFile: TestFileRef): boolean;
  /** When `testFile` last left queued or running, as far as known; `null`: not known to have. */
  leftAt(testFile: TestFileRef): EpochMs | null;
  /**
   * Exits before it are not known (a daemon handoff: the earlier daemon saw
   * them): a record idle before it counts as idle from it.
   */
  readonly knownSince: EpochMs;
}

/** A request's covered files (`readCoveredFiles`). */
export interface CoveredFiles {
  /** The request id the daemon's answer carries (`coveredId`). */
  readonly id: string;
  readonly worktreeId: WorktreeId;
  /** The worktree's revision when the scheduler took the request. */
  readonly revision: RevisionNumber;
  readonly recordedAt: EpochMs;
  readonly files: readonly CoveredFile[];
}

/**
 * Writes `record`, inside the caller's transaction (the request's own). The
 * worktree's older records are pruned first, each by what `activity` says
 * of its files now (`idleSince`): one with a file queued or running is
 * kept and counts as idle again only once none is; one idle for
 * `COVERED_FILES_KEPT_MS` after the latest known exit of its files is
 * deleted (review 0.1.478, B1). A store `openStore` did not open (a test's
 * fake) records nothing.
 */
export function writeCoveredFiles(
  store: Store,
  record: CoveredFiles,
  activity: CoveredActivity,
): void {
  const conn = connection(store);
  if (conn === null) return;
  if (!hasTable(conn)) conn.db.exec(TABLE_SQL);
  const now = record.recordedAt;
  const rows = conn.all(
    `SELECT id, recorded_at, idle_since, files FROM ${COVERED_FILES_TABLE} WHERE worktree_id = ?`,
    record.worktreeId,
  );
  for (const row of rows) {
    const id = String(row.id);
    const was = row.idle_since === null ? null : Number(row.idle_since);
    const files = parseFiles(row.files);
    const idle = idleSince(files, was, Number(row.recorded_at), now, activity);
    if (idle !== null && idle <= now - COVERED_FILES_KEPT_MS) {
      conn.run(`DELETE FROM ${COVERED_FILES_TABLE} WHERE id = ?`, id);
    } else if (idle !== was) {
      conn.run(`UPDATE ${COVERED_FILES_TABLE} SET idle_since = ? WHERE id = ?`, idle, id);
    }
  }
  conn.run(
    `INSERT INTO ${COVERED_FILES_TABLE} (id, worktree_id, revision, recorded_at, idle_since, files)
     VALUES (?, ?, ?, ?, ?, ?)`,
    record.id,
    record.worktreeId,
    record.revision,
    now,
    idleSince(record.files, null, now, now, activity),
    JSON.stringify(record.files),
  );
}

/**
 * Condition 3: when a record of `files`, written at `recordedAt`, counts
 * as idle from; `null` while one of them is queued or running. Otherwise
 * the latest of: `was`, the time a write gave it (`recordedAt` before
 * any); each file's last exit, also one that began and ended between two
 * writes; and `knownSince`. A record a write last found busy with a file
 * the scheduler lists no more counts from `now`: that file's exit is not
 * held anywhere and came no later.
 */
function idleSince(
  files: readonly CoveredFile[],
  was: EpochMs | null,
  recordedAt: EpochMs,
  now: EpochMs,
  activity: CoveredActivity,
): EpochMs | null {
  if (files.some((file) => activity.pending(file.testFile))) return null;
  if (was === null && files.some((file) => !activity.listed(file.testFile))) return now;
  let idle = Math.max(was ?? recordedAt, activity.knownSince);
  for (const file of files) idle = Math.max(idle, activity.leftAt(file.testFile) ?? idle);
  return idle;
}

/**
 * Row 011-325: the reader. The covered files of request `id` as the
 * scheduler decided them; `null` when the store holds no such record (an
 * older daemon wrote none, or it was pruned) or was not opened by
 * `openStore`. A file entry this release cannot read is left out.
 */
export function readCoveredFiles(store: Store, id: string): CoveredFiles | null {
  const conn = connection(store);
  if (conn === null || !hasTable(conn)) return null;
  const row = conn.get(`SELECT * FROM ${COVERED_FILES_TABLE} WHERE id = ?`, id);
  if (row === null) return null;
  return {
    id,
    worktreeId: String(row.worktree_id),
    revision: Number(row.revision),
    recordedAt: Number(row.recorded_at),
    files: parseFiles(row.files),
  };
}

function connection(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}

function hasTable(conn: Connection): boolean {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?";
  return conn.get(sql, COVERED_FILES_TABLE) !== null;
}

function parseFiles(text: unknown): CoveredFile[] {
  let value: unknown;
  try {
    value = JSON.parse(String(text));
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(isCoveredFile) : [];
}

function isCoveredFile(value: unknown): value is CoveredFile {
  if (typeof value !== "object" || value === null) return false;
  const { testFile, state, reason } = value as Record<string, unknown>;
  if (typeof testFile !== "object" || testFile === null) return false;
  const { project, path } = testFile as Record<string, unknown>;
  if (typeof project !== "string" || typeof path !== "string") return false;
  if (state === "queued" || state === "current") return true;
  return state === "not-queued" && typeof reason === "string";
}
