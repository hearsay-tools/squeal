import type {
  CheckError,
  CheckId,
  EpochMs,
  ResultRecord,
  SourceLocation,
  TestFileRef,
} from "../types/index.js";
import type { Connection, Row } from "./connection.js";
import { hasColumn } from "./schema.js";

/*
 * Conversions between rows and records. Column readers throw on a type the
 * schema does not allow, so a damaged row surfaces instead of becoming a
 * plausible-looking record.
 */

export function str(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new TypeError(`squeal store: ${column} is not text`);
  return value;
}

export function strOrNull(row: Row, column: string): string | null {
  return row[column] === null ? null : str(row, column);
}

export function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number") throw new TypeError(`squeal store: ${column} is not a number`);
  return value;
}

export function numOrNull(row: Row, column: string): number | null {
  return row[column] === null ? null : num(row, column);
}

export function bool(row: Row, column: string): boolean {
  return num(row, column) !== 0;
}

export function json<T>(row: Row, column: string): T {
  return JSON.parse(str(row, column)) as T;
}

/** Narrows a stored text column to one of a string union's members. */
export function oneOf<T extends string>(row: Row, column: string, values: readonly T[]): T {
  const value = str(row, column);
  if (!(values as readonly string[]).includes(value)) {
    throw new TypeError(`squeal store: ${column} has unexpected value ${value}`);
  }
  return value as T;
}

export function oneOfOrNull<T extends string>(
  row: Row,
  column: string,
  values: readonly T[],
): T | null {
  return row[column] === null ? null : oneOf(row, column, values);
}

/** `[path, line, column]` for the three `location_*` columns. */
export function locationParams(location: SourceLocation | null) {
  return [location?.path ?? null, location?.line ?? null, location?.column ?? null] as const;
}

export function location(row: Row): SourceLocation | null {
  const path = strOrNull(row, "location_path");
  if (path === null) return null;
  return { path, line: num(row, "location_line"), column: num(row, "location_column") };
}

/** Identity columns of a check. A file-level check stores `""` as its full name. */
export function checkParams(check: CheckId) {
  return [
    check.project,
    check.testPath,
    check.kind,
    check.kind === "test" ? check.fullName : "",
  ] as const;
}

/** Reads a check identity from the columns `CHECK_COLUMNS` selects. */
export function checkFrom(row: Row): CheckId {
  const project = str(row, "check_project");
  const testPath = str(row, "check_test_path");
  const kind = oneOf(row, "check_kind", ["test", "file", "setup"] as const);
  if (kind !== "test") return { kind, project, testPath };
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}

const OUTCOMES = ["pass", "fail", "skip"] as const;

/**
 * A `results` row, joined to its check (`CHECK_COLUMNS`) and its failure text,
 * as `ResultRepo` and `FailureRepo` read it.
 */
export function toResult(row: Row): ResultRecord {
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

export const CHECK_WHERE = "project = ? AND test_path = ? AND kind = ? AND full_name = ?";

/**
 * Columns to select from `checks` joined as `c`, to rebuild a check with
 * `checkFrom`. Aliased because `transitions` has its own `kind`.
 */
export const CHECK_COLUMNS =
  "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";

/**
 * A condition that the check id in `column` is one of `files`' checks (task
 * 001-414), as a subquery on the `checks` index so a table keyed by check id
 * is searched rather than scanned. An empty list matches nothing.
 */
export function inTestFiles(
  column: string,
  files: readonly TestFileRef[],
): { readonly sql: string; readonly params: readonly string[] } {
  if (files.length === 0) return { sql: "0", params: [] };
  const values = files.map(() => "(?, ?)").join(", ");
  return {
    sql: `${column} IN (SELECT id FROM checks WHERE (project, test_path) IN (VALUES ${values}))`,
    params: files.flatMap((f) => [f.project, f.path]),
  };
}

/** The row id of a check, or `null` if it was never stored. For read paths. */
export function findCheckId(conn: Connection, check: CheckId): number | null {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE}`, ...checkParams(check));
  return row === null ? null : num(row, "id");
}

/** The row id of a check, inserting a bare `checks` row first if needed. For write paths. */
export function ensureCheckId(conn: Connection, check: CheckId, seenAt: EpochMs): number {
  conn.run(
    `INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at)
     VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`,
    ...checkParams(check),
    seenAt,
  );
  const id = findCheckId(conn, check);
  if (id === null) throw new Error(`squeal store: check row missing after insert`);
  return id;
}

/**
 * Whether `checks.runner` exists (`addColumns`, spec 016 D3). A store an
 * older daemon made lacks it until a newer opener adds it; once added it
 * stays, so `true` is kept.
 */
export function runnerColumn(conn: Connection): () => boolean {
  let added = false;
  return () => {
    added ||= hasColumn(conn.db, "checks", "runner");
    return added;
  };
}

/** Records `runner` as the runner of check row `id`; no write when it already is. */
export function recordRunner(conn: Connection, id: number, runner: string): void {
  conn.run("UPDATE checks SET runner = ? WHERE id = ? AND runner IS NOT ?", runner, id, runner);
}

export function flag(value: boolean): number {
  return value ? 1 : 0;
}
