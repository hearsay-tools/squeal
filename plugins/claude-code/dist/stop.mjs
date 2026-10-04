// src/harness/claude-code/hooks/stop.ts
import { setTimeout as sleep2 } from "node:timers/promises";

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

// src/core/state/fingerprint.ts
var SUMMARY_MAX_CHARS = 300;

// src/core/state/derive.ts
function checkIdentity(check) {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}
function testFileKeyOf(check) {
  return testFileId(testFileOf(check));
}
function testFileOf(check) {
  return { project: check.project, path: check.testPath };
}

// src/core/state/baseline.ts
var metaKey = (worktreeId) => `state.baseline-findings.${worktreeId}`;
function entry(check, fingerprint) {
  return `${checkIdentity(check)}\0${fingerprint ?? ""}`;
}
function read(store, worktreeId) {
  const raw = store.meta.get(metaKey(worktreeId));
  return raw === null ? null : JSON.parse(raw);
}
function baselineFindings(store, worktreeId) {
  const entries = new Set(read(store, worktreeId)?.entries);
  return (check, fingerprint) => entries.has(entry(check, fingerprint));
}

// src/core/state/check-name.ts
var FILE_LEVEL = " (file-level)";
function formatCheck(check) {
  const project = check.project === "" ? "" : `[${check.project}] `;
  return check.kind === "test" ? `${project}${check.testPath} > ${check.fullName}` : `${project}${check.testPath}${FILE_LEVEL}`;
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

// src/core/state/transitions.ts
function transitionKind(from, to) {
  const before = from?.outcome ?? null;
  switch (to.outcome) {
    case "fail":
      if (before === "pass") return "pass-to-fail";
      if (before === "fail") return from?.fingerprint === to.fingerprint ? null : "fail-changed";
      return "first-seen-fail";
    case "pass":
      return before === "fail" ? "fail-to-pass" : null;
    case "unknown":
      return before === "pass" || before === "fail" ? "to-unknown" : null;
    case "skip":
      return null;
  }
}

// src/core/delivery/delivery.ts
import { setTimeout as sleep } from "node:timers/promises";

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/delivery.ts
var MAIN_AGENT = "main";

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

// src/core/delivery/delta.ts
var RANK = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-changed": 1,
  "to-unknown": 3,
  "fail-to-pass": 4,
  "fail-retired": 5
};
var rank = (e) => isBaselineEntry(e) ? 2 : RANK[e.kind];
function isBaselineEntry(e) {
  return e.kind !== "fail-retired" && e.baseline === true;
}
function restrictPlan(plan, kinds) {
  const entries = plan.entries.filter((e) => kinds.has(e.kind));
  const ids = new Set(entries.map((e) => checkIdentity(e.check)));
  return {
    entries,
    writes: plan.writes.filter((w) => ids.has(checkIdentity(w.check))),
    removals: plan.removals.filter((c) => ids.has(checkIdentity(c)))
  };
}
function toView(state, toldAt) {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt };
}
function planDelta(input) {
  const told = new Map(input.view.map((v) => [checkIdentity(v.check), v]));
  const entries = [];
  const writes = [];
  for (const state of input.states) {
    const id = checkIdentity(state.check);
    const before = told.get(id) ?? null;
    told.delete(id);
    const kind = transitionKind(before, state);
    if (before === null || kind !== null) writes.push(toView(state, input.toldAt));
    if (kind === null) continue;
    const baseline = kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    const originRoot = state.origin?.kind === "inherited" ? input.rootOf(state.origin.worktreeId) : null;
    entries.push({
      check: state.check,
      kind,
      from: before?.outcome ?? null,
      to: state.outcome,
      validity: state.validity,
      observedAt: state.observedAt ?? input.revision,
      origin: state.origin ?? { kind: "own" },
      ...originRoot === null ? {} : { originRoot },
      summary: state.summary,
      location: state.location,
      ...baseline ? { baseline } : {}
    });
  }
  for (const view of told.values()) {
    if (view.outcome !== "fail") continue;
    entries.push({
      check: view.check,
      kind: "fail-retired",
      from: "fail",
      to: null,
      fingerprint: view.fingerprint,
      observedAt: input.revision
    });
  }
  const sorted = entries.map((entry2, i) => ({ entry: entry2, i })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i).map(({ entry: entry2 }) => entry2);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}

