import type { MetaRepo, Store } from "../types/index.js";
import { num, str } from "./codec.js";
import type { Connection } from "./connection.js";
import type { StorePaths } from "./paths.js";
import { prune } from "./prune.js";
import { createConsumerRepo, createViewRepo } from "./repos/consumers.js";
import { createResultRepo } from "./repos/results.js";
import { createCheckpointRepo, createRunRepo } from "./repos/runs.js";
import { createKnownStateRepo, createTransitionRepo } from "./repos/states.js";
import { createCheckRepo, createTestFileKeyRepo, createTestFileRepo } from "./repos/test-files.js";
import { createFileHashRepo, createRevisionRepo } from "./repos/workspace.js";
import { createWorktreeRepo } from "./repos/worktrees.js";

const connections = new WeakMap<Store, Connection>();

/** The connection behind a store opened by `openStore`. For diagnostics and tests. */
export function connectionOf(store: Store): Connection {
  const conn = connections.get(store);
  if (conn === undefined) throw new Error("squeal store: not opened by openStore");
  return conn;
}

/**
 * The connection again, under a key a `Proxy` of the store forwards, so a
 * wrapped store (a test's paused reader) still reads in one transaction.
 */
const CONNECTION = Symbol("squeal.connection");

/**
 * Runs `fn`, which only reads, in one read transaction of the store's
 * connection: status reads see one committed state (lessons defect 23).
 */
export function readTransaction<T>(store: Store, fn: () => T): T {
  const conn = (store as { [CONNECTION]?: Connection })[CONNECTION];
  if (conn === undefined) throw new Error("squeal store: not opened by openStore");
  return conn.read(fn);
}

/**
 * What moved the store since it was last read, cheaply: `PRAGMA
 * data_version` moves when another connection commits, `total_changes()`
 * when this one writes (task 001-178). Equal markers mean the database is as
 * it was; `null` for a store not opened by `openStore`.
 */
export interface ChangeMarker {
  readonly others: number;
  readonly own: number;
}

export function changeMarker(store: Store): ChangeMarker | null {
  const conn = (store as { [CONNECTION]?: Connection })[CONNECTION];
  if (conn === undefined) return null;
  const row = conn.get(
    "SELECT data_version AS others, total_changes() AS own FROM pragma_data_version",
  );
  if (row === null) throw new Error("squeal store: no data_version");
  return { others: num(row, "others"), own: num(row, "own") };
}

export function createStore(conn: Connection, schemaVersion: number, paths: StorePaths): Store {
  const worktrees = createWorktreeRepo(conn);
  const store: Store = {
    schemaVersion,
    worktrees,
    revisions: createRevisionRepo(conn),
    fileHashes: createFileHashRepo(conn),
    testFiles: createTestFileRepo(conn),
    testFileKeys: createTestFileKeyRepo(conn),
    checks: createCheckRepo(conn),
    results: createResultRepo(conn),
    runs: createRunRepo(conn),
    checkpoints: createCheckpointRepo(conn),
    knownStates: createKnownStateRepo(conn),
    transitions: createTransitionRepo(conn),
    consumers: createConsumerRepo(conn),
    views: createViewRepo(conn),
    meta: createMetaRepo(conn),
    transaction: (fn) => conn.transaction(fn),
    prune: (options) => prune(conn, worktrees, paths, options),
    close: () => conn.close(),
  };
  connections.set(store, conn);
  Object.defineProperty(store, CONNECTION, { value: conn });
  return store;
}

function createMetaRepo(conn: Connection): MetaRepo {
  return {
    get: (key) => {
      const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
      return row === null ? null : str(row, "value");
    },
    set: (key, value) => {
      conn.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    },
    delete: (key) => {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    },
  };
}
