import { num, numOrNull, oneOf, oneOfOrNull, str } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { CodeTransition, CodeTransitionKind } from "../../types/code.js";
import { isStagedId } from "./staged.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCodeCheckId,
  findCodeCheckId,
  MEASURES,
  OUTCOMES,
} from "./states.js";
import type { CodeTransitionRepo } from "./types.js";

const KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "removed",
] as const satisfies readonly CodeTransitionKind[];

const COLUMNS = `worktree_id, check_id, measure, kind, from_outcome, to_outcome, from_value,
  to_value, threshold, revision, at`;

export function createTransitionRepo(conn: Connection): CodeTransitionRepo {
  return {
    append(transitions) {
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureCodeCheckId(conn, t.check),
            t.measure,
            t.kind,
            t.from,
            t.to,
            t.fromValue,
            t.toValue,
            t.threshold,
            t.revision,
            t.at,
          );
        }
      });
    },
    adopt(worktreeId, staged, expected) {
      return conn.transaction(() => {
        const row = conn.get("SELECT count(*) AS n FROM transitions WHERE worktree_id = ?", staged);
        if (row === null || num(row, "n") !== expected) return 0;
        // New ids: they sort after anything appended for the worktree while the pass staged.
        return conn.run(
          `INSERT INTO transitions (${COLUMNS})
           SELECT ?, check_id, measure, kind, from_outcome, to_outcome, from_value, to_value,
             threshold, revision, at
           FROM transitions WHERE worktree_id = ? ORDER BY id`,
          worktreeId,
          staged,
        );
      });
    },
    dropStaged(staged) {
      if (!isStagedId(staged)) {
        throw new Error(`squeal code store: ${staged} is no staging id; its transitions stay`);
      }
      conn.run("DELETE FROM transitions WHERE worktree_id = ?", staged);
    },
    history(worktreeId, check) {
      const id = findCodeCheckId(conn, check);
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

function toTransition(row: Row): CodeTransition {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    measure: oneOf(row, "measure", MEASURES),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES),
    to: oneOfOrNull(row, "to_outcome", OUTCOMES),
    fromValue: numOrNull(row, "from_value"),
    toValue: numOrNull(row, "to_value"),
    threshold: numOrNull(row, "threshold"),
    revision: num(row, "revision"),
    at: num(row, "at"),
  };
}