// src/core/delivery/delivery.ts
var DEFAULT_POLL_INTERVAL_MS = 250;
var isEmpty = (plan) => plan.entries.length === 0 && plan.writes.length === 0 && plan.removals.length === 0;
function createDelivery(store, options) {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  function plan(consumer, states, toldAt, kinds) {
    const full = planDelta({
      view: store.views.list(consumer),
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
      revision: store.revisions.latest(consumer.worktreeId)?.number ?? 0
    });
    return kinds === null ? full : restrictPlan(full, kinds);
  }
  function deliver(consumer, heardFrom, kinds = null) {
    if (!heardFrom) {
      if (store.consumers.get(consumer) === null) return null;
      const states = store.knownStates.list(consumer.worktreeId);
      if (isEmpty(plan(consumer, states, now(), kinds))) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      const at2 = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const delta = plan(consumer, states, at2, kinds);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const delivered = delta.entries.length > 0;
      if (heardFrom || delivered) store.consumers.touch(consumer, at2, delivered);
      if (!delivered) return null;
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header: readHeader(store, consumer.worktreeId, states),
        label: delta.entries.every(isBaselineEntry) ? "baseline" : "transitions",
        entries: delta.entries
      };
    });
  }
  return {
    register: async (consumer) => store.transaction(() => {
      const at2 = now();
      store.consumers.register(consumer, at2);
      const states = store.knownStates.list(consumer.worktreeId);
      store.views.writeMany(
        consumer,
        states.map((s) => toView(s, at2))
      );
      const header = readHeader(store, consumer.worktreeId, states);
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? [])
      };
    }),
    unregister: async (consumer) => {
      store.transaction(() => store.consumers.unregister(consumer));
    },
    onToolBoundary: async (consumer) => deliver(consumer, true),
    peek: async (consumer, { kinds }) => deliver(consumer, true, new Set(kinds)),
    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (; ; ) {
        if (signal?.aborted) return null;
        const delta = deliver(consumer, false);
        if (delta !== null) return delta;
        const left = deadline - performance.now();
        if (left <= 0) return null;
        try {
          await sleep(Math.min(pollIntervalMs, left), void 0, signal ? { signal } : {});
        } catch (error) {
          if (signal?.aborted) return null;
          throw error;
        }
      }
    },
    status: async (worktreeId) => options.status.build(worktreeId)
  };
}

