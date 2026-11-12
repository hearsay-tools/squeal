import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/daemon/front-desk.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { parentPort } from "node:worker_threads";

// src/core/daemon/handlers.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/daemon.ts
function daemonIncarnation(daemon) {
  if (daemon?.token === void 0) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}

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

// src/core/daemon/write-batch.ts
function parseBatch(value) {
  if (typeof value !== "object" || value === null) return '"batch" must be an object';
  const { sqls, rows } = value;
  if (!Array.isArray(sqls) || !sqls.every((s) => typeof s === "string")) {
    return '"batch.sqls" must be a list of strings';
  }
  for (const sql of sqls) {
    const refused = refusedStatement(sql);
    if (refused !== null) return refused;
  }
  if (!Array.isArray(rows)) return '"batch.rows" must be a list';
  for (const row of rows) {
    if (!Array.isArray(row) || !isIndex(row[0], sqls.length) || !row.slice(1).every(isParam)) {
      return '"batch.rows" must hold [statement index, ...parameters]';
    }
  }
  return { sqls, rows };
}
function isIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length;
}
function isParam(value) {
  if (value === null || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const keys = Object.keys(value);
  const record = value;
  if (keys.length !== 1) return false;
  if (keys[0] === "bigint")
    return typeof record.bigint === "string" && /^-?\d+$/.test(record.bigint);
  return keys[0] === "bytes" && typeof record.bytes === "string";
}
var WRITES = /* @__PURE__ */ new Set(["INSERT", "REPLACE", "UPDATE", "DELETE"]);
var CONFLICTS = /* @__PURE__ */ new Set(["ROLLBACK", "ABORT", "REPLACE", "FAIL", "IGNORE"]);
function refusedStatement(sql) {
  const tokens = tokenize(sql);
  if (tokens === null) return "a statement has an unterminated quote or comment";
  const first = tokens[0];
  if (first?.kind !== "word" || !WRITES.has(first.upper)) {
    return `only INSERT, REPLACE, UPDATE and DELETE are written, not ${JSON.stringify(sql.trim().slice(0, 40))}`;
  }
  const end = tokens.findIndex((t) => t.kind === "end");
  if (end >= 0 && tokens.slice(end + 1).some((t) => t.kind !== "end")) {
    return "one statement per entry: a statement follows the first";
  }
  const table = targetOf(tokens);
  if (table === null) return `no table named in ${JSON.stringify(sql.trim().slice(0, 40))}`;
  if (table.qualified) return `a table named with its schema is not written: ${table.name}`;
  if (table.name.toLowerCase().startsWith("sqlite_")) {
    return `SQLite's own table ${table.name} is not written`;
  }
  return null;
}
function targetOf(tokens) {
  const upper = (i) => tokens[i]?.kind === "word" ? tokens[i]?.upper ?? "" : "";
  const verb = upper(0);
  let at = 1;
  if ((verb === "INSERT" || verb === "UPDATE") && upper(at) === "OR" && CONFLICTS.has(upper(2))) {
    at += 2;
  }
  if (verb === "INSERT" || verb === "REPLACE") {
    if (upper(at) !== "INTO") return null;
    at++;
  }
  if (verb === "DELETE") {
    if (upper(at) !== "FROM") return null;
    at++;
  }
  const name = tokens[at];
  if (name === void 0 || name.kind !== "word" && name.kind !== "name") return null;
  return { name: name.text, qualified: tokens[at + 1]?.kind === "dot" };
}
function tokenize(sql) {
  const tokens = [];
  const push = (kind, text) => tokens.push({ kind, text, upper: text.toUpperCase() });
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) i++;
    else if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (sql.startsWith("/*", i)) {
      const close = sql.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 2;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const end = quoteEnd(sql, i);
      if (end < 0) return null;
      push(c === "'" ? "other" : "name", sql.slice(i + 1, end - 1));
      i = end;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))?.[0] ?? c;
      push("word", word);
      i += word.length;
    } else {
      push(c === ";" ? "end" : c === "." ? "dot" : "other", c);
      i++;
    }
  }
  return tokens;
}
function quoteEnd(sql, start) {
  const closer = sql[start] === "[" ? "]" : sql[start];
  let from = start + 1;
  for (; ; ) {
    const k = sql.indexOf(closer, from);
    if (k < 0) return -1;
    if (closer === "]" || sql[k + 1] !== closer) return k + 1;
    from = k + 2;
  }
}

