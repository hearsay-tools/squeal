import type { Connection } from "./connection.js";
import { deleteByKey } from "./prune-keyed.js";
import { LIST_DELETE_BATCH } from "./prune-rules.js";

/*
 * Spec 022 D3 (amended 2026-11-21, row 022-05): no release stores loaded
 * lists any more. Releases 0.1.496 to 0.1.586 wrote them to the
 * `loaded_modules` main-store table, one row per project, test path and
 * result key. The prune empties that table in slices; the empty table
 * stays, since an older daemon sharing the store makes it again on its next
 * write either way. A run's loaded list still joins its key and its CI part
 * (D2); it is only never stored.
 */
export const LOADED_MODULES_TABLE = "loaded_modules";

/**
 * The prune: every stored list, `LIST_DELETE_BATCH` per slice (row 022-08). Row 021-33 shape:
 * the keys are read outside the write lock, and each slice deletes them in
 * one write transaction. Nothing on a store without the table.
 */
export function* emptyLoadedModules(conn: Connection): Generator<() => void, void, undefined> {
  if (!conn.read(() => hasLoadedModulesTable(conn))) return;
  yield* deleteByKey(conn, {
    table: LOADED_MODULES_TABLE,
    key: ["project", "path", "key"],
    search: "1",
    batch: LIST_DELETE_BATCH,
  });
}

/** Whether `conn`'s database holds the table. */
export function hasLoadedModulesTable(conn: Connection): boolean {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?";
  return conn.get(sql, LOADED_MODULES_TABLE) !== null;
}
