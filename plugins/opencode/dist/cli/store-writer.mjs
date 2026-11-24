import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/store-process/writer-thread.ts
import { parentPort, workerData } from "node:worker_threads";

// src/core/store/long-write.ts
import { basename } from "node:path";

// src/core/store/connection.ts
import { AsyncLocalStorage } from "node:async_hooks";
var Connection = class {
  #statements = /* @__PURE__ */ new Map();
  #depth = 0;
  #closed = false;
  db;
  constructor(db) {
    this.db = db;
  }
  /** Runs a statement; returns the number of rows it changed. */
  run(sql, ...params) {
    const statement = this.#statement(sql);
    const changes = () => statement.run(...params).changes;
    return Number(this.#depth > 0 ? changes() : this.#withinSlice(changes));
  }
  get(sql, ...params) {
    return this.#statement(sql).get(...params) ?? null;
  }
  all(sql, ...params) {
    return this.#statement(sql).all(...params);
  }
  /**
   * Runs `fn` in a `BEGIN IMMEDIATE` transaction, or in a savepoint when one
   * is already open. Spec 001 D8: "short `BEGIN IMMEDIATE` write
   * transactions": the write lock is taken up front, so a writer waits on the
   * busy timeout instead of failing to upgrade a read snapshot. Spec 021
   * D3: the thread's write observer (`observeWrites`), when set, is told once
   * the lock is held and again at the end.
   */
  transaction(fn) {
    const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
    let ended = null;
    if (savepoint === null) {
      this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
      ended = observer?.(this.db) ?? null;
    } else this.db.exec(`SAVEPOINT ${savepoint}`);
    this.#depth++;
    try {
      const result = fn();
      this.db.exec(savepoint === null ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      if (savepoint === null) rollback(this.db);
      else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.#depth--;
      ended?.();
    }
  }
  /**
   * Runs `fn`, which only reads, in a deferred `BEGIN` transaction, so every
   * statement in it sees one committed state of the store. In WAL a reader
   * never blocks the writer and the writer never blocks it (spec 001 D8).
   * Inside an open transaction it just runs `fn`: that is one state already.
   */
  read(fn) {
    if (this.#depth > 0) return fn();
    this.db.exec("BEGIN");
    this.#depth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(this.db);
      throw error;
    } finally {
      this.#depth--;
    }
  }
  /** Idempotent. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#statements.clear();
    this.db.close();
  }
  /**
   * Runs `fn`, one statement that takes the write lock, with the busy slice
   * of the caller's async context as its busy timeout when that is shorter,
   * and restores the connection's own before returning (task 001-422). One
   * synchronous call: no other statement runs while the slice is set.
   */
  #withinSlice(fn) {
    const slice = slices.getStore();
    if (slice === void 0 || !slice.live) return fn();
    const own = Number(Object.values(this.#statement("PRAGMA busy_timeout").get() ?? {})[0]);
    if (!(slice.ms < own)) return fn();
    this.db.exec(`PRAGMA busy_timeout = ${slice.ms}`);
    try {
      return fn();
    } finally {
      this.db.exec(`PRAGMA busy_timeout = ${own}`);
    }
  }
  #statement(sql) {
    let statement = this.#statements.get(sql);
    if (statement === void 0) {
      statement = this.db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }
};
var observer = null;
function observeWrites(next) {
  observer = next;
}
function observedWrite(db) {
  return observer?.(db) ?? null;
}
var slices = new AsyncLocalStorage();
function rollback(db) {
  if (db.isTransaction) db.exec("ROLLBACK");
}
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/store/long-write.ts
var LONG_WRITE_MS = 250;
var sink = null;
function logLongWrites(to) {
  sink = to;
  observeWrites(startWrite);
  return () => {
    if (sink !== to) return;
    sink = null;
    observeWrites(null);
  };
}
function startWrite(db) {
  if (sink === null) return null;
  const at = performance.now();
  const changes = totalChanges(db);
  return function endWrite() {
    const ms = performance.now() - at;
    if (sink === null || ms <= LONG_WRITE_MS) return;
    sink({
      database: basename(fileOf(db)),
      operation: operationOf(new Error().stack ?? ""),
      ms: Math.round(ms),
      rows: totalChanges(db) - changes
    });
  };
}
function longWriteLine(write) {
  const rows = `${write.rows} ${write.rows === 1 ? "row" : "rows"} written`;
  const database = write.database === "" ? "a database in memory" : write.database;
  return `long write: ${database} write lock held ${write.ms} ms by ${write.operation}; ${rows}`;
}
var STORE_FRAME = /^(?:\w*Connection\d*\.|Object\.transaction$|transaction$|endWrite$)/;
function operationOf(stack) {
  const names = stack.split("\n").slice(1).map(frameName).filter((name) => name !== null && !STORE_FRAME.test(name));
  return names.slice(0, 3).join(" < ") || "unknown";
}
function frameName(line) {
  const match = /^\s*at (?:async )?(.+?)(?: \((.+)\))?$/.exec(line);
  if (match === null) return null;
  const [, name = "", location2] = match;
  if (location2 !== void 0) return name;
  const place = /([^/\\]+):(\d+):\d+$/.exec(name);
  return place === null ? name : `${place[1]}:${place[2]}`;
}
var files = /* @__PURE__ */ new WeakMap();
function fileOf(db) {
  let file = files.get(db);
  if (file === void 0) {
    const rows = db.prepare("PRAGMA database_list").all();
    const main = rows.find((row) => row.name === "main")?.file;
    file = typeof main === "string" ? main : "";
    files.set(db, file);
  }
  return file;
}
var counters = /* @__PURE__ */ new WeakMap();
function totalChanges(db) {
  let statement = counters.get(db);
  if (statement === void 0) {
    statement = db.prepare("SELECT total_changes() AS n");
    counters.set(db, statement);
  }
  return Number(statement.get()?.n);
}

// src/core/code/store/open.ts
import { existsSync, mkdirSync } from "node:fs";
import { join as join2 } from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/store/open.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// src/core/store/mark.ts
import { DatabaseSync } from "node:sqlite";

// src/core/store/paths.ts
import { basename as basename2, dirname, join } from "node:path";
function storePaths(commonDir) {
  const dir = join(commonDir, "squeal");
  return {
    dir,
    database: join(dir, "store.sqlite"),
    runsDir: join(dir, "runs"),
    locksDir: join(dir, "locks")
  };
}

// src/core/store/schema.ts
var V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  common_dir TEXT NOT NULL,
  is_main INTEGER NOT NULL,
  registered_at INTEGER NOT NULL,
  daemon_socket TEXT,
  daemon_started_at INTEGER,
  daemon_heartbeat_at INTEGER,
  daemon_heartbeat_interval_ms INTEGER,
  daemon_version TEXT
) STRICT;

CREATE TABLE revisions (
  worktree_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  head TEXT,
  dirty INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  changes TEXT NOT NULL,
  PRIMARY KEY (worktree_id, number)
) STRICT;

CREATE TABLE file_hashes (
  worktree_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  ctime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  inode INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (worktree_id, path)
) STRICT, WITHOUT ROWID;

CREATE TABLE test_files (
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  closure_paths TEXT NOT NULL,
  complete INTEGER NOT NULL,
  method TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project, path)
) STRICT;

CREATE TABLE test_file_keys (
  worktree_id TEXT NOT NULL,
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT,
  revision INTEGER NOT NULL,
  pending TEXT,
  PRIMARY KEY (worktree_id, project, path)
) STRICT;
CREATE INDEX test_file_keys_by_key ON test_file_keys (key);

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  project TEXT NOT NULL,
  test_path TEXT NOT NULL,
  full_name TEXT NOT NULL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  templated INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  UNIQUE (project, test_path, kind, full_name)
) STRICT;

CREATE TABLE failure_texts (
  id TEXT PRIMARY KEY,
  summary TEXT,
  errors TEXT NOT NULL
) STRICT;

CREATE TABLE results (
  check_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  fingerprint TEXT,
  failure_id TEXT,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  commit_sha TEXT,
  dirty INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (check_id, key)
) STRICT;
CREATE INDEX results_by_key ON results (key);
CREATE INDEX results_by_check_time ON results (check_id, recorded_at);
CREATE INDEX results_by_time ON results (recorded_at);
CREATE INDEX results_by_last_use ON results (last_used_at);
CREATE INDEX results_by_worktree ON results (worktree_id, check_id, recorded_at);
CREATE INDEX results_by_run ON results (run_id);
CREATE INDEX results_by_failure ON results (failure_id);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  test_files TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  end_state TEXT
) STRICT;
CREATE INDEX checkpoints_by_worktree ON checkpoints (worktree_id, end_state, completed_at);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  test_files TEXT NOT NULL,
  checkpoint_id TEXT,
  log_dir TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_state TEXT
) STRICT;
CREATE INDEX runs_by_checkpoint ON runs (checkpoint_id);

