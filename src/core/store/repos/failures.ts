import type { SQLInputValue } from "node:sqlite";
import type { CheckError, FailureRepo, FailureSelection, ResultRecord } from "../../types/index.js";
import {
  bool,
  CHECK_COLUMNS,
  checkFrom,
  checkParams,
  json,
  location,
  num,
  oneOf,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

/** One query and its parameters. */
export interface Statement {
  readonly sql: string;
  readonly params: readonly SQLInputValue[];
}

/**
 * The failing rows, through `results_by_failure` (row 011-75, 011-64 section
 * 1). `failure_id` is set on every failing row and on no other: a fail always
 * has a summary (`describeFailure`), and `putMany` stores a text for it.
 * SQLite does not choose the index for `IS NOT NULL` without `ANALYZE`
 * statistics, so it is named, as `KEYS_SINCE` names its own; on cezar's
 * store it takes the count from 90 ms to 0.7 ms. `CROSS JOIN` keeps the
 * results the outer loop.
 */
const FAILING_ROWS = `results r INDEXED BY results_by_failure CROSS JOIN checks c ON c.id = r.check_id`;

/** Every condition of `selection`, in one parameter order. */
function where({ worktreeId, since, paths, checks }: FailureSelection): Statement {
  const sql = ["r.failure_id IS NOT NULL", "r.outcome = 'fail'"];
  const params: SQLInputValue[] = [];
  if (worktreeId !== null) {
    sql.push("r.worktree_id = ?");
    params.push(worktreeId);
  }
  if (since !== null) {
    sql.push("r.recorded_at >= ?");
    params.push(since);
  }
  if (paths.length > 0) {
    // A path or below it, compared case-sensitively, as `LIKE` would not.
    sql.push(`EXISTS (SELECT 1 FROM json_each(?) p WHERE c.test_path = p.value
      OR substr(c.test_path, 1, length(p.value) + 1) = p.value || '/')`);
    params.push(JSON.stringify(paths));
  }
  if (checks !== null) {
    sql.push(`r.check_id IN (SELECT k.id FROM json_each(?) j JOIN checks k
      ON k.project = json_extract(j.value, '$[0]') AND k.test_path = json_extract(j.value, '$[1]')
      AND k.kind = json_extract(j.value, '$[2]') AND k.full_name = json_extract(j.value, '$[3]'))`);
    params.push(JSON.stringify(checks.map(checkParams)));
  }
  return { sql: sql.join(" AND "), params };
}

/** The statements `FailureRepo` runs, exported so a test can read their plans. */
export const FAILURE_STATEMENTS = {
  list: (selection: FailureSelection, limit: number): Statement => {
    const w = where(selection);
    return {
      sql: `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM ${FAILING_ROWS}
        LEFT JOIN failure_texts f ON f.id = r.failure_id
        WHERE ${w.sql} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
      params: [...w.params, limit],
    };
  },
  count: (selection: FailureSelection): Statement => {
    const w = where(selection);
    return { sql: `SELECT COUNT(*) AS n FROM ${FAILING_ROWS} WHERE ${w.sql}`, params: w.params };
  },
  failingChecks: (selection: FailureSelection): Statement => {
    const w = where(selection);
    return {
      sql: `SELECT DISTINCT ${CHECK_COLUMNS} FROM ${FAILING_ROWS} WHERE ${w.sql}
        ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      params: w.params,
    };
  },
};

export function createFailureRepo(conn: Connection): FailureRepo {
  const all = ({ sql, params }: Statement) => conn.all(sql, ...params);
  return {
    list: (selection, limit) => all(FAILURE_STATEMENTS.list(selection, limit)).map(toResult),
    count: (selection) => num(all(FAILURE_STATEMENTS.count(selection))[0] ?? { n: 0 }, "n"),
    failingChecks: (selection) => all(FAILURE_STATEMENTS.failingChecks(selection)).map(checkFrom),
  };
}

const OUTCOMES = ["pass", "fail", "skip"] as const;

/**
 * A row as `ResultRepo` reads it. Not shared with `results.ts`: that module
 * is on the key-format alarm's path, and a changed line there needs a
 * validity case (011-64 section 4).
 */
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
