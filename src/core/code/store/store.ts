import { str } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import type { AbsolutePath } from "../../types/index.js";
import { createCountRepo, createFileRepo } from "./counts.js";
import { createCoverageRepo } from "./coverage.js";
import { pruneCodeStore } from "./prune.js";
import { createStateRepo } from "./states.js";
import { createTransitionRepo } from "./transitions.js";
import type { CodeMetaRepo, CodeStore } from "./types.js";
import { createViewRepo } from "./views.js";

/** The code store over an open, migrated connection. */
export function createCodeStore(
  conn: Connection,
  schemaVersion: number,
  path: AbsolutePath,
): CodeStore {
  return {
    path,
    schemaVersion,
    meta: createMetaRepo(conn),
    counts: createCountRepo(conn),
    files: createFileRepo(conn),
    states: createStateRepo(conn),
    transitions: createTransitionRepo(conn),
    views: createViewRepo(conn),
    coverage: createCoverageRepo(conn),
    transaction: (fn) => conn.transaction(fn),
    read: (fn) => conn.read(fn),
    prune: (options) => pruneCodeStore(conn, options),
    close: () => conn.close(),
  };
}

function createMetaRepo(conn: Connection): CodeMetaRepo {
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
