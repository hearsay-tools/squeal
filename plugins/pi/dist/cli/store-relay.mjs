const require = process.getBuiltinModule("node:module").createRequire(import.meta.url);

// squeal-builtin:node:fs
var $mod;
var $load = () => $mod ??= process.getBuiltinModule("node:fs");
var $pick = (n) => $load()[n];
var closeSync = /* @__PURE__ */ $pick("closeSync");
var constants = /* @__PURE__ */ $pick("constants");
var copyFileSync = /* @__PURE__ */ $pick("copyFileSync");
var existsSync = /* @__PURE__ */ $pick("existsSync");
var ftruncateSync = /* @__PURE__ */ $pick("ftruncateSync");
var mkdirSync = /* @__PURE__ */ $pick("mkdirSync");
var openSync = /* @__PURE__ */ $pick("openSync");
var readFileSync = /* @__PURE__ */ $pick("readFileSync");
var readdirSync = /* @__PURE__ */ $pick("readdirSync");
var readlinkSync = /* @__PURE__ */ $pick("readlinkSync");
var statSync = /* @__PURE__ */ $pick("statSync");

// squeal-builtin:node:sqlite
var $mod2;
var $load2 = () => $mod2 ??= process.getBuiltinModule("node:sqlite");
var $pick2 = (n) => $load2()[n];
var DatabaseSync = /* @__PURE__ */ $pick2("DatabaseSync");

// squeal-builtin:node:timers/promises
var $mod3;
var $load3 = () => $mod3 ??= process.getBuiltinModule("node:timers/promises");
var $pick3 = (n) => $load3()[n];
var setTimeout2 = /* @__PURE__ */ $pick3("setTimeout");

// squeal-builtin:node:worker_threads
var $mod4;
var $load4 = () => $mod4 ??= process.getBuiltinModule("node:worker_threads");
var $pick4 = (n) => $load4()[n];
var parentPort = /* @__PURE__ */ $pick4("parentPort");
var workerData = /* @__PURE__ */ $pick4("workerData");

// squeal-builtin:node:path
var $mod5;
var $load5 = () => $mod5 ??= process.getBuiltinModule("node:path");
var $pick5 = (n) => $load5()[n];
var basename = /* @__PURE__ */ $pick5("basename");
var dirname = /* @__PURE__ */ $pick5("dirname");
var join = /* @__PURE__ */ $pick5("join");

// squeal-builtin:node:async_hooks
var $mod6;
var $load6 = () => $mod6 ??= process.getBuiltinModule("node:async_hooks");
var $pick6 = (n) => $load6()[n];
var AsyncLocalStorage = /* @__PURE__ */ $pick6("AsyncLocalStorage");

// src/core/store/connection.ts
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

// src/core/store/paths.ts
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

// src/core/store/codec.ts
var CHECK_COLUMNS = "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";

// src/core/store/repos/replaced.ts
var FAILING_AT = `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
  JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
  WHERE r.key = ? AND r.outcome = 'fail'`;

// src/core/store/prune-rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
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
var JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

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

// squeal-builtin:node:zlib
var $mod7;
var $load7 = () => $mod7 ??= process.getBuiltinModule("node:zlib");
var $pick7 = (n) => $load7()[n];
var constants2 = /* @__PURE__ */ $pick7("constants");

// src/core/code/coverage/parts.ts
var SYNC = { finishFlush: constants2.Z_SYNC_FLUSH };
var MANIFEST_HEAD = stored('{"v":1,"sources":[],"parts":');
var RECORD_HEAD = stored('{"v":1,"sources":[');
var COMMA = stored(",");
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

// src/core/code/store/parts.ts
var PART_REFRESH_MS = 60 * 6e4;

// squeal-builtin:node:fs/promises
var $mod8;
var $load8 = () => $mod8 ??= process.getBuiltinModule("node:fs/promises");
var $pick8 = (n) => $load8()[n];
var readFile = /* @__PURE__ */ $pick8("readFile");

// src/core/hash/blob.ts
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/code/coverage/sourcemap.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

// src/core/code/store/prune.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;

// src/core/code/store/states.ts
var CHECK_WHERE = "path = ? AND qualified_name = ? AND occurrence = ?";
var CHECK_ID = `(SELECT id FROM checks WHERE ${CHECK_WHERE})`;

// src/core/code/store/open.ts
function codeStorePath(commonDir) {
  return join(storePaths(commonDir).dir, "code.sqlite");
}

// squeal-builtin:node:net
var $mod9;
var $load9 = () => $mod9 ??= process.getBuiltinModule("node:net");
var $pick9 = (n) => $load9()[n];
var createConnection = /* @__PURE__ */ $pick9("createConnection");

