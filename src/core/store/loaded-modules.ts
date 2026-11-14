import type { EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, FileHash } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { Connection } from "./connection.js";
import { DELETE_BATCH } from "./prune-rules.js";
import { connectionOf } from "./store.js";

/*
 * Spec 022 D3 (contract, committed by the coordinator before wave 1): the
 * modules a test file's worker loaded in one run (D1), stored per result key
 * and shared by every worktree of the repository.
 *
 * An additive main-store table, made by the first write, with no
 * `user_version` raise: an older daemon sharing the store opens it as
 * before and never reads it. No key reads it, so it lives outside
 * `schema.ts`, which the key-format alarm bundles (the pattern of
 * `IMPORT_TABLES` and `COVERED_FILES_TABLE`). A reader of a store that has
 * no such table reads no lists.
 *
 * - `loaded_modules`: by project, test path and the result key the run was
 *   stored under, when it was recorded, and `modules` as JSON
 *   (`LoadedModule[]`, sorted by path). Prune removes a row with the last
 *   result at its key.
 *
 * Row 022-03 owns the write, the table creation and the prune; row 022-05
 * reads it for the reach estimate (D4). Neither changes this shape without
 * the coordinator.
 */
export const LOADED_MODULES_TABLE = "loaded_modules";

export const LOADED_MODULES_SQL = `
CREATE TABLE loaded_modules (
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  modules TEXT NOT NULL,
  PRIMARY KEY (project, path, key)
) STRICT, WITHOUT ROWID;
`;

/** One repository module a test file's worker loaded (D1), with its blob id at the run. */
export interface LoadedModule {
  readonly path: RelativePath;
  readonly hash: FileHash;
}

/** One stored list: what the test file at `path` loaded in the run stored under `key`. */
export interface LoadedModulesRecord {
  readonly project: ProjectName;
  readonly path: RelativePath;
  readonly key: CheckKey;
  readonly recordedAt: EpochMs;
  /** Sorted by path; holds the test file itself (D1, a list without it is never stored). */
  readonly modules: readonly LoadedModule[];
}

/**
 * Stores `record`, inside the caller's transaction (the record's own),
 * replacing the list stored at its key. The first write makes the table. A
 * store `openStore` did not open (a test's fake) records nothing.
 */
export function writeLoadedModules(store: Store, record: LoadedModulesRecord): void {
  const conn = connectionOrNull(store);
  if (conn === null) return;
  if (!hasLoadedModulesTable(conn)) conn.db.exec(LOADED_MODULES_SQL);
  conn.run(
    `INSERT OR REPLACE INTO ${LOADED_MODULES_TABLE} (project, path, key, recorded_at, modules)
     VALUES (?, ?, ?, ?, ?)`,
    record.project,
    record.path,
    record.key,
    record.recordedAt,
    JSON.stringify(record.modules),
  );
}

/**
 * The prune: each list no result is stored at the key of any more,
 * `DELETE_BATCH` per slice, each one write transaction. Nothing on a store
 * without the table.
 */
export function* dropOrphanLoadedModules(conn: Connection): Generator<() => void, void, undefined> {
  if (!conn.read(() => hasLoadedModulesTable(conn))) return;
  let removed = DELETE_BATCH;
  while (removed === DELETE_BATCH) {
    removed = 0;
    yield () => {
      removed = conn.transaction(() =>
        conn.run(
          `DELETE FROM ${LOADED_MODULES_TABLE} WHERE (project, path, key) IN (
             SELECT project, path, key FROM ${LOADED_MODULES_TABLE} l
             WHERE NOT EXISTS (SELECT 1 FROM results r WHERE r.key = l.key) LIMIT ?)`,
          DELETE_BATCH,
        ),
      );
    };
  }
}

/** Whether `conn`'s database holds the table. */
export function hasLoadedModulesTable(conn: Connection): boolean {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?";
  return conn.get(sql, LOADED_MODULES_TABLE) !== null;
}

function connectionOrNull(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}
