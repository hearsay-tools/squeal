import { num, oneOf, strOrNull } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { Consumer } from "../../types/index.js";
import type { LintTold, LintViewEntry } from "../../types/lint.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureLintCheckId,
  findLintCheckId,
  OUTCOMES,
} from "./checks.js";
import type { LintViewRepo } from "./types.js";

const TOLD = ["count", "full"] as const satisfies readonly LintTold[];
const WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";

function consumerParams(c: Consumer) {
  return [c.worktreeId, c.sessionId, c.agentId] as const;
}

export function createViewRepo(conn: Connection): LintViewRepo {
  return {
    list(consumer) {
      return conn
        .all(
          `SELECT v.*, ${CHECK_COLUMNS} FROM views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ? AND v.outcome <> 'pass'
           ORDER BY c.path, c.tool`,
          ...consumerParams(consumer),
        )
        .map(toEntry);
    },
    writeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint,
               told, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id) DO UPDATE SET
               outcome = excluded.outcome, fingerprint = excluded.fingerprint,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams(consumer),
            ensureLintCheckId(conn, entry.check),
            entry.outcome,
            entry.fingerprint,
            entry.told,
            entry.toldAt,
          );
        }
      });
    },
    removeMany(consumer, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findLintCheckId(conn, check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER} AND check_id = ?`,
            ...consumerParams(consumer),
            id,
          );
        }
      });
    },
    clear(consumer) {
      conn.run(`DELETE FROM views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    },
  };
}

function toEntry(row: Row): LintViewEntry {
  return {
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    fingerprint: strOrNull(row, "fingerprint"),
    told: oneOf(row, "told", TOLD),
    toldAt: num(row, "told_at"),
  };
}