// src/core/daemon/write-protocol.ts
var TYPES = /* @__PURE__ */ new Set(["lease", "release", "write", "write-status"]);
function isWriteRequest(request) {
  return TYPES.has(request.type);
}
function parseWriteRequest(request) {
  switch (request.type) {
    case "lease": {
      if (!isText(request.worktreeId)) return '"worktreeId" must be a non-empty string';
      if (typeof request.holder !== "string") return '"holder" must be a string';
      const process2 = parseProcess(request.process);
      if (typeof process2 === "string") return process2;
      return {
        type: "lease",
        worktreeId: request.worktreeId,
        holder: request.holder,
        ...process2 === null ? {} : { process: process2 }
      };
    }
    case "release":
      if (!isText(request.worktreeId)) return '"worktreeId" must be a non-empty string';
      if (!isText(request.token)) return '"token" must be a non-empty string';
      return {
        type: "release",
        worktreeId: request.worktreeId,
        token: request.token
      };
    case "write":
      return parseWrite(request);
    case "write-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "write-status", requestId: request.requestId };
    default:
      return void 0;
  }
}
function parseWrite(request) {
  const { worktreeId, storeSchema, token, release } = request;
  if (!isText(worktreeId)) return '"worktreeId" must be a non-empty string';
  if (!Number.isInteger(storeSchema)) return '"storeSchema" must be an integer';
  if (token !== null && !isText(token)) return '"token" must be a non-empty string or null';
  if (typeof release !== "boolean") return '"release" must be true or false';
  const batch = parseBatch(request.batch);
  if (typeof batch === "string") return batch;
  return {
    type: "write",
    worktreeId,
    storeSchema,
    token,
    release,
    batch
  };
}
function parseProcess(value) {
  if (value === void 0) return null;
  const { pid, startTime, pidNamespace: pidNamespace2 } = value ?? {};
  if (!Number.isInteger(pid) || pid <= 0) return '"process.pid" must be a pid';
  if (startTime !== null && !Number.isInteger(startTime)) {
    return '"process.startTime" must be an integer or null';
  }
  if (pidNamespace2 !== null && typeof pidNamespace2 !== "string") {
    return '"process.pidNamespace" must be a string or null';
  }
  return { pid, startTime, pidNamespace: pidNamespace2 };
}
function isText(value) {
  return typeof value === "string" && value.length > 0;
}

