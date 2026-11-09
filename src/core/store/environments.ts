import type { EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import type { EnvironmentRecord } from "../keys/environment-hash.js";
import type { EpochMs, ProjectName, WorktreeId } from "../types/common.js";
import type { EnvironmentHash } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { Connection, Row } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Spec 018 D1, storage: the parts of each environment hash, and the hash
 * each worktree keys each project with now. Additive main-store tables, made
 * by the first write, with no `user_version` raise; no key reads them, so
 * they live outside `schema.ts`, which the key-format alarm bundles (the
 * pattern of `IMPORT_GRAPH_TABLES`).
 *
 * - `environments`: by hash, the descriptor as JSON. One hash has one set of
 *   parts, so a row stays as first written. Imports (D3) add theirs here too.
 * - `worktree_environment_hashes`: by worktree and project, the hash its
 *   daemon keyed with last. Not `worktree_environments`: 0.1.415 made a table
 *   of that name with other columns, and a store it opened still holds it.
 */
export const ENVIRONMENT_TABLES: Readonly<Record<string, string>> = {
  environments: `
CREATE TABLE environments (
  hash TEXT PRIMARY KEY,
  descriptor TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`,
  worktree_environment_hashes: `
CREATE TABLE worktree_environment_hashes (
  worktree_id TEXT NOT NULL,
  project TEXT NOT NULL,
  hash TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, project)
) STRICT, WITHOUT ROWID;
`,
};

/** The environment a worktree keys one project with, as stored. */
export interface StoredEnvironment {
  readonly project: ProjectName;
  readonly hash: EnvironmentHash;
  /** `null` when the store holds no descriptor for the hash, or none this release reads. */
  readonly descriptor: EnvironmentDescriptor | null;
  readonly recordedAt: EpochMs;
}

/**
 * Adds each descriptor under its hash; a hash already stored keeps its row,
 * unless the row lacks the `browser` part and the new descriptor has it
 * (018 D10): equal hashes have equal parts, so only the part is new. In a
 * transaction of its own, or a savepoint of the caller's.
 */
export function putEnvironments(
  store: Store,
  environments: readonly EnvironmentRecord[],
  now: EpochMs,
): void {
  const conn = connectionOf(store);
  conn.transaction(() => insertEnvironments(conn, environments, now));
}

/**
 * Records `environments` as the ones `worktreeId` keys its projects with now:
 * each descriptor under its hash, each project's hash, and no row for a
 * project the worktree no longer reads. A test's fake or `Proxy` of a store
 * stores none.
 */
export function recordWorktreeEnvironments(
  store: Store,
  worktreeId: WorktreeId,
  environments: readonly EnvironmentRecord[],
  now: EpochMs,
): void {
  const conn = openedConnection(store);
  if (conn === null) return;
  conn.transaction(() => {
    insertEnvironments(conn, environments, now);
    for (const { hash, descriptor } of environments) {
      conn.run(
        `INSERT INTO worktree_environment_hashes (worktree_id, project, hash, recorded_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (worktree_id, project)
         DO UPDATE SET hash = excluded.hash, recorded_at = excluded.recorded_at
         WHERE hash <> excluded.hash`,
        worktreeId,
        descriptor.project,
        hash,
        now,
      );
    }
    conn.run(
      `DELETE FROM worktree_environment_hashes
       WHERE worktree_id = ? AND project NOT IN (SELECT value FROM json_each(?))`,
      worktreeId,
      JSON.stringify(environments.map((e) => e.descriptor.project)),
    );
  });
}

/** The descriptor stored under `hash`, or `null`. */
export function readEnvironment(store: Store, hash: EnvironmentHash): EnvironmentDescriptor | null {
  const conn = openedConnection(store);
  if (conn === null || !hasTables(conn)) return null;
  const row = conn.get("SELECT descriptor FROM environments WHERE hash = ?", hash);
  return row === null ? null : parseDescriptor(row.descriptor);
}

/** The environment of each project `worktreeId` keys, by project name; empty before any record. */
export function worktreeEnvironments(store: Store, worktreeId: WorktreeId): StoredEnvironment[] {
  const conn = openedConnection(store);
  if (conn === null || !hasTables(conn)) return [];
  return conn
    .all(
      `SELECT w.project, w.hash, w.recorded_at, e.descriptor
       FROM worktree_environment_hashes w LEFT JOIN environments e ON e.hash = w.hash
       WHERE w.worktree_id = ? ORDER BY w.project`,
      worktreeId,
    )
    .map(stored);
}

/** The environment `worktreeId` keys `project` with, or `null` before any record. */
export function worktreeEnvironment(
  store: Store,
  worktreeId: WorktreeId,
  project: ProjectName,
): StoredEnvironment | null {
  const conn = openedConnection(store);
  if (conn === null || !hasTables(conn)) return null;
  const row = conn.get(
    `SELECT w.project, w.hash, w.recorded_at, e.descriptor
     FROM worktree_environment_hashes w LEFT JOIN environments e ON e.hash = w.hash
     WHERE w.worktree_id = ? AND w.project = ?`,
    worktreeId,
    project,
  );
  return row === null ? null : stored(row);
}

function stored(row: Row): StoredEnvironment {
  return {
    project: String(row.project),
    hash: String(row.hash),
    descriptor: parseDescriptor(row.descriptor),
    recordedAt: Number(row.recorded_at),
  };
}

/**
 * A stored descriptor, or `null` when it is absent or not one this release
 * reads: another release sharing the store may have written another shape.
 */
function parseDescriptor(text: unknown): EnvironmentDescriptor | null {
  if (typeof text !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const strings = [
    "project",
    "runnerName",
    "runnerVersion",
    "adapterVersion",
    "nodeVersion",
    "platform",
    "arch",
    "installedDependencies",
  ];
  const env = d.env as Record<string, unknown> | null | undefined;
  const sound =
    typeof d.keyFormat === "number" &&
    strings.every((name) => typeof d[name] === "string") &&
    typeof env === "object" &&
    env !== null &&
    Array.isArray(env.names) &&
    typeof env.hash === "string" &&
    typeof d.config === "object" &&
    d.config !== null &&
    Array.isArray(d.files) &&
    typeof d.ci === "boolean";
  return sound ? (value as EnvironmentDescriptor) : null;
}

/** Inserts each descriptor under its hash, after the tables; the caller holds the transaction. */
function insertEnvironments(
  conn: Connection,
  environments: readonly EnvironmentRecord[],
  now: EpochMs,
): void {
  ensureTables(conn);
  for (const { hash, descriptor } of environments) {
    conn.run(
      `INSERT INTO environments (hash, descriptor, recorded_at) VALUES (?, ?, ?)
       ON CONFLICT (hash) DO UPDATE SET descriptor = excluded.descriptor, recorded_at = excluded.recorded_at
       WHERE json_type(environments.descriptor, '$.browser') IS NULL
         AND json_type(excluded.descriptor, '$.browser') IS NOT NULL`,
      hash,
      JSON.stringify(descriptor),
      now,
    );
  }
}

/** `store`'s connection, or `null` for a test's fake or `Proxy` of a store, which has none of its own. */
function openedConnection(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}

function hasTables(conn: Connection): boolean {
  const found = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(Object.keys(ENVIRONMENT_TABLES)),
  );
  return found.length === Object.keys(ENVIRONMENT_TABLES).length;
}

/** Makes each absent `ENVIRONMENT_TABLES` table; called inside the writer's transaction. */
function ensureTables(conn: Connection): void {
  if (hasTables(conn)) return;
  for (const [name, sql] of Object.entries(ENVIRONMENT_TABLES)) {
    if (conn.get("SELECT 1 AS found FROM sqlite_master WHERE name = ?", name) === null) {
      conn.db.exec(sql);
    }
  }
}
