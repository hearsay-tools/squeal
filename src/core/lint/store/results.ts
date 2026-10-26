import { json, num, oneOf, str, strOrNull } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { LintFinding, LintResult } from "../../types/lint.js";
import { CHECK_COLUMNS, checkFrom, ensureLintCheckId, findLintCheckId, JUDGED } from "./checks.js";
import type { LintResultRepo } from "./types.js";

export function createResultRepo(conn: Connection): LintResultRepo {
  return {
    get(check, key) {
      const row = conn.get(
        `SELECT r.*, ${CHECK_COLUMNS} FROM checks c JOIN results r ON r.check_id = c.id
         WHERE c.path = ? AND c.tool = ? AND r.key = ?`,
        check.path,
        check.tool,
        key,
      );
      return row === null ? null : toResult(row);
    },
    put(result, at) {
      conn.run(
        `INSERT INTO results (check_id, key, outcome, findings, fingerprint, tool_version,
           linted_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (check_id, key) DO UPDATE SET
           outcome = excluded.outcome, findings = excluded.findings,
           fingerprint = excluded.fingerprint, tool_version = excluded.tool_version,
           linted_at = excluded.linted_at, used_at = excluded.used_at`,
        ensureLintCheckId(conn, result.check),
        result.key,
        result.outcome,
        JSON.stringify(result.findings),
        result.fingerprint,
        result.toolVersion,
        result.lintedAt,
        at,
      );
    },
    use(check, key, at) {
      const id = findLintCheckId(conn, check);
      if (id === null) return;
      conn.run("UPDATE results SET used_at = ? WHERE check_id = ? AND key = ?", at, id, key);
    },
  };
}

function toResult(row: Row): LintResult {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", JUDGED),
    findings: json<LintFinding[]>(row, "findings"),
    fingerprint: strOrNull(row, "fingerprint"),
    toolVersion: str(row, "tool_version"),
    lintedAt: num(row, "linted_at"),
  };
}
