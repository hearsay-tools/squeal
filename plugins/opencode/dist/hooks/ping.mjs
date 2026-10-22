import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/harness/opencode/bridge.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/daemon/config-file.ts
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";

// src/core/daemon/policy-node-test.ts
import { isAbsolute, posix } from "node:path";

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
function compiles(globs2) {
  for (const glob of globs2) {
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
  return isAbsolute(v) || normal === ".." || normal.startsWith("../") ? "a path inside the worktree, relative to its root" : null;
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

// src/core/daemon/policy-pytest.ts
import { isAbsolute as isAbsolute2, posix as posix2 } from "node:path";
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
  if (python === void 0 || isAbsolute2(python)) return null;
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
var boolean2 = (v) => typeof v === "boolean" ? null : "true or false";
var strings2 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
var inputs = (v) => {
  const isList = strings2(v) === null;
  if (!isList && !(isRecord(v) && Object.values(v).every((globs3) => strings2(globs3) === null))) {
    return "an array of strings, or an object from test-file glob to an array of strings";
  }
  const globs2 = isList ? v : Object.entries(v).flatMap(([test, input]) => [test, ...input]);
  return compiles(globs2);
};
var atLeastZero = (v) => isNumber(v) && v >= 0 ? null : "a number >= 0";
var aboveZero = (v) => isNumber(v) && v > 0 ? null : "a number > 0";
var orNull = (leaf) => (v) => {
  const expected = v === null ? null : leaf(v);
  return expected === null || typeof expected === "object" ? expected : `${expected}, or null`;
};
var oneOf = (...values) => (v) => values.includes(v) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;
var SHAPE = {
  interrupt: { onRegression: boolean2 },
  stop: {
    blockOnKnownFailures: boolean2,
    requireFullSuite: boolean2,
    waitMs: atLeastZero,
    requireSlowSuite: boolean2,
    slowWaitMs: atLeastZero
  },
  testCommand: { denyWhenCurrent: boolean2 },
  baseline: { onStart: oneOf("lookup-then-run-missing", "lookup-only") },
  inputs,
  observe: { runtimeInputs: boolean2 },
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
    maxLoadPerCpu: aboveZero,
    maxDeferMs: atLeastZero,
    maxParallel: positiveInteger,
    rank: oneOf("tokens", "duration"),
    // Spec 004 D2, D7 as amended 2026-10-18 (row 004-80).
    trigger: oneOf("continuous", "idle"),
    quietMs: atLeastZero
  },
  delivery: { uncoveredEdits: boolean2 },
  daemon: { idleExitMinutes: aboveZero, unusedExitMinutes: aboveZero },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) }
};
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/text.ts
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
function excludedProjectsText(entries) {
  const quoted = (list, join) => {
    const all = list.map((entry) => JSON.stringify(entry));
    const last = all.pop();
    return all.length === 0 ? last : `${all.join(", ")} ${join} ${last}`;
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
function excludedFilesText(globs2) {
  const quoted = globs2.slice(0, EXCLUDED_GLOBS_NAMED).map((glob) => JSON.stringify(glob));
  const rest = globs2.length - quoted.length;
  if (rest > 0)
    return `Vitest test files matching ${quoted.join(", ")} and ${plural(rest, "more glob")}`;
  const last = quoted.pop();
  return `Vitest test files matching ${quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`}`;
}

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
var PRUNABLE = `${UNPROTECTED}
  AND (recorded_at < ? OR worktree_id NOT IN (SELECT id FROM worktrees))`;

// src/core/store/repos/results.ts
var SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;

// src/core/store/repos/states.ts
var SELECT_STATES = `SELECT s.*, ${CHECK_COLUMNS} FROM known_states s JOIN checks c ON c.id = s.check_id`;

// src/core/waiter-lock/waiter-lock.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

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

// src/core/daemon/lock.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/daemon/test-pause.ts
import { channel } from "node:diagnostics_channel";
var TEST_PAUSE_CHANNEL = "squeal:test-pause";
var pauses = channel(TEST_PAUSE_CHANNEL);

// src/core/status/open.ts
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/slow/slot.ts
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/ps/proc.ts
var MARK = Buffer.from("SQUEAL_DAEMON_CHILD=");

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

// src/core/hash/blob.ts
import { constants } from "node:fs";
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/delivery/handoff.ts
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;

// src/core/status/stopping.ts
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);

// src/core/delivery/format.ts
var SQUEAL_COMMAND = "squeal";
function shellWord(text) {
  return /["$`\\]/.test(text) ? `'${text.replaceAll("'", "'\\''")}'` : `"${text}"`;
}

// src/harness/shared/coverage.ts
var VITEST_ONLY = {
  vitest: true,
  vitestConfig: null,
  nodeTest: [],
  slow: null
};

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
function primer(command = SQUEAL_COMMAND, coverage = VITEST_ONLY) {
  const names = runnerNames(coverage);
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
  const most = Math.max(coverage.nodeTest.length, coverage.pytest?.length ?? 0);
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
function runnerNames(coverage) {
  const nodeTest = coverage.nodeTest.length > 0;
  const pytest = (coverage.pytest?.length ?? 0) > 0;
  return [
    ...coverage.vitest || !nodeTest && !pytest ? ["Vitest"] : [],
    ...nodeTest ? ["node:test"] : [],
    ...pytest ? ["pytest"] : []
  ];
}
function listed(words, conjunction) {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}
function coversSentence(coverage, node) {
  const suites = runnerNames(coverage).includes("Vitest") ? [
    `${coverage.vitestConfig === null ? "Vitest" : `Vitest (${coverage.vitestConfig})`}${excluded(coverage)}`
  ] : [];
  if (coverage.nodeTest.length > 0) {
    const entries = coverage.nodeTest.map(
      ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`
    );
    const list = named("project", entries, node);
    suites.push(node === 0 ? `node:test (${list})` : `node:test ${list}`);
  }
  if (coverage.pytest !== void 0 && coverage.pytest.length > 0) {
    const entries = coverage.pytest.map(
      ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`
    );
    const list = named("project", entries, node);
    suites.push(node === 0 ? `pytest (${list})` : `pytest ${list}`);
  }
  const files = coverage.slow?.files;
  const slow = coverage.slow === null ? "" : files === null || files === void 0 ? ", with slow test files not counted yet" : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed(suites, "and")}${slow}.`;
}
function excluded(coverage) {
  const entries = coverage.vitestExcluded ?? [];
  if (entries.length === 0) return "";
  const { text, plural: plural2 } = excludedProjectsText(entries);
  return `; its ${text} ${plural2 ? "are" : "is"} not run, excluded by squeal.config.json`;
}
function notCovered(coverage) {
  const globs2 = coverage.vitestExcludedFiles ?? [];
  const what = globs2.length === 0 ? "typecheck, build" : `typecheck, build, the ${excludedFilesText(globs2)}, which squeal.config.json excludes,`;
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
    stdin = readFileSync2(0, "utf8");
  } catch {
  }
  await runBridge(stdin, new URL(module), kind, handler);
}

// src/harness/opencode/entries/hooks/ping.ts
await runEntry(import.meta.url, "ping", ping);