// src/core/delivery/format.ts
var MESSAGE_CAP_CHARS = 1e4;
var OVERFLOW_RESERVE = 200;
var INDENT = "      ";
var STATUS_POINTER = "`squeal status` lists every known failure.";
var upper = (outcome) => outcome.toUpperCase();
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function cap(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
function checkName(check) {
  return cap(formatCheck(check), SUMMARY_MAX_CHARS);
}
function at(location2) {
  return `at ${location2.path}:${location2.line}:${location2.column}`;
}
function headerLine(header) {
  const { revision, counts, testFilesWithoutChecks: files, fullSuite } = header;
  const suite = fullSuite.atCurrentRevision ? `completed at revision ${revision}` : fullSuite.lastCompletedRevision === null ? "not completed at any revision" : `not completed at revision ${revision}, last completed at revision ${fullSuite.lastCompletedRevision}`;
  const withoutChecks = files.pending + files.unknown === 0 ? "" : ` Test files without checks: ${files.pending} pending, ${files.unknown} unknown.`;
  return `Revision ${revision}: ${counts.current} current, ${counts.pending} pending, ${counts.stale} stale, ${counts.unknown} unknown.${withoutChecks} Full suite: ${suite}.`;
}
function change(entry2) {
  switch (entry2.kind) {
    case "first-seen-fail": {
      const line = entry2.from === null ? "first observed: FAIL" : `${upper(entry2.from)} -> FAIL`;
      return entry2.baseline === true ? `baseline finding, ${line}` : line;
    }
    case "fail-changed":
      return "FAIL -> FAIL, failure changed";
    default:
      return `${entry2.from === null ? "NONE" : upper(entry2.from)} -> ${upper(entry2.to)}`;
  }
}
function provenance(entry2, revision) {
  const parts = [];
  if (entry2.validity === "stale") parts.push(`stale, observed at revision ${entry2.observedAt}`);
  if (entry2.validity === "pending") {
    parts.push(`observed at revision ${entry2.observedAt}, revision ${revision} pending`);
  }
  if (entry2.origin.kind === "inherited") {
    const commit = entry2.origin.commit === null ? "no commit" : `commit ${entry2.origin.commit.slice(0, 12)}`;
    const from = entry2.originRoot ?? `worktree ${entry2.origin.worktreeId}`;
    parts.push(`inherited from ${from} at ${commit}`);
  }
  return parts.length === 0 ? null : parts.join("; ");
}
function block(head, lines, outcomes) {
  const body = lines.filter((l) => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), outcomes };
}
function entryBlock(entry2, revision) {
  return block(
    `${upper(entry2.to)}  ${checkName(entry2.check)}`,
    [
      change(entry2),
      entry2.summary === null ? null : cap(entry2.summary, SUMMARY_MAX_CHARS),
      entry2.location === null ? null : at(entry2.location),
      provenance(entry2, revision)
    ],
    [entry2.to]
  );
}
function retiredBlock(entry2) {
  return block(
    `RESOLVED  ${checkName(entry2.check)}`,
    ["FAIL -> no longer reported by the runner"],
    ["resolved"]
  );
}
function unknownBlocks(entries) {
  const byReason = /* @__PURE__ */ new Map();
  for (const e of entries) {
    const reason = e.summary ?? "no trusted result";
    byReason.set(reason, [...byReason.get(reason) ?? [], e]);
  }
  return [...byReason].map(([reason, group]) => {
    const files = [...new Set(group.map((e) => e.check.testPath))];
    const from = (outcome) => group.filter((e) => e.from === outcome).length;
    const counts = ["pass", "fail"].filter((o) => from(o) > 0).map((o) => `${upper(o)} -> UNKNOWN (${from(o)})`);
    const listed = files.slice(0, 5).join(", ");
    const more = files.length > 5 ? ` and ${plural(files.length - 5, "more file")}` : "";
    return block(
      `UNKNOWN  ${plural(group.length, "check")} in ${plural(files.length, "test file")}`,
      [counts.join(", "), cap(reason, SUMMARY_MAX_CHARS), `${listed}${more}`],
      group.map(() => "unknown")
    );
  });
}
function assemble(head, blocks, overflow) {
  let out = head;
  for (const [i, b] of blocks.entries()) {
    const next = `${out}

${b.text}`;
    const last = i === blocks.length - 1;
    if (next.length <= MESSAGE_CAP_CHARS - (last ? 0 : OVERFLOW_RESERVE)) {
      out = next;
      continue;
    }
    return cap(`${out}

${overflow(blocks.slice(i))}`, MESSAGE_CAP_CHARS);
  }
  return out;
}
function formatDelta(delta) {
  const { header, entries } = delta;
  const changed = entries.filter((e) => e.kind !== "fail-retired");
  const retired = entries.filter((e) => e.kind === "fail-retired");
  const title = delta.label === "baseline" ? `SQUEAL \xB7 baseline: ${plural(entries.length, "failing check")} found at revision ${header.revision}` : `SQUEAL \xB7 ${plural(entries.length, "check")} changed at revision ${header.revision}`;
  const blocks = [
    ...changed.filter((e) => e.to === "fail").map((e) => entryBlock(e, header.revision)),
    ...unknownBlocks(changed.filter((e) => e.to === "unknown")),
    ...changed.filter((e) => e.to === "pass").map((e) => entryBlock(e, header.revision)),
    ...retired.map(retiredBlock)
  ];
  return assemble(`${title}
${headerLine(header)}`, blocks, (left) => {
    const outcomes = left.flatMap((b) => b.outcomes);
    const by = ["fail", "pass", "unknown", "resolved"].map((o) => [o, outcomes.filter((x) => x === o).length]).filter(([, n]) => n > 0).map(([o, n]) => `${n} ${upper(o)}`);
    return `Not shown: ${outcomes.length} more changed checks (${by.join(", ")}). ${STATUS_POINTER}`;
  });
}
function formatRegistration(registration) {
  const { header, knownFailures } = registration;
  const head = [
    `SQUEAL \xB7 registered at revision ${header.revision}`,
    headerLine(header),
    `Known failures: ${knownFailures.length}`
  ].join("\n");
  const blocks = knownFailures.map(
    (f) => block(
      `FAIL  ${checkName(f.check)}`,
      [
        f.summary === "" ? null : cap(f.summary, SUMMARY_MAX_CHARS),
        f.location === null ? null : at(f.location),
        f.validity === "current" ? null : `${f.validity}, observed at revision ${f.observedAt}`
      ],
      ["fail"]
    )
  );
  return assemble(
    head,
    blocks,
    (left) => `Not shown: ${left.length} more known failures. ${STATUS_POINTER}`
  );
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
    register: (consumer, at2) => conn.transaction(() => {
      unregister(consumer);
      conn.run(
        `INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`,
        ...consumerParams(consumer),
        at2,
        at2
      );
      return { consumer, registeredAt: at2, lastSeenAt: at2, lastDeliveredAt: null };
    }),
    touch: (consumer, at2, delivered) => {
      conn.run(
        `UPDATE consumers SET last_seen_at = ?,
           last_delivered_at = CASE WHEN ? THEN ? ELSE last_delivered_at END
         WHERE ${WHERE_CONSUMER}`,
        at2,
        delivered ? 1 : 0,
        at2,
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
    ).map(toView2),
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
function toView2(row) {
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
    finish: (id, end, at2) => {
      conn.run("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?", end, at2, id);
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
    finish: (id, end, at2) => {
      conn.run("UPDATE checkpoints SET end_state = ?, completed_at = ? WHERE id = ?", end, at2, id);
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
    heartbeat: (id, at2) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at2,
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
    const at2 = now();
    const movedTo = moveAside(paths.database, at2);
    const fresh = connect(paths, { ...options, checkIntegrity: false });
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const note = JSON.stringify({ at: at2, movedTo, reason: again.corrupt });
      fresh.transaction(() => fresh.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh;
  } finally {
    rollback(lock);
    lock.close();
  }
}
function moveAside(database, at2) {
  let movedTo = `${database}.corrupt-${at2}`;
  for (let n = 1; existsSync2(movedTo); n++) movedTo = `${database}.corrupt-${at2}-${n}`;
  renameSync(database, movedTo);
  if (existsSync2(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync2(`${database}-shm`, { force: true });
  return movedTo;
}

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

// src/core/status/git-head.ts
import { readFileSync as readFileSync2, statSync } from "node:fs";
import { join as join5, resolve as resolve4 } from "node:path";
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = worktreeGitDir(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read2(join5(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === void 0) return null;
    value = read2(join5(gitDir, ref)) ?? read2(join5(commonDir, ref)) ?? packed(commonDir, ref);
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
  const line = /^gitdir:\s*(.+?)\s*$/m.exec(read2(dotGit) ?? "");
  return line?.[1] === void 0 ? null : resolve4(root, line[1]);
}
function packed(commonDir, ref) {
  for (const line of (read2(join5(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read2(path) {
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
  const { at: at2, revision, text } = item;
  if (typeof at2 !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  return [{ at: at2, revision, text }];
}

// src/core/status/snapshot.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
function createStatusBuilder(store, options = {}) {
  const now = options.now ?? Date.now;
  return {
    build(worktreeId) {
      const worktree = store.worktrees.get(worktreeId);
      if (worktree === null) {
        return unavailable(
          "not-registered",
          `worktree ${worktreeId} is not registered in the store`
        );
      }
      return snapshot(store, worktreeId, worktree.root, now());
    }
  };
}
function snapshot(store, worktreeId, root, now) {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const header = readHeader(store, worktreeId, states, keys);
  const notes = [];
  if (worktree === null) {
    notes.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes.push(recovered);
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
    notes,
    daemonNotes: readDaemonNotes(store, worktreeId)
  };
}
function liveness(daemon, now) {
  if (daemon === null) return { state: "down", since: null };
  const age = now - daemon.heartbeatAt;
  if (age <= daemon.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
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
    const { at: at2, movedTo } = JSON.parse(raw);
    const when = typeof at2 === "number" ? ` at ${new Date(at2).toISOString()}` : "";
    const where = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}; the baseline was lost${where}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
}

// src/harness/claude-code/context.ts
function locate(cwd) {
  const root = findWorktreeRoot(cwd);
  if (root === null) return null;
  const commonDir = resolveCommonDir(root);
  return commonDir === null ? null : { root, commonDir };
}
function openContext(input, location2, options = {}) {
  const store = openStore(location2.commonDir, {
    create: false,
    busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS
  });
  if (isStoreOpenFailure(store)) return null;
  try {
    const consumer = {
      worktreeId: worktreeIdFor(location2.root),
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT
    };
    const now = options.now ?? Date.now;
    const delivery = createDelivery(store, {
      status: createStatusBuilder(store, { now }),
      now,
      ...options.pollIntervalMs === void 0 ? {} : { pollIntervalMs: options.pollIntervalMs }
    });
    return { ...location2, store, delivery, consumer, close: () => store.close() };
  } catch (error) {
    store.close();
    throw error;
  }
}

// src/harness/claude-code/hook.ts
async function withContext(input, location2, deps, fn) {
  const options = {
    ...deps.now === void 0 ? {} : { now: deps.now },
    ...deps.pollIntervalMs === void 0 ? {} : { pollIntervalMs: deps.pollIntervalMs }
  };
  const context = openContext(input, location2, options);
  if (context === null) return null;
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}
function additionalContext(input, text) {
  return {
    output: {
      hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: text }
    }
  };
}
function isRegistered(context) {
  return context.store.consumers.get(context.consumer) !== null;
}

// src/harness/claude-code/policy.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join6 } from "node:path";
function readHookPolicy(root) {
  let text;
  try {
    text = readFileSync3(join6(root, "squeal.config.json"), "utf8");
  } catch (error) {
    if (isMissing(error)) return DEFAULT_POLICY;
    throw error;
  }
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return DEFAULT_POLICY;
  }
  return merge(DEFAULT_POLICY, file);
}
var isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function merge(defaults, file) {
  if (!isPlain(defaults) || !isPlain(file)) return defaults;
  const out = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    const given = file[key];
    if (given === void 0) continue;
    if (isPlain(value)) out[key] = merge(value, given);
    else if (value === null || typeof given === typeof value) out[key] = given;
  }
  return out;
}

// src/harness/claude-code/text.ts
var plural3 = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var LISTED_FAILURES = 10;
function headerLine2(consumer, header) {
  const text = formatRegistration({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    consumer,
    header,
    knownFailures: []
  });
  return text.split("\n")[1] ?? "";
}
function statusText(consumer, header, failures) {
  return [
    `SQUEAL \xB7 status at revision ${header.revision}`,
    headerLine2(consumer, header),
    knownFailuresLine(failures)
  ].join("\n");
}
function knownFailuresLine(failures) {
  return `Known failures: ${failures}`;
}
function knownFailuresReason(revision, failures) {
  const names = failures.slice(0, LISTED_FAILURES).map((f) => formatCheck(f.check));
  const more = failures.length - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  const verb = failures.length === 1 ? "exists" : "exist";
  return `Squeal policy stop.blockOnKnownFailures is on and ${plural3(failures.length, "known failure")} ${verb} at revision ${revision}: ${list}.`;
}
function fullSuiteReason(header) {
  const last = header.fullSuite.lastCompletedRevision;
  const before = last === null ? "none completed at any revision" : `the last one completed at revision ${last}`;
  return `Squeal policy stop.requireFullSuite is on and no full-suite checkpoint completed at revision ${header.revision}; ${before}. \`squeal run --all\` starts one.`;
}

// src/harness/claude-code/hooks/stop.ts
var STOP_WAIT_CAP_MS = 1500;
var STOP_POLL_MS = 100;
var stop = (input, location2, deps) => withContext(input, location2, deps, async (context) => {
  const policy = readHookPolicy(location2.root).stop;
  const wait = Math.min(policy.waitMs, STOP_WAIT_CAP_MS);
  if (wait > 0) await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS);
  const { store, consumer } = context;
  const text = await deliveryText(context);
  const states = store.knownStates.list(consumer.worktreeId);
  const header = readHeader(store, consumer.worktreeId, states);
  const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
  const reasons = [];
  if (input.stop_hook_active !== true) {
    if (policy.blockOnKnownFailures && failures.length > 0) {
      reasons.push(knownFailuresReason(header.revision, failures));
    }
    if (policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
      reasons.push(fullSuiteReason(header));
    }
  }
  if (reasons.length > 0) {
    return { output: { decision: "block", reason: `${reasons.join("\n")}

${text}` } };
  }
  return additionalContext(input, text);
});
async function deliveryText(context) {
  const { store, delivery, consumer } = context;
  if (!isRegistered(context)) return formatRegistration(await delivery.register(consumer));
  const delta = await delivery.onToolBoundary(consumer);
  const states = store.knownStates.list(consumer.worktreeId);
  const header = readHeader(store, consumer.worktreeId, states);
  const failures = states.filter((s) => s.outcome === "fail").length;
  if (delta === null) return statusText(consumer, header, failures);
  return `${formatDelta(delta)}
${knownFailuresLine(failures)}`;
}
async function waitForPending(context, waitMs, pollMs) {
  const deadline = performance.now() + waitMs;
  for (; ; ) {
    const header = readHeader(context.store, context.consumer.worktreeId);
    if (header.counts.pending + header.testFilesWithoutChecks.pending === 0) return;
    const left = deadline - performance.now();
    if (left <= 0) return;
    await sleep2(Math.min(pollMs, left));
  }
}

// src/harness/claude-code/main.ts
import { readFileSync as readFileSync4 } from "node:fs";

// src/harness/claude-code/input.ts
function parseHookInput(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  if (typeof v.session_id !== "string" || v.session_id === "") return null;
  if (typeof v.cwd !== "string" || v.cwd === "") return null;
  if (typeof v.hook_event_name !== "string") return null;
  return {
    session_id: v.session_id,
    cwd: v.cwd,
    hook_event_name: v.hook_event_name,
    ...typeof v.agent_id === "string" && v.agent_id !== "" ? { agent_id: v.agent_id } : {},
    ...typeof v.tool_name === "string" ? { tool_name: v.tool_name } : {},
    ...typeof v.stop_hook_active === "boolean" ? { stop_hook_active: v.stop_hook_active } : {}
  };
}

// src/harness/claude-code/run.ts
var SILENT = { stdout: "", stderr: "", exitCode: 0 };
async function runHandler(name, handler, stdin, deps) {
  try {
    const input = parseHookInput(stdin);
    if (input === null) return SILENT;
    const location2 = locate(input.cwd);
    if (location2 === null) return SILENT;
    const outcome = await handler(input, location2, deps);
    if (outcome === null) return SILENT;
    return {
      stdout: outcome.output === void 0 ? "" : JSON.stringify(outcome.output),
      stderr: outcome.stderr ?? "",
      exitCode: outcome.exitCode ?? 0
    };
  } catch (error) {
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal ${name} hook: ${String(error)}
` };
    }
    return SILENT;
  }
}

// src/harness/claude-code/main.ts
async function runMain(name, handler) {
  let stdin = "";
  try {
    stdin = readFileSync4(0, "utf8");
  } catch {
  }
  const result = await runHandler(name, handler, stdin, {
    env: process.env,
    ...waiterTimeout(process.env.SQUEAL_WAITER_TIMEOUT_MS)
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
function waiterTimeout(value) {
  const ms = Number(value);
  return value !== void 0 && Number.isInteger(ms) && ms > 0 ? { waiterTimeoutMs: ms } : {};
}

// src/harness/claude-code/entries/stop.ts
await runMain("stop", stop);
