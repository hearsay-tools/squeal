#!/usr/bin/env node

// src/cli/main.ts
import { readFileSync as readFileSync4 } from "node:fs";

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/keys/closure.ts
var CLOSURE_METHOD = "static imports plus declared inputs";

// src/core/keys/reverse-index.ts
function testFileId(ref) {
  return `${ref.project}\0${ref.path}`;
}

// src/core/state/derive.ts
function testFileKeyOf(check) {
  return testFileId(testFileOf(check));
}
function testFileOf(check) {
  return { project: check.project, path: check.testPath };
}

// src/core/state/check-name.ts
var FILE_LEVEL = " (file-level)";
function formatCheck(check) {
  const project = check.project === "" ? "" : `[${check.project}] `;
  return check.kind === "test" ? `${project}${check.testPath} > ${check.fullName}` : `${project}${check.testPath}${FILE_LEVEL}`;
}
function parseCheck(name) {
  const match = /^(?:\[([^\]]*)\] )?(.+)$/s.exec(name.trim());
  if (match === null) return null;
  const project = match[1] ?? "";
  const rest = match[2] ?? "";
  const split = rest.indexOf(" > ");
  if (split === -1) {
    const testPath = rest.endsWith(FILE_LEVEL) ? rest.slice(0, -FILE_LEVEL.length) : rest;
    return { kind: "file", project, testPath };
  }
  return {
    kind: "test",
    project,
    testPath: rest.slice(0, split),
    fullName: rest.slice(split + 3)
  };
}

// src/core/state/header.ts
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId)) {
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  const counts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  for (const state of states) counts[state.validity]++;
  const last = store.checkpoints.lastCompleted(worktreeId);
  return {
    revision,
    counts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    fullSuite: {
      atCurrentRevision: last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null
    }
  };
}
function countFilesWithoutChecks(states, keys) {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const counts = { pending: 0, unknown: 0 };
  for (const row of keys) {
    if (withChecks.has(testFileId(row.testFile))) continue;
    counts[hasKey(row) && row.pending !== null ? "pending" : "unknown"]++;
  }
  return counts;
}
function hasKey(row) {
  return row.key !== null;
}
function toKnownFailure(state, revision) {
  if (state.outcome !== "fail") return null;
  return {
    check: state.check,
    outcome: "fail",
    validity: state.validity,
    observedAt: state.observedAt ?? revision,
    summary: state.summary ?? "",
    fingerprint: state.fingerprint ?? "",
    location: state.location
  };
}