CREATE TABLE known_states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  validity TEXT NOT NULL,
  pending_phase TEXT,
  observed_at INTEGER,
  commit_sha TEXT,
  origin_kind TEXT,
  origin_worktree TEXT,
  origin_commit TEXT,
  duration_ms REAL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  summary TEXT,
  fingerprint TEXT,
  PRIMARY KEY (worktree_id, check_id)
) STRICT;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  from_outcome TEXT,
  to_outcome TEXT NOT NULL,
  from_fingerprint TEXT,
  to_fingerprint TEXT,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE consumers (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_delivered_at INTEGER,
  PRIMARY KEY (worktree_id, session_id, agent_id)
) STRICT;

CREATE TABLE consumer_views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id)
) STRICT;
`;
var MIGRATIONS = [(db) => db.exec(V1)];
var SCHEMA_VERSION = MIGRATIONS.length;
function userVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
}
function migrate(db, migrations = MIGRATIONS) {
  if (userVersion(db) >= migrations.length) return userVersion(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const from = userVersion(db);
    for (let version = from; version < migrations.length; version++) {
      migrations[version]?.(db);
    }
    if (from < migrations.length) db.exec(`PRAGMA user_version = ${migrations.length}`);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
  return userVersion(db);
}

// src/core/store/codec.ts
function str(row, column) {
  const value = row[column];
  if (typeof value !== "string") throw new TypeError(`squeal store: ${column} is not text`);
  return value;
}
function num(row, column) {
  const value = row[column];
  if (typeof value !== "number") throw new TypeError(`squeal store: ${column} is not a number`);
  return value;
}
function numOrNull(row, column) {
  return row[column] === null ? null : num(row, column);
}
function json(row, column) {
  return JSON.parse(str(row, column));
}
function oneOf(row, column, values) {
  const value = str(row, column);
  if (!values.includes(value)) {
    throw new TypeError(`squeal store: ${column} has unexpected value ${value}`);
  }
  return value;
}
function oneOfOrNull(row, column, values) {
  return row[column] === null ? null : oneOf(row, column, values);
}
var CHECK_COLUMNS = "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";

// src/core/store/prune-checkpoint.ts
function* checkpointAfterWrites(conn, slices2) {
  for (const slice of slices2) {
    let wrote = false;
    yield () => {
      const before = writeMark(conn);
      withoutAutoCheckpoint(conn, slice);
      wrote = writeMark(conn) !== before;
      return wrote;
    };
    if (wrote) yield () => checkpoint(conn);
  }
}
function withoutAutoCheckpoint(conn, fn) {
  const own = Number(conn.get("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint);
  conn.db.exec("PRAGMA wal_autocheckpoint = 0");
  try {
    fn();
  } finally {
    conn.db.exec(`PRAGMA wal_autocheckpoint = ${own}`);
  }
}
function checkpoint(conn) {
  conn.get("PRAGMA wal_checkpoint(PASSIVE)");
}
function writeMark(conn) {
  const changes = conn.get("SELECT total_changes() AS n")?.n;
  const pages = conn.get("PRAGMA page_count")?.page_count;
  return `${String(changes)}:${String(pages)}`;
}

// src/core/store/repos/replaced.ts
var FAILING_AT = `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
  JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
  WHERE r.key = ? AND r.outcome = 'fail'`;

// src/core/store/prune-rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var DELETE_BATCH = 256;
var VACUUM_PAGES = 8;
var VACUUM_SLICE_MS = 100;
var LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key IS NOT NULL`;
var MAIN = "SELECT id FROM worktrees WHERE is_main = 1";
var UNPROTECTED = `key NOT IN (${LIVE_KEYS})
  AND NOT (worktree_id IN (${MAIN}) AND NOT EXISTS (
    SELECT 1 FROM results n
    WHERE n.check_id = results.check_id AND n.worktree_id IN (${MAIN})
      AND (n.recorded_at > results.recorded_at
           OR (n.recorded_at = results.recorded_at AND n.rowid > results.rowid))))`;
var PRUNABLE = `${UNPROTECTED} AND recorded_at < ?`;

// src/core/store/prune-keyed.ts
function* deleteByKey(conn, rule) {
  const batch = rule.batch ?? DELETE_BATCH;
  const columns = rule.key.join(", ");
  const after = rule.key.map(() => "?").join(", ");
  const read = (from) => `SELECT ${columns} FROM ${rule.table}
     WHERE ${from ? `(${columns}) > (${after}) AND ` : ""}(${rule.search})
     ORDER BY ${columns} LIMIT ${batch}`;
  const first = read(false);
  const next = read(true);
  const named = rule.key.map((_, i) => `value ->> ${i}`).join(", ");
  const remove = `DELETE FROM ${rule.table}
    WHERE (${columns}) IN (SELECT ${named} FROM json_each(?)) AND (${rule.recheck ?? rule.search})`;
  const searchParams = rule.searchParams ?? [];
  let last = null;
  for (; ; ) {
    let keys = [];
    yield () => {
      const rows = conn.read(
        () => last === null ? conn.all(first, ...searchParams) : conn.all(next, ...last, ...searchParams)
      );
      keys = rows.map((row) => rule.key.map((column) => row[column]));
      return false;
    };
    if (keys.length === 0) return;
    const list = JSON.stringify(keys);
    yield () => {
      const n = conn.transaction(
        () => conn.run(remove, list, ...rule.recheckParams?.() ?? searchParams)
      );
      rule.removed?.(n);
      return n > 0;
    };
    if (keys.length < batch) return;
    last = keys[keys.length - 1] ?? null;
  }
}
var worktreeIdsOf = (table) => `WITH RECURSIVE ids(id) AS (
    SELECT min(worktree_id) FROM ${table}
    UNION ALL SELECT (SELECT min(worktree_id) FROM ${table} WHERE worktree_id > ids.id)
      FROM ids WHERE ids.id IS NOT NULL)
  SELECT id FROM ids WHERE id IS NOT NULL`;
function worktreeIdList(conn, table) {
  return JSON.stringify(conn.all(worktreeIdsOf(table)).map((row) => row.id));
}
function hasIndexes(conn, ...names) {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?";
  return names.every((name) => conn.get(sql, name) !== null);
}

// src/core/store/prune-vacuum.ts
function vacuum(conn, clock = () => performance.now()) {
  return checkpointAfterWrites(conn, vacuumSlices(conn, clock));
}
function* vacuumSlices(conn, clock) {
  let free = freePages(conn);
  while (free > 0) {
    yield () => conn.transaction(() => vacuumFor(conn, clock));
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
  }
}
function vacuumFor(conn, clock) {
  const start = clock();
  let free = freePages(conn);
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
    if (clock() - start >= VACUUM_SLICE_MS) return;
  }
}
function freePages(conn) {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count ?? 0);
}

// src/core/store/repos/results.ts
var SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
var NEWEST_OF_FILE = `${SELECT_RESULTS}
  WHERE c.project = ? AND c.test_path = ? AND r.key = (
    SELECT r2.key FROM checks c2 JOIN results r2 ON r2.check_id = c2.id
    WHERE c2.project = ? AND c2.test_path = ?
    ORDER BY r2.recorded_at DESC, r2.rowid DESC LIMIT 1)
  ORDER BY c.kind, c.full_name`;

// src/core/store/repos/states.ts
var SELECT_STATES = `SELECT s.*, ${CHECK_COLUMNS} FROM known_states s JOIN checks c ON c.id = s.check_id`;

// src/core/store/open.ts
var DEFAULT_BUSY_TIMEOUT_MS = 1e3;
var JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;
var CONNECTION_PRAGMAS = ["PRAGMA cache_size = -16384", "PRAGMA temp_store = MEMORY"];
function switchToWal(db, ms) {
  const deadline = Date.now() + ms;
  for (; ; ) {
    try {
      const mode = db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
      if (mode !== "wal") throw new Error(`squeal store: journal_mode is ${String(mode)}, not wal`);
      return;
    } catch (error) {
      if (!isBusy(error) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}
function isCorruption(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}

// src/core/code/store/schema.ts
var V12 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE counts (
  blob TEXT NOT NULL,
  language TEXT NOT NULL,
  counter_version INTEGER NOT NULL,
  functions TEXT NOT NULL,
  errors TEXT NOT NULL,
  counted_at INTEGER NOT NULL,
  PRIMARY KEY (blob, language, counter_version)
) STRICT, WITHOUT ROWID;

CREATE TABLE files (
  worktree_id TEXT NOT NULL,
  path TEXT NOT NULL,
  blob TEXT NOT NULL,
  language TEXT NOT NULL,
  counter_version INTEGER NOT NULL,
  size INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  too_big INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (worktree_id, path)
) STRICT, WITHOUT ROWID;
CREATE INDEX files_by_count ON files (blob, language, counter_version);

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  UNIQUE (path, qualified_name, occurrence)
) STRICT;

CREATE TABLE states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  outcome TEXT NOT NULL,
  value REAL,
  threshold REAL,
  counted_at INTEGER NOT NULL,
  blob TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  edited_revision INTEGER,
  edited_at INTEGER,
  PRIMARY KEY (worktree_id, check_id, measure)
) STRICT, WITHOUT ROWID;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_outcome TEXT,
  to_outcome TEXT,
  from_value REAL,
  to_value REAL,
  threshold REAL,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  outcome TEXT NOT NULL,
  threshold REAL,
  told TEXT NOT NULL,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id, measure)
) STRICT, WITHOUT ROWID;