// src/core/daemon/client.ts
function endpointAt(socketPath) {
  try {
    const { dev, ino, ctimeNs, birthtimeNs } = statSync(socketPath, { bigint: true });
    return { dev, ino, ctimeNs, birthtimeNs };
  } catch {
    return null;
  }
}
function sameEndpoint(a, b) {
  return a !== null && a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs && a.birthtimeNs === b.birthtimeNs;
}
function requestDaemon(socketPath, request, timeoutMs, endpoint, signal) {
  return new Promise((resolve2, reject) => {
    if (signal?.aborted) {
      reject(failure("ABORT_ERR", `request to ${socketPath} aborted`));
      return;
    }
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      socket.destroy();
      if (error) reject(error);
      else resolve2(response);
    };
    const timer = setTimeout(
      () => settle(failure("ETIMEDOUT", `no answer from ${socketPath} in ${timeoutMs} ms`)),
      timeoutMs
    );
    const aborted = () => settle(failure("ABORT_ERR", `request to ${socketPath} aborted`));
    signal?.addEventListener("abort", aborted, { once: true });
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      if (endpoint !== void 0 && !sameEndpoint(endpointAt(socketPath), endpoint)) {
        settle(failure("ESTALE", `${socketPath} is another daemon's socket now`));
        return;
      }
      socket.write(`${JSON.stringify(request)}
`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        settle(null, JSON.parse(buffer.slice(0, end)));
      } catch {
        settle(failure("EPROTO", `malformed answer from ${socketPath}`));
      }
    });
    socket.on(
      "error",
      (error) => settle(failure(error.code ?? "EIO", error.message))
    );
    socket.on(
      "close",
      () => settle(failure("ECONNRESET", `${socketPath} closed without an answer`))
    );
  });
}
function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// src/core/delivery/harness-process.ts
function readProcStat(pid) {
  let text;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const open2 = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const rest = text.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  const startTime = Number(rest[19]);
  if (open2 < 0 || close < open2 || !Number.isInteger(ppid) || !Number.isInteger(startTime)) {
    throw new Error(`unreadable /proc/${pid}/stat`);
  }
  return { comm: text.slice(open2 + 1, close), state: rest[0] ?? "", ppid, startTime };
}
function pidNamespace() {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}

// src/core/daemon/lease-process.ts
function leaseProcess(pid = process.pid) {
  const namespace = pidNamespace();
  let startTime = null;
  try {
    startTime = namespace === null ? null : readProcStat(pid)?.startTime ?? null;
  } catch {
    startTime = null;
  }
  return { pid, startTime, pidNamespace: startTime === null ? null : namespace };
}

// squeal-builtin:node:diagnostics_channel
var $mod10;
var $load10 = () => $mod10 ??= process.getBuiltinModule("node:diagnostics_channel");
var $pick10 = (n) => $load10()[n];
var channel = /* @__PURE__ */ $pick10("channel");

// src/core/daemon/test-pause.ts
var TEST_PAUSE_CHANNEL = "squeal:test-pause";
var pauses = channel(TEST_PAUSE_CHANNEL);

// src/core/daemon/lock.ts
function acquireDaemonLock(path) {
  const db = lockDatabase(path);
  let lock;
  try {
    lock = tryLock(db);
  } catch (error) {
    db.close();
    throw error;
  }
  if (lock === null) db.close();
  return lock;
}
function lockDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
function tryLock(db) {
  try {
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    if (isBusy(error)) return null;
    throw error;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    }
  };
}

// src/core/daemon/write-batch.ts
function encodeBatch(statements) {
  const sqls = [];
  const index = /* @__PURE__ */ new Map();
  const rows = statements.map(({ sql, params }) => {
    let at = index.get(sql);
    if (at === void 0) {
      at = sqls.push(sql) - 1;
      index.set(sql, at);
    }
    return [at, ...params.map(encodeParam)];
  });
  return { sqls, rows };
}
function encodeParam(value) {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return { bigint: value.toString() };
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return { bytes: bytes.toString("base64") };
}

// src/core/delivery/daemon-writer.ts
var SMALL_REQUEST_TIMEOUT_MS = 250;

// squeal-builtin:node:os
var $mod11;
var $load11 = () => $mod11 ??= process.getBuiltinModule("node:os");
var $pick11 = (n) => $load11()[n];
var availableParallelism = /* @__PURE__ */ $pick11("availableParallelism");

// squeal-builtin:node:child_process
var $mod12;
var $load12 = () => $mod12 ??= process.getBuiltinModule("node:child_process");
var $pick12 = (n) => $load12()[n];
var execFile = /* @__PURE__ */ $pick12("execFile");
var execFileSync = /* @__PURE__ */ $pick12("execFileSync");
var spawn = /* @__PURE__ */ $pick12("spawn");

