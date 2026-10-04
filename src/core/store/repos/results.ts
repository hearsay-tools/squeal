import { createHash } from "node:crypto";
import type {
  CheckError,
  ResultRecord,
  ResultRepo,
  RunRecord,
  RunRepo,
  TestFileRef,
} from "../../types/index.js";
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
  numOrNull,
  oneOf,
  oneOfOrNull,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

const OUTCOMES = ["pass", "fail", "skip"] as const;
const RUN_ENDS = ["completed", "crashed", "timed-out"] as const;

const SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;

export function createResultRepo(conn: Connection): ResultRepo {
  return {
    byKey: (key) =>
      conn
        .all(
          `${SELECT_RESULTS} WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          key,
        )
        .map(toResult),
    latestForCheck: (check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_RESULTS} WHERE r.check_id = ? ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1`,
        id,
      );
      return row === null ? null : toResult(row);
    },
    putMany: (records) =>
      conn.transaction(() => {
        for (const r of records) {
          const p = r.provenance;
          conn.run(
            `INSERT OR REPLACE INTO results (check_id, key, outcome, duration_ms, location_path,
               location_line, location_column, fingerprint, failure_id, worktree_id, revision,
               commit_sha, dirty, run_id, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          );
        }
      }),
  };
}

/**
 * Stores failure text once and returns its id, or `null` when there is none.
 * Spec 001 D8: "Failure text is deduplicated by fingerprint." The id hashes
 * the text itself rather than the fingerprint, which normalizes the message
 * and drops stack and diff, so every result reads back the text it was
 * stored with.
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

export function createRunRepo(conn: Connection): RunRepo {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO runs (id, worktree_id, revision, test_files, full_suite, log_dir, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        JSON.stringify(record.testFiles),
        flag(record.fullSuite),
        record.logDir,
        record.startedAt,
      );
      return { ...record, endedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM runs WHERE id = ?", id);
      return row === null ? null : toRun(row);
    },
    lastFullSuite: (worktreeId) => {
      const row = conn.get(
        `SELECT * FROM runs WHERE worktree_id = ? AND full_suite = 1 AND end_state = 'completed'
         ORDER BY ended_at DESC LIMIT 1`,
        worktreeId,
      );
      return row === null ? null : toRun(row);
    },
  };
}

function toRun(row: Row): RunRecord {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    testFiles: json<TestFileRef[]>(row, "test_files"),
    fullSuite: bool(row, "full_suite"),
    logDir: str(row, "log_dir"),
    startedAt: num(row, "started_at"),
    endedAt: numOrNull(row, "ended_at"),
    end: oneOfOrNull(row, "end_state", RUN_ENDS),
  };
}
