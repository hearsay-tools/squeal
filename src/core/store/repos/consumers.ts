import type {
  Consumer,
  ConsumerRecord,
  ConsumerRepo,
  ViewEntry,
  ViewRepo,
} from "../../types/index.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  num,
  numOrNull,
  oneOf,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

const OUTCOMES = ["pass", "fail", "unknown"] as const;
const WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";

function consumerParams(c: Consumer) {
  return [c.worktreeId, c.sessionId, c.agentId] as const;
}

export function createConsumerRepo(conn: Connection): ConsumerRepo {
  const unregister = (consumer: Consumer) =>
    conn.transaction(() => {
      conn.run(`DELETE FROM consumer_views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
      conn.run(`DELETE FROM consumers WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    });

  return {
    get: (consumer) => {
      const row = conn.get(
        `SELECT * FROM consumers WHERE ${WHERE_CONSUMER}`,
        ...consumerParams(consumer),
      );
      return row === null ? null : toConsumer(row);
    },
    list: (worktreeId) =>
      conn
        .all(
          "SELECT * FROM consumers WHERE worktree_id = ? ORDER BY session_id, agent_id",
          worktreeId,
        )
        .map(toConsumer),
    /**
     * A registration starts from an empty view: spec 001 D6 seeds the view
     * with the current known state on registration, so entries left by an
     * earlier registration of the same consumer are dropped.
     */
    register: (consumer, at) =>
      conn.transaction(() => {
        unregister(consumer);
        conn.run(
          `INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`,
          ...consumerParams(consumer),
          at,
          at,
        );
        return { consumer, registeredAt: at, lastSeenAt: at, lastDeliveredAt: null };
      }),
    touch: (consumer, at, delivered) => {
      conn.run(
        `UPDATE consumers SET last_seen_at = ?,
           last_delivered_at = CASE WHEN ? THEN ? ELSE last_delivered_at END
         WHERE ${WHERE_CONSUMER}`,
        at,
        delivered ? 1 : 0,
        at,
        ...consumerParams(consumer),
      );
    },
    unregister,
    expire: (cutoff) =>
      conn.transaction(() => {
        const expired = conn
          .all(
            `SELECT * FROM consumers
             WHERE last_seen_at < ? AND coalesce(last_delivered_at, 0) < ?
             ORDER BY worktree_id, session_id, agent_id`,
            cutoff,
            cutoff,
          )
          .map((row) => toConsumer(row).consumer);
        for (const consumer of expired) unregister(consumer);
        return expired;
      }),
  };
}

function toConsumer(row: Row): ConsumerRecord {
  return {
    consumer: {
      worktreeId: str(row, "worktree_id"),
      sessionId: str(row, "session_id"),
      agentId: str(row, "agent_id"),
    },
    registeredAt: num(row, "registered_at"),
    lastSeenAt: num(row, "last_seen_at"),
    lastDeliveredAt: numOrNull(row, "last_delivered_at"),
  };
}

export function createViewRepo(conn: Connection): ViewRepo {
  return {
    list: (consumer) =>
      conn
        .all(
          `SELECT v.*, ${CHECK_COLUMNS} FROM consumer_views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          ...consumerParams(consumer),
        )
        .map(toView),
    writeMany: (consumer, entries) =>
      conn.transaction(() => {
        for (const e of entries) {
          conn.run(
            `INSERT OR REPLACE INTO consumer_views
               (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ...consumerParams(consumer),
            ensureCheckId(conn, e.check, e.toldAt),
            e.outcome,
            e.fingerprint,
            e.toldAt,
          );
        }
      }),
  };
}

function toView(row: Row): ViewEntry {
  return {
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    fingerprint: strOrNull(row, "fingerprint"),
    toldAt: num(row, "told_at"),
  };
}