CREATE TABLE coverage (
  result_key TEXT NOT NULL,
  provider_version INTEGER NOT NULL,
  record BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (result_key, provider_version)
) STRICT, WITHOUT ROWID;
`;
var CODE_MIGRATIONS = [(db) => db.exec(V12)];
var CODE_SCHEMA_VERSION = CODE_MIGRATIONS.length;
var CODE_INDEXES = {
  coverage_stored: "CREATE INDEX coverage_stored ON coverage (result_key, provider_version, recorded_at)",
  coverage_recorded: "CREATE INDEX coverage_recorded ON coverage (recorded_at)",
  counts_keys: "CREATE INDEX counts_keys ON counts (blob, language, counter_version)",
  states_failing: "CREATE INDEX states_failing ON states (worktree_id, measure) WHERE outcome = 'fail'",
  states_edited: "CREATE INDEX states_edited ON states (worktree_id, measure) WHERE edited_at IS NOT NULL",
  states_non_pass: "CREATE INDEX states_non_pass ON states (worktree_id, measure, outcome) WHERE outcome != 'pass'",
  states_by_blob: "CREATE INDEX states_by_blob ON states (blob)",
  views_by_check: "CREATE INDEX views_by_check ON views (check_id)"
};
var CODE_TABLES = {
  coverage_parts: `
