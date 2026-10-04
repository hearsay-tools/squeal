import { createHash } from "node:crypto";
import type { CheckError, ResultRecord, ResultRepo } from "../../types/index.js";
import {
  bool,
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  findCheckId,
  flag,
  json,
  location,
  locationParams,
  num,
  oneOf,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

const OUTCOMES = ["pass", "fail", "skip"] as const;

const SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;

export function createResultRepo(conn: Connection): ResultRepo {
  return {
    byKey: (key, usedAt = Date.now()) => {
      conn.run(
        "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
        usedAt,
        key,
        usedAt,
      );
      return conn
        .all(
          `${SELECT_RESULTS} WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          key,
        )
        .map(toResult);
    },
    checksForKey: (key) =>
      conn
        .all(
          `SELECT ${CHECK_COLUMNS} FROM results r JOIN checks c ON c.id = r.check_id
           WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          key,
        )
        .map(checkFrom),
    latestForCheck: (check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_RESULTS} WHERE r.check_id = ? ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1`,
        id,
      );
      return row === null ? null : toResult(row);
    },
    listForCheck: (check, limit) => {
      const id = findCheckId(conn, check);
      if (id === null) return [];
      return conn
        .all(
          `${SELECT_RESULTS} WHERE r.check_id = ?
           ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
          id,
          limit,
        )
        .map(toResult);
    },
    putMany: (records) =>
      conn.transaction(() => {
        for (const r of records) {
          const p = r.provenance;
          conn.run(
            `INSERT OR REPLACE INTO results (check_id, key, outcome, duration_ms, location_path,
               location_line, location_column, fingerprint, failure_id, worktree_id, revision,
               commit_sha, dirty, run_id, recorded_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ensureCheckId(conn, r.check, p.recordedAt),
            r.key,
            r.outcome,
            r.durationMs,
            ...locationParams(r.location),
            r.fingerprint,
            storeFailureText(conn, r.summary, r.errors),
            p.worktreeId,
            p.revision,
            p.commit,
            flag(p.dirty),
            p.runId,
            p.recordedAt,
            p.recordedAt,
          );
        }
      }),
  };
}

/**
 * Stores failure text once and returns its id, or `null` when there is none.
 * Spec 001 D8: "Failure text is deduplicated by exact text; the fingerprint
 * is a separate derived column." The id hashes the text, so every result
 * reads back the text it was stored with.
 */
function storeFailureText(
  conn: Connection,
  summary: string | null,
  errors: readonly CheckError[],
): string | null {
  if (summary === null && errors.length === 0) return null;
  const text = JSON.stringify(errors);
  const id = createHash("sha256")
    .update(JSON.stringify([summary, text]))
    .digest("hex");
  conn.run(
    "INSERT INTO failure_texts (id, summary, errors) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    id,
    summary,
    text,
  );
  return id;
}

function toResult(row: Row): ResultRecord {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", OUTCOMES),
    durationMs: num(row, "duration_ms"),
    location: location(row),
    fingerprint: strOrNull(row, "fingerprint"),
    summary: strOrNull(row, "summary"),
    errors: row.errors === null ? [] : json<CheckError[]>(row, "errors"),
    provenance: {
      worktreeId: str(row, "worktree_id"),
      revision: num(row, "revision"),
      commit: strOrNull(row, "commit_sha"),
      dirty: bool(row, "dirty"),
      runId: str(row, "run_id"),
      recordedAt: num(row, "recorded_at"),
    },
  };
}
