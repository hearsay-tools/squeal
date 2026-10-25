import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Spec 011 C7, the rule accepted on 2026-10-25 after review 0.1.303's
 * re-review B1: "No column is added to an existing table under an unchanged
 * user_version. A new field goes in a new table or a meta row, or comes with
 * a user_version raise." An older daemon keeps its statements prepared while
 * a newer one opens the shared store, and on Node 22 a column added under a
 * held `SELECT r.*, ...` drops a field from what it returns.
 *
 * Every table's columns, in order with their declared types, as the store a
 * daemon opens holds them, per `user_version`. A column change fails here
 * until it comes with a raise and the new version's list. A new table is
 * added to its version's list; a listed table's columns never change.
 */
const COLUMNS: Readonly<Record<number, Readonly<Record<string, readonly string[]>>>> = {
  1: {
    checkpoints: [
      "id TEXT",
      "worktree_id TEXT",
      "revision INTEGER",
      "kind TEXT",
      "test_files TEXT",
      "started_at INTEGER",
      "completed_at INTEGER",
      "end_state TEXT",
    ],
    checks: [
      "id INTEGER",
      "kind TEXT",
      "project TEXT",
      "test_path TEXT",
      "full_name TEXT",
      "location_path TEXT",
      "location_line INTEGER",
      "location_column INTEGER",
      "templated INTEGER",
      "first_seen_at INTEGER",
    ],
    consumer_views: [
      "worktree_id TEXT",
      "session_id TEXT",
      "agent_id TEXT",
      "check_id INTEGER",
      "outcome TEXT",
      "fingerprint TEXT",
      "told_at INTEGER",
    ],
    consumers: [
      "worktree_id TEXT",
      "session_id TEXT",
      "agent_id TEXT",
      "registered_at INTEGER",
      "last_seen_at INTEGER",
      "last_delivered_at INTEGER",
    ],
    failure_texts: ["id TEXT", "summary TEXT", "errors TEXT"],
    file_hashes: [
      "worktree_id TEXT",
      "path TEXT",
      "mtime_ms REAL",
      "ctime_ms REAL",
      "size INTEGER",
      "inode INTEGER",
      "hash TEXT",
    ],
    known_states: [
      "worktree_id TEXT",
      "check_id INTEGER",
      "outcome TEXT",
      "validity TEXT",
      "pending_phase TEXT",
      "observed_at INTEGER",
      "commit_sha TEXT",
      "origin_kind TEXT",
      "origin_worktree TEXT",
      "origin_commit TEXT",
      "duration_ms REAL",
      "location_path TEXT",
      "location_line INTEGER",
      "location_column INTEGER",
      "summary TEXT",
      "fingerprint TEXT",
    ],
    meta: ["key TEXT", "value TEXT"],
    results: [
      "check_id INTEGER",
      "key TEXT",
      "outcome TEXT",
      "duration_ms REAL",
      "location_path TEXT",
      "location_line INTEGER",
      "location_column INTEGER",
      "fingerprint TEXT",
      "failure_id TEXT",
      "worktree_id TEXT",
      "revision INTEGER",
      "commit_sha TEXT",
      "dirty INTEGER",
      "run_id TEXT",
      "recorded_at INTEGER",
      "last_used_at INTEGER",
    ],
    revisions: [
      "worktree_id TEXT",
      "number INTEGER",
      "created_at INTEGER",
      "head TEXT",
      "dirty INTEGER",
      "trigger TEXT",
      "changes TEXT",
    ],
    runs: [
      "id TEXT",
      "worktree_id TEXT",
      "revision INTEGER",
      "test_files TEXT",
      "checkpoint_id TEXT",
      "log_dir TEXT",
      "started_at INTEGER",
      "ended_at INTEGER",
      "end_state TEXT",
    ],
    test_file_keys: [
      "worktree_id TEXT",
      "project TEXT",
      "path TEXT",
      "key TEXT",
      "revision INTEGER",
      "pending TEXT",
    ],
    test_files: [
      "project TEXT",
      "path TEXT",
      "closure_paths TEXT",
      "complete INTEGER",
      "method TEXT",
      "updated_at INTEGER",
      "updated_by TEXT",
    ],
    transitions: [
      "id INTEGER",
      "worktree_id TEXT",
      "check_id INTEGER",
      "kind TEXT",
      "from_outcome TEXT",
      "to_outcome TEXT",
      "from_fingerprint TEXT",
      "to_fingerprint TEXT",
      "revision INTEGER",
      "at INTEGER",
    ],
    worktrees: [
      "id TEXT",
      "root TEXT",
      "common_dir TEXT",
      "is_main INTEGER",
      "registered_at INTEGER",
      "daemon_socket TEXT",
      "daemon_started_at INTEGER",
      "daemon_heartbeat_at INTEGER",
      "daemon_heartbeat_interval_ms INTEGER",
      "daemon_version TEXT",
    ],
  },
};

/** Each table of the database at `path` with its columns, as `COLUMNS` lists them. */
function tableColumns(path: string): Record<string, string[]> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    return Object.fromEntries(
      tables.map((table) => [
        table,
        db
          .prepare("SELECT name, type FROM pragma_table_info(?) ORDER BY cid")
          .all(table)
          .map((column) => `${String(column.name)} ${String(column.type)}`),
      ]),
    );
  } finally {
    db.close();
  }
}

describe("store: each table's columns per user_version (011 C7)", () => {
  it("are the listed ones in the store a daemon opens, at the version it writes", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    expect(tableColumns(storePaths(commonDir).database)).toEqual(COLUMNS[SCHEMA_VERSION]);
  });
});
