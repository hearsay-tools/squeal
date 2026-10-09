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
  };
}

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
