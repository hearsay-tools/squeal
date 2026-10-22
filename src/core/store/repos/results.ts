import { createHash } from "node:crypto";
import type { CheckError, FailureFilter, ResultRepo } from "../../types/index.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  findCheckId,
  flag,
  locationParams,
  num,
  str,
  toResult,
} from "../codec.js";
import type { Connection } from "../connection.js";

const SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;

/**
 * `ResultRepo.keysSince` (task 011-23). The index is named: for `GROUP BY
 * key`, SQLite scans all of `results_by_key` instead, 0.56 s on a
 * 300,000-row store for an empty window.
 */
export const KEYS_SINCE = `
  SELECT key, MAX(recorded_at) AS recorded_at FROM results INDEXED BY results_by_time
  WHERE recorded_at > ? GROUP BY key`;

/**
 * `ResultRepo.copyNewest`'s copy (task 011-38): every row of one key under
 * another, with its provenance and record time, only while the other holds
 * no row. One statement, so a set another daemon stores there meanwhile is
 * never mixed with the copy.
 */
const COPY_SET = `
  INSERT INTO results (check_id, key, outcome, duration_ms, location_path, location_line,
    location_column, fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id,
    recorded_at, last_used_at)
  SELECT check_id, ?, outcome, duration_ms, location_path, location_line, location_column,
    fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id, recorded_at,
    last_used_at
  FROM results WHERE key = ? AND NOT EXISTS (SELECT 1 FROM results WHERE key = ?)`;

export function createResultRepo(conn: Connection): ResultRepo {
  return {
    byKey: (key, usedAt = Date.now()) => {
      if (usedAt > 0) {
        conn.run(
          "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
          usedAt,
          key,
          usedAt,
        );
      }
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
    listFailures: (filter, limit) =>
      conn
        .all(
          `${SELECT_RESULTS} WHERE ${FAILURE_WHERE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
          ...failureParams(filter),
          limit,
        )
        .map(toResult),
    countFailures: (filter) =>
      num(
        conn.get(
          `SELECT COUNT(*) AS n FROM results r WHERE ${FAILURE_WHERE}`,
          ...failureParams(filter),
        ) ?? { n: 0 },
        "n",
      ),
    copyNewest: (key, from) => {
      if (from.length === 0) return false;
      const newest = conn.get(
        `SELECT key FROM results WHERE key IN (${from.map(() => "?").join(", ")})
         GROUP BY key ORDER BY MAX(recorded_at) DESC, key LIMIT 1`,
        ...from,
      );
      if (newest === null) return false;
      return conn.run(COPY_SET, key, str(newest, "key"), key) > 0;
    },
    keysSince: (since) =>
      conn
        .all(KEYS_SINCE, since)
        .map((row) => ({ key: str(row, "key"), recordedAt: num(row, "recorded_at") })),
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

/** Task 001-409: a `null` filter field matches every row. */
const FAILURE_WHERE = `r.outcome = 'fail' AND (? IS NULL OR r.worktree_id = ?) AND (? IS NULL OR r.recorded_at >= ?)`;

function failureParams({ worktreeId, since }: FailureFilter): (string | number | null)[] {
  return [worktreeId, worktreeId, since, since];
}