// src/core/daemon/protocol.ts
var MAX_LINE_BYTES = 64 * 1024;
var MAX_WRITE_LINE_BYTES = 32 * 1024 * 1024;
var WRITE_LINE_START = '{"type":"write",';
function lineLimit(start) {
  return start.startsWith(WRITE_LINE_START) ? MAX_WRITE_LINE_BYTES : MAX_LINE_BYTES;
}
function parseRequest(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return "request is not valid JSON";
  }
  if (typeof value !== "object" || value === null) return "request is not a JSON object";
  const request = value;
  switch (request.type) {
    case "ping":
    case "nudge":
    case "retry":
    case "run-slow":
    case "stop":
    case "hold":
    case "resume":
      return { type: request.type };
    // An older CLI's `after` and `resolvedSince` are ignored (task 001-258).
    case "sync":
      return parseSync(request.paths);
    case "run-all":
      if (request.force !== void 0 && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      if (request.observeIgnored !== void 0 && typeof request.observeIgnored !== "boolean") {
        return '"observeIgnored" must be true or false';
      }
      if (request.lane !== void 0 && request.lane !== "fast" && request.lane !== "slow") {
        return '"lane" must be "fast" or "slow"';
      }
      return {
        type: "run-all",
        force: request.force === true,
        ...request.observeIgnored === true ? { observeIgnored: true } : {},
        ...request.lane === void 0 ? {} : { lane: request.lane }
      };
    case "step-down":
      if (typeof request.version !== "string") return '"version" must be a string';
      return { type: "step-down", version: request.version };
    case "run-all-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-all-status", requestId: request.requestId };
    case "run-slow-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-slow-status", requestId: request.requestId };
    case "run-group":
      if (!isText2(request.group)) return '"group" must be a non-empty string';
      return { type: "run-group", group: request.group };
    case "run-group-paths":
      return parseGroupPaths(request.group, request.paths);
    case "run-group-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-group-status", requestId: request.requestId };
    case "sync-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "sync-status", requestId: request.requestId };
    case "hold-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "hold-status", requestId: request.requestId };
    case "promote": {
      const { testFiles, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "promote", testFiles: refs, withinMs };
    }
    case "focus": {
      const { testFiles, texts, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (!Array.isArray(texts) || texts.length === 0 || !texts.every(isText2)) {
        return '"texts" must be a list of non-empty strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "focus", testFiles: refs, texts: [...texts], withinMs };
    }
    default:
      return parseWriteRequest(request) ?? `unknown request type ${JSON.stringify(request.type)}`;
  }
}
function parseSync(paths) {
  if (paths === void 0) return { type: "sync" };
  if (!Array.isArray(paths) || !paths.every(isText2)) {
    return '"paths" must be a list of non-empty strings';
  }
  return { type: "sync", paths: [...paths] };
}
function parseGroupPaths(group, paths) {
  if (!isText2(group)) return '"group" must be a non-empty string';
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isText2)) {
    return '"paths" must be a non-empty list of non-empty strings';
  }
  return { type: "run-group-paths", group, paths: [...paths] };
}
function isTestFileRef(value) {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value;
  return typeof project === "string" && typeof path === "string";
}
function isText2(value) {
  return typeof value === "string" && value.length > 0;
}
function errorResponse(error) {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}

// src/core/daemon/run-group.ts
import { randomUUID } from "node:crypto";
var GROUP_NOT_SUPPORTED = "squeal run <group> is not supported by this daemon, which predates check groups; `squeal stop`, then `squeal start`, starts the installed version";
var NARROW_NOT_SUPPORTED = "squeal run <group> <path>... is not supported by this daemon, which predates narrow runs, and it ran nothing; `squeal stop`, then `squeal start`, starts the installed version";
var MainSteps = class {
  #running = /* @__PURE__ */ new Map();
  set(operation, since) {
    if (since === null) this.#running.delete(operation);
    else this.#running.set(operation, since);
  }
  current() {
    let oldest = null;
    for (const [operation, since] of this.#running) {
      if (oldest === null || since < oldest.since) oldest = { operation, since };
    }
    return oldest;
  }
};
function groupRequests(requestGroup, max, step = () => null, now = Date.now) {
  const requests = /* @__PURE__ */ new Map();
  const holderOf = (request) => {
    const { held } = request;
    if (request.requested !== null || request.unknown || request.error !== null) return null;
    const at = now();
    const since = (from) => Math.max(0, at - from);
    const running = step();
    const stepped = {
      step: running === null ? null : { operation: running.operation, heldMs: since(running.since) }
    };
    if (held === void 0) return { kind: "unanswered", heldMs: since(request.at), ...stepped };
    if (held === null) return { kind: "unknown", ...stepped };
    if (held.kind === "startup") return { kind: "startup", heldMs: since(held.since), ...stepped };
    const { operation } = held;
    return { kind: "scheduler", operation, heldMs: since(held.since), ...stepped };
  };
  const answer2 = (requestId, request) => {
    const { requested } = request;
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-group",
      requestId,
      group: request.group,
      requested: requested === null ? null : { revision: requested.revision, queued: requested.queued },
      unknown: request.unknown,
      error: request.error,
      holder: holderOf(request),
      ...requested?.narrow === void 0 ? {} : { narrow: requested.narrow }
    };
  };
  return {
    start(group, paths) {
      const requestId = randomUUID();
      const request = {
        group,
        at: now(),
        requested: null,
        unknown: false,
        error: null,
        held: void 0
      };
      requests.set(requestId, request);
      for (const old of requests.keys()) {
        if (requests.size <= max) break;
        requests.delete(old);
      }
      const held = (holder) => {
        request.held = holder;
      };
      const missing = new Error(paths === void 0 ? GROUP_NOT_SUPPORTED : NARROW_NOT_SUPPORTED);
      (requestGroup?.(group, held, paths) ?? Promise.reject(missing)).then(
        (requested) => {
          if (requested === null) request.unknown = true;
          else request.requested = requested;
        },
        (error) => {
          request.error = error instanceof Error ? error.message : String(error);
        }
      );
      return answer2(requestId, request);
    },
    status(requestId) {
      const request = requests.get(requestId);
      return request === void 0 ? null : answer2(requestId, request);
    }
  };
}

