import { num, oneOf, str } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { LintCheckId, LintOutcome, LintTool } from "../../types/lint.js";

export const TOOLS = ["eslint"] as const satisfies readonly LintTool[];
export const OUTCOMES = [
  "pass",
  "fail",
  "pending",
  "unknown",
] as const satisfies readonly LintOutcome[];
/** The outcomes a lint run gives; `pending` and `unknown` are never a result's (D2). */
export const JUDGED = ["pass", "fail"] as const satisfies readonly LintOutcome[];

/** The row id of a lint check, or `null` if it was never stored. For read paths. */
export function findLintCheckId(conn: Connection, check: LintCheckId): number | null {
  const row = conn.get("SELECT id FROM checks WHERE path = ? AND tool = ?", check.path, check.tool);
  return row === null ? null : num(row, "id");
}

/** The row id of a lint check, inserting its `checks` row first if needed. For write paths. */
export function ensureLintCheckId(conn: Connection, check: LintCheckId): number {
  conn.run(
    "INSERT INTO checks (path, tool) VALUES (?, ?) ON CONFLICT DO NOTHING",
    check.path,
    check.tool,
  );
  const id = findLintCheckId(conn, check);
  if (id === null) throw new Error("squeal lint store: check row missing after insert");
  return id;
}

/** Columns of the check a row's `check_id` names, for a `JOIN checks c`. */
export const CHECK_COLUMNS = "c.path, c.tool";

export function checkFrom(row: Row): LintCheckId {
  return { kind: "lint", path: str(row, "path"), tool: oneOf(row, "tool", TOOLS) };
}
