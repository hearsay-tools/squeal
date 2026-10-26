import { json, num, oneOf, str } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { LintFinding, LintTransition, LintTransitionKind } from "../../types/lint.js";
import { CHECK_COLUMNS, checkFrom, ensureLintCheckId, findLintCheckId } from "./checks.js";
import type { LintTransitionRepo } from "./types.js";

const KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "fail-changed",
  "removed",
] as const satisfies readonly LintTransitionKind[];

export function createTransitionRepo(conn: Connection): LintTransitionRepo {
  return {
    append(transitions) {
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (worktree_id, check_id, kind, added, removed, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureLintCheckId(conn, t.check),
            t.kind,
            JSON.stringify(t.added),
            JSON.stringify(t.removed),
            t.revision,
            t.at,
          );
        }
      });
    },
    history(worktreeId, check) {
      const id = findLintCheckId(conn, check);
      if (id === null) return [];
      return conn
        .all(
          `SELECT t.*, ${CHECK_COLUMNS} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.check_id = ? ORDER BY t.id`,
          worktreeId,
          id,
        )
        .map(toTransition);
    },
  };
}

function toTransition(row: Row): LintTransition {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    kind: oneOf(row, "kind", KINDS),
    added: json<LintFinding[]>(row, "added"),
    removed: json<LintFinding[]>(row, "removed"),
    revision: num(row, "revision"),
    at: num(row, "at"),
  };
}
