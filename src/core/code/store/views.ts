import { num, numOrNull, oneOf } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { CodeTold, CodeViewEntry } from "../../types/code.js";
import type { Consumer } from "../../types/index.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCodeCheckId,
  findCodeCheckId,
  MEASURES,
  OUTCOMES,
} from "./states.js";
import type { CodeViewRepo } from "./types.js";

const TOLD = ["count", "full", "still"] as const satisfies readonly CodeTold[];
const WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";

function consumerParams(c: Consumer) {
  return [c.worktreeId, c.sessionId, c.agentId] as const;
}

export function createViewRepo(conn: Connection): CodeViewRepo {
  return {
    list(consumer) {
      return conn
        .all(
          `SELECT v.*, ${CHECK_COLUMNS} FROM views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ? AND v.outcome <> 'pass'
           ORDER BY c.path, c.qualified_name, c.occurrence, v.measure`,
          ...consumerParams(consumer),
        )
        .map(toEntry);
    },
    writeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, measure, outcome,
               threshold, told, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, threshold = excluded.threshold,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams(consumer),
            ensureCodeCheckId(conn, entry.check),
            entry.measure,
            entry.outcome,
            entry.threshold,
            entry.told,
            entry.toldAt,
          );
        }
      });
    },
    removeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry of entries) {
          const id = findCodeCheckId(conn, entry.check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER} AND check_id = ? AND measure = ?`,
            ...consumerParams(consumer),
            id,
            entry.measure,
          );
        }
      });
    },
    clear(consumer) {
      conn.run(`DELETE FROM views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    },
    retain(worktreeIds, consumers) {
      return conn.run(
        `DELETE FROM views WHERE worktree_id IN (SELECT value FROM json_each(?))
           AND (worktree_id, session_id, agent_id) NOT IN (
             SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
             FROM json_each(?))`,
        JSON.stringify(worktreeIds),
        JSON.stringify(consumers),
      );
    },
  };
}

function toEntry(row: Row): CodeViewEntry {
  return {
    check: checkFrom(row),
    measure: oneOf(row, "measure", MEASURES),
    outcome: oneOf(row, "outcome", OUTCOMES),
    threshold: numOrNull(row, "threshold"),
    told: oneOf(row, "told", TOLD),
    toldAt: num(row, "told_at"),
  };
}