// src/core/status/format-status.ts
function formatStatus(result, now) {
  if (!result.available) return formatUnavailable(result);
  const lines = [
    `Revision: ${result.revision}`,
    `Known failures: ${result.knownFailures.length}`,
    ...result.knownFailures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...f.summary === "" ? [] : [`        ${f.summary}`],
      `        ${[
        ...f.location === null ? [] : [`at ${f.location.path}:${f.location.line}:${f.location.column}`],
        `observed at revision ${f.observedAt}`,
        f.validity
      ].join(", ")}`
    ]),
    `Affected checks: ${affected(result)}`,
    result.fullSuite.lastCompletedRevision === null ? "Last full suite: none recorded" : `Last full suite: completed at revision ${result.fullSuite.lastCompletedRevision}`,
    result.fullSuite.atCurrentRevision ? "Current revision has completed a full-suite run" : "Current revision has not completed a full-suite run",
    "",
    worktreeLine(result),
    daemonLine(result, now),
    `Inherited: ${result.inherited.count} current ${plural(result.inherited.count, "result")}`,
    ...result.inherited.sources.map(
      (s) => `  ${s.count} from ${s.worktreeRoot ?? s.worktreeId} at ${shortCommit(s.commit)}`
    ),
    ...result.breakdown.testFilesWithoutChecks === 0 ? [] : [
      `Test files without checks: ${result.testFilesWithoutChecks.pending} pending, ${result.testFilesWithoutChecks.unknown} unknown`
    ],
    `Closure method: ${result.closureMethod}`,
    `Store schema: ${result.storeSchemaVersion}`,
    ...notes(result)
  ];
  return `${lines.join("\n")}
`;
}
function notes(s) {
  const daemon = s.daemonNotes.map((n) => {
    const at = new Date(n.at).toISOString();
    return n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
  });
  const all = [...s.notes, ...daemon];
  return all.length === 0 ? [] : ["Notes:", ...all.map((note) => `  ${note}`)];
}
function formatUnavailable(result) {
  return `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}
`;
}
function affected(s) {
  const { currentByOutcome, pendingByPhase } = s.breakdown;
  const parts = [
    `${currentByOutcome.pass} passed`,
    `${pendingByPhase.running} running`,
    `${pendingByPhase.queued} queued`
  ];
  const optional = [
    [currentByOutcome.skip, "skipped"],
    [s.counts.stale, "stale"],
    [s.counts.unknown + currentByOutcome.unknown, "unknown"]
  ];
  for (const [count, label] of optional) if (count > 0) parts.push(`${count} ${label}`);
  return parts.join(", ");
}
function worktreeLine(s) {
  const dirty = s.dirty === null ? "dirty state unknown" : s.dirty ? "dirty" : "clean";
  return `Worktree: ${s.worktreeRoot} (HEAD ${shortCommit(s.head)}, ${dirty})`;
}
function daemonLine(s, now) {
  if (s.daemon.state === "alive") {
    return `Daemon: running, last heartbeat ${age(now - s.daemon.lastHeartbeatAt)} ago`;
  }
  if (s.daemon.since === null) return "Daemon: no daemon running";
  return `Daemon: no daemon running since ${new Date(s.daemon.since).toISOString()}`;
}
function shortCommit(commit) {
  return commit === null ? "no commit" : commit.slice(0, 7);
}
function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}
function age(ms) {
  const seconds = Math.max(0, Math.round(ms / 1e3));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

// src/core/status/format-why.ts
var INDENT = "        ";
function formatWhy(why2) {
  if (!why2.available) return formatUnavailable(why2);
  if (!why2.found) {
    if (why2.candidates.length === 0) return `No check matches "${why2.query}" in this worktree.
`;
    return `${[
      `"${why2.query}" matches ${why2.candidates.length} checks in this worktree:`,
      ...why2.candidates.map((c) => `  ${formatCheck(c)}`)
    ].join("\n")}
`;
  }
  const lines = [
    `Check: ${formatCheck(why2.check)}`,
    `Worktree: ${why2.worktreeRoot}`,
    `Revision: ${why2.revision ?? "none recorded"}`,
    "",
    ...knownState(why2, why2.knownState),
    "",
    ...history(why2.history),
    "",
    ...results(why2),
    "",
    `Last run log: ${why2.results[0]?.logDir ?? "none"}`
  ];
  return `${lines.join("\n")}
`;
}
function knownState(why2, s) {
  if (s === null) return ["Known state: none in this worktree"];
  const head = [
    upper(s.outcome),
    s.pendingPhase === null ? s.validity : `${s.validity} (${s.pendingPhase})`,
    ...s.observedAt === null ? [] : [`observed at revision ${s.observedAt}`],
    ...s.commit === null ? [] : [`commit ${shortCommit(s.commit)}`]
  ];
  const lines = [`Known state: ${head.join(", ")}`];
  if (s.origin?.kind === "inherited") {
    const source = why2.worktreeRoots[s.origin.worktreeId] ?? `removed worktree ${s.origin.worktreeId}`;
    lines.push(`  Origin: inherited from ${source} at ${shortCommit(s.origin.commit)}`);
  }
  if (s.summary !== null) lines.push(`  Summary: ${s.summary}`);
  if (s.location !== null) {
    lines.push(`  Location: ${s.location.path}:${s.location.line}:${s.location.column}`);
  }
  if (s.fingerprint !== null) lines.push(`  Fingerprint: ${s.fingerprint}`);
  return lines;
}
function history(transitions) {
  if (transitions.length === 0) return ["History: no transitions in this worktree"];
  return [
    `History (${transitions.length} ${plural(transitions.length, "transition")}, oldest first):`,
    ...transitions.map(
      (t) => `  revision ${t.revision}  ${new Date(t.at).toISOString()}  ${transitionText(t)}`
    )
  ];
}
function transitionText(t) {
  if (t.kind === "first-seen-fail") return "first seen FAIL";
  const change = `${t.from === null ? "NONE" : upper(t.from)} -> ${upper(t.to)}`;
  return t.kind === "fail-changed" ? `${change}, failure changed` : change;
}
function results(why2) {
  if (why2.results.length === 0) return ["Results: none stored"];
  return [
    `Results (${why2.results.length}, newest first):`,
    ...why2.results.flatMap((entry) => resultLines(why2, entry))
  ];
}
function resultLines(why2, { result, worktreeRoot, logDir }) {
  const p = result.provenance;
  const where = p.worktreeId === why2.worktreeId ? `${worktreeRoot ?? why2.worktreeRoot} (this worktree)` : worktreeRoot ?? `removed worktree ${p.worktreeId}`;
  const lines = [
    `  ${upper(result.outcome).padEnd(4)}  ${new Date(p.recordedAt).toISOString()}  ${where}, revision ${p.revision}, commit ${shortCommit(p.commit)}, ${p.dirty ? "dirty" : "clean"}`,
    `${INDENT}run ${p.runId}, ${Math.round(result.durationMs)} ms, key ${result.key.slice(0, 12)}`,
    `${INDENT}log: ${logDir ?? "run record pruned"}`
  ];
  if (result.summary !== null) lines.push(`${INDENT}${result.summary}`);
  for (const error of result.errors) {
    const text = [error.stack ?? `${error.name}: ${error.message}`, error.diff].filter((part) => part !== null).join("\n");
    for (const line of text.split("\n")) lines.push(`${INDENT}${line}`);
  }
  return lines;
}
function upper(outcome) {
  return outcome.toUpperCase();
}

// src/core/status/open.ts
import { existsSync as existsSync3, realpathSync as realpathSync2 } from "node:fs";
import { dirname, join as join4, resolve as resolve3 } from "node:path";

// src/core/store/open.ts
import { existsSync as existsSync2, mkdirSync, renameSync, rmSync as rmSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/core/store/connection.ts
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
    return Number(this.#statement(sql).run(...params).changes);
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
   * busy timeout instead of failing to upgrade a read snapshot.
   */
  transaction(fn) {
    const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
    this.db.exec(savepoint === null ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
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
    }
  }
  /** Idempotent. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#statements.clear();
    this.db.close();
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
function rollback(db) {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/.test(String(error))) throw error;
  }
}

// src/core/store/paths.ts
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
function worktreeIdFor(root) {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}
function resolveCommonDir(root) {
  const dotGit = join(root, ".git");
  const stat = lstatOrNull(dotGit);
  if (stat === null) return null;
  if (stat.isDirectory()) return realpathSync(dotGit);
  if (!stat.isFile()) return null;
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
  if (!match?.[1]) return null;
  const gitdir = resolve(root, match[1]);
  if (lstatOrNull(gitdir) === null) return null;
  const commondirFile = join(gitdir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync(gitdir);
  const commondir = readFileSync(commondirFile, "utf8").trim();
  const common = isAbsolute(commondir) ? commondir : resolve(gitdir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync(common);
}
function storePaths(commonDir) {
  const dir = join(commonDir, "squeal");
  return {
    dir,
    database: join(dir, "store.sqlite"),
    runsDir: join(dir, "runs"),
    locksDir: join(dir, "locks")
  };
}
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
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
function strOrNull(row, column) {
  return row[column] === null ? null : str(row, column);
}
function num(row, column) {
  const value = row[column];
  if (typeof value !== "number") throw new TypeError(`squeal store: ${column} is not a number`);
  return value;
}
function numOrNull(row, column) {
  return row[column] === null ? null : num(row, column);
}
function bool(row, column) {
  return num(row, column) !== 0;
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
function locationParams(location2) {
  return [location2?.path ?? null, location2?.line ?? null, location2?.column ?? null];
}
function location(row) {
  const path = strOrNull(row, "location_path");
  if (path === null) return null;
  return { path, line: num(row, "location_line"), column: num(row, "location_column") };
}
function checkParams(check) {
  return [
    check.project,
    check.testPath,
    check.kind,
    check.kind === "test" ? check.fullName : ""
  ];
}
function checkFrom(row) {
  const project = str(row, "check_project");
  const testPath = str(row, "check_test_path");
  if (oneOf(row, "check_kind", ["test", "file"]) === "file") {
    return { kind: "file", project, testPath };
  }
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}
var CHECK_WHERE = "project = ? AND test_path = ? AND kind = ? AND full_name = ?";
var CHECK_COLUMNS = "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";
function findCheckId(conn, check) {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE}`, ...checkParams(check));
  return row === null ? null : num(row, "id");
}
function ensureCheckId(conn, check, seenAt) {
  conn.run(
    `INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at)
     VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`,
    ...checkParams(check),
    seenAt
  );
  const id = findCheckId(conn, check);
  if (id === null) throw new Error(`squeal store: check row missing after insert`);
  return id;
}
function flag(value) {
  return value ? 1 : 0;
}

// src/core/store/prune.ts
import { existsSync, rmSync } from "node:fs";
import { join as join2, resolve as resolve2, sep } from "node:path";
var DAY_MS = 24 * 60 * 60 * 1e3;
var EVICTION_BATCH = 32;
var LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key IS NOT NULL`;
var MAIN_NEWEST = `
  SELECT id FROM (
    SELECT rowid AS id,
      row_number() OVER (PARTITION BY check_id ORDER BY recorded_at DESC, rowid DESC) AS n
    FROM results WHERE worktree_id IN (SELECT id FROM worktrees WHERE is_main = 1)
  ) WHERE n = 1`;
var LAST_COMPLETED_CHECKPOINTS = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM checkpoints x
            WHERE x.worktree_id = w.id AND x.end_state = 'completed'
            ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1) AS id
    FROM worktrees w
  ) WHERE id IS NOT NULL`;
function prune(conn, worktrees, paths, options) {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  let worktreesRemoved = 0;
  for (const worktree of worktrees.list()) {
    if (existsSync(join2(worktree.root, ".git"))) continue;
    worktrees.remove(worktree.id);
    worktreesRemoved++;
  }
  let resultsRemoved = conn.transaction(() => {
    const removed = conn.run(
      `DELETE FROM results
       WHERE key NOT IN (${LIVE_KEYS})
         AND rowid NOT IN (${MAIN_NEWEST})
         AND (recorded_at < ? OR worktree_id NOT IN (SELECT id FROM worktrees))`,
      cutoff
    );
    dropOrphanFailureTexts(conn);
    return removed;
  });
  if (options.maxSizeMb !== null) {
    resultsRemoved += evictToCap(conn, options.maxSizeMb * 1024 * 1024);
  }
  const droppedRuns = conn.transaction(
    () => conn.all(
      `DELETE FROM runs
       WHERE NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))
       RETURNING log_dir`,
      cutoff
    )
  );
  for (const row of droppedRuns) removeRunLog(paths, str(row, "log_dir"));
  const checkpointsRemoved = conn.transaction(
    () => conn.run(
      `DELETE FROM checkpoints
       WHERE id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
      cutoff
    )
  );
  const checksRemoved = conn.transaction(
    () => conn.run(
      `DELETE FROM checks WHERE id NOT IN (
         SELECT check_id FROM results UNION SELECT check_id FROM known_states
         UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`
    )
  );
  conn.db.exec("PRAGMA incremental_vacuum");
  return {
    resultsRemoved,
    runsRemoved: droppedRuns.length,
    checkpointsRemoved,
    checksRemoved,
    worktreesRemoved,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size")
  };
}
function evictToCap(conn, capBytes) {
  const tiers = [
    `key NOT IN (${LIVE_KEYS}) AND rowid NOT IN (${MAIN_NEWEST})`,
    `key NOT IN (${LIVE_KEYS})`
  ];
  let removed = 0;
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      const batch = conn.transaction(() => {
        const n = conn.run(
          `DELETE FROM results WHERE rowid IN (
             SELECT rowid FROM results WHERE ${tier} ORDER BY last_used_at, rowid LIMIT ?)`,
          EVICTION_BATCH
        );
        dropOrphanFailureTexts(conn);
        return n;
      });
      if (batch === 0) break;
      removed += batch;
    }
  }
  return removed;
}
function dropOrphanFailureTexts(conn) {
  conn.run(
    `DELETE FROM failure_texts
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)`
  );
}
function usedBytes(conn) {
  const pages = pragmaNumber(conn, "page_count") - pragmaNumber(conn, "freelist_count");
  return pages * pragmaNumber(conn, "page_size");
}
function pragmaNumber(conn, name) {
  const row = conn.get(`PRAGMA ${name}`);
  if (row === null) throw new Error(`squeal store: PRAGMA ${name} returned nothing`);
  return num(row, name);
}
function removeRunLog(paths, logDir) {
  const runsDir = resolve2(paths.runsDir);
  const target = resolve2(logDir);
  if (target.startsWith(runsDir + sep)) rmSync(target, { recursive: true, force: true });
}

// src/core/store/repos/consumers.ts
var OUTCOMES = ["pass", "fail", "skip", "unknown"];
var WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";
function consumerParams(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createConsumerRepo(conn) {
  const unregister = (consumer) => conn.transaction(() => {
    conn.run(`DELETE FROM consumer_views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    conn.run(`DELETE FROM consumers WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
  });
  return {
    get: (consumer) => {
      const row = conn.get(
        `SELECT * FROM consumers WHERE ${WHERE_CONSUMER}`,
        ...consumerParams(consumer)
      );
      return row === null ? null : toConsumer(row);
    },
    list: (worktreeId) => conn.all(
      "SELECT * FROM consumers WHERE worktree_id = ? ORDER BY session_id, agent_id",
      worktreeId
    ).map(toConsumer),
    /**
     * A registration starts from an empty view: spec 001 D6 seeds the view
     * with the current known state on registration, so entries left by an
     * earlier registration of the same consumer are dropped.
     */
    register: (consumer, at) => conn.transaction(() => {
      unregister(consumer);
      conn.run(
        `INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`,
        ...consumerParams(consumer),
        at,
        at
      );
      return { consumer, registeredAt: at, lastSeenAt: at, lastDeliveredAt: null };
    }),
    touch: (consumer, at, delivered) => {
      conn.run(
        `UPDATE consumers SET last_seen_at = ?,
           last_delivered_at = CASE WHEN ? THEN ? ELSE last_delivered_at END
         WHERE ${WHERE_CONSUMER}`,
        at,
        delivered ? 1 : 0,
        at,
        ...consumerParams(consumer)
      );
    },
    unregister,
    expire: (cutoff) => conn.transaction(() => {
      const expired = conn.all(
        `SELECT * FROM consumers
             WHERE last_seen_at < ? AND coalesce(last_delivered_at, 0) < ?
             ORDER BY worktree_id, session_id, agent_id`,
        cutoff,
        cutoff
      ).map((row) => toConsumer(row).consumer);
      for (const consumer of expired) unregister(consumer);
      return expired;
    })
  };
}
function toConsumer(row) {
  return {
    consumer: {
      worktreeId: str(row, "worktree_id"),
      sessionId: str(row, "session_id"),
      agentId: str(row, "agent_id")
    },
    registeredAt: num(row, "registered_at"),
    lastSeenAt: num(row, "last_seen_at"),
    lastDeliveredAt: numOrNull(row, "last_delivered_at")
  };
}
function createViewRepo(conn) {
  return {
    list: (consumer) => conn.all(
      `SELECT v.*, ${CHECK_COLUMNS} FROM consumer_views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      ...consumerParams(consumer)
    ).map(toView),
    writeMany: (consumer, entries) => conn.transaction(() => {
      for (const e of entries) {
        conn.run(
          `INSERT OR REPLACE INTO consumer_views
               (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ...consumerParams(consumer),
          ensureCheckId(conn, e.check, e.toldAt),
          e.outcome,
          e.fingerprint,
          e.toldAt
        );
      }
    }),
    removeMany: (consumer, checks) => conn.transaction(() => {
      for (const check of checks) {
        const id = findCheckId(conn, check);
        if (id === null) continue;
        conn.run(
          `DELETE FROM consumer_views WHERE ${WHERE_CONSUMER} AND check_id = ?`,
          ...consumerParams(consumer),
          id
        );
      }
    })
  };
}
function toView(row) {
  return {
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    fingerprint: strOrNull(row, "fingerprint"),
    toldAt: num(row, "told_at")
  };
}

