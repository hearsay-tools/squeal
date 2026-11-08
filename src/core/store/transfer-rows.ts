import type { WorktreeId } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import { location, num, oneOf, str } from "./codec.js";
import type { Connection } from "./connection.js";
import type { ExportedResult } from "./transfer-bundle.js";

/** An exported result as read, a failure still among them (018 D2). */
export interface ExportRow extends Omit<ExportedResult, "outcome"> {
  readonly outcome: "pass" | "fail" | "skip";
}

/**
 * Every stored result of `worktreeId`'s test files at their keys, pending or
 * not: one statement over `test_file_keys`, the `checks` index and the
 * `results` key.
 */
const AT_KEYS = `
  SELECT k.project, k.path, k.key, c.kind, c.full_name, r.outcome, r.duration_ms,
    r.location_path, r.location_line, r.location_column
  FROM test_file_keys k
  JOIN checks c ON c.project = k.project AND c.test_path = k.path
  JOIN results r ON r.check_id = c.id AND r.key = k.key
  WHERE k.worktree_id = ? AND k.key IS NOT NULL
  ORDER BY k.project, k.path, c.kind, c.full_name`;

export function exportedRows(conn: Connection, worktreeId: WorktreeId): ExportRow[] {
  return conn.all(AT_KEYS, worktreeId).map((row) => {
    const kind = oneOf(row, "kind", ["test", "file", "setup"] as const);
    return {
      project: str(row, "project"),
      testPath: str(row, "path"),
      kind,
      fullName: kind === "test" ? str(row, "full_name") : null,
      location: location(row),
      key: str(row, "key"),
      outcome: oneOf(row, "outcome", ["pass", "fail", "skip"] as const),
      durationMs: num(row, "duration_ms"),
    };
  });
}

/** Whether the store holds any result at `key` (018 D3: an import keeps them). */
export function holdsKey(conn: Connection, key: CheckKey): boolean {
  return conn.get("SELECT 1 AS found FROM results WHERE key = ? LIMIT 1", key) !== null;
}

/** `items` by `keyOf`, in first-seen order (`Map.groupBy`, which es2023 lacks). */
export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}
