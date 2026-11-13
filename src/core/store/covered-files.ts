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
 *   `idle_since`: when a write first found none of its files queued or
 *   running (`NULL` until then).
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
 * worktree's older records are pruned first: one none of whose files
 * `pending` says is queued or running is marked idle, and one idle for
 * `COVERED_FILES_KEPT_MS` is deleted. A store `openStore` did not open (a
 * test's fake) records nothing.
 */
export function writeCoveredFiles(
  store: Store,
  record: CoveredFiles,
  pending: (testFile: TestFileRef) => boolean,
): void {
  const conn = connection(store);
  if (conn === null) return;
  if (!hasTable(conn)) conn.db.exec(TABLE_SQL);
  const now = record.recordedAt;
  const open = conn.all(
    `SELECT id, files FROM ${COVERED_FILES_TABLE} WHERE worktree_id = ? AND idle_since IS NULL`,
    record.worktreeId,
  );
  for (const row of open) {
    if (parseFiles(row.files).some((file) => pending(file.testFile))) continue;
    conn.run(`UPDATE ${COVERED_FILES_TABLE} SET idle_since = ? WHERE id = ?`, now, String(row.id));
  }
  conn.run(
    `DELETE FROM ${COVERED_FILES_TABLE} WHERE worktree_id = ? AND idle_since <= ?`,
    record.worktreeId,
    now - COVERED_FILES_KEPT_MS,
  );
  const busy = record.files.some((file) => pending(file.testFile));
  conn.run(
    `INSERT INTO ${COVERED_FILES_TABLE} (id, worktree_id, revision, recorded_at, idle_since, files)
     VALUES (?, ?, ?, ?, ?, ?)`,
    record.id,
    record.worktreeId,
    record.revision,
    now,
    busy ? null : now,
    JSON.stringify(record.files),
  );
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