// src/core/store/repos/results.ts
import { createHash as createHash2 } from "node:crypto";
var OUTCOMES2 = ["pass", "fail", "skip"];
var SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
function createResultRepo(conn) {
  return {
    byKey: (key, usedAt = Date.now()) => {
      conn.run(
        "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
        usedAt,
        key,
        usedAt
      );
      return conn.all(
        `${SELECT_RESULTS} WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
        key
      ).map(toResult);
    },
    checksForKey: (key) => conn.all(
      `SELECT ${CHECK_COLUMNS} FROM results r JOIN checks c ON c.id = r.check_id
           WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      key
    ).map(checkFrom),
    latestForCheck: (check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_RESULTS} WHERE r.check_id = ? ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1`,
        id
      );
      return row === null ? null : toResult(row);
    },
    listForCheck: (check, limit) => {
      const id = findCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `${SELECT_RESULTS} WHERE r.check_id = ?
           ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
        id,
        limit
      ).map(toResult);
    },
    putMany: (records) => conn.transaction(() => {
      for (const r of records) {
        const p = r.provenance;
        conn.run(
          `INSERT OR REPLACE INTO results (check_id, key, outcome, duration_ms, location_path,
               location_line, location_column, fingerprint, failure_id, worktree_id, revision,
               commit_sha, dirty, run_id, recorded_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ensureCheckId(conn, r.check, p.recordedAt),
          r.key,
          r.outcome,
          r.durationMs,
          ...locationParams(r.location),
          r.fingerprint,
          storeFailureText(conn, r.summary, r.errors),
          p.worktreeId,
          p.revision,
          p.commit,
          flag(p.dirty),
          p.runId,
          p.recordedAt,
          p.recordedAt
        );
      }
    })
  };
}
function storeFailureText(conn, summary, errors) {
  if (summary === null && errors.length === 0) return null;
  const text = JSON.stringify(errors);
  const id = createHash2("sha256").update(JSON.stringify([summary, text])).digest("hex");
  conn.run(
    "INSERT INTO failure_texts (id, summary, errors) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    id,
    summary,
    text
  );
  return id;
}
function toResult(row) {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", OUTCOMES2),
    durationMs: num(row, "duration_ms"),
    location: location(row),
    fingerprint: strOrNull(row, "fingerprint"),
    summary: strOrNull(row, "summary"),
    errors: row.errors === null ? [] : json(row, "errors"),
    provenance: {
      worktreeId: str(row, "worktree_id"),
      revision: num(row, "revision"),
      commit: strOrNull(row, "commit_sha"),
      dirty: bool(row, "dirty"),
      runId: str(row, "run_id"),
      recordedAt: num(row, "recorded_at")
    }
  };
}

// src/core/store/repos/runs.ts
var RUN_ENDS = ["completed", "crashed", "timed-out"];
var CHECKPOINT_KINDS = ["run-all", "baseline"];
var CHECKPOINT_ENDS = ["completed", "abandoned"];
function createRunRepo(conn) {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO runs (id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        JSON.stringify(record.testFiles),
        record.checkpointId,
        record.logDir,
        record.startedAt
      );
      return { ...record, endedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM runs WHERE id = ?", id);
      return row === null ? null : toRun(row);
    }
  };
}
function toRun(row) {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    testFiles: json(row, "test_files"),
    checkpointId: strOrNull(row, "checkpoint_id"),
    logDir: str(row, "log_dir"),
    startedAt: num(row, "started_at"),
    endedAt: numOrNull(row, "ended_at"),
    end: oneOfOrNull(row, "end_state", RUN_ENDS)
  };
}
function createCheckpointRepo(conn) {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO checkpoints (id, worktree_id, revision, kind, test_files, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        record.kind,
        JSON.stringify(record.testFiles),
        record.startedAt
      );
      return { ...record, completedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE checkpoints SET end_state = ?, completed_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM checkpoints WHERE id = ?", id);
      return row === null ? null : toCheckpoint(row);
    },
    lastCompleted: (worktreeId) => {
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId
      );
      return row === null ? null : toCheckpoint(row);
    }
  };
}
function toCheckpoint(row) {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    kind: oneOf(row, "kind", CHECKPOINT_KINDS),
    testFiles: json(row, "test_files"),
    startedAt: num(row, "started_at"),
    completedAt: numOrNull(row, "completed_at"),
    end: oneOfOrNull(row, "end_state", CHECKPOINT_ENDS)
  };
}

// src/core/store/repos/states.ts
var OUTCOMES3 = ["pass", "fail", "skip", "unknown"];
var VALIDITIES = ["current", "pending", "stale", "unknown"];
var PENDING = ["queued", "running"];
var KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "fail-changed",
  "to-unknown"
];
var SELECT_STATES = `SELECT s.*, ${CHECK_COLUMNS} FROM known_states s JOIN checks c ON c.id = s.check_id`;
function createKnownStateRepo(conn) {
  return {
    list: (worktreeId) => conn.all(
      `${SELECT_STATES} WHERE s.worktree_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      worktreeId
    ).map(toKnownState),
    get: (worktreeId, check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_STATES} WHERE s.worktree_id = ? AND s.check_id = ?`,
        worktreeId,
        id
      );
      return row === null ? null : toKnownState(row);
    },
    upsertMany: (states) => conn.transaction(() => {
      const now = Date.now();
      for (const s of states) {
        const origin = s.origin;
        conn.run(
          `INSERT OR REPLACE INTO known_states (worktree_id, check_id, outcome, validity,
               pending_phase, observed_at, commit_sha, origin_kind, origin_worktree,
               origin_commit, duration_ms, location_path, location_line, location_column,
               summary, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.worktreeId,
          ensureCheckId(conn, s.check, now),
          s.outcome,
          s.validity,
          s.pendingPhase,
          s.observedAt,
          s.commit,
          origin?.kind ?? null,
          origin?.kind === "inherited" ? origin.worktreeId : null,
          origin?.kind === "inherited" ? origin.commit : null,
          s.durationMs,
          ...locationParams(s.location),
          s.summary,
          s.fingerprint
        );
      }
    }),
    removeMany: (worktreeId, checks) => conn.transaction(() => {
      for (const check of checks) {
        const id = findCheckId(conn, check);
        if (id === null) continue;
        conn.run(
          "DELETE FROM known_states WHERE worktree_id = ? AND check_id = ?",
          worktreeId,
          id
        );
      }
    })
  };
}
function toOrigin(row) {
  const kind = oneOfOrNull(row, "origin_kind", ["own", "inherited"]);
  if (kind === null) return null;
  if (kind === "own") return { kind };
  return {
    kind,
    worktreeId: str(row, "origin_worktree"),
    commit: strOrNull(row, "origin_commit")
  };
}
function toKnownState(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES3),
    validity: oneOf(row, "validity", VALIDITIES),
    pendingPhase: oneOfOrNull(row, "pending_phase", PENDING),
    observedAt: numOrNull(row, "observed_at"),
    commit: strOrNull(row, "commit_sha"),
    origin: toOrigin(row),
    durationMs: numOrNull(row, "duration_ms"),
    location: location(row),
    summary: strOrNull(row, "summary"),
    fingerprint: strOrNull(row, "fingerprint")
  };
}
function createTransitionRepo(conn) {
  return {
    append: (transitions) => conn.transaction(() => {
      for (const t of transitions) {
        conn.run(
          `INSERT INTO transitions (worktree_id, check_id, kind, from_outcome, to_outcome,
               from_fingerprint, to_fingerprint, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.worktreeId,
          ensureCheckId(conn, t.check, t.at),
          t.kind,
          t.from,
          t.to,
          t.fromFingerprint,
          t.toFingerprint,
          t.revision,
          t.at
        );
      }
    }),
    history: (worktreeId, check) => {
      const id = findCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS} FROM transitions t JOIN checks c ON c.id = t.check_id
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
    check: checkFrom(row),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES3),
    to: oneOf(row, "to_outcome", OUTCOMES3),
    fromFingerprint: strOrNull(row, "from_fingerprint"),
    toFingerprint: strOrNull(row, "to_fingerprint"),
    revision: num(row, "revision"),
    at: num(row, "at")
  };
}

// src/core/store/repos/test-files.ts
var METHODS = ["static imports plus declared inputs"];
var PENDING2 = ["queued", "running"];
function createTestFileRepo(conn) {
  return {
    get: (testFile) => {
      const row = conn.get(
        "SELECT * FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path
      );
      return row === null ? null : toTestFile(row);
    },
    list: () => conn.all("SELECT * FROM test_files ORDER BY project, path").map(toTestFile),
    put: (record) => {
      conn.run(
        `INSERT OR REPLACE INTO test_files
           (project, path, closure_paths, complete, method, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.testFile.project,
        record.testFile.path,
        JSON.stringify(record.closure.paths),
        flag(record.closure.complete),
        record.closure.method,
        record.updatedAt,
        record.updatedBy
      );
    },
    remove: (testFile) => {
      conn.run(
        "DELETE FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path
      );
    }
  };
}
function toTestFile(row) {
  const testFile = { project: str(row, "project"), path: str(row, "path") };
  return {
    testFile,
    closure: {
      testFile,
      paths: json(row, "closure_paths"),
      complete: bool(row, "complete"),
      method: oneOf(row, "method", METHODS)
    },
    updatedAt: num(row, "updated_at"),
    updatedBy: str(row, "updated_by")
  };
}
function createTestFileKeyRepo(conn) {
  return {
    list: (worktreeId) => conn.all(
      "SELECT * FROM test_file_keys WHERE worktree_id = ? ORDER BY project, path",
      worktreeId
    ).map(toTestFileKey),
    upsertMany: (records) => conn.transaction(() => {
      for (const r of records) {
        conn.run(
          `INSERT OR REPLACE INTO test_file_keys
               (worktree_id, project, path, key, revision, pending)
             VALUES (?, ?, ?, ?, ?, ?)`,
          r.worktreeId,
          r.testFile.project,
          r.testFile.path,
          r.key,
          r.revision,
          r.pending
        );
      }
    }),
    remove: (worktreeId, testFiles) => conn.transaction(() => {
      for (const t of testFiles) {
        conn.run(
          "DELETE FROM test_file_keys WHERE worktree_id = ? AND project = ? AND path = ?",
          worktreeId,
          t.project,
          t.path
        );
      }
    })
  };
}
function toTestFileKey(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    testFile: { project: str(row, "project"), path: str(row, "path") },
    key: strOrNull(row, "key"),
    revision: num(row, "revision"),
    pending: oneOfOrNull(row, "pending", PENDING2)
  };
}
function createCheckRepo(conn) {
  return {
    listByTestFile: (testFile) => conn.all(
      `SELECT c.*, ${CHECK_COLUMNS} FROM checks c WHERE c.project = ? AND c.test_path = ?
           ORDER BY c.kind, c.full_name`,
      testFile.project,
      testFile.path
    ).map(toCheck),
    upsertMany: (records) => conn.transaction(() => {
      for (const r of records) {
        const id = ensureCheckId(conn, r.check, r.firstSeenAt);
        conn.run(
          `UPDATE checks SET location_path = ?, location_line = ?, location_column = ?,
               templated = ? WHERE id = ?`,
          ...locationParams(r.location),
          flag(r.templated),
          id
        );
      }
    })
  };
}
function toCheck(row) {
  return {
    check: checkFrom(row),
    location: location(row),
    templated: bool(row, "templated"),
    firstSeenAt: num(row, "first_seen_at")
  };
}

// src/core/store/repos/workspace.ts
var TRIGGERS = ["watch", "interval", "start", "dropped-events"];
function createRevisionRepo(conn) {
  return {
    append: (revision) => conn.transaction(() => {
      const row = conn.get(
        "SELECT coalesce(max(number), 0) AS n FROM revisions WHERE worktree_id = ?",
        revision.worktreeId
      );
      const stored = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
      conn.run(
        `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        stored.worktreeId,
        stored.number,
        stored.createdAt,
        stored.head,
        flag(stored.dirty),
        stored.trigger,
        JSON.stringify(stored.changes)
      );
      return stored;
    }),
    latest: (worktreeId) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? ORDER BY number DESC LIMIT 1",
        worktreeId
      );
      return row === null ? null : toRevision(row);
    },
    get: (worktreeId, number) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? AND number = ?",
        worktreeId,
        number
      );
      return row === null ? null : toRevision(row);
    }
  };
}
function toRevision(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    number: num(row, "number"),
    createdAt: num(row, "created_at"),
    head: strOrNull(row, "head"),
    dirty: bool(row, "dirty"),
    trigger: oneOf(row, "trigger", TRIGGERS),
    changes: json(row, "changes")
  };
}
function createFileHashRepo(conn) {
  return {
    get: (worktreeId, path) => {
      const row = conn.get(
        "SELECT * FROM file_hashes WHERE worktree_id = ? AND path = ?",
        worktreeId,
        path
      );
      return row === null ? null : toFileHash(row);
    },
    list: (worktreeId) => conn.all("SELECT * FROM file_hashes WHERE worktree_id = ? ORDER BY path", worktreeId).map(toFileHash),
    upsertMany: (worktreeId, records) => conn.transaction(() => {
      for (const r of records) {
        conn.run(
          `INSERT OR REPLACE INTO file_hashes
               (worktree_id, path, mtime_ms, ctime_ms, size, inode, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          worktreeId,
          r.path,
          r.mtimeMs,
          r.ctimeMs,
          r.size,
          r.inode,
          r.hash
        );
      }
    }),
    removeMany: (worktreeId, paths) => conn.transaction(() => {
      for (const path of paths) {
        conn.run("DELETE FROM file_hashes WHERE worktree_id = ? AND path = ?", worktreeId, path);
      }
    })
  };
}
function toFileHash(row) {
  return {
    path: str(row, "path"),
    mtimeMs: num(row, "mtime_ms"),
    ctimeMs: num(row, "ctime_ms"),
    size: num(row, "size"),
    inode: num(row, "inode"),
    hash: str(row, "hash")
  };
}

// src/core/store/repos/worktrees.ts
var WORKTREE_SCOPED_TABLES = [
  "revisions",
  "file_hashes",
  "test_file_keys",
  "known_states",
  "transitions",
  "consumer_views",
  "consumers"
];
function createWorktreeRepo(conn) {
  return {
    get: (id) => {
      const row = conn.get("SELECT * FROM worktrees WHERE id = ?", id);
      return row === null ? null : toRecord(row);
    },
    list: () => conn.all("SELECT * FROM worktrees ORDER BY id").map(toRecord),
    upsert: (record) => {
      const d = record.daemon;
      conn.run(
        `INSERT INTO worktrees (id, root, common_dir, is_main, registered_at, daemon_socket,
           daemon_started_at, daemon_heartbeat_at, daemon_heartbeat_interval_ms, daemon_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET root = excluded.root, common_dir = excluded.common_dir,
           is_main = excluded.is_main, registered_at = excluded.registered_at,
           daemon_socket = excluded.daemon_socket, daemon_started_at = excluded.daemon_started_at,
           daemon_heartbeat_at = excluded.daemon_heartbeat_at,
           daemon_heartbeat_interval_ms = excluded.daemon_heartbeat_interval_ms,
           daemon_version = excluded.daemon_version`,
        record.id,
        record.root,
        record.commonDir,
        flag(record.isMain),
        record.registeredAt,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null
      );
    },
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?, daemon_started_at = ?, daemon_heartbeat_at = ?,
           daemon_heartbeat_interval_ms = ?, daemon_version = ? WHERE id = ?`,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
        id
      );
    },
    heartbeat: (id, at) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at,
        id
      );
    },
    remove: (id) => {
      conn.transaction(() => {
        conn.run("DELETE FROM worktrees WHERE id = ?", id);
        for (const table of WORKTREE_SCOPED_TABLES) {
          conn.run(`DELETE FROM ${table} WHERE worktree_id = ?`, id);
        }
      });
    }
  };
}
function toRecord(row) {
  const socketPath = strOrNull(row, "daemon_socket");
  return {
    id: str(row, "id"),
    root: str(row, "root"),
    commonDir: str(row, "common_dir"),
    isMain: bool(row, "is_main"),
    registeredAt: num(row, "registered_at"),
    daemon: socketPath === null ? null : {
      socketPath,
      startedAt: num(row, "daemon_started_at"),
      heartbeatAt: num(row, "daemon_heartbeat_at"),
      heartbeatIntervalMs: num(row, "daemon_heartbeat_interval_ms"),
      squealVersion: str(row, "daemon_version")
    }
  };
}

// src/core/store/store.ts
var connections = /* @__PURE__ */ new WeakMap();
function createStore(conn, schemaVersion, paths) {
  const worktrees = createWorktreeRepo(conn);
  const store = {
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
    close: () => conn.close()
  };
  connections.set(store, conn);
  return store;
}
function createMetaRepo(conn) {
  return {
    get: (key) => {
      const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
      return row === null ? null : str(row, "value");
    },
    set: (key, value) => {
      conn.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    }
  };
}

// src/core/store/open.ts
var DEFAULT_BUSY_TIMEOUT_MS = 1e3;
var META_STORE_RECOVERED = "store.recovered";
function isStoreOpenFailure(value) {
  return "reason" in value;
}
function openStore(commonDir, options = {}) {
  const paths = storePaths(commonDir);
  if (!existsSync2(paths.database)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync(paths.dir, { recursive: true });
  }
  const opened = connect(paths, options);
  if (!("corrupt" in opened)) return opened;
  if (options.checkIntegrity !== true) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}
function connect(paths, options) {
  let db;
  try {
    db = new DatabaseSync(paths.database);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout(options)}`);
    const found = userVersion(db);
    if (found > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: SCHEMA_VERSION };
    }
    if (options.checkIntegrity === true) {
      const problem = integrityProblem(db);
      if (problem !== null) {
        db.close();
        return { corrupt: problem };
      }
    }
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    const mode = db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
    if (mode !== "wal") throw new Error(`squeal store: journal_mode is ${String(mode)}, not wal`);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db);
    return createStore(new Connection(db), version, paths);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { corrupt: String(error) };
    throw error;
  }
}
function busyTimeout(options) {
  const ms = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`busyTimeoutMs must be >= 0: ${ms}`);
  return ms;
}
function integrityProblem(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const messages = rows.map((row) => String(row.integrity_check));
  return messages.length === 1 && messages[0] === "ok" ? null : messages.join("; ");
}
function isCorruption(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}
function recover(paths, options) {
  mkdirSync(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync(join3(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: true });
    if (!("corrupt" in again)) return again;
    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh = connect(paths, { ...options, checkIntegrity: false });
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt });
      fresh.transaction(() => fresh.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh;
  } finally {
    rollback(lock);
    lock.close();
  }
}
function moveAside(database, at) {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync2(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  if (existsSync2(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync2(`${database}-shm`, { force: true });
  return movedTo;
}

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/policy.ts
var DEFAULT_POLICY = {
  interrupt: { onRegression: true },
  stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 0 },
  baseline: { onStart: "lookup-then-run-missing" },
  inputs: [],
  env: { allowlist: [] },
  runner: { tierSize: 4, timeoutMs: 6e5, maxConcurrentRuns: 1 },
  daemon: { idleExitMinutes: 60 },
  store: { retentionDays: 7, maxSizeMb: null }
};

// src/core/types/scheduler.ts
var MAX_PERSISTED_NOTES = 20;
function notesMetaKey(worktreeId) {
  return `notes.${worktreeId}`;
}

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;

// src/core/status/open.ts
var STATUS_BUSY_TIMEOUT_MS = 1e3;
function findWorktreeRoot(path) {
  let dir = resolve3(path);
  if (existsSync3(dir)) dir = realpathSync2(dir);
  for (; ; ) {
    if (existsSync3(join4(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function unavailable(reason, detail) {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: false,
    reason,
    message: `status unavailable, ${detail}`
  };
}
function withStatusStore(cwd, options, fn) {
  const root = findWorktreeRoot(cwd);
  const commonDir = root === null ? null : resolveCommonDir(root);
  if (root === null || commonDir === null) {
    return unavailable("no-store", `${cwd} is not inside a git worktree`);
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  let store;
  try {
    const opened = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(opened)) {
      switch (opened.reason) {
        case "missing":
          return unavailable("no-store", `no Squeal store at ${storePaths(commonDir).database}`);
        case "newer-schema":
          return unavailable(
            "store-newer",
            `store version newer than this Squeal (store ${opened.found}, supported ${opened.supported})`
          );
        case "corrupt":
          return unavailable(
            "store-unreadable",
            `store at ${storePaths(commonDir).database} is corrupt`
          );
      }
    }
    store = opened;
    return fn({ store, root });
  } catch (error) {
    if (isBusy(error)) {
      return unavailable("timeout", `store busy for more than ${busyTimeoutMs} ms`);
    }
    return unavailable("store-unreadable", `store unreadable: ${String(error)}`);
  } finally {
    store?.close();
  }
}
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/status/git-head.ts
import { readFileSync as readFileSync2, statSync } from "node:fs";
import { join as join5, resolve as resolve4 } from "node:path";
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = worktreeGitDir(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read(join5(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === void 0) return null;
    value = read(join5(gitDir, ref)) ?? read(join5(commonDir, ref)) ?? packed(commonDir, ref);
  }
  return null;
}
function worktreeGitDir(root) {
  const dotGit = join5(root, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const line = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotGit) ?? "");
  return line?.[1] === void 0 ? null : resolve4(root, line[1]);
}
function packed(commonDir, ref) {
  for (const line of (read(join5(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read(path) {
  try {
    return readFileSync2(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// src/core/status/notes.ts
var MAX_NOTES = MAX_PERSISTED_NOTES;
function readDaemonNotes(store, worktreeId) {
  const raw = store.meta.get(notesMetaKey(worktreeId));
  if (raw === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(toNote).slice(-MAX_NOTES);
}
function toNote(item) {
  if (typeof item !== "object" || item === null) return [];
  const { at, revision, text } = item;
  if (typeof at !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  return [{ at, revision, text }];
}

// src/core/status/snapshot.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
function readStatus(cwd, options = {}) {
  const now = options.now ?? Date.now;
  return withStatusStore(cwd, options, ({ store, root }) => buildSnapshot(store, root, now()));
}
function buildSnapshot(store, root, now) {
  return snapshot(store, worktreeIdFor(root), root, now);
}
function snapshot(store, worktreeId, root, now) {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const header = readHeader(store, worktreeId, states, keys);
  const notes2 = [];
  if (worktree === null) {
    notes2.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes2.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes2.push(recovered);
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    worktreeId,
    worktreeRoot: worktree?.root ?? root,
    ...header,
    head: revision === null ? readGitHead(root) : revision.head,
    dirty: revision?.dirty ?? null,
    daemon: liveness(worktree?.daemon ?? null, now),
    knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
    inherited: inheritedSources(store, states),
    breakdown: breakdown(states, keys),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes: notes2,
    daemonNotes: readDaemonNotes(store, worktreeId)
  };
}
function liveness(daemon, now) {
  if (daemon === null) return { state: "down", since: null };
  const age2 = now - daemon.heartbeatAt;
  if (age2 <= daemon.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: daemon.heartbeatAt };
  }
  return { state: "down", since: daemon.heartbeatAt };
}
function inheritedSources(store, states) {
  const groups = /* @__PURE__ */ new Map();
  let count = 0;
  for (const s of states) {
    if (s.validity !== "current" || s.origin?.kind !== "inherited") continue;
    count++;
    const id = JSON.stringify([s.origin.worktreeId, s.origin.commit]);
    const group = groups.get(id) ?? {
      worktreeId: s.origin.worktreeId,
      commit: s.origin.commit,
      count: 0
    };
    group.count++;
    groups.set(id, group);
  }
  const sources = [...groups.values()].map((g) => ({ ...g, worktreeRoot: store.worktrees.get(g.worktreeId)?.root ?? null })).sort(
    (a, b) => b.count - a.count || a.worktreeId.localeCompare(b.worktreeId) || String(a.commit).localeCompare(String(b.commit))
  ).map(({ worktreeId, worktreeRoot, commit, count: count2 }) => ({
    worktreeId,
    worktreeRoot,
    commit,
    count: count2
  }));
  return { count, sources };
}
function breakdown(states, keys) {
  const filePhase = new Map(keys.map((k) => [testFileId(k.testFile), k.pending]));
  const currentByOutcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  const pendingByPhase = { queued: 0, running: 0 };
  const filesWithChecks = /* @__PURE__ */ new Set();
  for (const s of states) {
    const file = testFileKeyOf(s.check);
    filesWithChecks.add(file);
    if (s.validity === "current") currentByOutcome[s.outcome]++;
    if (s.validity === "pending")
      pendingByPhase[s.pendingPhase ?? filePhase.get(file) ?? "queued"]++;
  }
  const testFilesWithoutChecks = keys.filter(
    (k) => !filesWithChecks.has(testFileId(k.testFile))
  ).length;
  return { currentByOutcome, pendingByPhase, testFiles: keys.length, testFilesWithoutChecks };
}
function recoveryNote(raw) {
  if (raw === null) return null;
  try {
    const { at, movedTo } = JSON.parse(raw);
    const when = typeof at === "number" ? ` at ${new Date(at).toISOString()}` : "";
    const where = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}; the baseline was lost${where}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
}

// src/core/status/why.ts
var WHY_RESULT_LIMIT = 20;
var WHY_CANDIDATE_LIMIT = 20;
function readWhy(cwd, query, options = {}) {
  return withStatusStore(cwd, options, ({ store, root }) => {
    const worktreeId = worktreeIdFor(root);
    const exact = parseCheck(query);
    if (exact !== null && known(store, worktreeId, exact)) return report(store, root, exact);
    const match = resolve5(store, worktreeId, query.trim());
    return "found" in match ? match : report(store, root, match);
  });
}
function known(store, worktreeId, check) {
  return store.knownStates.get(worktreeId, check) !== null || store.transitions.history(worktreeId, check).length > 0 || store.results.listForCheck(check, 1).length > 0;
}
function resolve5(store, worktreeId, query) {
  const named = store.knownStates.list(worktreeId).map((s) => ({
    check: s.check,
    name: formatCheck(s.check)
  }));
  const stem = query.endsWith("...") ? query.slice(0, -3) : null;
  let matches = named.filter(
    (n) => n.name.includes(query) || stem !== null && n.name.startsWith(stem)
  );
  if (matches.length > 1) {
    const ending = matches.filter(
      (n) => n.name.endsWith(` > ${query}`) || n.name.endsWith(`/${query}`)
    );
    if (ending.length === 1) matches = ending;
  }
  const [only] = matches;
  if (matches.length === 1 && only !== void 0) return only.check;
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: false,
    query,
    candidates: matches.slice(0, WHY_CANDIDATE_LIMIT).map((n) => n.check)
  };
}
function report(store, root, check) {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: true,
    worktreeId,
    worktreeRoot: worktreeRoots[worktreeId] ?? root,
    revision: store.revisions.latest(worktreeId)?.number ?? null,
    check,
    worktreeRoots,
    knownState: store.knownStates.get(worktreeId, check),
    history: store.transitions.history(worktreeId, check),
    results: store.results.listForCheck(check, WHY_RESULT_LIMIT).map((result) => ({
      result,
      worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
      logDir: store.runs.get(result.provenance.runId)?.logDir ?? null
    }))
  };
}

// src/cli/init.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { join as join6 } from "node:path";
var MARKETPLACE_NAME = "squeal";
var PLUGIN_ID = `squeal@${MARKETPLACE_NAME}`;
var MARKETPLACE_SOURCE = {
  source: { source: "github", repo: "hearsay-tools/squeal", path: "plugins/claude-code" }
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function init(args, io) {
  if (args.length > 0) {
    io.stderr("squeal init: takes no arguments\n\nUsage: squeal init\n");
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree
`);
    return 1;
  }
  const settingsPath = join6(root, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  if (typeof settings === "string") {
    io.stderr(`squeal init: ${settings}; nothing changed
`);
    return 1;
  }
  const marketplaces = settings.value.extraKnownMarketplaces ?? {};
  const plugins = settings.value.enabledPlugins ?? {};
  for (const [key, value] of [
    ["extraKnownMarketplaces", marketplaces],
    ["enabledPlugins", plugins]
  ]) {
    if (!isObject(value)) {
      io.stderr(`squeal init: ${key} in ${settingsPath} is not an object; nothing changed
`);
      return 1;
    }
  }
  const lines = [];
  const configPath = join6(root, "squeal.config.json");
  if (existsSync4(configPath)) {
    lines.push("kept squeal.config.json");
  } else {
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}
`);
    lines.push("wrote squeal.config.json with every default policy key");
  }
  const next = { ...settings.value };
  const marketplaceEntries = marketplaces;
  if (MARKETPLACE_NAME in marketplaceEntries) {
    lines.push("kept the squeal marketplace entry in .claude/settings.json");
  } else {
    next.extraKnownMarketplaces = { ...marketplaceEntries, [MARKETPLACE_NAME]: MARKETPLACE_SOURCE };
    lines.push("added the squeal marketplace to .claude/settings.json");
  }
  const pluginEntries = plugins;
  if (pluginEntries[PLUGIN_ID] === true) {
    lines.push(`.claude/settings.json already enables ${PLUGIN_ID}`);
  } else {
    next.enabledPlugins = { ...pluginEntries, [PLUGIN_ID]: true };
    lines.push(`enabled ${PLUGIN_ID} in .claude/settings.json`);
  }
  const text = `${JSON.stringify(next, null, settings.indent)}
`;
  if (text !== settings.text) {
    mkdirSync2(join6(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath, text);
  }
  io.stdout(
    [
      ...lines.map((line) => `squeal init: ${line}`),
      `Each collaborator installs the plugin once: claude plugin install ${PLUGIN_ID} --scope project`,
      ""
    ].join("\n")
  );
  return 0;
}
function readSettings(path) {
  if (!existsSync4(path)) return { value: {}, text: null, indent: 2 };
  const text = readFileSync3(path, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (!isObject(value)) return `${path} is not a JSON object`;
  return { value, text, indent: /^([ \t]+)"/m.exec(text)?.[1] ?? 2 };
}

// src/cli/main.ts
var HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal status [--json]        Current validation state of this worktree
  squeal why <check> [--json]   History and provenance of one check
  squeal --version              Print the version
  squeal --help                 Print this help

A check is named as in status output: "path > describe > test", or any
unique part of that name. Status reads the store directly; no daemon needed.

Commands from spec 001 still to come: run, daemon, start, init.
`;
function readVersion() {
  const manifest = new URL("../../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync4(manifest, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    return String(parsed.version);
  }
  throw new Error(`squeal: no version in ${manifest.pathname}`);
}
function main(argv, io) {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    io.stdout(`${readVersion()}
`);
    return 0;
  }
  if (first === void 0 || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (first === "status") return status(rest, io);
  if (first === "why") return why(rest, io);
  if (first === "init") return init(rest, io);
  io.stderr(`squeal: unknown command "${first}"

${HELP}`);
  return 2;
}
function status(args, io) {
  const parsed = parseArgs("status", args, io);
  if (parsed === null) return 2;
  if (parsed.positional.length > 0) return usage("status", "takes no arguments", io);
  const now = io.now ?? Date.now;
  const result = readStatus(io.cwd ?? process.cwd(), { now });
  io.stdout(parsed.json ? json2(result) : formatStatus(result, now()));
  return result.available ? 0 : 1;
}
function why(args, io) {
  const parsed = parseArgs("why", args, io);
  if (parsed === null) return 2;
  const [name] = parsed.positional;
  if (name === void 0 || parsed.positional.length > 1) {
    return usage("why", "expected one check name", io);
  }
  const result = readWhy(io.cwd ?? process.cwd(), name);
  io.stdout(parsed.json ? json2(result) : formatWhy(result));
  return result.available && result.found ? 0 : 1;
}
function parseArgs(command, args, io) {
  let isJson = false;
  const positional = [];
  for (const arg of args) {
    if (arg === "--json") isJson = true;
    else if (arg.startsWith("--")) {
      usage(command, `unknown option "${arg}"`, io);
      return null;
    } else positional.push(arg);
  }
  return { json: isJson, positional };
}
function usage(command, problem, io) {
  io.stderr(`squeal ${command}: ${problem}

${HELP}`);
  return 2;
}
function json2(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}

// src/cli/index.ts
process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd()
});
