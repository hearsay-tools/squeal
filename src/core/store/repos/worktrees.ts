import { isRecord } from "../../fs/index.js";
import {
  type DaemonRecord,
  type EpochMs,
  WORKTREE_META_ROWS,
  type WorktreeMetaRow,
  type WorktreeRecord,
  type WorktreeRepo,
  worktreeMetaKey,
} from "../../types/index.js";
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

/*
 * Task 001-270: a daemon's start token (`DaemonRecord.token`) is a `meta`
 * row beside its registration, written with it, with the start time and the
 * version it was drawn with. Schema V1 stays: a release before the token
 * writes no row and leaves one it finds, so a token counts only while the
 * registration's start time and version are its own; that release's daemon
 * reads as having none.
 */

const tokenKey = (id: string) => worktreeMetaKey("daemonToken", id);

/**
 * A `daemonToken` row's parsed value: its token when the daemon registered at
 * `startedAt` with `version` drew it, `null` when another registration did,
 * `undefined` in a format this release does not know.
 */
export function toDaemonToken(
  value: unknown,
  startedAt: EpochMs,
  version: string | null,
): string | null | undefined {
  if (!isRecord(value) || typeof value.token !== "string") return undefined;
  return value.startedAt === startedAt && value.squealVersion === version ? value.token : null;
}

export function createWorktreeRepo(conn: Connection): WorktreeRepo {
  /** `id`'s token, when it was drawn by the daemon registered at `startedAt` with `version`. */
  const tokenOf = (id: string, startedAt: EpochMs, version: string | null): string | undefined => {
    const raw = conn.get("SELECT value FROM meta WHERE key = ?", tokenKey(id));
    if (raw === null) return undefined;
    try {
      return toDaemonToken(JSON.parse(str(raw, "value")), startedAt, version) ?? undefined;
    } catch {
      return undefined;
    }
  };
  /** With a registration: its token, or none, so an earlier token never names it. */
  const writeToken = (id: string, d: DaemonRecord) => {
    if (d.token === undefined) {
      conn.run("DELETE FROM meta WHERE key = ?", tokenKey(id));
      return;
    }
    const value = { startedAt: d.startedAt, squealVersion: d.squealVersion, token: d.token };
    conn.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      tokenKey(id),
      JSON.stringify(value),
    );
  };
  const toRecord = (row: Row): WorktreeRecord => {
    const record = fromRow(row);
    const d = record.daemon;
    const token = d === null ? undefined : tokenOf(record.id, d.startedAt, d.squealVersion);
    return token === undefined || d === null ? record : { ...record, daemon: { ...d, token } };
  };
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
      if (d !== null) writeToken(record.id, d);
    },
    // Clearing keeps `daemon_heartbeat_at`: the last heartbeat (review wave 4.5, N5). It keeps
    // the start time and version too, and the token row, the identity `lastDaemon` reads (tasks
    // 001-268, 001-270); with no
    // socket every other read finds no daemon.
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?,
           daemon_started_at = COALESCE(?, daemon_started_at),
           daemon_heartbeat_at = COALESCE(?, daemon_heartbeat_at),
           daemon_heartbeat_interval_ms = ?,
           daemon_version = COALESCE(?, daemon_version) WHERE id = ?`,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
        id,
      );
      if (d !== null) writeToken(id, d);
    },
    heartbeat: (id, at) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at,
        id,
      );
    },
    lastDaemon: (id) => {
      const row = conn.get(
        "SELECT daemon_started_at, daemon_version FROM worktrees WHERE id = ?",
        id,
      );
      const startedAt = row === null ? null : numOrNull(row, "daemon_started_at");
      if (row === null || startedAt === null) return null;
      const squealVersion = strOrNull(row, "daemon_version");
      const token = tokenOf(id, startedAt, squealVersion);
      return { startedAt, squealVersion, ...(token === undefined ? {} : { token }) };
    },
    remove: (id) => {
      conn.transaction(() => {
        conn.run("DELETE FROM worktrees WHERE id = ?", id);
        for (const table of WORKTREE_SCOPED_TABLES) {
          conn.run(`DELETE FROM ${table} WHERE worktree_id = ?`, id);
        }
        // By exact name, never by a suffix match: a shared row stays (review wave 13u, S1).
        for (const row of Object.keys(WORKTREE_META_ROWS) as WorktreeMetaRow[]) {
          conn.run("DELETE FROM meta WHERE key = ?", worktreeMetaKey(row, id));
        }
      });
    },
  };
}

function fromRow(row: Row): WorktreeRecord {
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
