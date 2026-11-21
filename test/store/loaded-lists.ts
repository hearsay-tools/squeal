import type { Connection } from "../../src/core/store/connection.js";
import {
  hasLoadedModulesTable,
  LOADED_MODULES_TABLE,
} from "../../src/core/store/loaded-modules.js";

/*
 * Spec 022 D3 as releases 0.1.496 to 0.1.586 stored it: the `loaded_modules`
 * table and its rows, which this release only empties (row 022-05).
 */
const OLD_TABLE_SQL = `
CREATE TABLE loaded_modules (
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  modules TEXT NOT NULL,
  PRIMARY KEY (project, path, key)
) STRICT, WITHOUT ROWID;
`;

/** A list an older release stored at `key` for `path`, the table made first if absent. */
export function putOldList(conn: Connection, key: string, path = "a.test.ts"): void {
  if (!hasLoadedModulesTable(conn)) conn.db.exec(OLD_TABLE_SQL);
  conn.run(
    `INSERT OR REPLACE INTO ${LOADED_MODULES_TABLE} (project, path, key, recorded_at, modules)
     VALUES ('', ?, ?, 1, ?)`,
    path,
    key,
    JSON.stringify([{ path, hash: "2".repeat(40) }]),
  );
}

/** The number of stored lists; 0 for a store without the table. */
export function oldListCount(conn: Connection): number {
  if (!hasLoadedModulesTable(conn)) return 0;
  return Number(conn.get(`SELECT count(*) AS n FROM ${LOADED_MODULES_TABLE}`)?.n);
}
