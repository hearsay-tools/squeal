import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/harness/opencode/bridge.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { fileURLToPath } from "node:url";

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/fs/paths.ts
import { isAbsolute, join, relative, sep } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
function toAbsolute(root, rel) {
  return join(root, ...rel.split("/"));
}

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/types/watcher.ts
var WATCHER_TIMINGS = {
  quietMs: 100,
  maxBatchMs: 500,
  reconcileIntervalMs: 3e4
};

// src/core/daemon/config-file.ts
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";

// src/core/daemon/policy-node-test.ts
import { isAbsolute as isAbsolute2, posix } from "node:path";

// src/core/keys/glob.ts
function globToRegExp(glob) {
  if (glob.startsWith("!")) throw new Error(`squeal: negated input glob is not supported: ${glob}`);
  if (glob.startsWith("/")) throw new Error(`squeal: input glob must be relative: ${glob}`);
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  return new RegExp(`^${compile(source, glob)}$`, "s");
}
function compile(glob, original) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) {
          if (i + 2 === glob.length) out += ".+";
          else out += "(?:.+/)?";
          i += 3;
          continue;
        }
      }
      out += "[^/]*";
      i += glob[i + 1] === "*" ? 2 : 1;
    } else if (char === "?") {
      out += "[^/]";
      i++;
    } else if (char === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) throw new Error(`squeal: unclosed [ in input glob: ${original}`);
      let body = glob.slice(i + 1, end);
      const negated = body.startsWith("!");
      if (negated) body = body.slice(1);
      out += `[${negated ? "^/" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
      i = end + 1;
    } else if (char === "{") {
      const end = matchingBrace(glob, i, original);
      const alternatives = splitTopLevel(glob.slice(i + 1, end));
      out += `(?:${alternatives.map((alt) => compile(alt, original)).join("|")})`;
      i = end + 1;
    } else {
      out += char.replace(/[.+^$()|\\{}\]]/, "\\$&");
      i++;
    }
  }
  return out;
}
function matchingBrace(glob, open, original) {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`squeal: unclosed { in input glob: ${original}`);
}
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

// src/core/daemon/policy-node-test.ts
function compiles(globs3) {
  for (const glob of globs3) {
    try {
      globToRegExp(glob);
    } catch (error) {
      return { problem: `has a glob Squeal cannot use: ${error.message}` };
    }
  }
  return null;
}
var boolean = (v) => typeof v === "boolean" ? null : "true or false";
var nonEmptyString = (v) => typeof v === "string" && v.length > 0 ? null : "a non-empty string";
var strings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
var globs = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string") ? compiles(v) : "a non-empty array of strings";
var variables = (v) => isRecord(v) && Object.values(v).every((s) => typeof s === "string") ? null : "an object from variable name to string";
var insideRoot = (v) => {
  if (typeof v !== "string") return "a path inside the worktree, relative to its root";
  const normal = posix.normalize(v.replaceAll("\\", "/"));
  return isAbsolute2(v) || normal === ".." || normal.startsWith("../") ? "a path inside the worktree, relative to its root" : null;
};
var FIELDS = {
  name: nonEmptyString,
  cwd: insideRoot,
  node: nonEmptyString,
  argv: strings,
  env: variables,
  include: globs,
  exclude: globs,
  slow: boolean
};
var REQUIRED = /* @__PURE__ */ new Set(["name", "include"]);
function nodeTestProjects(value, path) {
  return projectEntries(value, path, FIELDS, REQUIRED, withDefaults);
}
function withDefaults(entry) {
  return { ...entry, argv: entry.argv ?? [], env: entry.env ?? {} };
}
function projectEntries(value, path, fields, required, withDefaults3, check) {
  if (!Array.isArray(value)) return "an array of projects";
  const kept = [];
  const problems = [];
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry, at, kept, fields, required, check);
    if (problem === null) kept.push(withDefaults3(entry));
    else problems.push(problem);
  });
  return { kept, problems };
}
function entryProblem(entry, at, kept, fields, required, check) {
  if (!isRecord(entry))
    return `"${at}" must be an object, got ${JSON.stringify(entry)}; it is skipped`;
  const named2 = nonEmptyString(entry.name) === null ? entry.name : null;
  const skipped = named2 === null ? "it is skipped" : `project ${JSON.stringify(named2)} is skipped`;
  for (const key of Object.keys(entry)) {
    if (!Object.hasOwn(fields, key)) return `unknown key "${at}.${key}"; ${skipped}`;
  }
  for (const [key, field] of Object.entries(fields)) {
    const given = entry[key];
    if (given === void 0 && !required.has(key)) continue;
    const expected = field(given);
    if (expected === null) continue;
    const why = typeof expected === "object" ? expected.problem : `must be ${expected}, got ${given === void 0 ? "undefined" : JSON.stringify(given)}`;
    return `"${at}.${key}" ${why}; ${skipped}`;
  }
  const across = check?.(entry) ?? null;
  if (across !== null) return `"${at}.${across.key}" ${across.problem}; ${skipped}`;
  if (kept.some((project) => project.name === named2)) {
    return `"${at}.name" repeats ${JSON.stringify(named2)} of an earlier project; it is skipped`;
  }
  return null;
}

// src/core/daemon/policy-code.ts
var boolean2 = (v) => typeof v === "boolean" ? null : "true or false";
var globs2 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? compiles(v) : "an array of strings";
var aboveZero = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "a number > 0";
var CODE_SHAPE = {
  complexity: {
    enabled: boolean2,
    threshold: positiveInteger,
    include: globs2,
    exclude: globs2,
    maxFileBytes: positiveInteger,
    blocking: boolean2
  },
  coverage: { enabled: boolean2 },
  crap: { threshold: aboveZero }
};

// src/core/daemon/policy-pytest.ts
import { isAbsolute as isAbsolute3, posix as posix2 } from "node:path";
var FIELDS2 = {
  name: nonEmptyString,
  cwd: insideRoot,
  python: nonEmptyString,
  args: strings,
  env: variables,
  include: globs,
  exclude: globs,
  slow: boolean,
  batchSize: positiveInteger2
};
var REQUIRED2 = /* @__PURE__ */ new Set(["name", "include"]);
function positiveInteger2(value) {
  return Number.isInteger(value) && value > 0 ? null : "a positive integer";
}
function pytestProjects(value, path) {
  return projectEntries(value, path, FIELDS2, REQUIRED2, withDefaults2, pythonInsideRoot);
}
function withDefaults2(entry) {
  return { ...entry, args: entry.args ?? [], env: entry.env ?? {} };
}
var pythonInsideRoot = (entry) => {
  const python = entry.python;
  if (python === void 0 || isAbsolute3(python)) return null;
  const path = posix2.join(entry.cwd ?? ".", python.replaceAll("\\", "/"));
  if (insideRoot(path) === null) return null;
  return {
    key: "python",
    problem: `must stay inside the worktree when relative (absolute only for an environment outside it), got ${JSON.stringify(python)}`
  };
};

// src/core/daemon/policy-slow.ts
function slowInclude(value) {
  if (!Array.isArray(value) || !value.every((glob) => typeof glob === "string")) {
    return "an array of strings";
  }
  const kept = [];
  const problems = [];
  value.forEach((glob, index) => {
    const bad = compiles([glob]);
    if (bad === null) kept.push(glob);
    else problems.push(`"slow.include[${index}]" ${bad.problem}; it is left out`);
  });
  return { kept, problems };
}

// src/core/daemon/policy.ts
var boolean3 = (v) => typeof v === "boolean" ? null : "true or false";
var strings2 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
var inputs = (v) => {
  const isList = strings2(v) === null;
  if (!isList && !(isRecord(v) && Object.values(v).every((globs4) => strings2(globs4) === null))) {
    return "an array of strings, or an object from test-file glob to an array of strings";
  }
  const globs3 = isList ? v : Object.entries(v).flatMap(([test, input]) => [test, ...input]);
  return compiles(globs3);
};
var atLeastZero = (v) => isNumber(v) && v >= 0 ? null : "a number >= 0";
var aboveZero2 = (v) => isNumber(v) && v > 0 ? null : "a number > 0";
var orNull = (leaf) => (v) => {
  const expected = v === null ? null : leaf(v);
  return expected === null || typeof expected === "object" ? expected : `${expected}, or null`;
};
var oneOf = (...values) => (v) => values.includes(v) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;
var SHAPE = {
  interrupt: { onRegression: boolean3 },
  stop: {
    blockOnKnownFailures: boolean3,
    requireFullSuite: boolean3,
    waitMs: atLeastZero,
    requireSlowSuite: boolean3,
    slowWaitMs: atLeastZero
  },
  testCommand: { denyWhenCurrent: boolean3 },
  baseline: { onStart: oneOf("lookup-then-run-missing", "lookup-only") },
  inputs,
  observe: { runtimeInputs: boolean3 },
  env: { allowlist: strings2 },
  runner: {
    tierSize: positiveInteger,
    backlogTierSize: positiveInteger,
    timeoutMs: orNull(positiveInteger)
  },
  nodeTest: (v) => nodeTestProjects(v, "nodeTest"),
  pytest: (v) => pytestProjects(v, "pytest"),
  vitest: { excludeProjects: strings2, exclude: (v) => strings2(v) ?? compiles(v) },
  slow: {
    include: slowInclude,
    maxWorkers: positiveInteger,
    maxLoadPerCpu: aboveZero2,
    maxDeferMs: atLeastZero,
    maxParallel: positiveInteger,
    rank: oneOf("tokens", "duration"),
    // Spec 004 D2, D7 as amended 2026-10-18 (row 004-80).
    trigger: oneOf("continuous", "idle"),
    quietMs: atLeastZero
  },
  delivery: { uncoveredEdits: boolean3 },
  daemon: { idleExitMinutes: aboveZero2, unusedExitMinutes: aboveZero2 },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero2) },
  ...CODE_SHAPE
};
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/keys/observed.ts
import { createHash } from "node:crypto";
var ABSENT_LISTING = createHash("sha1").update("\0absent").digest("hex");
var EMPTY_LISTING = createHash("sha1").update("\0empty").digest("hex");

// src/core/keys/pnpm-lockfile.ts
var PNPM_VIRTUAL_STORE = "node_modules/.pnpm";
var PNPM_LOCKFILE = `${PNPM_VIRTUAL_STORE}/lock.yaml`;

// src/core/text.ts
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
function durationText(ms, round = Math.round) {
  const seconds = Math.max(0, round(ms / 1e3));
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest === 0 ? "" : ` ${rest} s`}`;
}
var SAFE_WORD = /^[\w@%+=:,./-]+$/;
function shellWord(word) {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
function excludedProjectsText(entries) {
  const quoted = (list, join6) => {
    const all = list.map((entry) => JSON.stringify(entry));
    const last = all.pop();
    return all.length === 0 ? last : `${all.join(", ")} ${join6} ${last}`;
  };
  const names = entries.filter((entry) => !entry.includes("*"));
  const patterns = entries.filter((entry) => entry.includes("*"));
  const parts = [
    ...names.length === 0 ? [] : [`${names.length === 1 ? "project" : "projects"} ${quoted(names, "and")}`],
    ...patterns.length === 0 ? [] : [`projects matching ${quoted(patterns, "or")}`]
  ];
  return { text: parts.join(" and "), plural: patterns.length > 0 || names.length > 1 };
}
var EXCLUDED_GLOBS_NAMED = 3;
function excludedFilesText(globs3) {
  const quoted = globs3.slice(0, EXCLUDED_GLOBS_NAMED).map((glob) => JSON.stringify(glob));
  const rest = globs3.length - quoted.length;
  if (rest > 0)
    return `Vitest test files matching ${quoted.join(", ")} and ${plural(rest, "more glob")}`;
  const last = quoted.pop();
  return `Vitest test files matching ${quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`}`;
}

// src/core/retry/kept.ts
var ASKED_KEY_MS = 7 * 24 * 60 * 60 * 1e3;

// src/core/retry/gate.ts
var LOAD_RETRY_WAIT_MS = 6e5;

// src/core/retry/text.ts
function waitedText(ms) {
  return durationText(ms, Math.floor);
}
var BOUND_TEXT = waitedText(LOAD_RETRY_WAIT_MS);

// src/core/store/connection.ts
import { AsyncLocalStorage } from "node:async_hooks";
var slices = new AsyncLocalStorage();

// src/core/store/open.ts
import { DatabaseSync } from "node:sqlite";

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

// src/core/store/prune.ts
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

// src/core/hash/blob.ts
import { constants } from "node:fs";
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/code/coverage/sourcemap.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

// src/core/code/store/open.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

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

// src/core/code/store/prune.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;

// src/core/code/coverage/writer.ts
var RESULT_WAITS_MS = [0, 250, 1e3, 5e3, 3e4];

// src/core/code/crap/loaders.ts
var RECORD_WAIT_MS = RESULT_WAITS_MS.reduce((a, b) => a + b, 0);

// src/core/waiter-lock/waiter-lock.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/delivery/harness-process.ts
import { readFileSync, readlinkSync } from "node:fs";
function readProcStat(pid) {
  let text;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const rest = text.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  const startTime = Number(rest[19]);
  if (open < 0 || close < open || !Number.isInteger(ppid) || !Number.isInteger(startTime)) {
    throw new Error(`unreadable /proc/${pid}/stat`);
  }
  return { comm: text.slice(open + 1, close), state: rest[0] ?? "", ppid, startTime };
}
function pidNamespace() {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}

// src/core/daemon/runner.ts
import { readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join2, posix as posix3 } from "node:path";
var VITEST_CONFIG = /^(vitest\.(config|workspace|projects)|vite\.config)\.[cm]?[jt]s$/;
function vitestDetected(root) {
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return false;
  }
  if (names.some((name) => VITEST_CONFIG.test(name))) return true;
  return listsVitest(readManifest(join2(root, "package.json")));
}
function listsVitest(manifest) {
  if (!isRecord(manifest)) return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const deps = manifest[field];
    return isRecord(deps) && Object.hasOwn(deps, "vitest");
  });
}
function readManifest(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return null;
  }
}

// src/core/daemon/lock.ts
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";

// src/core/daemon/test-pause.ts
import { channel } from "node:diagnostics_channel";
var TEST_PAUSE_CHANNEL = "squeal:test-pause";
var pauses = channel(TEST_PAUSE_CHANNEL);

// src/core/status/feed-late.ts
var FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;

// src/core/delivery/handoff.ts
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;

// src/core/status/stopping.ts
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);

// src/core/status/open.ts
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/slow/slot.ts
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/daemon/escaped.ts
var CHILD_VARIABLE = "SQUEAL_DAEMON_CHILD";

// src/core/ps/proc.ts
var MARK = Buffer.from(`${CHILD_VARIABLE}=`);

// src/core/capacity/pool.ts
var MARK_REFRESH_MS = SLOT_WAITER_FRESH_MS / 3;

// src/core/slow/rank.ts
var MAX_READ_BYTES = 1024 * 1024;

// src/core/scheduler/queue.ts
var Group = { first: 0, catchUp: 1, second: 2 };
var GROUP_ORDER = {
  edits: [Group.first, Group.catchUp, Group.second],
  turn: [Group.catchUp, Group.second, Group.first]
};

// src/core/scheduler/rekeyed-moves.ts
var MOVES_RETENTION_MS = 60 * 6e4;

// src/core/delivery/format.ts
var SQUEAL_COMMAND = "squeal";

// src/runners/node-test/describe.ts
var UNCONFIGURED = { nodeTest: [] };
var NODE_TEST = {
  runner: "node-test",
  name: "node:test",
  fallback: false,
  unconfigured: UNCONFIGURED,
  projects: (policy) => policy.nodeTest,
  coverage: ({ projects }) => ({ nodeTest: projects }),
  built: (coverage) => coverage.nodeTest.length > 0,
  covered: (coverage) => ({ projects: coverage.nodeTest }),
  excluded: () => null,
  context: (policy, _root, _cwd) => ({ nodeTest: policy.nodeTest }),
  command: (words, context) => context.atRoot === false ? null : nodeTestCommand(words, context.nodeTest),
  resolves: () => true,
  files: (command, listing) => command.runner === "node-test" ? nodeTestFiles(command, listing) : null,
  slowProjects: (policy) => policy.nodeTest
};
function nodeTestCommand(words, projects) {
  const at = words.indexOf("--test");
  if (at === -1) return null;
  const argv = words.slice(1, at);
  const args = words.slice(at + 1);
  if (args.length === 0) return null;
  const project = projects.find(
    (p) => (p.node ?? "node") === words[0] && (p.cwd === void 0 || p.cwd === "." || p.cwd === "") && Object.keys(p.env).length === 0 && same(p.argv, argv)
  );
  if (project === void 0) return null;
  if (same(project.include, args))
    return { runner: "node-test", project: project.name, files: null };
  if (args.some((arg) => arg.startsWith("-") || /[*?[\]{}]/.test(arg))) return null;
  return { runner: "node-test", project: project.name, files: args };
}
function same(a, b) {
  return a.length === b.length && a.every((word, i) => word === b[i]);
}
function nodeTestFiles(command, listing) {
  const own = listing.files.filter((ref) => ref.project === command.project);
  if (command.files === null) return own.length === 0 ? null : own;
  const byPath = new Map(own.map((ref) => [ref.path, ref]));
  const files = command.files.map((file) => byPath.get(listing.pathOf(file) ?? ""));
  return files.every((ref) => ref !== void 0) ? [...new Set(files)] : null;
}

// src/runners/pytest/describe.ts
import { realpathSync } from "node:fs";
import { join as join4, resolve as resolve2 } from "node:path";

// src/runners/pytest/environment/discover.ts
import { existsSync, readdirSync as readdirSync2, readFileSync as readFileSync3, statSync } from "node:fs";
import { basename, dirname, isAbsolute as isAbsolute4, join as join3, relative as relative2, resolve } from "node:path";
function projectDir(root, project) {
  return project.cwd === void 0 ? root : toAbsolute(root, project.cwd);
}
function discoverEnvironment(root, project) {
  const cwd = projectDir(root, project);
  if (project.python !== void 0) {
    const declared = resolve(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join3(declared, "bin", "python"));
    if (existsSync(declared)) return found("declared", dirname(dirname(declared)), declared);
    const target = basename(declared).startsWith("python") ? dirname(dirname(declared)) : declared;
    return none(root, cwd, [declared], target);
  }
  const venv = join3(cwd, ".venv");
  if (existsSync(join3(venv, "pyvenv.cfg"))) return found("venv", venv, join3(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname(dirname(pdm)), pdm);
  return none(root, cwd, [venv, join3(cwd, ".pdm-python")], venv);
}
function found(source, env, python) {
  return { kind: "found", source, env, python };
}
function pdmPython(root, cwd) {
  let text;
  try {
    text = readFileSync3(join3(cwd, ".pdm-python"), "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!isAbsolute4(text) || toRelative(root, text) === null || !existsSync(text)) return null;
  return text;
}
var LOCKFILES = [
  ["uv.lock", "uv sync"],
  ["poetry.lock", "poetry install"],
  ["pdm.lock", "pdm install"]
];
var REQUIREMENTS = /^(?:[\w.-]+[-_])?requirements(?:[-_.][\w.-]+)?\.txt$/;
function none(root, cwd, looked, target) {
  const venv = relative2(cwd, target) || ".";
  const dirs = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (toRelative(root, dir) === null) break;
  }
  for (const dir of dirs) {
    const hit = LOCKFILES.find(([file]) => existsSync(join3(dir, file)));
    if (hit !== void 0)
      return { kind: "none", looked, command: hit[1], from: join3(dir, hit[0]) };
  }
  for (const dir of dirs) {
    const files = requirementsIn(dir).map((file) => join3(dir, file));
    if (files.length === 0) continue;
    const install = files.map((file) => `-r ${relative2(cwd, file)}`).join(" ");
    const command = `python -m venv ${venv} && ${venv}/bin/pip install ${install}`;
    return { kind: "none", looked, command, from: files[0] };
  }
  return { kind: "none", looked, command: `python -m venv ${venv}`, from: null };
}
function requirementsIn(dir) {
  let names;
  try {
    names = readdirSync2(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names.filter((name) => REQUIREMENTS.test(name)).sort();
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

// src/runners/pytest/describe.ts
var OUTPUT_FLAG = /^(-[qvs]+|-r[fEsxXpPaAwN]+|--tb=(auto|long|short|line|native|no))$/;
var PYTEST = {
  runner: "pytest",
  name: "pytest",
  fallback: false,
  unconfigured: {},
  projects: (policy) => policy.pytest,
  coverage: ({ projects }) => ({ pytest: projects }),
  built: (coverage) => (coverage.pytest?.length ?? 0) > 0,
  covered: (coverage) => ({ projects: coverage.pytest ?? [] }),
  excluded: () => null,
  context: (policy, root, cwd) => ({ pytest: pytestHere(root, cwd, policy.pytest) }),
  command: (words, context) => pytestCommand(words, context.pytest ?? []),
  resolves: () => true,
  files: (command, listing) => command.runner === "pytest" ? pytestFiles(command, listing) : null,
  slowProjects: () => []
};
function pytestHere(root, cwd, projects) {
  return projects.flatMap((project) => {
    const dir = projectDir(root, project);
    if (realPath(dir) !== cwd) return [];
    let env = null;
    try {
      const found2 = discoverEnvironment(root, project);
      if (found2.kind === "found") env = found2.env;
    } catch {
    }
    return [{ project, dir, env }];
  });
}
function realPath(path) {
  try {
    return realpathSync(resolve2(path));
  } catch {
    return null;
  }
}
function pytestCommand(words, here) {
  if (here.length !== 1) return null;
  const { project, dir, env } = here[0];
  if (Object.keys(project.env).length > 0) return null;
  const start = invocation(words, dir, env);
  if (start === null) return null;
  const rest = words.slice(start);
  const { args } = project;
  if (!args.every((arg, i) => rest[i] === arg)) return null;
  const paths = [];
  for (const word of rest.slice(args.length)) {
    if (OUTPUT_FLAG.test(word)) continue;
    const path = word.split("::")[0];
    if (word.startsWith("-") || path === "") return null;
    paths.push(resolve2(dir, path));
  }
  return { runner: "pytest", project: project.name, paths: paths.length === 0 ? null : paths };
}
function invocation(words, dir, env) {
  const [first, second, third] = words;
  const inEnv = (name) => env !== null && first?.includes("/") === true && resolve2(dir, first) === join4(env, "bin", name);
  if (first === "pytest" || inEnv("pytest")) return 1;
  if (first === "uv" && second === "run" && third === "pytest") return 3;
  if ((first === "python" || inEnv("python")) && second === "-m" && third === "pytest") return 3;
  return null;
}
function pytestFiles(command, listing) {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref) => ref.project === command.project);
  const named2 = new Set(command.paths.map((path) => listing.pathOf(path)));
  if (![...named2].every((rel) => own.some((ref) => ref.path === rel))) return null;
  return own.filter((ref) => named2.has(ref.path));
}

// src/runners/vitest/describe.ts
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "node:fs";
import { isAbsolute as isAbsolute5, join as join5, relative as relative3, resolve as resolve3 } from "node:path";
var UNCONFIGURED2 = { vitest: true, vitestConfig: null };
var CONFIG_NAMES = ["vitest.config", "vite.config"];
var CONFIG_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
var REPORTER = "--reporter";
var SILENT_VALUES = /* @__PURE__ */ new Set(["true", "false", "yes", "no", "passed-only"]);
var VITEST = {
  runner: "vitest",
  name: "Vitest",
  fallback: true,
  unconfigured: UNCONFIGURED2,
  projects: () => [],
  coverage({ policy, root, configured }) {
    const vitest = !configured || vitestDetected(root);
    return {
      vitest,
      vitestConfig: vitest ? configFile(root) : null,
      vitestExcluded: vitest ? policy.vitest.excludeProjects : [],
      vitestExcludedFiles: vitest ? policy.vitest.exclude : []
    };
  },
  built: (coverage) => coverage.vitest,
  covered: (coverage) => ({
    config: coverage.vitestConfig,
    excludedProjects: coverage.vitestExcluded ?? []
  }),
  // Spec 004 D8 as amended 2026-10-18 (task 004-81): the `vitest.exclude` globs, named.
  excluded(coverage) {
    const globs3 = coverage.vitestExcludedFiles ?? [];
    return globs3.length === 0 ? null : excludedFilesText(globs3);
  },
  context: (_policy, root, cwd) => ({
    scripts: cwd === root ? rootScripts(root) : {}
  }),
  command: (words, context, split) => context.atRoot === false ? null : vitestCommand(words) ?? npmCommand(words, context, split),
  // 004 D7: a file `vitest.exclude` drops is one a bare Vitest command still runs; read live, so
  // an exclusion added since the last listing counts too (review 004 wave-12 B2).
  resolves: (live) => live.vitest.exclude.length === 0,
  files: (command, listing) => command.runner === "vitest" ? vitestFiles(command, listing) : null,
  slowProjects: () => []
};
function vitestCommand(words) {
  const start = words[0] === "npx" ? 1 : 0;
  if (words[start] !== "vitest" || words[start + 1] !== "run") return null;
  const filters = [];
  const rest = words.slice(start + 2);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--silent") {
      const next = rest[i + 1];
      if (next !== void 0 && !next.startsWith("-")) {
        if (!SILENT_VALUES.has(next)) return null;
        i++;
      }
    } else if (word.startsWith("--silent=")) {
      if (!SILENT_VALUES.has(word.slice("--silent=".length))) return null;
    } else if (word === REPORTER) {
      const next = rest[i + 1];
      if (next === void 0 || next.startsWith("-")) return null;
      i++;
    } else if (word.startsWith(`${REPORTER}=`)) {
      if (word === `${REPORTER}=`) return null;
    } else if (word.startsWith("-") || word === "" || /:\d+(-\d+)?$/.test(word)) {
      return null;
    } else {
      filters.push(word);
    }
  }
  return { runner: "vitest", filters };
}
function npmCommand(words, { scripts }, split) {
  if (words[0] !== "npm") return null;
  const name = words.length === 2 && words[1] === "test" ? "test" : words.length === 3 && words[1] === "run" ? words[2] : void 0;
  if (name === void 0) return null;
  if (!Object.hasOwn(scripts, name)) return null;
  if (Object.hasOwn(scripts, `pre${name}`) || Object.hasOwn(scripts, `post${name}`)) return null;
  const script = split(scripts[name]);
  return script === null ? null : vitestCommand(script);
}
function vitestFiles(command, listing) {
  const { root, configured } = listing;
  if (listing.omitted !== 0) return null;
  const vitest = listing.files.filter((ref) => !configured.has(ref.project));
  if (new Set(vitest.map((ref) => ref.project)).size !== 1) return null;
  if (command.filters.length === 0) return vitest;
  const selected = /* @__PURE__ */ new Set();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref) => matchesFilter(join5(root, ref.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref of hits) selected.add(ref);
  }
  return vitest.filter((ref) => selected.has(ref));
}
function matchesFilter(file, filter, root) {
  if (isAbsolute5(filter) && file.startsWith(filter)) return true;
  const testFile = relative3(root, file).toLocaleLowerCase();
  const rel = relative3(root, resolve3(root, filter));
  const relativePath = filter.endsWith("/") ? join5(rel, "/") : rel;
  return testFile.includes(filter.toLocaleLowerCase()) || testFile.includes(relativePath.toLocaleLowerCase());
}
function rootScripts(root) {
  try {
    const manifest = JSON.parse(readFileSync4(join5(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text]) => typeof text === "string")
    );
  } catch {
    return {};
  }
}
function configFile(root) {
  for (const name of CONFIG_NAMES) {
    for (const extension of CONFIG_EXTENSIONS) {
      if (existsSync2(join5(root, `${name}${extension}`))) return `${name}${extension}`;
    }
  }
  return null;
}

// src/runners/descriptions.ts
var DESCRIPTIONS = [VITEST, NODE_TEST, PYTEST];
var UNCONFIGURED3 = {
  ...VITEST.unconfigured,
  ...NODE_TEST.unconfigured,
  ...PYTEST.unconfigured
};

// src/harness/shared/coverage.ts
var DEFAULT_COVERAGE = { ...UNCONFIGURED3, slow: null };

// src/harness/shared/harness-process.ts
var SKIPPED = /* @__PURE__ */ new Set([
  "sh",
  "dash",
  "bash",
  "zsh",
  "ksh",
  "mksh",
  "fish",
  "env",
  "nohup",
  "timeout"
]);
var MAX_HOPS = 4;
function findHarnessProcess(lookup = {}) {
  const read = lookup.read ?? readProcStat;
  const namespace = (lookup.namespace ?? pidNamespace)();
  if (namespace === null) return null;
  let pid = lookup.ppid ?? process.ppid;
  try {
    for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
      const stat = read(pid);
      if (stat === null || stat.state === "Z" || stat.comm === "systemd") return null;
      if (!SKIPPED.has(stat.comm)) {
        return { pid, startTime: stat.startTime, pidNamespace: namespace };
      }
      pid = stat.ppid;
    }
  } catch {
    return null;
  }
  return null;
}

// src/harness/shared/primer.ts
var PRIMER_CAP_CHARS = 1500;
var PRIMER_OPENING = "Squeal runs this repository's ";
var REVISION = "A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed.";
function primer(command = SQUEAL_COMMAND, coverage = DEFAULT_COVERAGE) {
  const names = runnersOf(coverage).map((runner) => runner.name);
  const sentences = (covers, naming, wait) => [
    `${PRIMER_OPENING}${listed(names, "and")} tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run ${listed(names, "or")} to learn whether your edits broke something.`,
    waitSentence(command, naming, wait),
    ...coverage.slow === null ? [] : slowSentences(command, naming, coverage.slow),
    "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
    retrySentence(command, naming),
    REVISION,
    covers,
    notCovered(coverage)
  ].join(" ");
  let text = "";
  const most = Math.max(
    0,
    ...DESCRIPTIONS.map((runner) => projectsOf(runner.covered(coverage))?.length ?? 0)
  );
  for (const naming of ["every", "first", "none"]) {
    for (let node = most; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming, "plain");
      if (text.length > PRIMER_CAP_CHARS) continue;
      const paths = sentences(coversSentence(coverage, node), naming, "paths");
      return paths.length <= PRIMER_CAP_CHARS ? paths : text;
    }
    if (naming !== "first") continue;
    for (let node = most; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming, "short");
      if (text.length <= PRIMER_CAP_CHARS) return text;
    }
  }
  return text;
}
function waitSentence(command, naming, form) {
  if (form === "short") {
    return `Wait only when you need a result, as before you finish: \`${command} status --wait 60000\`.`;
  }
  if (form === "plain") {
    const wait = naming === "none" ? "`status --wait 60000` on the CLI SQUEAL messages name" : `\`${command} status --wait 60000\``;
    return `Wait only when you need a result before your next step, for example before saying the task is done: ${wait}.`;
  }
  const full = naming === "every" && command === SQUEAL_COMMAND;
  const cli = (sub, first) => naming !== "none" && (first || full) ? `\`${command} ${sub}\`` : naming === "none" ? `\`${sub}\`` : `the CLI's \`${sub}\``;
  return `Wait only when you need a result before your next step${naming === "none" ? ", on the CLI SQUEAL messages name" : ""}: ${cli("status --wait 60000 <path>...", true)} for the verdict on files you just changed; before you finish, ${cli("status --wait 60000", false)} or a checkpoint, ${cli("run --all --wait", false)}.`;
}
function retrySentence(command, naming) {
  const cli = naming === "every" && command === SQUEAL_COMMAND ? `\`${command} retry` : "the CLI's `retry";
  return `For a failure from load or a stopped service: ${cli} <file> --reason load|environment\`, never past a real one.`;
}
function runnersOf(coverage) {
  const others = DESCRIPTIONS.some((runner) => !runner.fallback && runner.built(coverage));
  return DESCRIPTIONS.filter((runner) => runner.built(coverage) || runner.fallback && !others);
}
function projectsOf(covered) {
  return "projects" in covered ? covered.projects : null;
}
function listed(words, conjunction) {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}
function coversSentence(coverage, node) {
  const suites = runnersOf(coverage).map(
    (runner) => suite(runner.name, runner.covered(coverage), node)
  );
  const files = coverage.slow?.files;
  const slow = coverage.slow === null ? "" : files === null || files === void 0 ? ", with slow test files not counted yet" : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed(suites, "and")}${slow}.`;
}
function suite(runner, covered, shown) {
  if (!("projects" in covered)) {
    const config = covered.config === null ? runner : `${runner} (${covered.config})`;
    return `${config}${excluded(covered.excludedProjects)}`;
  }
  const entries = covered.projects.map(
    ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`
  );
  const list = named("project", entries, shown);
  return shown === 0 ? `${runner} (${list})` : `${runner} ${list}`;
}
function excluded(entries) {
  if (entries.length === 0) return "";
  const { text, plural: plural2 } = excludedProjectsText(entries);
  return `; its ${text} ${plural2 ? "are" : "is"} not run, excluded by squeal.config.json`;
}
function notCovered(coverage) {
  const files = DESCRIPTIONS.flatMap((runner) => runner.excluded(coverage) ?? []);
  const what = files.length === 0 ? "typecheck, build" : `typecheck, build, the ${files.join(", the ")}, which squeal.config.json excludes,`;
  return `Squeal does not cover ${what} or any other test suite: run those yourself.`;
}
function named(noun, entries, shown) {
  const nouns = entries.length === 1 ? noun : `${noun}s`;
  if (shown === 0) return `${entries.length} ${nouns}`;
  const listed2 = entries.slice(0, shown);
  const rest = entries.length - shown;
  const tail = rest > 0 ? [...listed2, `${rest} more`] : listed2;
  const last = tail.pop();
  return `${nouns} ${tail.length === 0 ? last : `${tail.join(", ")} and ${last}`}`;
}
function slowSentences(command, naming, slow) {
  const run = naming === "every" ? `\`${command} run --slow --wait 60000\`` : "the CLI's `run --slow --wait 60000`";
  const when = slow.pausesOnly === true ? "between your turns" : "after the fast tests";
  return [
    slow.requireSlowSuite === true ? `Slow test files run ${when}; this repository requires them once you change a file: before you say the task is done, wait with ${run} unless the latest \`Slow tier:\` line says every slow file is current; Stop waits or holds you once.` : `Slow test files run ${when}; this repository does not require them before you finish: say slow tests pass only when the latest \`Slow tier:\` line states every slow file is current, else say how many are not, or wait for them with ${run}.`,
    command === SQUEAL_COMMAND ? "A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call." : "A slow failure arrives with your next prompt or tool call."
  ];
}
var PRIMER = primer();

// src/harness/opencode/bridge.ts
function opencodeCommand(cli, node = process.execPath) {
  return `${shellWord(node)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}
function bridgeDeps(module, host) {
  const cli = fileURLToPath(new URL("../cli/squeal.mjs", module));
  return {
    env: process.env,
    cli,
    command: opencodeCommand(cli),
    harnessProcess: () => findHarnessProcess({ ppid: host.pid })
  };
}
var ping = async () => ({ pong: true });
async function runBridge(stdin, module, kind, handler) {
  try {
    const request = JSON.parse(stdin);
    if (request.kind !== kind) throw new Error(`not a ${kind} request`);
    const answer = await handler(
      request,
      bridgeDeps(module, request)
    );
    process.stdout.write(JSON.stringify({ answer }));
  } catch {
    process.exitCode = 1;
  }
}
async function runEntry(module, kind, handler) {
  let stdin = "";
  try {
    stdin = readFileSync5(0, "utf8");
  } catch {
  }
  await runBridge(stdin, new URL(module), kind, handler);
}

// src/harness/opencode/entries/hooks/ping.ts
await runEntry(import.meta.url, "ping", ping);
