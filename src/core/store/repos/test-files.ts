import type {
  CheckRecord,
  CheckRepo,
  RelativePath,
  TestFileKeyRecord,
  TestFileKeyRepo,
  TestFileRecord,
  TestFileRepo,
} from "../../types/index.js";
import {
  bool,
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  flag,
  json,
  location,
  locationParams,
  num,
  oneOf,
  oneOfOrNull,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

const METHODS = ["static imports plus declared inputs"] as const;
const PENDING = ["queued", "running"] as const;

export function createTestFileRepo(conn: Connection): TestFileRepo {
  return {
    get: (testFile) => {
      const row = conn.get(
        "SELECT * FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path,
      );
      return row === null ? null : toTestFile(row);
    },
    list: () => conn.all("SELECT * FROM test_files ORDER BY project, path").map(toTestFile),
    put: (record) => {
      conn.run(
        `INSERT OR REPLACE INTO test_files
           (project, path, closure_paths, complete, method, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.testFile.project,
        record.testFile.path,
        JSON.stringify(record.closure.paths),
        flag(record.closure.complete),
        record.closure.method,
        record.updatedAt,
        record.updatedBy,
      );
    },
    remove: (testFile) => {
      conn.run(
        "DELETE FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path,
      );
    },
  };
}

function toTestFile(row: Row): TestFileRecord {
  const testFile = { project: str(row, "project"), path: str(row, "path") };
  return {
    testFile,
    closure: {
      testFile,
      paths: json<RelativePath[]>(row, "closure_paths"),
      complete: bool(row, "complete"),
      method: oneOf(row, "method", METHODS),
    },
    updatedAt: num(row, "updated_at"),
    updatedBy: str(row, "updated_by"),
  };
}

export function createTestFileKeyRepo(conn: Connection): TestFileKeyRepo {
  return {
    list: (worktreeId) =>
      conn
        .all(
          "SELECT * FROM test_file_keys WHERE worktree_id = ? ORDER BY project, path",
          worktreeId,
        )
        .map(toTestFileKey),
    withKey: (key) =>
      conn
        .all("SELECT * FROM test_file_keys WHERE key = ? ORDER BY worktree_id, project, path", key)
        .map(toTestFileKey),
    upsertMany: (records) =>
      conn.transaction(() => {
        for (const r of records) {
          conn.run(
            `INSERT OR REPLACE INTO test_file_keys
               (worktree_id, project, path, key, revision, pending)
             VALUES (?, ?, ?, ?, ?, ?)`,
            r.worktreeId,
            r.testFile.project,
            r.testFile.path,
            r.key,
            r.revision,
            r.pending,
          );
        }
      }),
    remove: (worktreeId, testFiles) =>
      conn.transaction(() => {
        for (const t of testFiles) {
          conn.run(
            "DELETE FROM test_file_keys WHERE worktree_id = ? AND project = ? AND path = ?",
            worktreeId,
            t.project,
            t.path,
          );
        }
      }),
    releaseRunning: (worktreeId) => {
      conn.run(
        "UPDATE test_file_keys SET pending = 'queued' WHERE worktree_id = ? AND pending = 'running'",
        worktreeId,
      );
    },
    claimed: (worktreeId, key, live) =>
      conn.get(
        `SELECT 1 AS one FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
         WHERE k.key = ? AND k.pending = 'running' AND k.worktree_id <> ? AND ${LIVE} LIMIT 1`,
        key,
        worktreeId,
        live.now,
        live.graceIntervals,
      ) !== null,
    sharers: (worktreeId, live) => {
      const row = conn.get(
        `SELECT COUNT(DISTINCT k.worktree_id) AS n FROM test_file_keys own
         JOIN test_file_keys k ON k.key = own.key AND k.worktree_id <> own.worktree_id
         JOIN worktrees w ON w.id = k.worktree_id
         WHERE own.worktree_id = ? AND own.pending = 'queued' AND k.pending IS NOT NULL AND ${LIVE}`,
        worktreeId,
        live.now,
        live.graceIntervals,
      );
      return row === null ? 0 : num(row, "n");
    },
  };
}

/**
 * The daemon of worktree row `w` heartbeats: a socket and a heartbeat within
 * the grace (task 001-205). Binds `now`, then the grace in intervals.
 */
const LIVE = `w.daemon_socket IS NOT NULL
  AND w.daemon_heartbeat_at >= ? - ? * w.daemon_heartbeat_interval_ms`;

function toTestFileKey(row: Row): TestFileKeyRecord {
  return {
    worktreeId: str(row, "worktree_id"),
    testFile: { project: str(row, "project"), path: str(row, "path") },
    key: strOrNull(row, "key"),
    revision: num(row, "revision"),
    pending: oneOfOrNull(row, "pending", PENDING),
  };
}

export function createCheckRepo(conn: Connection): CheckRepo {
  return {
    listByTestFile: (testFile) =>
      conn
        .all(
          `SELECT c.*, ${CHECK_COLUMNS} FROM checks c WHERE c.project = ? AND c.test_path = ?
           ORDER BY c.kind, c.full_name`,
          testFile.project,
          testFile.path,
        )
        .map(toCheck),
    upsertMany: (records) =>
      conn.transaction(() => {
        for (const r of records) {
          // Keeps first_seen_at of a check that is already known.
          const id = ensureCheckId(conn, r.check, r.firstSeenAt);
          conn.run(
            `UPDATE checks SET location_path = ?, location_line = ?, location_column = ?,
               templated = ? WHERE id = ?`,
            ...locationParams(r.location),
            flag(r.templated),
            id,
          );
        }
      }),
  };
}

function toCheck(row: Row): CheckRecord {
  return {
    check: checkFrom(row),
    location: location(row),
    templated: bool(row, "templated"),
    firstSeenAt: num(row, "first_seen_at"),
  };
}