CREATE TABLE coverage_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  part BLOB NOT NULL,
  used_at INTEGER NOT NULL
) STRICT;
CREATE INDEX coverage_parts_used ON coverage_parts (used_at);
`
};

// src/core/delivery/held-connection.ts
var HoldingConnection = class extends Connection {
  #held = false;
  #savepoints = 0;
  /** Calls of the plain `transaction` or `read` in progress: no hold starts inside one. */
  #inside = 0;
  /** The database file, which this thread's holds are kept by. */
  #file;
  constructor(db) {
    super(db);
    this.#file = fileOf2(db);
  }
  /** Whether a held transaction is open. */
  get held() {
    return this.#held;
  }
  run(sql, ...params) {
    this.#notBlocked();
    return super.run(sql, ...params);
  }
  transaction(fn) {
    if (!this.#held) {
      this.#notBlocked();
      return this.#plain(() => super.transaction(fn));
    }
    const name = `squeal_held_${++this.#savepoints}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    } finally {
      this.#savepoints--;
    }
  }
  read(fn) {
    return this.#held ? fn() : this.#plain(() => super.read(fn));
  }
  /**
   * Opens a `BEGIN IMMEDIATE` transaction and leaves it open; `null` when one
   * is already open, held or not, so the caller writes in that one instead.
   * Spec 021 D3: opened while this thread holds another database, it never
   * waits, since the wait would keep that one's lock: a busy database fails
   * it at once.
   */
  hold() {
    if (this.#held || this.#inside > 0) return null;
    this.#notBlocked();
    this.#begin();
    this.#held = true;
    holders.set(this.#file, this);
    let open = true;
    const end = () => {
      open = false;
      this.#held = false;
      release(this.#file, this);
    };
    return {
      commit: () => {
        if (!open) return;
        try {
          this.db.exec("COMMIT");
        } catch (error) {
          rollback(this.db);
          throw error;
        } finally {
          end();
        }
      },
      rollback: () => {
        if (!open) return;
        end();
        rollback(this.db);
      }
    };
  }
  /** Closing rolls an open hold back (SQLite does), and it no longer holds the database for this thread. */
  close() {
    if (this.#held) {
      this.#held = false;
      release(this.#file, this);
    }
    super.close();
  }
  /** The wait for this database's hold by another connection of this thread; `null` when none holds it. */
  heldElsewhere() {
    const other = holders.get(this.#file);
    if (other === void 0 || other === this) return null;
    return new Promise((resolve) => waiters.push({ file: this.#file, resolve }));
  }
  /**
   * A write here while another connection of this thread holds the database
   * would wait on that hold with the thread blocked, so the hold could never
   * end: it fails at once as busy instead, and the hook goes silent.
   */
  #notBlocked() {
    const other = holders.get(this.#file);
    if (other !== void 0 && other !== this) throw threadBusy();
  }
  /** `BEGIN IMMEDIATE`, with no busy wait while this thread holds another database. */
  #begin() {
    if (![...holders.keys()].some((file) => file !== this.#file)) {
      this.db.exec("BEGIN IMMEDIATE");
      return;
    }
    const own = Number(Object.values(this.db.prepare("PRAGMA busy_timeout").get() ?? {})[0]);
    this.db.exec("PRAGMA busy_timeout = 0");
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } finally {
      this.db.exec(`PRAGMA busy_timeout = ${own}`);
    }
  }
  #plain(fn) {
    this.#inside++;
    try {
      return fn();
    } finally {
      this.#inside--;
    }
  }
};
var holders = /* @__PURE__ */ new Map();
var waiters = [];
function release(file, holder) {
  if (holders.get(file) !== holder) return;
  holders.delete(file);
  const ready = waiters.filter((w) => w.file === file);
  waiters = waiters.filter((w) => w.file !== file);
  for (const waiter of ready) waiter.resolve();
}
function fileOf2(db) {
  const rows = db.prepare("PRAGMA database_list").all();
  const file = rows.find((row) => row.name === "main")?.file;
  return typeof file === "string" ? file : "";
}
function threadBusy() {
  return Object.assign(new Error("database is locked: a delivery of this thread holds it"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5
  });
}

// src/core/delivery/sent-meta.ts
var READ = "SELECT value FROM meta WHERE key = ?";
var SETS = /* @__PURE__ */ new Set([
  "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
]);
var DELETE = "DELETE FROM meta WHERE key = ?";
function readsMeta(sql) {
  return sql === READ;
}
function overlaidMeta(sql, params, pending) {
  if (sql !== READ || pending.length === 0) return void 0;
  const key = params[0];
  for (let i = pending.length - 1; i >= 0; i--) {
    const write = pending[i];
    if (write.params[0] !== key) continue;
    if (SETS.has(write.sql)) return { value: write.params[1] };
    if (write.sql === DELETE) return null;
  }
  return void 0;
}

// src/core/delivery/sending-connection.ts
var NeedsLease = class extends Error {
  constructor() {
    super("squeal: a store write needs the worktree's write lease first");
  }
};
var SendingConnection = class extends HoldingConnection {
  #direct = false;
  #depth = 0;
  #batch = [];
  #held = null;
  /** Spec 024 D2: a batch ended in `unit`'s synchronous run of its work, sent once that run ends. */
  #deferred = null;
  /** Whether `unit` runs its work synchronously now: a batch ended now is deferred (`#run`). */
  #deferring = false;
  /** Batches sent outside a hold and not yet written. */
  #unsent = 0;
  #sending = /* @__PURE__ */ new Set();
  #failure = null;
  #closing = false;
  #sender;
  constructor(db, sender) {
    super(db);
    this.#sender = sender;
    db.exec("PRAGMA query_only = 1");
  }
  /** Whether the store is written here: no daemon took the writes. */
  get direct() {
    return this.#direct;
  }
  get held() {
    return this.#direct ? super.held : this.#held !== null;
  }
  /**
   * Runs `work`, then waits until its batches are written and ends the lease
   * unless a hold keeps it. A write before the lease (`NeedsLease`) takes
   * it, through `acquire`, and runs `work` again: nothing was kept by then.
   * `acquire` says whether a daemon took the lease; when none does, this
   * connection writes the store itself from then on.
   */
  async unit(work, acquire) {
    for (let tries = 0; ; tries++) {
      try {
        const result = await this.#run(work);
        await this.settle();
        return result;
      } catch (error) {
        if (!(error instanceof NeedsLease) || tries > 0) {
          await this.settle().catch(() => {
          });
          throw error;
        }
        if (!await acquire()) this.#becomeDirect();
      }
    }
  }
  /**
   * Spec 024 D2: runs `work`, sending the batch its synchronous run ends once that run ends:
   * when it returns, or at its first `await`, before which nothing else ran. Work that
   * returned without awaiting, in no other unit's work, writes nothing after that batch, so
   * the batch ends the lease as it is written (`release`): one request, not a write and then a
   * release. Any other batch is sent as before, and `settle` ends the lease.
   */
  #run(work) {
    const outer = this.#deferring;
    this.#deferring = true;
    let result;
    try {
      result = work();
    } catch (error) {
      this.#deferring = outer;
      this.#flush(false);
      throw error;
    }
    this.#deferring = outer;
    this.#flush(!outer && !isThenable(result));
    return result;
  }
  /** Sends the deferred batch, if any; `release` ends the lease once it is written. */
  #flush(release2) {
    const batch = this.#deferred;
    if (batch === null) return;
    this.#deferred = null;
    this.#track(this.#send(batch, release2), true);
  }
  /** Writes the store here from now on: no daemon serves. Before any write. */
  writeDirectly() {
    this.#becomeDirect();
  }
  /** Waits until every batch sent so far is written, then ends the lease unless a hold keeps it. */
  async settle() {
    try {
      await this.sent();
    } finally {
      if (!this.#direct && this.#held === null && this.#sender.leased) await this.#sender.release();
    }
  }
  /** Row 021-36: whether a batch sent is not written yet (or a failed one not yet told). */
  get unsettled() {
    return this.#sending.size > 0 || this.#failure !== null || this.#deferred !== null;
  }
  /** Waits until every batch sent so far is written; rethrows the first that failed. */
  async sent() {
    this.#flush(false);
    while (this.#sending.size > 0) await Promise.allSettled([...this.#sending]);
    this.#rethrow();
  }
  /** Throws the first failed batch not yet told, once. */
  #rethrow() {
    const failure = this.#failure;
    if (failure === null) return;
    this.#failure = null;
    this.#sender.surfaced?.();
    throw failure;
  }
  run(sql, ...params) {
    if (this.#direct) return super.run(sql, ...params);
    if (this.#depth > 0) {
      this.#batch.push({ sql, params });
      return 0;
    }
    return this.transaction(() => this.run(sql, ...params));
  }
  get(sql, ...params) {
    if (this.#direct) return super.get(sql, ...params);
    this.#readable();
    if (!readsMeta(sql)) return super.get(sql, ...params);
    const overlaid = overlaidMeta(sql, params, this.#pending());
    return overlaid === void 0 ? super.get(sql, ...params) : overlaid;
  }
  all(sql, ...params) {
    if (this.#direct) return super.all(sql, ...params);
    this.#readable();
    return super.all(sql, ...params);
  }
  transaction(fn) {
    if (this.#direct) return super.transaction(fn);
    const outer = this.#depth === 0;
    if (outer) {
      if (this.#held === null && !this.#sender.leased) throw new NeedsLease();
      if (this.#sender.post !== void 0) this.#rethrow();
      this.#readable();
      this.db.exec("BEGIN");
    }
    const mark = this.#batch.length;
    this.#depth++;
    try {
      const result = fn();
      if (outer) {
        this.db.exec("COMMIT");
        this.#end(this.#batch);
      }
      return result;
    } catch (error) {
      this.#batch.length = mark;
      if (outer) {
        this.#batch = [];
        rollback(this.db);
      }
      throw error;
    } finally {
      this.#depth--;
    }
  }
  read(fn) {
    if (this.#direct) return super.read(fn);
    if (this.#depth > 0) return fn();
    this.#readable();
    this.db.exec("BEGIN");
    this.#depth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(this.db);
      throw error;
    } finally {
      this.#depth--;
    }
  }
  /**
   * Keeps every batch from now until the hold's commit, which sends them as
   * one and ends the lease once they are written; its rollback drops them
   * and ends the lease. `null` inside a transaction or a hold, as
   * `HoldingConnection.hold` is. Needs the lease (`NeedsLease`).
   */
  hold() {
    if (this.#direct) return super.hold();
    if (this.#held !== null || this.#depth > 0) return null;
    if (!this.#sender.leased) throw new NeedsLease();
    this.#readable();
    const held = [];
    this.#held = held;
    let open = true;
    return {
      commit: () => {
        if (!open) return;
        open = false;
        this.#held = null;
        this.#track(this.#send(held, true), false);
      },
      rollback: () => {
        if (!open) return;
        open = false;
        this.#held = null;
        this.#track(this.#sender.release(), false);
      }
    };
  }
  heldElsewhere() {
    return this.#direct ? super.heldElsewhere() : null;
  }
  /**
   * Closes once every batch sent is written, since one the daemon does not
   * take is written here. A hold left open is dropped and its lease ended:
   * a live process keeps its lease until then (review 0.1.442 B3).
   */
  close() {
    this.#flush(false);
    if (this.#held !== null || this.#sender.leased && !this.#direct) {
      this.#held = null;
      this.#track(this.#sender.release(), false);
    }
    if (this.#sending.size === 0) {
      super.close();
      return;
    }
    if (this.#closing) return;
    this.#closing = true;
    void Promise.allSettled([...this.#sending]).then(() => super.close());
  }
  /** A read now would miss writes not yet written: it must wait for them (`sent`). */
  #readable() {
    if (this.#unsent > 0 || this.#deferred !== null) {
      throw new Error("squeal: a store read before this hook's writes were written (await sent())");
    }
  }
  /** What a read here must see before the store has it: the hold's batch, then the open one. */
  #pending() {
    if (this.#held === null) return this.#depth > 0 ? this.#batch : [];
    return this.#depth > 0 ? [...this.#held, ...this.#batch] : this.#held;
  }
  #end(batch) {
    this.#batch = [];
    if (batch.length === 0) return;
    if (this.#sender.post !== void 0) this.#track(this.#sender.post(batch), false);
    else if (this.#held !== null) this.#held.push(...batch);
    else if (this.#deferring) this.#deferred = batch;
    else this.#track(this.#send(batch, false), true);
  }
  /** Sends `batch`; when no daemon takes it, writes it here and stays direct. */
  async #send(batch, release2) {
    if (batch.length === 0) {
      if (release2) await this.#sender.release();
      return;
    }
    if (await this.#sender.send(batch, release2) === "written") return;
    this.#becomeDirect();
    super.transaction(() => {
      for (const { sql, params } of batch) super.run(sql, ...params);
    });
  }
  #track(sending, unsent) {
    if (unsent) this.#unsent++;
    const tracked = sending.then(
      () => {
      },
      (error) => {
        this.#failure ??= error;
      }
    );
    const done = tracked.finally(() => {
      if (unsent) this.#unsent--;
      this.#sending.delete(done);
    });
    this.#sending.add(done);
  }
  /** From now on the store is written here, as `HoldingConnection` writes it. */
  #becomeDirect() {
    if (this.#direct) return;
    this.#direct = true;
    this.db.exec("PRAGMA query_only = 0");
  }
};
function isThenable(value) {
  return typeof value?.then === "function";
}

// src/core/code/store/counts.ts
var LANGUAGES = [
  "typescript",
  "javascript",
  "python"
];
function createCountRepo(conn) {
  return {
    get(blob, language, counterVersion) {
      const row = conn.get(
        "SELECT * FROM counts WHERE blob = ? AND language = ? AND counter_version = ?",
        blob,
        language,
        counterVersion
      );
      return row === null ? null : toCount(row);
    },
    put(count, at) {
      conn.run(
        `INSERT INTO counts (blob, language, counter_version, functions, errors, counted_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        count.blob,
        count.language,
        count.counterVersion,
        JSON.stringify(count.functions),
        JSON.stringify(count.errors),
        at
      );
    }
  };
}
var COUNT_KEYS = "counts_keys";
function createFileRepo(conn) {
  const keyed = conn.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?",
    COUNT_KEYS
  ) !== null;
  const counts = keyed ? `counts c INDEXED BY ${COUNT_KEYS}` : "counts c";
  return {
    list(worktreeId, paths) {
      const rows = paths === void 0 ? conn.all("SELECT * FROM files WHERE worktree_id = ? ORDER BY path", worktreeId) : conn.all(
        `SELECT * FROM files WHERE worktree_id = ? AND path IN (SELECT value FROM json_each(?))
               ORDER BY path`,
        worktreeId,
        JSON.stringify(paths)
      );
      return rows.map(toFile);
    },
    uncounted(worktreeId) {
      return conn.all(
        `SELECT * FROM files f WHERE f.worktree_id = ? AND f.too_big = 0 AND NOT EXISTS (
             SELECT 1 FROM ${counts} WHERE c.blob = f.blob AND c.language = f.language
               AND c.counter_version = f.counter_version)
           ORDER BY f.path`,
        worktreeId
      ).map(toFile);
    },
    upsertMany(worktreeId, files2) {
      conn.transaction(() => {
        for (const file of files2) {
          conn.run(
            `INSERT INTO files (worktree_id, path, blob, language, counter_version, size, revision,
               too_big) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, path) DO UPDATE SET blob = excluded.blob,
               language = excluded.language, counter_version = excluded.counter_version,
               size = excluded.size, revision = excluded.revision, too_big = excluded.too_big`,
            worktreeId,
            file.path,
            file.blob,
            file.language,
            file.counterVersion,
            file.size,
            file.revision,
            file.tooBig === true ? 1 : 0
          );
        }
      });
    },
    removeMany(worktreeId, paths) {
      conn.run(
        "DELETE FROM files WHERE worktree_id = ? AND path IN (SELECT value FROM json_each(?))",
        worktreeId,
        JSON.stringify(paths)
      );
    }
  };
}
function toCount(row) {
  return {
    blob: str(row, "blob"),
    language: oneOf(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    functions: json(row, "functions"),
    errors: json(row, "errors")
  };
}
function toFile(row) {
  return {
    path: str(row, "path"),
    blob: str(row, "blob"),
    language: oneOf(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    size: num(row, "size"),
    revision: num(row, "revision"),
    ...num(row, "too_big") === 1 ? { tooBig: true } : {}
  };
}

// src/core/code/coverage/parts.ts
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";

// src/core/fs/compare.ts
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/core/code/coverage/parts.ts
var SYNC = { finishFlush: constants.Z_SYNC_FLUSH };
var MANIFEST_HEAD = stored('{"v":1,"sources":[],"parts":');
var RECORD_HEAD = stored('{"v":1,"sources":[');
var COMMA = stored(",");
function manifestBytes(record, ids) {
  const pairs = [];
  let at = 0;
  let id = 0;
  record.parts.forEach((part, i) => {
    const partId = ids[i] ?? 0;
    pairs.push(part.at - at, partId - id);
    at = part.at;
    id = partId;
  });
  const middle = `[${pairs.join(",")}],"unreadAt":[${record.unread.join(",")}],`;
  return Buffer.concat([MANIFEST_HEAD, deflateRawSync(middle, SYNC), record.tail]);
}
function isManifest(bytes) {
  return bytes.length > MANIFEST_HEAD.length && Buffer.from(bytes.buffer, bytes.byteOffset, MANIFEST_HEAD.length).equals(MANIFEST_HEAD);
}
function readManifest(bytes) {
  let read;
  try {
    read = JSON.parse(inflateRawSync(bytes).toString("utf8"));
  } catch {
    return null;
  }
  const { parts: pairs, unreadAt, unread: paths } = read ?? {};
  if (!integers(pairs) || !integers(unreadAt) || !strings(paths) || pairs.length % 2 !== 0) {
    return null;
  }
  const parts = [];
  let at = 0;
  let id = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    at += pairs[i] ?? 0;
    id += pairs[i + 1] ?? 0;
    if (at < 0 || at >= paths.length || id < 1) return null;
    parts.push({ at, id });
  }
  if (unreadAt.some((i) => i < 0 || i >= paths.length)) return null;
  return { paths, parts, unread: unreadAt };
}
function storedPart(bytes) {
  const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (all.length < 5 || all[0] !== 0) return null;
  const length = all.readUInt16LE(1);
  if (all.readUInt16LE(3) !== (~length & 65535) || all.length <= 5 + length) return null;
  const head = all.toString("utf8", 5, 5 + length);
  if (!head.startsWith('{"path":') || !head.endsWith(",")) return null;
  try {
    const path = JSON.parse(head.slice(8, -1));
    return typeof path === "string" && partHead(path) === head ? { path, bytes } : null;
  } catch {
    return null;
  }
}
function assemble(manifest, parts) {
  const pieces = [RECORD_HEAD];
  const unread = manifest.unread.map((i) => manifest.paths[i] ?? "");
  for (const { at, id } of manifest.parts) {
    const path = manifest.paths[at] ?? "";
    const part = parts.get(id);
    if (part === void 0 || part === null || part.path !== path) {
      unread.push(path);
      continue;
    }
    if (pieces.length > 1) pieces.push(COMMA);
    pieces.push(part.bytes);
  }
  const left = [...new Set(unread)].sort(compare);
  pieces.push(stored(`],"unread":${JSON.stringify(left)}}`, true));
  return Buffer.concat(pieces);
}
function partHead(path) {
  return `{"path":${JSON.stringify(path)},`;
}
function stored(text, last = false) {
  const body = Buffer.from(text, "utf8");
  const blocks = [];
  for (let at = 0; at === 0 || at < body.length; at += 65535) {
    const chunk = body.subarray(at, at + 65535);
    const head = Buffer.alloc(5);
    head[0] = last && at + 65535 >= body.length ? 1 : 0;
    head.writeUInt16LE(chunk.length, 1);
    head.writeUInt16LE(~chunk.length & 65535, 3);
    blocks.push(head, chunk);
  }
  return Buffer.concat(blocks);
}
function integers(value) {
  return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v));
}
function strings(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// src/core/code/store/parts.ts
var PART_REFRESH_MS = 60 * 6e4;
function hasParts(conn) {
  return conn.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    "coverage_parts"
  ) !== null;
}
function markParts(conn, bound) {
  const marked = /* @__PURE__ */ new Set();
  const keys = conn.all(
    "SELECT result_key, provider_version FROM coverage WHERE recorded_at < ?",
    bound
  );
  for (const key of keys) {
    const row = conn.get(
      "SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?",
      key.result_key,
      key.provider_version
    );
    const bytes = row?.record;
    if (!(bytes instanceof Uint8Array) || !isManifest(bytes)) continue;
    for (const part of readManifest(bytes)?.parts ?? []) marked.add(part.id);
  }
  return marked;
}
function* sweepParts(conn, cutoff, marked, batch, removed) {
  const ids = conn.all("SELECT id FROM coverage_parts WHERE used_at < ?", cutoff).map((row) => num(row, "id")).filter((id) => !marked.has(id));
  for (let i = 0; i < ids.length; i += batch) {
    const some = JSON.stringify(ids.slice(i, i + batch));
    yield () => {
      removed(
        conn.transaction(
          () => conn.run(
            "DELETE FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?",
            some,
            cutoff
          )
        )
      );
    };
  }
}
function* pruneParts(conn, cutoff, batch, removed) {
  if (!hasParts(conn)) return;
  yield* sweepParts(conn, cutoff, markParts(conn, cutoff + PART_REFRESH_MS), batch, removed);
}

// src/core/code/store/coverage.ts
var INDEX = "coverage_stored";
var PART_CACHE_LIMIT = 8192;
var UPSERT = `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET record = excluded.record,
    recorded_at = max(excluded.recorded_at, recorded_at + 1)`;
function createCoverageRepo(conn, sent) {
  const indexed = conn.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?", INDEX) !== null;
  const by = indexed ? `coverage INDEXED BY ${INDEX}` : "coverage";
  let parted = false;
  const read = /* @__PURE__ */ new Map();
  const partsOf = (ids) => {
    parted ||= hasParts(conn);
    const missing = ids.filter((id) => !read.has(id));
    if (!parted || missing.length === 0) return read;
    for (const row of conn.all(
      "SELECT id, part FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(missing)
    )) {
      read.set(num(row, "id"), row.part instanceof Uint8Array ? storedPart(row.part) : null);
    }
    const wanted = new Set(ids);
    for (const id of read.keys()) {
      if (read.size <= PART_CACHE_LIMIT) break;
      if (!wanted.has(id)) read.delete(id);
    }
    return read;
  };
  const storedAt = (key) => {
    const row = conn.get(
      `SELECT recorded_at FROM ${by} WHERE result_key = ? AND provider_version = ?`,
      key.resultKey,
      key.providerVersion
    );
    return row === null ? null : num(row, "recorded_at");
  };
  const writeParts = ({ key, record, at }) => {
    const before = storedAt(key);
    const stored2 = before === null ? at : Math.max(at, before + 1);
    const known = /* @__PURE__ */ new Map();
    for (const row of conn.all(
      `SELECT j.key AS i, p.used_at FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash))
    )) {
      known.set(record.parts[num(row, "i")]?.hash ?? "", num(row, "used_at"));
    }
    for (const part of record.parts) {
      if (known.has(part.hash)) continue;
      known.set(part.hash, stored2);
      conn.run(
        `INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET used_at = max(used_at, excluded.used_at)`,
        part.hash,
        part.bytes,
        stored2
      );
    }
    const stale = [...known].filter(([, usedAt]) => usedAt < stored2 - PART_REFRESH_MS);
    if (stale.length > 0) {
      conn.run(
        `UPDATE coverage_parts SET used_at = ?
         WHERE hash IN (SELECT value FROM json_each(?)) AND used_at < ?`,
        stored2,
        JSON.stringify(stale.map(([hash]) => hash)),
        stored2 - PART_REFRESH_MS
      );
    }
    return stored2;
  };
  const writeManifest = ({ key, record }, stored2) => {
    const ids = /* @__PURE__ */ new Map();
    for (const row of conn.all(
      `SELECT j.value AS hash, p.id FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash))
    )) {
      ids.set(str(row, "hash"), num(row, "id"));
    }
    const listed = record.parts.map((part) => ids.get(part.hash));
    if (listed.some((id) => id === void 0)) {
      throw new Error("squeal code store: a coverage part is missing after its insert");
    }
    conn.run(
      UPSERT,
      key.resultKey,
      key.providerVersion,
      manifestBytes(record, listed),
      stored2
    );
  };
  const putPartsBatch = async (items) => {
    if (items.length === 0) return;
    const stored2 = conn.transaction(() => items.map(writeParts));
    if (sent !== void 0) await sent();
    conn.transaction(() => {
      items.forEach((item, i) => {
        writeManifest(item, stored2[i] ?? item.at);
      });
    });
    if (sent !== void 0) await sent();
  };
  return {
    get(key) {
      return conn.read(() => {
        const row = conn.get(
          "SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?",
          key.resultKey,
          key.providerVersion
        );
        const record = row?.record;
        if (!(record instanceof Uint8Array)) return null;
        if (!isManifest(record)) return record;
        const manifest = readManifest(record);
        return manifest === null ? null : assemble(manifest, partsOf(manifest.parts.map((p) => p.id)));
      });
    },
    has: (key) => storedAt(key) !== null,
    storedAt,
    put(key, record, at) {
      conn.run(UPSERT, key.resultKey, key.providerVersion, record, at);
    },
    putParts: (key, record, at) => putPartsBatch([{ key, record, at }]),
    putPartsBatch
  };
}

// src/core/hash/blob.ts
import { constants as constants2 } from "node:fs";
var OPEN_FLAGS = constants2.O_RDONLY | constants2.O_NOFOLLOW | constants2.O_NONBLOCK;

// src/core/code/coverage/sourcemap.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

// src/core/code/coverage/record.ts
var COVERAGE_RECORD_VERSION = 4;

// src/core/code/store/staged.ts
var SUFFIX = " recount";
var stagedId = (worktreeId) => `${worktreeId}${SUFFIX}`;
var isStagedId = (id) => id.endsWith(SUFFIX);

// src/core/code/store/prune.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var DELETE_BATCH2 = 256;
var COVERAGE_BATCH = 64;
var COVERAGE_META_OF_DEAD = `key LIKE 'coverage:%' AND (CASE
    WHEN instr(substr(key, 10), ':') = 0 THEN substr(key, 10)
    ELSE substr(key, 10, instr(substr(key, 10), ':') - 1) END) NOT IN (SELECT value FROM json_each(?))`;
var OLDER_RECORD = "provider_version < ?";
function pruneCodeStore(conn, options) {
  const counts = noCodeRemoved();
  for (const slice of pruneCodeSlices(conn, options, counts)) slice();
  return { ...counts };
}
function noCodeRemoved() {
  return {
    countsRemoved: 0,
    coverageRemoved: 0,
    partsRemoved: 0,
    worktreesRemoved: 0,
    viewsRemoved: 0,
    checksRemoved: 0
  };
}
var PER_WORKTREE = [
  ["files", ["worktree_id", "path"]],
  ["states", ["worktree_id", "check_id", "measure"]],
  ["views", ["worktree_id", "session_id", "agent_id", "check_id", "measure"]],
  ["transitions", ["worktree_id", "check_id", "id"]]
];
var UNUSED_COUNT = `counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob
    AND f.language = counts.language AND f.counter_version = counts.counter_version)
  AND NOT EXISTS (SELECT 1 FROM states s WHERE s.blob = counts.blob)`;
var UNUSED_CHECK = `NOT EXISTS (SELECT 1 FROM states s
    WHERE s.worktree_id IN (SELECT value FROM json_each(?)) AND s.check_id = checks.id)
  AND NOT EXISTS (SELECT 1 FROM transitions t
    WHERE t.worktree_id IN (SELECT value FROM json_each(?)) AND t.check_id = checks.id)
  AND NOT EXISTS (SELECT 1 FROM views v WHERE v.check_id = checks.id)`;
function* pruneCodeSlices(conn, options, counts) {
  const cutoff = options.now - options.retentionDays * DAY_MS2;
  const live = JSON.stringify(options.worktrees);
  const rule = (r) => deleteByKey(conn, r);
  const dead = conn.read(() => deadWorktrees(conn, options.worktrees));
  for (const id of dead) {
    for (const [table, key] of PER_WORKTREE) {
      yield* rule({ table, key, search: "worktree_id = ?", searchParams: [id] });
    }
  }
  counts.worktreesRemoved = dead.length;
  yield* rule({ table: "meta", key: ["key"], search: COVERAGE_META_OF_DEAD, searchParams: [live] });
  yield* rule({
    table: "views",
    key: PER_WORKTREE[2][1],
    search: `(worktree_id, session_id, agent_id) NOT IN (
       SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
       FROM json_each(?))`,
    searchParams: [JSON.stringify(options.consumers)],
    removed: (n) => {
      counts.viewsRemoved += n;
    }
  });
  const indexed = conn.read(() => hasIndexes(conn, "states_by_blob", "views_by_check"));
  if (indexed) {
    yield* rule({
      table: "counts",
      key: ["blob", "language", "counter_version"],
      search: UNUSED_COUNT,
      searchParams: [cutoff],
      removed: (n) => {
        counts.countsRemoved += n;
      }
    });
  }
  yield* pruneCoverage(conn, options.resultKeys, cutoff, (n) => {
    counts.coverageRemoved += n;
  });
  yield* pruneParts(conn, cutoff, DELETE_BATCH2, (n) => {
    counts.partsRemoved += n;
  });
  if (indexed) {
    yield* rule({
      table: "checks",
      key: ["id"],
      search: `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
         UNION SELECT check_id FROM transitions)`,
      recheck: UNUSED_CHECK,
      recheckParams: () => [worktreeIdList(conn, "states"), worktreeIdList(conn, "transitions")],
      removed: (n) => {
        counts.checksRemoved += n;
      }
    });
  }
  yield* vacuum(conn);
}
function deadWorktrees(conn, live) {
  const kept = /* @__PURE__ */ new Set([...live, ...live.map((id) => stagedId(id))]);
  const found = new Set(
    PER_WORKTREE.flatMap(([table]) => conn.all(worktreeIdsOf(table)).map((row) => str(row, "id")))
  );
  return [...found].filter((id) => !kept.has(id));
}
function* pruneCoverage(conn, resultKeys, cutoff, removed) {
  const key = ["result_key", "provider_version"];
  if (resultKeys === void 0) {
    yield* deleteByKey(conn, {
      table: "coverage",
      key,
      search: `recorded_at < ? OR ${OLDER_RECORD}`,
      searchParams: [cutoff, COVERAGE_RECORD_VERSION],
      batch: COVERAGE_BATCH,
      removed
    });
    return;
  }
  const held = conn.read(() => conn.all("SELECT DISTINCT result_key FROM coverage")).map((row) => str(row, "result_key"));
  const kept = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  yield* deleteByKey(conn, {
    table: "coverage",
    key,
    search: `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    searchParams: [JSON.stringify(held.filter((k) => !kept.has(k))), COVERAGE_RECORD_VERSION],
    batch: COVERAGE_BATCH,
    removed
  });
}

// src/core/code/store/states.ts
var MEASURES = [
  "complexity",
  "crap",
  "uncovered"
];
var OUTCOMES = [
  "pass",
  "fail",
  "pending",
  "unknown"
];
var CHECK_WHERE = "path = ? AND qualified_name = ? AND occurrence = ?";
function checkParams2(check) {
  return [check.path, check.qualifiedName, check.occurrence];
}
function findCodeCheckId(conn, check) {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE}`, ...checkParams2(check));
  return row === null ? null : num(row, "id");
}
var CHECK_ID = `(SELECT id FROM checks WHERE ${CHECK_WHERE})`;
function ensureCodeCheck(conn, check) {
  const params = checkParams2(check);
  conn.run(
    "INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ...params
  );
  return params;
}
var CHECK_COLUMNS2 = "c.path, c.qualified_name, c.occurrence";
function checkFrom2(row) {
  return {
    kind: "code",
    path: str(row, "path"),
    qualifiedName: str(row, "qualified_name"),
    occurrence: num(row, "occurrence")
  };
}
var STATES_FAILING = "states_failing";
var STATES_EDITED = "states_edited";
var STATES_NON_PASS = "states_non_pass";
function indexesIn(conn, names) {
  const rows = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(names)
  );
  return new Set(rows.map((row) => str(row, "name")));
}
function statesOf(worktreeId, paths, index) {
  if (paths === void 0) {
    const states = index === null ? "states s" : `states s INDEXED BY ${index}`;
    return {
      from: `${states} JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?`,
      params: [worktreeId]
    };
  }
  return {
    from: `(SELECT DISTINCT value FROM json_each(?)) p
      CROSS JOIN checks c ON c.path = p.value
      CROSS JOIN states s ON s.worktree_id = ? AND s.check_id = c.id
      WHERE true`,
    params: [JSON.stringify(paths), worktreeId]
  };
}
function filterTerms(filter) {
  const terms = [];
  const params = [];
  if (filter.measure !== void 0) {
    terms.push("AND s.measure = ?");
    params.push(filter.measure);
  }
  if (filter.outcome === "fail") terms.push("AND s.outcome = 'fail'");
  else if (filter.outcome !== void 0) {
    terms.push("AND s.outcome = ?");
    params.push(filter.outcome);
  }
  return { sql: terms.join(" "), params };
}
function createStateRepo(conn) {
  const indexed = indexesIn(conn, [STATES_FAILING, STATES_EDITED, STATES_NON_PASS]);
  const named = (index, used) => used && indexed.has(index) ? index : null;
  return {
    list(worktreeId, filter = {}) {
      const index = named(STATES_FAILING, filter.outcome === "fail");
      const { from, params } = statesOf(worktreeId, filter.paths, index);
      const terms = filterTerms(filter);
      return conn.all(
        `SELECT s.*, ${CHECK_COLUMNS2} FROM ${from} ${terms.sql}
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
        ...params,
        ...terms.params
      ).map((row) => toState(worktreeId, row));
    },
    countNonPass(worktreeId, measure) {
      const index = named(STATES_NON_PASS, true);
      const states = index === null ? "states" : `states INDEXED BY ${index}`;
      const counts = { fail: 0, pending: 0, unknown: 0 };
      const rows = conn.all(
        `SELECT outcome, count(*) AS n FROM ${states}
         WHERE worktree_id = ? AND measure = ? AND outcome != 'pass' GROUP BY outcome`,
        worktreeId,
        measure
      );
      for (const row of rows) {
        const outcome = oneOf(row, "outcome", OUTCOMES);
        if (outcome !== "pass") counts[outcome] = num(row, "n");
      }
      return counts;
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          conn.run(
            `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
               counted_at, blob, changed_at) VALUES (?, ${CHECK_ID}, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
               counted_at = excluded.counted_at, blob = excluded.blob,
               changed_at = excluded.changed_at`,
            state.worktreeId,
            ...ensureCodeCheck(conn, state.check),
            state.measure,
            state.outcome,
            state.value,
            state.threshold,
            state.countedAt,
            state.blob,
            state.changedAt
          );
        }
      });
    },
    edits(worktreeId, measure, paths) {
      const { from, params } = statesOf(worktreeId, paths, named(STATES_EDITED, true));
      return conn.all(
        `SELECT s.measure, s.edited_revision, s.edited_at, ${CHECK_COLUMNS2} FROM ${from}
             AND s.measure = ? AND s.edited_at IS NOT NULL
           ORDER BY c.path, c.qualified_name, c.occurrence`,
        ...params,
        measure
      ).map(toEdit);
    },
    markEdited(worktreeId, edits) {
      conn.transaction(() => {
        for (const edit of edits) {
          const id = findCodeCheckId(conn, edit.check);
          if (id === null) continue;
          conn.run(
            `UPDATE states SET edited_revision = ?, edited_at = ?
             WHERE worktree_id = ? AND check_id = ? AND measure = ?`,
            edit.revision,
            edit.at,
            worktreeId,
            id,
            edit.measure
          );
        }
      });
    },
    removeMany(worktreeId, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findCodeCheckId(conn, check);
          if (id === null) continue;
          conn.run("DELETE FROM states WHERE worktree_id = ? AND check_id = ?", worktreeId, id);
        }
      });
    },
    removeMeasure(worktreeId, measure, paths) {
      if (paths === void 0) {
        conn.run("DELETE FROM states WHERE worktree_id = ? AND measure = ?", worktreeId, measure);
        return;
      }
      conn.run(
        `DELETE FROM states WHERE worktree_id = ? AND measure = ? AND check_id IN (
           SELECT c.id FROM json_each(?) p JOIN checks c ON c.path = p.value)`,
        worktreeId,
        measure,
        JSON.stringify(paths)
      );
    },
    move(worktreeId, from, to) {
      conn.transaction(() => {
        const fromId = findCodeCheckId(conn, from);
        if (fromId === null) return;
        const toId = ensureCodeCheck(conn, to);
        for (const table of ["states", "views"]) {
          conn.run(
            `UPDATE OR REPLACE ${table} SET check_id = ${CHECK_ID}
             WHERE worktree_id = ? AND check_id = ?`,
            ...toId,
            worktreeId,
            fromId
          );
        }
        conn.run(
          `DELETE FROM transitions WHERE worktree_id = ? AND check_id = ${CHECK_ID}`,
          worktreeId,
          ...toId
        );
        conn.run(
          `UPDATE transitions SET check_id = ${CHECK_ID} WHERE worktree_id = ? AND check_id = ?`,
          ...toId,
          worktreeId,
          fromId
        );
      });
    },
    adopt(worktreeId, staged, measure, removed) {
      return conn.transaction(() => {
        const staging = conn.get(
          "SELECT count(*) AS n FROM states WHERE worktree_id = ? AND measure = ?",
          staged,
          measure
        );
        const written = staging === null ? 0 : num(staging, "n");
        conn.run(
          `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
             counted_at, blob, changed_at, edited_revision, edited_at)
           SELECT ?, check_id, measure, outcome, value, threshold, counted_at, blob, changed_at,
             edited_revision, edited_at
           FROM states WHERE worktree_id = ? AND measure = ?
           ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
             outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
             counted_at = excluded.counted_at, blob = excluded.blob,
             changed_at = excluded.changed_at,
             edited_revision = coalesce(excluded.edited_revision, states.edited_revision),
             edited_at = coalesce(excluded.edited_at, states.edited_at)`,
          worktreeId,
          staged,
          measure
        );
        if (removed.length > 0) {
          conn.run(
            `DELETE FROM states WHERE worktree_id = ? AND check_id IN (
               SELECT c.id FROM json_each(?) j JOIN checks c ON c.path = j.value ->> 0
                 AND c.qualified_name = j.value ->> 1 AND c.occurrence = j.value ->> 2)`,
            worktreeId,
            JSON.stringify(removed.map((c) => [c.path, c.qualifiedName, c.occurrence]))
          );
        }
        return written;
      });
    }
  };
}
function toState(worktreeId, row) {
  return {
    worktreeId,
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    outcome: oneOf(row, "outcome", OUTCOMES),
    value: numOrNull(row, "value"),
    threshold: numOrNull(row, "threshold"),
    countedAt: num(row, "counted_at"),
    blob: str(row, "blob"),
    changedAt: num(row, "changed_at")
  };
}
function toEdit(row) {
  return {
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    revision: num(row, "edited_revision"),
    at: num(row, "edited_at")
  };
}

// src/core/code/store/transitions.ts
var KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "removed"
];
var COLUMNS = `worktree_id, check_id, measure, kind, from_outcome, to_outcome, from_value,
  to_value, threshold, revision, at`;
function createTransitionRepo2(conn) {
  return {
    append(transitions) {
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (${COLUMNS})
             VALUES (?, ${CHECK_ID}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ...ensureCodeCheck(conn, t.check),
            t.measure,
            t.kind,
            t.from,
            t.to,
            t.fromValue,
            t.toValue,
            t.threshold,
            t.revision,
            t.at
          );
        }
      });
    },
    adopt(worktreeId, staged, expected) {
      return conn.transaction(() => {
        const row = conn.get("SELECT count(*) AS n FROM transitions WHERE worktree_id = ?", staged);
        if (row === null || num(row, "n") !== expected) return 0;
        conn.run(
          `INSERT INTO transitions (${COLUMNS})
           SELECT ?, check_id, measure, kind, from_outcome, to_outcome, from_value, to_value,
             threshold, revision, at
           FROM transitions WHERE worktree_id = ? ORDER BY id`,
          worktreeId,
          staged
        );
        return expected;
      });
    },
    dropStaged(staged) {
      if (!isStagedId(staged)) {
        throw new Error(`squeal code store: ${staged} is no staging id; its transitions stay`);
      }
      conn.run("DELETE FROM transitions WHERE worktree_id = ?", staged);
    },
    history(worktreeId, check) {
      const id = findCodeCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS2} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.check_id = ? ORDER BY t.id`,
        worktreeId,
        id
      ).map(toTransition);
    }
  };
}
function toTransition(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES),
    to: oneOfOrNull(row, "to_outcome", OUTCOMES),
    fromValue: numOrNull(row, "from_value"),
    toValue: numOrNull(row, "to_value"),
    threshold: numOrNull(row, "threshold"),
    revision: num(row, "revision"),
    at: num(row, "at")
  };
}

// src/core/code/store/views.ts
var TOLD = ["count", "full", "still"];
var WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";
function consumerParams(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createViewRepo2(conn) {
  return {
    list(consumer) {
      return conn.all(
        `SELECT v.*, ${CHECK_COLUMNS2} FROM views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ? AND v.outcome <> 'pass'
           ORDER BY c.path, c.qualified_name, c.occurrence, v.measure`,
        ...consumerParams(consumer)
      ).map(toEntry);
    },
    writeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, measure, outcome,
               threshold, told, told_at) VALUES (?, ?, ?, ${CHECK_ID}, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, threshold = excluded.threshold,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams(consumer),
            ...ensureCodeCheck(conn, entry.check),
            entry.measure,
            entry.outcome,
            entry.threshold,
            entry.told,
            entry.toldAt
          );
        }
      });
    },
    removeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry of entries) {
          const id = findCodeCheckId(conn, entry.check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER} AND check_id = ? AND measure = ?`,
            ...consumerParams(consumer),
            id,
            entry.measure
          );
        }
      });
    },
    clear(consumer) {
      conn.run(`DELETE FROM views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    },
    retain(worktreeIds, consumers) {
      return conn.run(
        `DELETE FROM views WHERE worktree_id IN (SELECT value FROM json_each(?))
           AND (worktree_id, session_id, agent_id) NOT IN (
             SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
             FROM json_each(?))`,
        JSON.stringify(worktreeIds),
        JSON.stringify(consumers)
      );
    }
  };
}
function toEntry(row) {
  return {
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    outcome: oneOf(row, "outcome", OUTCOMES),
    threshold: numOrNull(row, "threshold"),
    told: oneOf(row, "told", TOLD),
    toldAt: num(row, "told_at")
  };
}

// src/core/code/store/store.ts
function createCodeStore(conn, schemaVersion, path) {
  const posting = conn instanceof SendingConnection;
  const sent = posting ? () => conn.sent() : async () => {
  };
  return {
    path,
    schemaVersion,
    meta: createMetaRepo(conn),
    counts: createCountRepo(conn),
    files: createFileRepo(conn),
    states: createStateRepo(conn),
    transitions: createTransitionRepo2(conn),
    views: createViewRepo2(conn),
    coverage: createCoverageRepo(conn, posting ? sent : void 0),
    transaction: (fn) => conn.transaction(fn),
    read: (fn) => conn.read(fn),
    prune: (options) => pruneCodeStore(conn, options),
    pruneSlices: (options, counts) => pruneCodeSlices(conn, options, counts),
    sent,
    unsettled: () => posting && conn.unsettled,
    close: () => conn.close()
  };
}
function createMetaRepo(conn) {
  return {
    get(key) {
      const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
      return row === null ? null : str(row, "value");
    },
    set(key, value) {
      conn.run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        value
      );
    },
    setWhilePresent(key, value, present) {
      conn.run(
        `INSERT INTO meta (key, value) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM meta WHERE key = ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        key,
        value,
        present
      );
    },
    delete(key) {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    }
  };
}