// src/core/daemon/terminate.ts
var TICKS_PER_SECOND = 100;
var COMMAND_CHARS = 120;
async function commandLine(pid) {
  try {
    const text = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
    return text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 3)}...` : text;
  } catch {
    return "";
  }
}
function uptimeTicks() {
  if (process.platform !== "linux") return 0;
  try {
    return Math.floor(
      Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * TICKS_PER_SECOND
    );
  } catch {
    return 0;
  }
}

// squeal-builtin:node:util
var $mod13;
var $load13 = () => $mod13 ??= process.getBuiltinModule("node:util");
var $pick13 = (n) => $load13()[n];
var promisify = /* @__PURE__ */ $pick13("promisify");

// src/runners/process/recorders.ts
var UNOBSERVED = JSON.stringify({ out: "" });

// src/core/daemon/outlived.ts
var PF_EXITING = 4;
var CHUNK = 64;
function procRow(pid) {
  let text;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X" || (Number(fields[6]) & PF_EXITING) !== 0) return null;
  return {
    pid,
    ppid: Number(fields[1]),
    pgrp: Number(fields[2]),
    session: Number(fields[3]),
    start: Number(fields[19])
  };
}
var PROC = {
  mark: (msAgo = 0) => Math.max(0, uptimeTicks() - TICKS_PER_SECOND - Math.ceil(msAgo * TICKS_PER_SECOND / 1e3)),
  async list() {
    const names = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
    const rows = [];
    for (let at = 0; at < names.length; at += CHUNK) {
      if (at > 0) await new Promise((done) => setImmediate(done));
      for (const name of names.slice(at, at + CHUNK)) {
        const row = procRow(Number(name));
        if (row !== null) rows.push(row);
      }
    }
    return rows;
  },
  async variable(pid, variable) {
    let environ;
    try {
      environ = `\0${await readFile(`/proc/${pid}/environ`, "latin1")}`;
    } catch {
      return null;
    }
    const needle = `\0${variable}=`;
    const at = environ.indexOf(needle);
    if (at < 0) return null;
    const end = environ.indexOf("\0", at + needle.length);
    return environ.slice(at + needle.length, end < 0 ? void 0 : end);
  },
  running: async (found) => found.flatMap(({ pid, start }) => {
    const row = procRow(pid);
    return row?.start === start ? [row] : [];
  }),
  command: commandLine
};
var run = promisify(execFile);
var COMMAND_CHARS2 = 120;
var PS_TIMEOUT_MS = 2e3;
var PS_MAX_BYTES = 16 * 1024 * 1024;
var PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/;
function psLines(text) {
  return text.split("\n").flatMap((line) => {
    const [, pid, ppid, pgrp, state, month, day, time, year, shown] = PS_LINE.exec(line) ?? [];
    if (state === void 0 || state.startsWith("Z")) return [];
    const start = Date.parse(`${month} ${day} ${year} ${time}`) / 1e3;
    if (!Number.isInteger(start)) return [];
    const row = { pid: Number(pid), ppid: Number(ppid), pgrp: Number(pgrp), session: null, start };
    return [{ row, shown: shown ?? "" }];
  });
}
function shownValue(shown, name) {
  const needle = ` ${name}=`;
  const at = shown.indexOf(needle);
  if (at < 0 || shown.includes(needle, at + 1)) return null;
  const end = shown.indexOf(" ", at + needle.length);
  return shown.slice(at + needle.length, end < 0 ? void 0 : end);
}
function psTable(calls) {
  let shown = /* @__PURE__ */ new Map();
  async function list() {
    let lines;
    try {
      lines = psLines(await calls.listing());
    } catch (error) {
      shown = /* @__PURE__ */ new Map();
      throw error;
    }
    shown = new Map(lines.map((line) => [line.row.pid, line.shown]));
    return lines.map(({ row }) => row);
  }
  return {
    mark: (msAgo = 0) => Math.floor((Date.now() - msAgo) / 1e3) - 1,
    list,
    variable: async (pid, name) => {
      const line = shown.get(pid);
      return line === void 0 ? null : shownValue(line, name);
    },
    running: async (found) => (await list()).filter(
      (row) => found.some(({ pid, start }) => row.pid === pid && row.start === start)
    ),
    command: calls.command
  };
}
var PS = psTable({
  async listing() {
    const args = ["-A", "-E", "-ww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command="];
    const { stdout } = await run("ps", args, {
      env: { ...process.env, LC_ALL: "C" },
      timeout: PS_TIMEOUT_MS,
      maxBuffer: PS_MAX_BYTES
    });
    return stdout;
  },
  async command(pid) {
    try {
      const args = ["-ww", "-o", "command=", "-p", String(pid)];
      const { stdout } = await run("ps", args, { timeout: PS_TIMEOUT_MS });
      const text = stdout.trim();
      return text.length > COMMAND_CHARS2 ? `${text.slice(0, COMMAND_CHARS2 - 3)}...` : text;
    } catch {
      return "";
    }
  }
});
var NONE = {
  mark: () => 0,
  list: async () => [],
  variable: async () => null,
  running: async () => [],
  command: async () => ""
};
var HOST = process.platform === "linux" ? PROC : process.platform === "darwin" ? PS : NONE;

// src/core/daemon/escaped.ts
var CHILD_VARIABLE = "SQUEAL_DAEMON_CHILD";

// src/core/ps/source.ts
var runCommand = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2e3,
      maxBuffer: 16 * 1024 * 1024
    });
  } catch {
    return null;
  }
};

// src/core/ps/proc.ts
var MARK = Buffer.from(`${CHILD_VARIABLE}=`);
function createProcSource(options = {}) {
  return new ProcSource(options);
}
var ProcSource = class {
  platform = "linux";
  memoryKind = "private";
  readsMarks = true;
  #proc;
  #cpus;
  #run;
  constructor(options) {
    this.#proc = join(options.root ?? "/", "proc");
    this.#cpus = options.availableParallelism ?? availableParallelism;
    this.#run = options.run ?? runCommand;
  }
  clockTicks() {
    return TICKS_PER_SECOND;
  }
  bootTime() {
    const seconds = /^btime (\d+)$/m.exec(this.#read("stat") ?? "")?.[1];
    return seconds === void 0 ? null : Number(seconds) * 1e3;
  }
  processTable(pids, since) {
    const table = /* @__PURE__ */ new Map();
    const born = since === void 0 ? [] : this.#pids().filter((pid) => !since.has(pid));
    for (const pid of pids === void 0 ? this.#pids() : /* @__PURE__ */ new Set([...pids, ...born])) {
      const row = this.#row(pid);
      if (row !== null) table.set(pid, row);
    }
    return table;
  }
  cmdline(pid) {
    const text = this.#read(`${pid}/cmdline`);
    if (text === null) return null;
    const args = text.split("\0");
    if (args.at(-1) === "") args.pop();
    return args;
  }
  markOf(pid) {
    const bytes = this.#bytes(`${pid}/environ`);
    if (bytes === null) return null;
    for (let at = bytes.indexOf(MARK); at >= 0; at = bytes.indexOf(MARK, at + 1)) {
      if (at > 0 && bytes[at - 1] !== 0) continue;
      const start = at + MARK.length;
      const end = bytes.indexOf(0, start);
      return bytes.toString("utf8", start, end < 0 ? bytes.length : end);
    }
    return null;
  }
  memory(pid) {
    const status = kilobytes(this.#read(`${pid}/status`));
    const anon = status.get("RssAnon");
    const shmem = status.get("RssShmem");
    if (anon === void 0 || shmem === void 0) return null;
    const swap = status.get("VmSwap");
    return { bytes: anon + shmem, swapBytes: swap ?? null };
  }
  fds(pid) {
    const dir = join(this.#proc, String(pid), "fd");
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    const targets = [];
    for (const fd of names.filter(isPid).map(Number).sort((a, b) => a - b)) {
      const target = this.#link(`${pid}/fd/${fd}`);
      if (target !== null) targets.push(target);
    }
    return targets;
  }
  locks() {
    const text = this.#read("locks");
    if (text === null) return null;
    const locks = [];
    for (const line of text.split("\n")) {
      const m = /^\s*\d+:\s+((?:->\s*)+)?(\S+)\s+\S+\s+(READ|WRITE)\s+(-?\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s(?:\s*(\d+)\s+(\d+|EOF)\b)?/i.exec(
        line
      );
      if (m === null) continue;
      const [, arrow, kind = "", access = "", pid = "", major = "", minor = "", inode = ""] = m;
      const [start, end] = [m[8], m[9]];
      locks.push({
        kind,
        access: access.toUpperCase() === "WRITE" ? "write" : "read",
        pid: Number(pid) > 0 ? Number(pid) : null,
        file: `${hex(BigInt(`0x${major}`))}:${hex(BigInt(`0x${minor}`))}:${inode}`,
        blocked: arrow !== void 0,
        // Spec 021 D5: the byte range, which names SQLite's WAL write lock (byte 120 of `-shm`).
        ...start === void 0 ? {} : { start: Number(start), end: end === "EOF" ? null : Number(end) }
      });
    }
    return locks;
  }
  fileKey(path) {
    let dev;
    let ino;
    try {
      ({ dev, ino } = statSync(path, { bigint: true }));
    } catch {
      return null;
    }
    const major = (dev & 0xfff00n) >> 8n | (dev & 0xfffff00000000000n) >> 32n;
    const minor = dev & 0xffn | (dev & 0xffffff00000n) >> 12n;
    return `${hex(major)}:${hex(minor)}:${ino}`;
  }
  unixListeners() {
    const text = this.#run("ss", ["-xle"]);
    if (text === null) return null;
    const listeners = [];
    for (const line of text.split("\n")) {
      const m = /^u_\w+\s+LISTEN\s+\d+\s+\d+\s+.+?\s+-?\d+\s+\*\s+\d+\b.*?\bino:(\d+)\b/.exec(line);
      if (m !== null) listeners.push({ fileInode: Number(m[1]) });
    }
    return listeners;
  }
  pidNamespace() {
    return this.#link("self/ns/pid");
  }
  host() {
    const load = (this.#read("loadavg") ?? "").split(" ").slice(0, 3).map(Number);
    const cpu = pressure(this.#read("pressure/cpu"));
    const memory = pressure(this.#read("pressure/memory"));
    const meminfo = kilobytes(this.#read("meminfo"));
    const swapTotal = meminfo.get("SwapTotal") ?? null;
    const swapFree = meminfo.get("SwapFree");
    return {
      load: load.length === 3 && load.every(Number.isFinite) ? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0] : null,
      cpuPressure: cpu.get("some") ?? null,
      memoryPressure: memory.has("some") && memory.has("full") ? { some: memory.get("some") ?? 0, full: memory.get("full") ?? 0 } : null,
      memTotal: meminfo.get("MemTotal") ?? null,
      memAvailable: meminfo.get("MemAvailable") ?? null,
      swapTotal,
      swapUsed: swapTotal !== null && swapFree !== void 0 ? swapTotal - swapFree : null,
      cpuTime: cpuTime(this.#read("stat")),
      cpus: this.#cpus()
    };
  }
  #pids() {
    try {
      return readdirSync(this.#proc).filter(isPid).map(Number);
    } catch {
      return [];
    }
  }
  /** Fields are counted after the last `)`, since the command name may hold spaces and parentheses. */
  #row(pid) {
    const text = this.#read(`${pid}/stat`);
    if (text === null) return null;
    const open2 = text.indexOf("(");
    const close = text.lastIndexOf(")");
    if (open2 < 0 || close < open2) return null;
    const f = text.slice(close + 2).split(" ");
    const [ppid, utime, stime, cutime, cstime, nice, startTicks] = [
      f[1],
      f[11],
      f[12],
      f[13],
      f[14],
      f[16],
      f[19]
    ].map(Number);
    const numbers = [ppid, utime, stime, cutime, cstime, nice, startTicks];
    if (!numbers.every(Number.isInteger)) return null;
    return {
      pid,
      ppid: ppid ?? 0,
      comm: text.slice(open2 + 1, close),
      state: f[0] ?? null,
      startTicks: startTicks ?? 0,
      cpuTicks: (utime ?? 0) + (stime ?? 0),
      childTicks: (cutime ?? 0) + (cstime ?? 0),
      nice: nice ?? 0,
      uid: this.#uid(pid)
    };
  }
  #uid(pid) {
    try {
      return statSync(join(this.#proc, String(pid))).uid;
    } catch {
      return null;
    }
  }
  #read(path) {
    try {
      return readFileSync(join(this.#proc, path), "utf8");
    } catch {
      return null;
    }
  }
  #bytes(path) {
    try {
      return readFileSync(join(this.#proc, path));
    } catch {
      return null;
    }
  }
  #link(path) {
    try {
      return readlinkSync(join(this.#proc, path));
    } catch {
      return null;
    }
  }
};
function isPid(name) {
  return /^\d+$/.test(name);
}
function hex(n) {
  return n.toString(16).padStart(2, "0");
}
function kilobytes(text) {
  const values = /* @__PURE__ */ new Map();
  for (const m of (text ?? "").matchAll(/^(\w+):\s+(\d+) kB$/gm))
    values.set(m[1] ?? "", Number(m[2]) * 1024);
  return values;
}
function pressure(text) {
  const values = /* @__PURE__ */ new Map();
  for (const m of (text ?? "").matchAll(/^(\w+) avg10=([\d.]+)/gm))
    values.set(m[1] ?? "", Number(m[2]));
  return values;
}
function cpuTime(text) {
  const line = /^cpu\s+(.*)$/m.exec(text ?? "")?.[1];
  if (line === void 0) return null;
  const ticks = line.trim().split(/\s+/).slice(0, 8).map(Number);
  if (ticks.length < 5 || !ticks.every(Number.isFinite)) return null;
  const total = ticks.reduce((a, b) => a + b, 0);
  return { busy: total - (ticks[3] ?? 0) - (ticks[4] ?? 0), total };
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

// src/core/store/busy.ts
function busyBackoffMs(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 0;
}
var BACKOFF_MS = [0, 100, 250];

// src/core/store-process/owner.ts
var OWNER_TIMING = {
  hungMs: 1e4,
  boundMs: 1e4,
  pauseMs: 3e4,
  startEveryMs: 3e4
};
var SLICE_MS = 250;
var POLL_MS = [5, 10, 20, 50, 100];
var KILLED_MS = 5e3;
var BatchOwner = class {
  #ports;
  #timing;
  /** The store process last answering, so a new one is told from it. */
  #instance = null;
  #refusedUntil = Number.NEGATIVE_INFINITY;
  #startedAt = Number.NEGATIVE_INFINITY;
  /** Per connection, the last epoch a batch of it failed in. */
  #failedEpoch = /* @__PURE__ */ new Map();
  constructor(ports, timing = OWNER_TIMING) {
    this.#ports = ports;
    this.#timing = timing;
  }
  /**
   * Settles `job`, once. A batch of a connection whose earlier batch failed
   * in the same epoch fails as well, unwritten: it was decided on rows that
   * failed write left out.
   */
  async settle(job) {
    const failed = this.#failedEpoch.get(job.conn);
    if (failed !== void 0 && failed.epoch >= job.epoch) return failed.settled;
    const settled = await this.#settle(job);
    if ("failed" in settled) this.#failedEpoch.set(job.conn, { epoch: job.epoch, settled });
    return settled;
  }
  async #settle(job) {
    const ports = this.#ports;
    const began = ports.now();
    let why = "none";
    let silentSince = null;
    let step = { at: "send" };
    for (let poll = 0; ; ) {
      if (step.at === "send") {
        if (ports.lockFree()) {
          if (why === "none") this.#start();
          return this.#direct(job, why);
        }
        if (ports.now() < this.#refusedUntil) return this.#direct(job, "refused");
        const sent = this.#instance === null ? "lost" : await ports.submit(job);
        if (sent === "lost") {
          step = { at: "probe", id: null };
          if (this.#instance !== null) why = "lost";
          continue;
        }
        if ("refused" in sent) {
          if (stopping(sent.refused)) {
            why = "refused";
            await ports.sleep(POLL_MS[POLL_MS.length - 1]);
            continue;
          }
          this.#refusedUntil = ports.now() + this.#timing.pauseMs;
          return this.#direct(job, "refused");
        }
        why = "lost";
        poll = 0;
        step = { at: "wait", id: sent.id, state: sent.state };
        continue;
      }
      if (step.at === "wait") {
        const { written, error } = step.state;
        if (written === true) return { by: "store", marked: false };
        if (written === false) {
          const next = this.#afterFailure(error ?? "failed", began);
          if (next !== null) return next;
          why = stopping(error ?? "") ? "refused" : "lost";
          await ports.sleep(busyBackoffMs(poll++));
          step = { at: "send" };
          continue;
        }
        const id = step.id;
        await ports.sleep(pollMs(poll++));
        const state = await ports.status(id);
        if (state === "lost") step = { at: "probe", id };
        else if (state === "unknown") step = { at: "send" };
        else step = { at: "wait", id, state };
        continue;
      }
      if (ports.lockFree()) {
        step = { at: "send" };
        continue;
      }
      const answer = await ports.ping();
      if (answer !== null) {
        silentSince = null;
        const same = this.#instance !== null && sameInstance(this.#instance, answer);
        this.#instance = answer;
        step = same && step.id !== null ? { at: "wait", id: step.id, state: WAITING } : { at: "send" };
        continue;
      }
      const now = ports.now();
      silentSince ??= now;
      if (now - silentSince >= this.#timing.hungMs) {
        if (await this.#end()) why = "hung";
        silentSince = null;
        step = { at: "send" };
        continue;
      }
      await ports.sleep(pollMs(poll++));
    }
  }
  /** `null`: try the batch again; else how it ended. A busy failure is tried again within D1's bound. */
  #afterFailure(error, began) {
    if (stopping(error)) return null;
    if (!busyText(error)) return { failed: error, busy: false };
    if (this.#ports.now() - began >= this.#timing.boundMs) return { failed: error, busy: true };
    return null;
  }
  /** Ends a store process that holds its lock and answers nothing, and waits for its lock to be free. */
  async #end() {
    const ports = this.#ports;
    const pid = this.#instance?.pid ?? ports.holder();
    if (pid === null) return false;
    ports.kill(pid);
    const deadline = ports.now() + KILLED_MS;
    for (let poll = 0; !ports.lockFree() && ports.now() < deadline; poll++) {
      await ports.sleep(pollMs(poll));
    }
    this.#instance = null;
    return true;
  }
  #start() {
    const now = this.#ports.now();
    if (now - this.#startedAt < this.#timing.startEveryMs) return;
    this.#startedAt = now;
    this.#instance = null;
    this.#ports.start();
  }
  /** D1, D2: written here in slices, tried again while busy, failed busy past the bound. */
  async #direct(job, why) {
    const ports = this.#ports;
    const began = ports.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const end = ports.direct(job, SLICE_MS);
        return end === "superseded" ? { by: "store", marked: true } : { by: "here", why };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!isBusy(error)) return { failed: text, busy: false };
        if (ports.now() - began >= this.#timing.boundMs) return { failed: text, busy: true };
      }
      await ports.sleep(busyBackoffMs(attempt));
    }
  }
};
var WAITING = { written: null, error: null };
function pollMs(poll) {
  return POLL_MS[Math.min(poll, POLL_MS.length - 1)];
}
function sameInstance(a, b) {
  return a.pid === b.pid && a.startedAt === b.startedAt;
}
function stopping(error) {
  return /stopping/.test(error);
}
function busyText(error) {
  return /database is (locked|busy)|SQLITE_BUSY/i.test(error);
}

// src/core/store-process/paths.ts
function storeProcessLockPath(commonDir, file) {
  return join(storePaths(commonDir).locksDir, `store-${file}.sqlite`);
}
function storeProcessLogPath(commonDir, file) {
  return join(storePaths(commonDir).dir, "logs", `store-${file}.log`);
}

// src/core/store-process/release.ts
var STARTING_MS = 2e3;
async function release(at, token, leaving, startingMs = STARTING_MS) {
  if (token === null && leaving) await untilServing(at, startingMs);
  if (token === null && !(leaving && existsSync(at.socketPath))) return;
  const request = {
    type: "release",
    worktreeId: at.worktreeId,
    token: token ?? "-",
    ...leaving ? { leaving } : {}
  };
  await requestDaemon(at.socketPath, request, SMALL_REQUEST_TIMEOUT_MS).catch(() => null);
}
async function untilServing(at, ms) {
  const lockPath = storeProcessLockPath(at.commonDir, "code");
  const deadline = performance.now() + ms;
  while (!existsSync(at.socketPath) && performance.now() < deadline) {
    const lock = acquireDaemonLock(lockPath);
    lock?.release();
    if (lock !== null) return;
    await setTimeout2(25);
  }
}

// src/core/daemon/log-file.ts
var DAEMON_LOG_MAX_BYTES = 4 * 1024 * 1024;
function rotateDaemonLog(path, maxBytes = DAEMON_LOG_MAX_BYTES) {
  try {
    if (statSync(path).size < maxBytes) return;
    copyFileSync(path, `${path}.1`);
    const fd = openSync(path, "r+");
    try {
      ftruncateSync(fd, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
  }
}
function openDaemonLog(path, maxBytes = DAEMON_LOG_MAX_BYTES) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateDaemonLog(path, maxBytes);
    return openSync(path, "a", 384);
  } catch {
    return null;
  }
}

// src/core/process-label.ts
var PROJECT_MAX = 32;
function argv0For(label, platform = process.platform) {
  return label !== null && platform === "linux" ? label : void 0;
}
function storeCheckLabel(commonDir) {
  return `squeal ${projectComponent(projectOf(commonDir) ?? "store")} check`;
}
function projectOf(commonDir) {
  return commonDir !== null && basename(commonDir) === ".git" ? basename(dirname(commonDir)) : null;
}
function projectComponent(name) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, PROJECT_MAX).replace(/-+$/, "") || "project";
}

// src/core/store-process/spawn.ts
function storeProcessLabel(commonDir) {
  return storeCheckLabel(commonDir).replace(/ check$/, " store");
}
function spawnStoreProcess(commonDir, launch, env = process.env) {
  let log = null;
  try {
    const cwd = storePaths(commonDir).dir;
    mkdirSync(cwd, { recursive: true });
    log = openDaemonLog(storeProcessLogPath(commonDir, "code"));
    const quiet = launch.execArgv.some((arg) => arg.startsWith("--disable-warning")) ? [] : ["--disable-warning=ExperimentalWarning"];
    const child = spawn(
      launch.execPath,
      [...quiet, ...launch.execArgv, launch.cli, "store-process", commonDir, "--store", "code"],
      {
        argv0: argv0For(storeProcessLabel(commonDir)),
        cwd,
        detached: true,
        stdio: log === null ? "ignore" : ["ignore", log, log],
        env
      }
    );
    child.on("error", () => {
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  } finally {
    if (log !== null) {
      try {
        closeSync(log);
      } catch {
      }
    }
  }
}

// src/core/store-process/relay-thread.ts
var PING_MS = 1e3;
var SUBMIT_MS = 1e4;
var data = workerData;
if (parentPort !== null && data !== void 0) serve(data);
function serve(data2) {
  const port = data2.port;
  logLongWrites((write) => port.postMessage({ log: longWriteLine(write) }));
  const lockPath = storeProcessLockPath(data2.commonDir, "code");
  let token = null;
  let leasedAt = null;
  let db = null;
  const ask = (request, timeoutMs) => requestDaemon(data2.socketPath, request, timeoutMs);
  const ports = {
    lockFree: () => {
      const lock = acquireDaemonLock(lockPath);
      lock?.release();
      return lock !== null;
    },
    start: () => {
      if (data2.launch !== null) spawnStoreProcess(data2.commonDir, data2.launch, data2.env);
    },
    ping: async () => {
      try {
        const answer = await ask({ type: "ping" }, PING_MS);
        if (!answer.ok || answer.type !== "ping") return null;
        const instance = { pid: answer.pid, startedAt: answer.startedAt };
        await lease(instance);
        return instance;
      } catch {
        return null;
      }
    },
    submit: async (job) => {
      const request = {
        type: "write",
        worktreeId: data2.worktreeId,
        storeSchema: data2.storeSchema,
        token: null,
        release: false,
        batch: encodeBatch(job.statements),
        kind: job.kind,
        splittable: job.splittable,
        seq: job.seq
      };
      try {
        const answer = await ask(request, SUBMIT_MS);
        if (!answer.ok) return { refused: answer.error };
        if (answer.type !== "write") return { refused: `unexpected answer ${answer.type}` };
        return { id: answer.requestId, state: answer };
      } catch {
        return "lost";
      }
    },
    status: async (id) => {
      try {
        const answer = await ask({ type: "write-status", requestId: id }, SMALL_REQUEST_TIMEOUT_MS);
        if (!answer.ok || answer.type !== "write") return "unknown";
        return answer;
      } catch {
        return "lost";
      }
    },
    holder: () => storeProcessHolder(lockPath),
    kill: (pid) => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
    },
    direct: (job, busyMs) => {
      db ??= openHere(data2.commonDir);
      db.raw.exec(`PRAGMA busy_timeout = ${busyMs}`);
      return db.writer.write(data2.worktreeId, job.seq, job.statements).end === "superseded" ? "superseded" : "written";
    },
    sleep: (ms) => setTimeout2(ms),
    now: () => performance.now()
  };
  const lease = async (instance) => {
    if (leasedAt?.pid === instance.pid && leasedAt.startedAt === instance.startedAt) return;
    leasedAt = instance;
    token = null;
    const request = {
      type: "lease",
      worktreeId: data2.worktreeId,
      holder: `${process.pid} daemon`,
      process: leaseProcess()
    };
    const answer = await ask(request, SMALL_REQUEST_TIMEOUT_MS).catch(() => null);
    if (answer?.ok === true && answer.type === "lease") token = answer.token;
  };
  const owner = new BatchOwner(ports, timingOf(data2.timing));
  let closing = false;
  let chain = Promise.resolve();
  port.on("message", (message) => {
    if (message.close === true) {
      closing = true;
      const leaving = message.leaving === true;
      chain = chain.then(async () => {
        await release(data2, token, leaving);
        db?.raw.close();
        port.close();
      });
      return;
    }
    const job = message.job;
    if (job === void 0 || closing) return;
    chain = chain.then(async () => {
      port.postMessage({ n: job.n, settled: await owner.settle(job) });
    });
  });
}
function timingOf(timing) {
  return { ...OWNER_TIMING, ...timing };
}
function openHere(commonDir) {
  const raw = new DatabaseSync(codeStorePath(commonDir));
  raw.exec("PRAGMA synchronous = NORMAL");
  return { raw, writer: new GuardedWriter(raw) };
}
function storeProcessHolder(lockPath) {
  if (process.platform !== "linux") return null;
  try {
    const source = createProcSource();
    const key = source.fileKey(lockPath);
    if (key === null) return null;
    for (const lock of source.locks() ?? []) {
      if (lock.file !== key || lock.blocked || lock.pid === null || lock.pid === process.pid)
        continue;
      const args = source.cmdline(lock.pid) ?? cmdlineOf(lock.pid);
      if (args.includes("store-process")) return lock.pid;
    }
  } catch {
  }
  return null;
}
function cmdlineOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return [];
  }
}
