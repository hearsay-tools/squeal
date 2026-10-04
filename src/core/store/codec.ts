import type { CheckId, EpochMs, SourceLocation } from "../types/index.js";
import type { Connection, Row } from "./connection.js";

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
  if (oneOf(row, "check_kind", ["test", "file"] as const) === "file") {
    return { kind: "file", project, testPath };
  }
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}

const CHECK_WHERE = "project = ? AND test_path = ? AND kind = ? AND full_name = ?";

/**
 * Columns to select from `checks` joined as `c`, to rebuild a check with
 * `checkFrom`. Aliased because `transitions` has its own `kind`.
 */
export const CHECK_COLUMNS =
  "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";

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

export function flag(value: boolean): number {
  return value ? 1 : 0;
}
