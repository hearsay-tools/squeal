import { str } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import type { AbsolutePath } from "../../types/index.js";
import { createResultRepo } from "./results.js";
import { createStateRepo } from "./states.js";
import { createTransitionRepo } from "./transitions.js";
import type { LintMetaRepo, LintStore } from "./types.js";
import { createViewRepo } from "./views.js";

/** The lint store over an open, migrated connection. */
export function createLintStore(
  conn: Connection,
  schemaVersion: number,
  path: AbsolutePath,
): LintStore {
  return {
    path,
    schemaVersion,
    meta: createMetaRepo(conn),
    results: createResultRepo(conn),
    states: createStateRepo(conn),
    transitions: createTransitionRepo(conn),
    views: createViewRepo(conn),
    transaction: (fn) => conn.transaction(fn),
    read: (fn) => conn.read(fn),
    close: () => conn.close(),
  };
}

function createMetaRepo(conn: Connection): LintMetaRepo {
  return {
    get(key) {
      const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
      return row === null ? null : str(row, "value");
    },
    set(key, value) {
      conn.run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
    },
    delete(key) {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    },
  };
}