// src/core/daemon/run-slow.ts
var SLOW_NOT_SUPPORTED = "run --slow is not supported by this daemon";

// src/core/daemon/version.ts
function isNewerVersion(version, than) {
  const a = versionParts(version);
  const b = versionParts(than);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}

// src/core/daemon/write-desk.ts
import { randomUUID as randomUUID2 } from "node:crypto";

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
function harnessAlive(harness, namespace, statOf) {
  if (namespace === null || harness.pidNamespace !== namespace) return null;
  const stat = statOf(harness.pid);
  return stat !== null && stat.startTime === harness.startTime && stat.state !== "Z";
}

// src/core/daemon/lease-process.ts
function leaseProcessAlive(holder) {
  const { pid, startTime, pidNamespace: namespace } = holder;
  if (startTime !== null && namespace !== null) {
    try {
      return harnessAlive(
        { pid, startTime, pidNamespace: namespace },
        pidNamespace(),
        readProcStat
      );
    } catch {
      return null;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error.code;
    return code === "ESRCH" ? false : code === "EPERM" ? true : null;
  }
}

// src/core/daemon/write-desk.ts
var LEASE_TTL_MS = 5e3;
var STOPPING = "daemon is stopping";
var REMEMBERED = 64;
var WriteDesk = class {
  #context;
  #lease = null;
  #issued = /* @__PURE__ */ new Set();
  #writes = /* @__PURE__ */ new Map();
  constructor(context) {
    this.#context = context;
  }
  /**
   * The answer to `request`. A stopping daemon takes no new lease or write:
   * its client writes itself, except while another client holds the lease,
   * whose report must stay its own (review 0.1.442 B3).
   */
  answer(request, phase2) {
    switch (request.type) {
      case "lease": {
        if (phase2 !== "stopping") return this.lease(request);
        const current = this.#current();
        return current === null ? errorResponse(STOPPING) : this.#leaseAnswer(null, current.holder);
      }
      case "write":
        return phase2 === "stopping" ? errorResponse(STOPPING) : this.write(request);
      case "release":
        return this.release(request);
      case "write-status":
        return this.status(request);
    }
  }
  lease(request) {
    const other = this.#otherWorktree(request.worktreeId);
    if (other !== null) return other;
    const current = this.#current();
    if (current !== null) return this.#leaseAnswer(null, current.holder);
    const token = randomUUID2();
    this.#lease = {
      token,
      holder: request.holder,
      process: request.process,
      until: this.#now() + LEASE_TTL_MS,
      pending: 0,
      releasing: false
    };
    remember(this.#issued, token);
    return this.#leaseAnswer(token, null);
  }
  release(request) {
    const refused = this.#otherWorktree(request.worktreeId) ?? this.#unknownToken(request.token);
    if (refused !== null) return refused;
    const lease = this.#lease;
    if (lease?.token === request.token) {
      if (lease.pending > 0) lease.releasing = true;
      else this.#lease = null;
    }
    return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "release" };
  }
  write(request) {
    const refused = this.#otherWorktree(request.worktreeId) ?? (request.token === null ? null : this.#unknownToken(request.token));
    if (refused !== null) return refused;
    if (request.storeSchema !== this.#context.storeSchema) {
      return errorResponse(
        `the daemon's store is at schema ${this.#context.storeSchema}, not ${request.storeSchema}`
      );
    }
    const lease = this.#lease?.token === request.token ? this.#lease : null;
    if (lease !== null) {
      lease.until = this.#now() + LEASE_TTL_MS;
      lease.pending++;
      if (request.release) lease.releasing = true;
    }
    const requestId = randomUUID2();
    const state = { written: null, error: null };
    this.#writes.set(requestId, state);
    for (const old of this.#writes.keys()) {
      if (this.#writes.size <= REMEMBERED) break;
      this.#writes.delete(old);
    }
    const settle = (error) => {
      state.written = error === null;
      state.error = error;
      if (lease === null) return;
      lease.pending--;
      lease.until = this.#now() + LEASE_TTL_MS;
      if (lease.releasing && lease.pending === 0 && this.#lease === lease) this.#lease = null;
    };
    this.#context.requestWrite(request.batch).then(
      () => settle(null),
      (error) => settle(error instanceof Error ? error.message : String(error))
    );
    return writeAnswer(requestId, state);
  }
  status(request) {
    const state = this.#writes.get(request.requestId);
    if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
    return writeAnswer(request.requestId, state);
  }
  /**
   * The lease in force. One past its time with no write waiting is kept
   * while its process lives, for another `LEASE_TTL_MS`, and else has ended.
   */
  #current() {
    const lease = this.#lease;
    if (lease === null || lease.pending > 0 || this.#now() < lease.until) return lease;
    const alive = this.#context.alive ?? leaseProcessAlive;
    if (lease.process !== void 0 && alive(lease.process) === true) {
      lease.until = this.#now() + LEASE_TTL_MS;
      return lease;
    }
    this.#lease = null;
    return null;
  }
  #otherWorktree(worktreeId) {
    if (worktreeId === this.#context.worktreeId) return null;
    return errorResponse(
      `this daemon serves worktree ${this.#context.worktreeId}, not ${worktreeId}`
    );
  }
  #unknownToken(token) {
    return this.#issued.has(token) ? null : errorResponse("unknown lease token");
  }
  #leaseAnswer(token, holder) {
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "lease",
      token,
      ttlMs: LEASE_TTL_MS,
      holder
    };
  }
  #now() {
    return (this.#context.now ?? (() => performance.now()))();
  }
};
function writeAnswer(requestId, state) {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "write",
    requestId,
    written: state.written,
    error: state.error
  };
}
function remember(set, value) {
  set.add(value);
  for (const old of set) {
    if (set.size <= REMEMBERED) break;
    set.delete(old);
  }
}

