import type { WorktreeRecord, WorktreeRepo } from "../../types/index.js";
import { bool, flag, num, numOrNull, str, strOrNull } from "../codec.js";
import type { Connection, Row } from "../connection.js";

/**
 * Tables whose rows belong to one worktree and go with it. Results, runs and
 * checkpoints are not listed: results are content-keyed and shared, runs are
 * referenced by results and checkpoints by runs, so `prune` decides when
 * they go (spec 001 D8).
 */
export const WORKTREE_SCOPED_TABLES = [
  "revisions",
  "file_hashes",
  "test_file_keys",
  "known_states",
  "transitions",
  "consumer_views",
  "consumers",
] as const;

/**
 * `meta` rows named `<prefix><worktreeId>` that belong to one worktree and go
 * with it (review wave 13u, S1): the consumers' edit state (`editsMetaKey`),
 * the open checkpoint (`checkpointMetaKey`) and the re-key record
 * (`rekeyedMetaKey`). Removed by exact name, never by a suffix match, so a
 * row shared across worktrees, a node:test observation's, stays.
 */
export const WORKTREE_META_PREFIXES = ["edits:", "checkpoint.", "rekeyed."] as const;

/**
 * Prefix of the per-consumer key snapshots squeal 0.1.100 to 0.1.102 kept,
 * `edit-keys:` and the JSON `[worktreeId, sessionId, agentId]`.
 */
const EDIT_KEYS_PREFIX = "edit-keys:";

/** Whether `key` is a key snapshot of `worktreeId`'s consumers. */
function editKeysOf(key: string, worktreeId: string): boolean {
  try {
    const owner: unknown = JSON.parse(key.slice(EDIT_KEYS_PREFIX.length));
    return Array.isArray(owner) && owner[0] === worktreeId;
  } catch {
    return false;
  }
}

export function createWorktreeRepo(conn: Connection): WorktreeRepo {
  return {
    get: (id) => {
      const row = conn.get("SELECT * FROM worktrees WHERE id = ?", id);
      return row === null ? null : toRecord(row);
    },
    list: () => conn.all("SELECT * FROM worktrees ORDER BY id").map(toRecord),
    upsert: (record) => {
      const d = record.daemon;
      conn.run(
        `INSERT INTO worktrees (id, root, common_dir, is_main, registered_at, daemon_socket,
           daemon_started_at, daemon_heartbeat_at, daemon_heartbeat_interval_ms, daemon_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET root = excluded.root, common_dir = excluded.common_dir,
           is_main = excluded.is_main, registered_at = excluded.registered_at,
           daemon_socket = excluded.daemon_socket, daemon_started_at = excluded.daemon_started_at,
           daemon_heartbeat_at = excluded.daemon_heartbeat_at,
           daemon_heartbeat_interval_ms = excluded.daemon_heartbeat_interval_ms,
           daemon_version = excluded.daemon_version`,
        record.id,
        record.root,
        record.commonDir,
        flag(record.isMain),
        record.registeredAt,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? record.lastHeartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
      );
    },
    // Clearing keeps `daemon_heartbeat_at`: the last heartbeat (review wave 4.5, N5).
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?, daemon_started_at = ?,
           daemon_heartbeat_at = COALESCE(?, daemon_heartbeat_at),
           daemon_heartbeat_interval_ms = ?, daemon_version = ? WHERE id = ?`,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
        id,
      );
    },
    heartbeat: (id, at) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at,
        id,
      );
    },
    remove: (id) => {
      conn.transaction(() => {
        conn.run("DELETE FROM worktrees WHERE id = ?", id);
        for (const table of WORKTREE_SCOPED_TABLES) {
          conn.run(`DELETE FROM ${table} WHERE worktree_id = ?`, id);
        }
        for (const prefix of WORKTREE_META_PREFIXES) {
          conn.run("DELETE FROM meta WHERE key = ?", `${prefix}${id}`);
        }
        const snapshots = conn.all(
          "SELECT key FROM meta WHERE substr(key, 1, ?) = ?",
          EDIT_KEYS_PREFIX.length,
          EDIT_KEYS_PREFIX,
        );
        for (const row of snapshots) {
          const key = str(row, "key");
          if (editKeysOf(key, id)) conn.run("DELETE FROM meta WHERE key = ?", key);
        }
      });
    },
  };
}

function toRecord(row: Row): WorktreeRecord {
  const socketPath = strOrNull(row, "daemon_socket");
  const lastHeartbeatAt = numOrNull(row, "daemon_heartbeat_at");
  return {
    id: str(row, "id"),
    root: str(row, "root"),
    commonDir: str(row, "common_dir"),
    isMain: bool(row, "is_main"),
    registeredAt: num(row, "registered_at"),
    daemon:
      socketPath === null
        ? null
        : {
            socketPath,
            startedAt: num(row, "daemon_started_at"),
            heartbeatAt: num(row, "daemon_heartbeat_at"),
            heartbeatIntervalMs: num(row, "daemon_heartbeat_interval_ms"),
            squealVersion: str(row, "daemon_version"),
          },
    ...(socketPath === null && lastHeartbeatAt !== null ? { lastHeartbeatAt } : {}),
  };
}
