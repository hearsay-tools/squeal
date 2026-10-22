import type { SQLInputValue } from "node:sqlite";
import type { CheckError, FailureRepo, FailureSelection } from "../../types/index.js";
import { CHECK_COLUMNS, checkFrom, checkParams, json, num, strOrNull, toResult } from "../codec.js";
import type { Connection } from "../connection.js";
import { failingAt, keepReplaced, readReplaced } from "./replaced.js";

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

/** The conditions on the failing row `alias` that `selection` sets on each row, not on its check. */
function rowWhere(
  alias: string,
  { worktreeId, since, errors = [] }: FailureSelection,
): { sql: string[]; params: SQLInputValue[] } {
  const sql = [`${alias}.failure_id IS NOT NULL`, `${alias}.outcome = 'fail'`];
  const params: SQLInputValue[] = [];
  if (worktreeId !== null) {
    sql.push(`${alias}.worktree_id = ?`);
    params.push(worktreeId);
  }
  if (since !== null) {
    sql.push(`${alias}.recorded_at >= ?`);
    params.push(since);
  }
  if (errors.length > 0) {
    // `instr` holds case, as `--check` holds a name's.
    sql.push(`EXISTS (SELECT 1 FROM json_each(?) e JOIN failure_texts t
      ON t.id = ${alias}.failure_id WHERE instr(t.summary, e.value) > 0)`);
    params.push(JSON.stringify(errors));
  }
  return { sql, params };
}

/** Every condition of `selection`, in one parameter order. */
function where(selection: FailureSelection): Statement {
  const { paths, checks } = selection;
  const { sql, params } = rowWhere("r", selection);
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
  if (selection.perCheck === true) {
    // Review 0.1.262 B1: no newer failure of the same check that the rest selects, in the order
    // `list` gives.
    const newer = rowWhere("n", selection);
    sql.push(`NOT EXISTS (SELECT 1 FROM results n WHERE n.check_id = r.check_id
      AND (n.recorded_at > r.recorded_at OR (n.recorded_at = r.recorded_at AND n.rowid > r.rowid))
      AND ${newer.sql.join(" AND ")})`);
    params.push(...newer.params);
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
    failingAt: (key) => failingAt(conn, key),
    keepReplaced: (failing, records, loadOf) => keepReplaced(conn, failing, records, loadOf),
    replaced: () => readReplaced(conn),
    text: (id) => {
      const row = conn.get("SELECT summary, errors FROM failure_texts WHERE id = ?", id);
      return row === null
        ? null
        : { summary: strOrNull(row, "summary"), errors: json<CheckError[]>(row, "errors") };
    },
  };
}