// src/core/daemon/handlers.ts
var MAX_REQUESTS = 32;
function createHandlers(context) {
  const requests = /* @__PURE__ */ new Map();
  const slowRequests = /* @__PURE__ */ new Map();
  const groups = groupRequests(context.requestGroup, MAX_REQUESTS, context.mainStep);
  const syncRequests = /* @__PURE__ */ new Map();
  const holdRequests = /* @__PURE__ */ new Map();
  const { requestWrite, storeSchema } = context;
  const writes = requestWrite === void 0 || storeSchema === void 0 ? null : new WriteDesk({ worktreeId: context.worktreeId, storeSchema, requestWrite });
  const runAll = (requestId, state) => {
    const answer2 = {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-all",
      requestId,
      error: state.error
    };
    if (state.checkpoint === null) return { ...answer2, checkpoint: null };
    const { owner, ...checkpoint } = state.checkpoint;
    return { ...answer2, checkpoint, owner };
  };
  const runSlow = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-slow",
    requestId,
    requested: state.requested,
    error: state.error
  });
  const sync = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "sync",
    requestId,
    revision: state.revision,
    error: state.error,
    moves: true,
    incarnation: daemonIncarnation(context),
    ...state.readers === null ? {} : { readers: state.readers }
  });
  const hold = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "hold",
    requestId,
    settled: state.holding !== null || state.error !== null,
    holding: state.holding,
    error: state.error
  });
  return (request) => {
    if (isWriteRequest(request)) {
      return writes?.answer(request, context.phase()) ?? errorResponse(NO_WRITES);
    }
    switch (request.type) {
      case "ping":
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: context.worktreeId,
          root: context.root,
          squealVersion: context.squealVersion,
          phase: context.phase(),
          startedAt: context.startedAt
        };
      case "nudge":
        context.onActivity();
        context.onNudge?.();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "retry":
        context.onActivity();
        context.requestRetries?.().catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "retry" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID3();
        const state = { checkpoint: null, error: null };
        remember2(requests, requestId, state);
        const full = {
          force: request.force === true,
          observeIgnored: request.observeIgnored === true,
          ...request.lane === void 0 ? {} : { lane: request.lane }
        };
        context.requestFullSuite(full).then(
          (checkpoint) => {
            state.checkpoint = checkpoint;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return runAll(requestId, state);
      }
      case "run-all-status": {
        const state = requests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return runAll(request.requestId, state);
      }
      case "run-slow": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID3();
        const state = { requested: null, error: null };
        remember2(slowRequests, requestId, state);
        const request2 = context.requestSlowSuite?.() ?? Promise.reject(new Error(SLOW_NOT_SUPPORTED));
        request2.then(
          (requested) => {
            state.requested = requested;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return runSlow(requestId, state);
      }
      case "run-slow-status": {
        const state = slowRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return runSlow(request.requestId, state);
      }
      case "run-group":
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        return groups.start(request.group);
      case "run-group-paths":
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        return groups.start(request.group, request.paths);
      case "run-group-status":
        return groups.status(request.requestId) ?? errorResponse(`unknown request id ${request.requestId}`);
      case "sync": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestSync === void 0) return errorResponse("this daemon cannot sync");
        context.onActivity();
        const requestId = randomUUID3();
        const state = { revision: null, readers: null, error: null };
        remember2(syncRequests, requestId, state);
        context.requestSync(request.paths).then(
          (answer2) => {
            state.revision = answer2.revision;
            state.readers = answer2.readers ?? null;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return sync(requestId, state);
      }
      case "sync-status": {
        const state = syncRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return sync(request.requestId, state);
      }
      case "hold": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestHold === void 0) return errorResponse("this daemon cannot hold");
        const requestId = randomUUID3();
        const state = { holding: null, error: null };
        remember2(holdRequests, requestId, state);
        context.requestHold().then(
          (holding) => {
            state.holding = holding;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return hold(requestId, state);
      }
      case "hold-status": {
        const state = holdRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return hold(request.requestId, state);
      }
      case "resume":
        if (context.requestResume === void 0) return errorResponse("this daemon cannot hold");
        context.requestResume().catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "resume" };
      case "promote":
        if (context.requestPromotion === void 0)
          return errorResponse("this daemon cannot promote");
        context.onActivity();
        context.requestPromotion(request.testFiles, request.withinMs).catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "promote" };
      case "focus":
        if (context.requestFocus === void 0) return errorResponse("this daemon cannot focus");
        context.onActivity();
        context.requestFocus(request.testFiles, request.texts, request.withinMs).catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "focus" };
      case "stop":
        context.onStop();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
      case "step-down": {
        const steppingDown = isNewerVersion(request.version, context.squealVersion);
        if (steppingDown) context.onStepDown(request.version);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "step-down",
          squealVersion: context.squealVersion,
          steppingDown
        };
      }
    }
  };
}
var NO_WRITES = "this daemon takes no writes";
function remember2(requests, requestId, state) {
  requests.set(requestId, state);
  for (const old of requests.keys()) {
    if (requests.size <= MAX_REQUESTS) break;
    requests.delete(old);
  }
}

