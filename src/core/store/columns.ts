import type { DatabaseSync } from "node:sqlite";
import type { Connection } from "./connection.js";

/*
 * Columns added with no `user_version` raise (spec 016 D3, row 016-15). A
 * daemon that finds a newer `user_version` exits (011 C7), so a raise would
 * stop every older daemon of the repository. Every released statement names
 * its columns, so an older daemon leaves an added column empty and reads past
 * it (`tasks/016-15/notes.md`). Each is nullable: empty is "not recorded".
 *
 * `results.runner`: the runner whose run stored the row, as its environment
 * names it (`RunnerEnvironment.runnerName`). A row's key hashes that name, so
 * every row at one key names one runner, whichever worktree stored it; a
 * check alone does not, since checks are shared by every worktree (review
 * 0.1.303 B1).
 */
const ADDED_COLUMNS = [{ table: "results", column: "runner", type: "TEXT" }] as const;

export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const row = db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column);
  return row !== undefined;
}

/**
 * Adds each missing column of `ADDED_COLUMNS` in one write transaction,
 * re-checked under the write lock so concurrent openers add it once. A store
 * busy past the busy timeout fails the open as a busy migration does, and is
 * left as it was. On a store with every column it writes nothing.
 */
export function addColumns(conn: Connection): void {
  if (ADDED_COLUMNS.every((c) => hasColumn(conn.db, c.table, c.column))) return;
  conn.transaction(() => {
    for (const { table, column, type } of ADDED_COLUMNS) {
      if (!hasColumn(conn.db, table, column))
        conn.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  });
}