// src/core/code/store/open.ts
function codeStorePath(commonDir) {
  return join2(storePaths(commonDir).dir, "code.sqlite");
}
function isCodeStoreOpenFailure(value) {
  return "reason" in value;
}
function openCodeStore(commonDir, policy, options = {}) {
  if (!policy.complexity.enabled) return { reason: "off" };
  const path = codeStorePath(commonDir);
  if (!existsSync(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db;
  try {
    db = new DatabaseSync3(path);
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    const found = userVersion(db);
    if (found > CODE_SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: CODE_SCHEMA_VERSION };
    }
    if (Number(db.prepare("PRAGMA page_count").get()?.page_count) === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    switchToWal(db, busyTimeoutMs);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db, CODE_MIGRATIONS);
    if (options.create !== false) makeIndexes(db);
    return createCodeStore(options.connection?.(db) ?? new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}
function makeIndexes(db) {
  const found = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?");
  const absent = () => Object.entries({ ...CODE_TABLES, ...CODE_INDEXES }).filter(
    ([name]) => found.get(name) === void 0
  );
  if (absent().length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [, sql] of absent()) db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

// src/core/daemon/idle-checkpoint.ts
import { statSync } from "node:fs";
var PASSIVE_CHECKPOINT_BYTES = 4 * 1024 * 1024;
function passiveCheckpoint(db, walPath, minBytes = PASSIVE_CHECKPOINT_BYTES) {
  if (db.isTransaction) return null;
  const wal = statSync(walPath, { throwIfNoEntry: false });
  if (wal === void 0 || wal.size < minBytes) return null;
  const row = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() ?? {};
  return {
    busy: Number(row.busy) !== 0,
    log: Number(row.log),
    checkpointed: Number(row.checkpointed)
  };
}

// src/core/daemon/write-batch.ts
function decodeBatch(batch) {
  return batch.rows.map(([at, ...params]) => ({
    sql: batch.sqls[at],
    params: params.map(decodeParam)
  }));
}
function decodeParam(value) {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if ("bigint" in value) return BigInt(value.bigint);
  return new Uint8Array(Buffer.from(value.bytes, "base64"));
}

// src/core/store-process/guard.ts
function markKey(worktreeId) {
  return `store-process:${worktreeId}`;
}
var MARK_READ = "SELECT value FROM meta WHERE key = ?";
var MARK_WRITE = "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
var GuardedWriter = class {
  #db;
  #statements = /* @__PURE__ */ new Map();
  constructor(db) {
    this.#db = db;
  }
  /** The worktree's mark; `null` with none. */
  mark(worktreeId) {
    const row = this.#statement(MARK_READ).get(markKey(worktreeId));
    return typeof row?.value === "string" ? row.value : null;
  }
  /**
   * Writes `statements` from `slice.from` in one transaction, unless the
   * worktree's mark is at `seq` or past it. With `slice.sliceMs`, commits
   * once that long has run and answers `partial`; the mark is set only with
   * the last statement, so a batch cut short is written again whole by
   * whoever writes it next: a splittable batch must be one whose statements
   * may run twice.
   */
  write(worktreeId, seq, statements, slice = {}) {
    const now = slice.now ?? (() => performance.now());
    const started = now();
    this.#db.exec("BEGIN IMMEDIATE");
    const ended = observedWrite(this.#db);
    try {
      if (slice.schema !== void 0) {
        const found = Number(Object.values(this.#statement("PRAGMA user_version").get() ?? {})[0]);
        if (found !== slice.schema) {
          throw new Error(`the code store is at schema ${found}, not ${slice.schema}`);
        }
      }
      const mark = this.mark(worktreeId);
      if (mark !== null && mark >= seq) {
        this.#db.exec("COMMIT");
        return { end: "superseded" };
      }
      let at = slice.from ?? 0;
      for (; at < statements.length; at++) {
        const { sql, params } = statements[at];
        this.#statement(sql).run(...params);
        const cut = slice.sliceMs !== void 0 && now() - started >= slice.sliceMs;
        if (cut && at + 1 < statements.length) {
          this.#db.exec("COMMIT");
          return { end: "partial", next: at + 1 };
        }
      }
      this.#statement(MARK_WRITE).run(markKey(worktreeId), seq);
      this.#db.exec("COMMIT");
      return { end: "written" };
    } catch (error) {
      rollback(this.#db);
      throw error;
    } finally {
      ended?.();
    }
  }
  #statement(sql) {
    let statement = this.#statements.get(sql);
    if (statement === void 0) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }
};

// src/core/store-process/writer.ts
var WRITER_CHECKPOINT_MS = 1e3;
var CheckpointingWriter = class extends GuardedWriter {
  #db;
  #walPath;
  #now;
  #looked = Number.NEGATIVE_INFINITY;
  constructor(db, walPath, now = () => performance.now()) {
    super(db);
    this.#db = db;
    this.#walPath = walPath;
    this.#now = now;
  }
  write(worktreeId, seq, statements, slice = {}) {
    try {
      return super.write(worktreeId, seq, statements, slice);
    } finally {
      this.#checkpoint();
    }
  }
  #checkpoint() {
    const at = this.#now();
    if (at - this.#looked < WRITER_CHECKPOINT_MS) return;
    this.#looked = at;
    try {
      passiveCheckpoint(this.#db, this.#walPath);
    } catch {
    }
  }
};
function openWriteConnection(commonDir) {
  let db = null;
  const opened = openCodeStore(
    commonDir,
    { complexity: { enabled: true } },
    {
      connection: (raw2) => {
        db = raw2;
        return new Connection(raw2);
      }
    }
  );
  if (isCodeStoreOpenFailure(opened))
    return `the code store did not open: ${JSON.stringify(opened)}`;
  const raw = db;
  if (raw === null) return "the code store did not open: no connection";
  for (const pragma of CONNECTION_PRAGMAS) raw.exec(pragma);
  raw.exec("PRAGMA wal_autocheckpoint = 0");
  return {
    writer: new CheckpointingWriter(raw, `${codeStorePath(commonDir)}-wal`),
    schema: opened.schemaVersion,
    close: () => opened.close()
  };
}
function runJob(writer, job, schema) {
  return writer.write(job.worktreeId, job.seq, decodeBatch(job.batch), {
    from: job.from,
    schema,
    ...job.sliceMs === void 0 ? {} : { sliceMs: job.sliceMs }
  });
}

// src/core/store-process/writer-thread.ts
var port = parentPort;
if (port !== null) {
  const { commonDir } = workerData;
  logLongWrites(
    (write) => port.postMessage({ type: "log", line: `store process: ${longWriteLine(write)}` })
  );
  const opened = openWriteConnection(commonDir);
  port.postMessage({
    type: "ready",
    ready: typeof opened === "string" ? { failed: opened } : { schema: opened.schema }
  });
  port.on("message", (message) => {
    if (message.close === true) {
      if (typeof opened !== "string") opened.close();
      port.close();
      return;
    }
    const { id, job } = message;
    if (id === void 0 || job === void 0) return;
    try {
      if (typeof opened === "string") throw new Error(opened);
      port.postMessage({ type: "done", id, end: runJob(opened.writer, job, opened.schema) });
    } catch (error) {
      port.postMessage({ type: "failed", id, error: String(error) });
    }
  });
}