// src/core/daemon/server.ts
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
var IDLE_CONNECTION_MS = 2e3;
async function createDaemonServer(socketPath, handle) {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 448 });
  const connections = /* @__PURE__ */ new Set();
  const server2 = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    serve(socket, handle);
  });
  const bound = await bindAt(server2, socketPath);
  let closing = null;
  return {
    socketPath,
    close() {
      closing ??= new Promise((resolve) => {
        if (stillBound(socketPath, bound)) rmSync(socketPath, { force: true });
        server2.close(() => resolve());
        for (const socket of connections) socket.destroy();
      });
      return closing;
    }
  };
}
async function bindAt(server2, socketPath) {
  const name = `.${randomBytes(8).toString("hex")}`.slice(
    0,
    Math.max(2, basename(socketPath).length)
  );
  const staging = join(dirname(socketPath), name);
  await new Promise((resolve, reject) => {
    server2.once("error", reject);
    server2.listen(staging, () => {
      server2.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(staging, 384);
    const { dev, ino } = statSync(staging);
    renameSync(staging, socketPath);
    return { dev, ino };
  } catch (error) {
    await new Promise((resolve) => server2.close(() => resolve()));
    throw error;
  }
}
function stillBound(socketPath, bound) {
  try {
    const { dev, ino } = statSync(socketPath);
    return dev === bound.dev && ino === bound.ino;
  } catch {
    return false;
  }
}
function serve(socket, handle) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end < 0) {
      if (buffer.length > lineLimit(buffer)) answer(socket, errorResponse("request too long"));
      return;
    }
    const request = parseRequest(buffer.slice(0, end));
    buffer = "";
    if (typeof request === "string") {
      answer(socket, errorResponse(request));
      return;
    }
    let response;
    try {
      response = handle(request);
    } catch (error) {
      response = errorResponse(`daemon error: ${String(error)}`);
    }
    answer(socket, response);
  });
}
function answer(socket, response) {
  socket.removeAllListeners("data");
  socket.end(`${JSON.stringify(response)}
`);
}

// src/core/daemon/front-desk.ts
var port = parentPort;
if (port === null) throw new Error("squeal front desk: not a worker thread");
var post = (message) => port.postMessage(message);
var phase = "starting";
var waiting = /* @__PURE__ */ new Map();
var waitingSlow = /* @__PURE__ */ new Map();
var waitingGroup = /* @__PURE__ */ new Map();
var steps = new MainSteps();
var waitingSync = /* @__PURE__ */ new Map();
var waitingHold = /* @__PURE__ */ new Map();
var waitingWrite = /* @__PURE__ */ new Map();
var server = null;
function bind(identity) {
  const handle = createHandlers({
    worktreeId: identity.worktreeId,
    root: identity.root,
    squealVersion: identity.squealVersion,
    startedAt: identity.startedAt,
    token: identity.token,
    phase: () => phase,
    requestFullSuite: (request) => new Promise((resolve, reject) => {
      const id = randomUUID4();
      waiting.set(id, { resolve, reject });
      post({ type: "run-all", id, request });
    }),
    requestSlowSuite: () => new Promise((resolve, reject) => {
      const id = randomUUID4();
      waitingSlow.set(id, { resolve, reject });
      post({ type: "run-slow", id });
    }),
    requestGroup: (group, held, paths) => new Promise((resolve, reject) => {
      const id = randomUUID4();
      waitingGroup.set(id, { resolve, reject, held });
      post({ type: "run-group", id, group, ...paths === void 0 ? {} : { paths } });
    }),
    mainStep: () => steps.current(),
    requestSync: (paths) => new Promise((resolve, reject) => {
      const id = randomUUID4();
      waitingSync.set(id, { resolve, reject });
      post({ type: "sync", id, ...paths === void 0 ? {} : { paths } });
    }),
    requestHold: () => new Promise((resolve, reject) => {
      const id = randomUUID4();
      waitingHold.set(id, { resolve, reject });
      post({ type: "hold", id });
    }),
    requestResume: async () => post({ type: "resume" }),
    onActivity: () => post({ type: "activity" }),
    onNudge: () => post({ type: "nudge" }),
    requestRetries: async () => post({ type: "retry" }),
    requestPromotion: async (testFiles, withinMs) => post({ type: "promote", testFiles, withinMs }),
    requestFocus: async (testFiles, texts, withinMs) => post({ type: "focus", testFiles, texts, withinMs }),
    onStop: () => post({ type: "stop" }),
    onStepDown: (version) => post({ type: "step-down", version }),
    ...identity.storeSchema === void 0 ? {} : {
      storeSchema: identity.storeSchema,
      requestWrite: (batch) => new Promise((resolve, reject) => {
        const id = randomUUID4();
        waitingWrite.set(id, { resolve, reject });
        post({ type: "write", id, batch });
      })
    }
  });
  createDaemonServer(identity.socketPath, handle).then(
    (bound) => {
      server = bound;
      post({ type: "listening" });
    },
    (error) => post({ type: "failed", error: String(error) })
  );
}
port.on("message", (message) => {
  try {
    receive(message);
  } catch (error) {
    console.error(`squeal front desk: ${String(error)}`);
  }
});
function receive(message) {
  switch (message.type) {
    case "bind":
      bind(message.identity);
      return;
    case "phase":
      phase = message.phase;
      return;
    case "run-all-result": {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.checkpoint !== null) entry?.resolve(message.checkpoint);
      else entry?.reject(new Error(message.error ?? "run --all failed"));
      return;
    }
    case "run-slow-result": {
      const entry = waitingSlow.get(message.id);
      waitingSlow.delete(message.id);
      if (message.requested !== null) entry?.resolve(message.requested);
      else entry?.reject(new Error(message.error ?? "run --slow failed"));
      return;
    }
    case "run-group-result": {
      const entry = waitingGroup.get(message.id);
      waitingGroup.delete(message.id);
      if (message.error === null) entry?.resolve(message.requested);
      else entry?.reject(new Error(message.error));
      return;
    }
    case "run-group-held":
      waitingGroup.get(message.id)?.held(message.holder);
      return;
    case "main-step":
      steps.set(message.operation, message.since);
      return;
    case "sync-result": {
      const entry = waitingSync.get(message.id);
      waitingSync.delete(message.id);
      if (message.answer !== null) entry?.resolve(message.answer);
      else entry?.reject(new Error(message.error ?? "sync failed"));
      return;
    }
    case "hold-result": {
      const entry = waitingHold.get(message.id);
      waitingHold.delete(message.id);
      if (message.holding !== null) entry?.resolve(message.holding);
      else entry?.reject(new Error(message.error ?? "hold failed"));
      return;
    }
    case "write-result": {
      const entry = waitingWrite.get(message.id);
      waitingWrite.delete(message.id);
      if (message.error === null) entry?.resolve();
      else entry?.reject(new Error(message.error));
      return;
    }
    case "close":
      phase = "stopping";
      void (server?.close() ?? Promise.resolve()).catch((error) => console.error(`squeal front desk: ${String(error)}`)).then(() => post({ type: "closed" }));
      return;
  }
}
