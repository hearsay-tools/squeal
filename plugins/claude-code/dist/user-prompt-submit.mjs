import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/text.ts
function plural(count2, word) {
  return `${count2} ${word}${count2 === 1 ? "" : "s"}`;
}
function cap(text2, max) {
  return text2.length <= max ? text2 : `${text2.slice(0, max - 3)}...`;
}
function capitalize(text2) {
  return `${text2.charAt(0).toUpperCase()}${text2.slice(1)}`;
}
var pad2 = (n) => String(n).padStart(2, "0");
function timeText(at) {
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
function utcTimeText(at) {
  const date = new Date(at);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} UTC`;
}
function durationText(ms, round = Math.round) {
  const seconds2 = Math.max(0, round(ms / 1e3));
  if (seconds2 < 60) return `${seconds2} s`;
  const rest = seconds2 % 60;
  return `${Math.floor(seconds2 / 60)} min${rest === 0 ? "" : ` ${rest} s`}`;
}
var SAFE_WORD = /^[\w@%+=:,./-]+$/;
function shellWord(word) {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
var PATHS_NAMED = 5;
function listPaths(paths, max = PATHS_NAMED) {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}
var EXCLUDED_GLOBS_NAMED = 3;
function excludedFilesText(globs4) {
  const quoted = globs4.slice(0, EXCLUDED_GLOBS_NAMED).map((glob) => JSON.stringify(glob));
  const rest = globs4.length - quoted.length;
  if (rest > 0)
    return `Vitest test files matching ${quoted.join(", ")} and ${plural(rest, "more glob")}`;
  const last = quoted.pop();
  return `Vitest test files matching ${quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`}`;
}

// src/core/lint/surface/format.ts
var NAMED_RULES = 3;
var lineOf = (text2) => (text2.split("\n")[0] ?? "").trim();
var firstLine = (text2) => lineOf(text2).replace(/\.$/, "");
var ruleOf = (f) => f.rule ?? lineOf(f.message);
function byRule(sign, findings) {
  const counts = /* @__PURE__ */ new Map();
  for (const f of findings) counts.set(ruleOf(f), (counts.get(ruleOf(f)) ?? 0) + 1);
  const named2 = [...counts].slice(0, NAMED_RULES).map(([rule, n]) => `${sign}${n} ${rule}`);
  const rest = [...counts.values()].slice(NAMED_RULES).reduce((a, n) => a + n, 0);
  return rest === 0 ? named2 : [...named2, `${sign}${rest} more`];
}
var LINT_STALE = "an input changed since it was linted; linting resumes when the agent is idle";
var findingsWords = (n) => n === null ? "findings not stored" : plural(n, "finding");
var lintSubject = (entry2) => entry2.tool === void 0 ? entry2.path : `${entry2.path} (${entry2.tool})`;
function lintEntryLine(entry2) {
  switch (entry2.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
    case "fail-changed": {
      const stale = entry2.stale === true ? ` (${LINT_STALE})` : "";
      const [only] = entry2.added;
      const message = only?.rule != null && entry2.added.length === 1 && entry2.removed.length === 0 ? ` (${lineOf(only.message)})` : "";
      const rules = [...byRule("+", entry2.added), ...byRule("-", entry2.removed)];
      return `FAIL lint: ${lintSubject(entry2)}: ${findingsWords(entry2.findings)}${stale}${rules.map((r) => `, ${r}`).join("")}${message}`;
    }
    case "fail-to-pass":
      return `PASS lint: ${lintSubject(entry2)}: no findings`;
    case "removed":
      return `RESOLVED lint: ${lintSubject(entry2)}: deleted or no longer linted`;
  }
}
function lintSummaryLine(summary, command) {
  const stale = summary.stale === 0 ? "" : `, ${summary.stale} stale`;
  const files2 = `${plural(summary.failing, "file")} with findings`;
  return summary.reason === "config" ? `Lint config changed: ${files2} now${stale}; ${command} lint lists them.` : `Lint: ${files2}${stale}; ${command} lint lists them.`;
}
var lintFailedLine = (reason) => `Lint: unknown: ${firstLine(reason)}.`;
var lintOffLine = (reason) => `Lint: off: ${firstLine(reason)}.`;
function lintLines(news, command) {
  return [
    ...news.summary === void 0 ? [] : [lintSummaryLine(news.summary, command)],
    ...news.entries.map(lintEntryLine),
    ...news.more === 0 ? [] : [
      `and ${news.more} more lint ${news.more === 1 ? "change" : "changes"}; ${command} lint --changed lists them.`
    ],
    ...news.failed === void 0 ? [] : [lintFailedLine(news.failed)],
    ...news.off === void 0 ? [] : [lintOffLine(news.off)]
  ];
}
var lintChanges = (news) => news.entries.length + news.more;
function lintTitleWords(news) {
  const changes = lintChanges(news);
  return changes === 0 ? null : `${changes} lint ${changes === 1 ? "change" : "changes"}`;
}
var lintingWords = ({ done, total, cpuWait }) => (total === 0 ? "linting has not started" : `linting, ${done} of ${plural(total, "file")}`) + (cpuWait === void 0 ? "" : `; ${cpuWaitWords(cpuWait)}`);
function cpuWaitWords({ busy: busy2, limit }) {
  const busyWords = busy2 === null ? "" : `${Math.round(busy2)} busy, `;
  return `waiting for CPU (${busyWords}limit ${Math.round(limit * 100) / 100})`;
}
function lintRegistrationLine(reg, command) {
  if (reg.off !== void 0) return lintOffLine(reg.off);
  if (reg.unreadable !== void 0) {
    return `Lint: unknown: the lint store cannot be read: ${firstLine(reg.unreadable)}.`;
  }
  if (reg.failed !== void 0) return lintFailedLine(reg.failed);
  if (reg.linting !== void 0) return `Lint: ${lintingWords(reg.linting)}.`;
  const stale = reg.stale === 0 ? "" : `, ${reg.stale} stale`;
  return `Lint: ${plural(reg.failing, "file")} with findings${stale}; ${command} lint lists them.`;
}

// src/core/types/daemon.ts
var DAEMON_SOCKET_TIMEOUT_MS = 100;
function daemonIncarnation(daemon) {
  if (daemon?.token === void 0) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}

// src/core/types/scheduler.ts
var TESTS_GROUP = "tests";
var SLOW_GROUP = "slow";
var MAX_PERSISTED_NOTES = 20;

// src/core/types/store.ts
var WORKTREE_META_ROWS = {
  runtimeFiles: { prefix: "runtimeFiles.", owner: "keys/runtime-applied" },
  turn: { prefix: "turn:", owner: "delivery/turn" },
  edits: { prefix: "edits:", owner: "delivery/edits" },
  editsLate: { prefix: "edits-late:", owner: "delivery/late" },
  editTimings: { prefix: "edit-timings:", owner: "scheduler/edit-timings" },
  harnessProcess: { prefix: "harness-process:", owner: "delivery/harness-process" },
  departed: { prefix: "departed:", owner: "delivery/expiry" },
  consumerVersion: { prefix: "consumer-version:", owner: "delivery/consumer-version" },
  registered: { prefix: "revision-registered:", owner: "delivery/registered" },
  registeredLeft: { prefix: "revision-registered-left:", owner: "delivery/registered" },
  registeredKeys: { prefix: "registered-keys:", owner: "state/before-edits" },
  livenessTold: { prefix: "liveness-told:", owner: "delivery/liveness" },
  revisionTold: { prefix: "revision-told:", owner: "delivery/liveness" },
  uncoveredTold: { prefix: "uncovered-told:", owner: "delivery/uncovered" },
  slowTierTold: { prefix: "slow-tier-told:", owner: "delivery/slow-told" },
  groupTiersTold: { prefix: "group-tiers-told:", owner: "delivery/slow-told" },
  commitTold: { prefix: "commit-told:", owner: "delivery/commit-told" },
  countsOwed: { prefix: "counts-owed:", owner: "delivery/counts-owed" },
  holdTold: { prefix: "hold-told:", owner: "delivery/hold-told" },
  leaving: { prefix: "leaving:", owner: "delivery/leaving" },
  registrationOwed: { prefix: "registration-owed:", owner: "delivery/registration-owed" },
  viewMark: { prefix: "view-mark:", owner: "delivery/view-mark" },
  notes: { prefix: "notes.", owner: "notes" },
  refined: { prefix: "refined.", owner: "scheduler/refined" },
  awaitingInstall: { prefix: "awaiting-install.", owner: "scheduler/install-wait" },
  installCommand: { prefix: "install-command.", owner: "scheduler/install-wait" },
  checkpoint: { prefix: "checkpoint.", owner: "scheduler/checkpoint-progress" },
  checkpointLanes: { prefix: "checkpoint-lanes.", owner: "store/repos/runs" },
  headMove: { prefix: "head-move.", owner: "scheduler/head-move-record" },
  commitReports: { prefix: "commit-reports:", owner: "commit/store" },
  feedDelivered: { prefix: "feed-delivered:", owner: "presence/stored" },
  daemonBootstrapped: { prefix: "daemon-bootstrapped:", owner: "daemon/bootstrapped" },
  daemonToken: { prefix: "daemon-token:", owner: "store/repos/worktrees" },
  daemonExit: { prefix: "daemon-exit:", owner: "presence/stored" },
  daemonRest: { prefix: "daemon-rest:", owner: "presence/stored" },
  daemonUsed: { prefix: "daemon-used:", owner: "daemon/last-use" },
  daemonStopped: { prefix: "daemon-stopped:", owner: "presence/stored" },
  daemonHandoff: { prefix: "daemon-handoff:", owner: "presence/stored" },
  daemonHandoffShort: { prefix: "daemon-handoff-short:", owner: "presence/stored" },
  slowTier: { prefix: "slow-tier:", owner: "slow/state" },
  groupTiers: { prefix: "group-tier:", owner: "slow/state" },
  slowEvidence: { prefix: "slow-evidence:", owner: "slow/rank-store" },
  failureKeys: { prefix: "failure-keys:", owner: "slow/state" },
  failureProducers: { prefix: "failure-producers:", owner: "state/producers" },
  runners: { prefix: "runners:", owner: "store/repos/test-files" },
  reruns: { prefix: "reruns:", owner: "scheduler/rerun-memory" },
  interrupted: { prefix: "interrupted:", owner: "scheduler/interrupted" },
  heldFiles: { prefix: "held-files:", owner: "scheduler/held" },
  promotions: { prefix: "promotions:", owner: "scheduler/promotions-row" },
  narrowAsks: { prefix: "narrow-asks:", owner: "scheduler/narrow-asks-row" },
  focused: { prefix: "focused:", owner: "scheduler/focused-row" },
  yields: { prefix: "yields:", owner: "scheduler/yields" },
  quiet: { prefix: "quiet:", owner: "scheduler/quiet" },
  poolWait: { prefix: "pool-wait:", owner: "scheduler/pool-wait" },
  mergeHold: { prefix: "merge-hold:", owner: "scheduler/hold-rows" },
  commandHold: { prefix: "command-hold:", owner: "scheduler/hold-rows" },
  rekeyed: { prefix: "rekeyed.", owner: "scheduler/rekeyed-record" },
  rekeyedMoves: { prefix: "rekeyed-moves.", owner: "scheduler/rekeyed-moves" },
  statesMarker: { prefix: "states-marker.", owner: "store/write-markers" },
  optimizerOff: { prefix: "optimizer-off.", owner: "state/optimizer-note" },
  baselineFindings: { prefix: "state.baseline-findings.", owner: "state/baseline" },
  stopWait: { prefix: "stop-wait:", owner: "slow/stop-wait" },
  testCommandDenied: { prefix: "test-command-denied:", owner: "delivery/test-command-denied" },
  ignoredReads: { prefix: "ignored-reads:", owner: "scheduler/ignored-reads" },
  omittedTestFiles: { prefix: "omitted-test-files:", owner: "scheduler/omitted-test-files" },
  unknownFiles: { prefix: "unknown-files:", owner: "scheduler/unknown-files" },
  otherMachineKeys: { prefix: "other-machine-keys:", owner: "scheduler/other-machine-keys" },
  importRewalk: { prefix: "import-rewalk:", owner: "scheduler/import-rewalk" },
  importsWaiting: { prefix: "imports-waiting:", owner: "scheduler/imports-waiting" },
  sharedRefused: { prefix: "shared-refused:", owner: "shared/refused" },
  remoteSummary: { prefix: "remote-summary:", owner: "status/remote-status" },
  containerSummary: { prefix: "container-summary:", owner: "status/container-status" }
};
function worktreeMetaKey(row, worktreeId) {
  return `${WORKTREE_META_ROWS[row].prefix}${worktreeId}`;
}

// src/core/notes.ts
function notesMetaKey(worktreeId) {
  return worktreeMetaKey("notes", worktreeId);
}
function readDaemonNotes(store, worktreeId) {
  const notes = parseList(store.meta.get(notesMetaKey(worktreeId))).flatMap(toNote).slice(-MAX_PERSISTED_NOTES);
  const latest = /* @__PURE__ */ new Map();
  for (const note of notes) if (note.topic !== void 0) latest.set(note.topic, note);
  return notes.filter((note) => note.topic === void 0 || latest.get(note.topic) === note);
}
function parseList(raw) {
  if (typeof raw !== "string") return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function toNote(item) {
  if (typeof item !== "object" || item === null) return [];
  const { at, revision, text: text2 } = item;
  if (typeof at !== "number" || typeof text2 !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  const { stopped: rawStopped, exitOf, topic } = item;
  const stopped = stoppedOf(rawStopped);
  return [
    {
      at,
      revision,
      text: text2,
      ...stopped === void 0 ? {} : { stopped },
      ...typeof exitOf === "string" ? { exitOf } : {},
      ...typeof topic === "string" ? { topic } : {}
    }
  ];
}
function stoppedOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const { what, commands: commands2 } = value;
  if (typeof what !== "string" || !Array.isArray(commands2)) return void 0;
  return commands2.every((c) => typeof c === "string") ? { what, commands: commands2 } : void 0;
}

// src/core/store/paths.ts
import { basename, dirname, join } from "node:path";
function storePaths(commonDir) {
  const dir = join(commonDir, "squeal");
  return {
    dir,
    database: join(dir, "store.sqlite"),
    runsDir: join(dir, "runs"),
    locksDir: join(dir, "locks")
  };
}
function lockFileFor(commonDir, worktreeId) {
  return join(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
}
function daemonLogFor(commonDir, worktreeId) {
  return join(storePaths(commonDir).dir, "logs", `daemon-${worktreeId}.log`);
}

// src/core/presence/heartbeat.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
var DAEMON_START_GRACE_MS = 1e4;
var DAEMON_START_SLOW_MS = 6 * DAEMON_START_GRACE_MS;
var LATE_HEARTBEAT_NEWS_MS = 6e4;
function heartbeatGraceMs(intervalMs) {
  return HEARTBEAT_GRACE_INTERVALS * intervalMs;
}
function heartbeatAge(record, now) {
  return now - record.heartbeatAt;
}
function heartbeatFresh(record, now) {
  return heartbeatAge(record, now) <= heartbeatGraceMs(record.heartbeatIntervalMs);
}
function lastHeartbeat(row) {
  return row?.daemon?.heartbeatAt ?? row?.lastHeartbeatAt ?? null;
}
function daemonLiveness(record, now, lastHeartbeatAt = null) {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (heartbeatFresh(record, now)) return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  return { state: "down", since: record.heartbeatAt };
}
function worktreeLiveness(worktree, now) {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
}

// src/core/presence/marks.ts
import { existsSync, readFileSync as readFileSync2, statSync } from "node:fs";

// src/core/daemon/lock.ts
import { mkdirSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
var slices = new AsyncLocalStorage();
function rollback(db) {
  if (db.isTransaction) db.exec("ROLLBACK");
}
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/daemon/test-pause.ts
import { channel } from "node:diagnostics_channel";
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
  mkdirSync(dirname2(path), { recursive: true });
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

// src/core/daemon/terminate.ts
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
var TICKS_PER_SECOND = 100;
var COMMAND_CHARS = 120;
var PF_EXITING = 4;
function lifeOf(pid) {
  let text2;
  try {
    text2 = readFileSync(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  const fields = text2.slice(text2.lastIndexOf(")") + 2).split(" ");
  const zombie = fields[0] === "Z" || fields[0] === "X";
  const dying = zombie || (Number(fields[6]) & PF_EXITING) !== 0;
  const entry2 = {
    pid,
    ppid: Number(fields[1]),
    pgrp: Number(fields[2]),
    start: Number(fields[19])
  };
  return { ...entry2, dying, zombie, stopped: fields[0] === "T" || fields[0] === "t" };
}
async function commandLine(pid) {
  try {
    const text2 = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
    return text2.length > COMMAND_CHARS ? `${text2.slice(0, COMMAND_CHARS - 3)}...` : text2;
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

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/presence/once.ts
function once(read4) {
  let value = null;
  return () => {
    value ??= { v: read4() };
    return value.v;
  };
}

// src/core/presence/marks.ts
function lockFileOf(row, orElse) {
  return row === null || row === void 0 ? orElse : lockFileFor(row.commonDir, row.id);
}
function startMarkFor(lockFile) {
  return `${lockFile}.starting`;
}
function spawnMarkFor(lockFile) {
  return `${lockFile}.spawned`;
}
function stopMarkFor(lockFile) {
  return `${lockFile}.stopped`;
}
function stopLockFor(lockFile) {
  return `${lockFile}.stopped.lock`;
}
function readStopFile(lockFile) {
  try {
    return stopMarkOf(JSON.parse(readFileSync2(stopMarkFor(lockFile), "utf8")));
  } catch {
    return null;
  }
}
function stopMarkOf(mark) {
  if (!isRecord(mark) || typeof mark.at !== "number") return null;
  return {
    at: mark.at,
    tree: typeof mark.tree === "string" ? mark.tree : null,
    ...mark.untilStart === true ? { untilStart: true } : {}
  };
}
function readLockMarks(lockFile, now) {
  return {
    start: once(() => {
      const pid = markedPid(lockFile);
      if (pid === null) return null;
      const since = writtenAt(startMarkFor(lockFile), now);
      return { pid, since, stopped: processStopped(pid) };
    }),
    spawnedAt: once(() => spawnedAt(lockFile))
  };
}
function startOf(marks, now, heartbeatAt = null) {
  const start = marks.start();
  if (start !== null) {
    const { since, pid, stopped } = start;
    return { kind: "locked", since, pid, ...stopped ? { stopped: true } : {} };
  }
  const at = marks.spawnedAt();
  if (at === null || Math.abs(now - at) > DAEMON_START_GRACE_MS) return null;
  return heartbeatAt !== null && heartbeatAt >= at ? null : { kind: "spawned", since: at };
}
function processStopped(pid, platform = process.platform, life = lifeOf) {
  return platform === "linux" && life(pid)?.stopped === true;
}
function spawnedAt(lockFile) {
  try {
    const mark = JSON.parse(readFileSync2(spawnMarkFor(lockFile), "utf8"));
    if (!isRecord(mark) || typeof mark.at !== "number" || !Number.isFinite(mark.at)) return null;
    return mark.at;
  } catch {
    return null;
  }
}
function lockFree(lockFile) {
  if (!existsSync(lockFile)) return false;
  try {
    const lock = acquireDaemonLock(lockFile);
    lock?.release();
    return lock !== null;
  } catch {
    return false;
  }
}
function markedPid(lockFile) {
  let mark;
  try {
    mark = JSON.parse(readFileSync2(startMarkFor(lockFile), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(mark)) return null;
  const { pid, startTime } = mark;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    const life = lifeOf(pid);
    return life !== null && !life.dying && life.start === startTime ? pid : null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return error.code === "EPERM" ? pid : null;
  }
}
function writtenAt(path, now) {
  try {
    return Math.floor(statSync(path).mtimeMs);
  } catch {
    return now;
  }
}

// src/core/presence/stored.ts
import { join as join3 } from "node:path";

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
  const kind = oneOf(row, "check_kind", ["test", "file", "setup"]);
  if (kind !== "test") return { kind, project, testPath };
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}
var OUTCOMES = ["pass", "fail", "skip"];
function toResult(row) {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", OUTCOMES),
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
var CHECK_WHERE = "project = ? AND test_path = ? AND kind = ? AND full_name = ?";
var CHECK_COLUMNS = "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";
function inTestFiles(column, files2) {
  if (files2.length === 0) return { sql: "0", params: [] };
  const values = files2.map(() => "(?, ?)").join(", ");
  return {
    sql: `${column} IN (SELECT id FROM checks WHERE (project, test_path) IN (VALUES ${values}))`,
    params: files2.flatMap((f) => [f.project, f.path])
  };
}
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
import { existsSync as existsSync2, rmSync } from "node:fs";
import { join as join2, resolve, sep } from "node:path";

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

// src/core/store/repos/meta-list.ts
function readMetaList(conn, key, guard) {
  const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
  if (row === null) return [];
  let value;
  try {
    value = JSON.parse(strOrNull(row, "value") ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(guard) : [];
}
function writeMetaList(conn, key, entries) {
  if (entries.length === 0) conn.run("DELETE FROM meta WHERE key = ?", key);
  else {
    conn.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      key,
      JSON.stringify(entries)
    );
  }
}

// src/core/store/repos/replaced.ts
var REPLACED_META_KEY = "replaced-failures";
var REPLACED_PER_CHECK = 4;
var REPLACED_KEPT = 1024;
var FAILING_AT = `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
  JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
  WHERE r.key = ? AND r.outcome = 'fail'`;
function failingAt(conn, key) {
  return conn.all(FAILING_AT, key).map((row) => ({ result: toResult(row), failureId: strOrNull(row, "failure_id") }));
}
function readReplaced(conn) {
  return readMetaList(conn, REPLACED_META_KEY, isEntry);
}
function keepReplaced(conn, failing, records, loadOf2) {
  if (failing.length === 0) return 0;
  const passes = new Map(
    records.filter((r) => r.outcome === "pass").map((r) => [identity(r.check), r])
  );
  const added = [];
  for (const { result, failureId } of failing) {
    const pass2 = passes.get(identity(result.check));
    if (pass2 === void 0 || pass2.key !== result.key) continue;
    added.push({
      check: result.check,
      key: result.key,
      provenance: result.provenance,
      durationMs: result.durationMs,
      location: result.location,
      fingerprint: result.fingerprint,
      summary: result.summary,
      failureId,
      loadPerCpu: loadOf2(result.provenance.runId),
      replacedBy: {
        runId: pass2.provenance.runId,
        worktreeId: pass2.provenance.worktreeId,
        recordedAt: pass2.provenance.recordedAt
      }
    });
  }
  if (added.length === 0) return 0;
  conn.transaction(
    () => writeMetaList(conn, REPLACED_META_KEY, capped([...readReplaced(conn), ...added]))
  );
  return added.length;
}
function expireReplaced(conn, cutoff) {
  const entries = readReplaced(conn);
  const kept2 = entries.filter((e) => e.provenance.recordedAt >= cutoff);
  if (kept2.length < entries.length) writeMetaList(conn, REPLACED_META_KEY, kept2);
  return entries.length - kept2.length;
}
function keptByReplaced(conn) {
  const entries = readReplaced(conn);
  return {
    runs: entries.map((e) => e.provenance.runId),
    texts: entries.flatMap((e) => e.failureId === null ? [] : [e.failureId])
  };
}
function capped(entries) {
  const seen = /* @__PURE__ */ new Set();
  const perCheck = /* @__PURE__ */ new Map();
  const kept2 = [];
  for (let i = entries.length - 1; i >= 0 && kept2.length < REPLACED_KEPT; i--) {
    const entry2 = entries[i];
    const check = identity(entry2.check);
    const id = JSON.stringify([check, entry2.key, entry2.provenance.runId]);
    const count2 = perCheck.get(check) ?? 0;
    if (seen.has(id) || count2 >= REPLACED_PER_CHECK) continue;
    seen.add(id);
    perCheck.set(check, count2 + 1);
    kept2.push(entry2);
  }
  return kept2.reverse();
}
function identity(check) {
  return JSON.stringify(checkParams(check));
}
function isEntry(value) {
  if (!isRecord(value) || !isRecord(value.check) || !isRecord(value.provenance)) return false;
  const { check, provenance: p, replacedBy: by } = value;
  return typeof check.project === "string" && typeof check.testPath === "string" && typeof check.kind === "string" && typeof value.key === "string" && typeof p.runId === "string" && typeof p.worktreeId === "string" && typeof p.revision === "number" && typeof p.recordedAt === "number" && typeof value.durationMs === "number" && (value.failureId === null || typeof value.failureId === "string") && (value.loadPerCpu === null || typeof value.loadPerCpu === "number") && isRecord(by) && typeof by.runId === "string" && typeof by.worktreeId === "string" && typeof by.recordedAt === "number";
}

// src/core/store/repos/unknown-runs.ts
var UNKNOWN_RUNS_META_KEY = "unknown-runs";
function readUnknownRuns(conn) {
  return readMetaList(conn, UNKNOWN_RUNS_META_KEY, isEntry2);
}
function recordUnknownRuns(conn, worktreeId, revision, marked2, at) {
  const added = marked2.flatMap(
    ({ testFiles: testFiles2, reason, runId }) => testFiles2.map((testFile) => ({ worktreeId, testFile, runId, revision, reason, at }))
  );
  if (added.length === 0) return;
  conn.transaction(() => {
    const ids = new Set(added.map(idOf));
    const kept2 = standing(conn, readUnknownRuns(conn)).filter((r) => !ids.has(idOf(r)));
    const newest = new Map(added.map((r) => [idOf(r), r]));
    writeMetaList(conn, UNKNOWN_RUNS_META_KEY, [...kept2, ...newest.values()]);
  });
}
var STANDS = `SELECT 1 FROM checks c CROSS JOIN known_states s
    ON s.worktree_id = ? AND s.check_id = c.id
  WHERE c.project = ? AND c.test_path = ? AND s.outcome = 'unknown'
    AND s.observed_at = ? AND s.summary = ? LIMIT 1`;
function dropFallenUnknownRuns(conn) {
  const records = readUnknownRuns(conn);
  const kept2 = standing(conn, records);
  if (kept2.length < records.length) writeMetaList(conn, UNKNOWN_RUNS_META_KEY, kept2);
  return records.length - kept2.length;
}
function hasFallenUnknownRuns(conn) {
  const records = readUnknownRuns(conn);
  return standing(conn, records).length < records.length;
}
function keptByUnknownRuns(conn) {
  return readUnknownRuns(conn).flatMap((r) => r.runId === null ? [] : [r.runId]);
}
function standing(conn, records) {
  return records.filter((r) => conn.get(STANDS, ...standsParams(r)) !== null);
}
function standsParams(r) {
  return [r.worktreeId, r.testFile.project, r.testFile.path, r.revision, r.reason];
}
function idOf(r) {
  return JSON.stringify([r.worktreeId, r.testFile.project, r.testFile.path]);
}
function isEntry2(value) {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return typeof value.worktreeId === "string" && typeof value.testFile.project === "string" && typeof value.testFile.path === "string" && (value.runId === null || typeof value.runId === "string") && typeof value.revision === "number" && typeof value.reason === "string" && typeof value.at === "number";
}

// src/core/store/prune-rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var EVICTION_BATCH = 32;
var DELETE_BATCH = 256;
var VACUUM_PAGES = 8;
var VACUUM_SLICE_MS = 100;
var LIST_DELETE_BATCH = 32;
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
var UNREFERENCED_RUN = `NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
  AND id NOT IN (SELECT value FROM json_each(?))`;
function keptRuns(conn) {
  return JSON.stringify([...keptByReplaced(conn).runs, ...keptByUnknownRuns(conn)]);
}
var LAST_COMPLETED_CHECKPOINTS = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM checkpoints x
            WHERE x.worktree_id = w.id AND x.end_state = 'completed'
            ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1) AS id
    FROM worktrees w
  ) WHERE id IS NOT NULL`;

// src/core/store/prune-keyed.ts
function* deleteByKey(conn, rule) {
  const batch = rule.batch ?? DELETE_BATCH;
  const columns = rule.key.join(", ");
  const after = rule.key.map(() => "?").join(", ");
  const read4 = (from) => `SELECT ${columns} FROM ${rule.table}
     WHERE ${from ? `(${columns}) > (${after}) AND ` : ""}(${rule.search})
     ORDER BY ${columns} LIMIT ${batch}`;
  const first = read4(false);
  const next = read4(true);
  const named2 = rule.key.map((_, i) => `value ->> ${i}`).join(", ");
  const remove = `DELETE FROM ${rule.table}
    WHERE (${columns}) IN (SELECT ${named2} FROM json_each(?)) AND (${rule.recheck ?? rule.search})`;
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
function hasIndexes(conn, ...names3) {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?";
  return names3.every((name2) => conn.get(sql, name2) !== null);
}

// src/core/store/loaded-modules.ts
var LOADED_MODULES_TABLE = "loaded_modules";
function* emptyLoadedModules(conn) {
  if (!conn.read(() => hasLoadedModulesTable(conn))) return;
  const deletes = deleteByKey(conn, {
    table: LOADED_MODULES_TABLE,
    key: ["project", "path", "key"],
    search: "1",
    batch: LIST_DELETE_BATCH
  });
  yield* checkpointAfterWrites(conn, deletes);
}
function hasLoadedModulesTable(conn) {
  const sql = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?";
  return conn.get(sql, LOADED_MODULES_TABLE) !== null;
}

// src/core/store/prune-unused.ts
var PRUNABLE_BY_KEY = `NOT EXISTS (SELECT 1 FROM test_file_keys k
    JOIN worktrees w ON w.id = k.worktree_id WHERE k.key = results.key)
  AND NOT (EXISTS (SELECT 1 FROM worktrees m WHERE m.id = results.worktree_id AND m.is_main = 1)
    AND NOT EXISTS (SELECT 1 FROM results n JOIN worktrees m ON m.id = n.worktree_id AND m.is_main = 1
      WHERE n.check_id = results.check_id
        AND (n.recorded_at > results.recorded_at
             OR (n.recorded_at = results.recorded_at AND n.rowid > results.rowid))))
  AND recorded_at < ?`;
function dropEndedCheckpoints(conn, cutoff, counts) {
  return deleteByKey(conn, {
    table: "checkpoints",
    key: ["id"],
    search: `id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
      AND (worktree_id NOT IN (SELECT id FROM worktrees)
           OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
    searchParams: [cutoff],
    recheck: `NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
      AND CASE WHEN EXISTS (SELECT 1 FROM worktrees w WHERE w.id = checkpoints.worktree_id)
        THEN id IS NOT (SELECT x.id FROM checkpoints x
               WHERE x.worktree_id = checkpoints.worktree_id AND x.end_state = 'completed'
               ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1)
             AND end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?
        ELSE 1 END`,
    recheckParams: () => [cutoff],
    removed: (n) => {
      counts.checkpointsRemoved += n;
    }
  });
}
function* dropUnusedChecks(conn, counts) {
  if (!conn.read(() => hasIndexes(conn, "consumer_views_by_check"))) return;
  yield* deleteByKey(conn, {
    table: "checks",
    key: ["id"],
    search: `id NOT IN (
      SELECT check_id FROM results UNION SELECT check_id FROM known_states
      UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`,
    recheck: `NOT EXISTS (SELECT 1 FROM results r WHERE r.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM known_states s
        WHERE s.worktree_id IN (SELECT value FROM json_each(?)) AND s.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM transitions t
        WHERE t.worktree_id IN (SELECT value FROM json_each(?)) AND t.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM consumer_views v WHERE v.check_id = checks.id)`,
    recheckParams: () => [
      worktreeIdList(conn, "known_states"),
      worktreeIdList(conn, "transitions")
    ],
    removed: (n) => {
      counts.checksRemoved += n;
    }
  });
}
function dropOrphanTexts(conn) {
  return deleteByKey(conn, {
    table: "failure_texts",
    key: ["id"],
    search: `id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)
      AND id NOT IN (SELECT value FROM json_each(?))`,
    searchParams: [keptTexts(conn)],
    recheck: `NOT EXISTS (SELECT 1 FROM results r WHERE r.failure_id = failure_texts.id)
      AND id NOT IN (SELECT value FROM json_each(?))`,
    recheckParams: () => [keptTexts(conn)]
  });
}
function keptTexts(conn) {
  return JSON.stringify(keptByReplaced(conn).texts);
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
var tokenKey = (id) => worktreeMetaKey("daemonToken", id);
function toDaemonToken(value, startedAt, version) {
  if (!isRecord(value) || typeof value.token !== "string") return void 0;
  return value.startedAt === startedAt && value.squealVersion === version ? value.token : null;
}
function createWorktreeRepo(conn) {
  const tokenRowOf = (id, startedAt, version) => {
    const raw = conn.get("SELECT value FROM meta WHERE key = ?", tokenKey(id));
    if (raw === null) return void 0;
    try {
      const value = JSON.parse(str(raw, "value"));
      const token2 = toDaemonToken(value, startedAt, version);
      if (token2 === null || token2 === void 0) return void 0;
      const executable = isRecord(value) ? value.executable : void 0;
      return typeof executable === "string" ? { token: token2, executable } : { token: token2 };
    } catch {
      return void 0;
    }
  };
  const tokenOf = (id, startedAt, version) => tokenRowOf(id, startedAt, version)?.token;
  const writeToken = (id, d) => {
    if (d.token === void 0) {
      conn.run("DELETE FROM meta WHERE key = ?", tokenKey(id));
      return;
    }
    const value = {
      startedAt: d.startedAt,
      squealVersion: d.squealVersion,
      token: d.token,
      ...d.executable === void 0 ? {} : { executable: d.executable }
    };
    conn.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      tokenKey(id),
      JSON.stringify(value)
    );
  };
  const toRecord2 = (row) => {
    const record = fromRow(row);
    const d = record.daemon;
    const token2 = d === null ? void 0 : tokenRowOf(record.id, d.startedAt, d.squealVersion);
    return token2 === void 0 || d === null ? record : { ...record, daemon: { ...d, ...token2 } };
  };
  return {
    get: (id) => {
      const row = conn.get("SELECT * FROM worktrees WHERE id = ?", id);
      return row === null ? null : toRecord2(row);
    },
    list: () => conn.all("SELECT * FROM worktrees ORDER BY id").map(toRecord2),
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
        d?.heartbeatAt ?? record.lastHeartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null
      );
      if (d !== null) writeToken(record.id, d);
    },
    // Clearing keeps `daemon_heartbeat_at`: the last heartbeat (review wave 4.5, N5). It keeps
    // the start time and version too, and the token row, the identity `lastDaemon` reads (tasks
    // 001-268, 001-270); with no
    // socket every other read finds no daemon.
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?,
           daemon_started_at = COALESCE(?, daemon_started_at),
           daemon_heartbeat_at = COALESCE(?, daemon_heartbeat_at),
           daemon_heartbeat_interval_ms = ?,
           daemon_version = COALESCE(?, daemon_version) WHERE id = ?`,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
        id
      );
      if (d !== null) writeToken(id, d);
    },
    heartbeat: (id, at) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at,
        id
      );
    },
    lastDaemon: (id) => {
      const row = conn.get(
        "SELECT daemon_started_at, daemon_version FROM worktrees WHERE id = ?",
        id
      );
      const startedAt = row === null ? null : numOrNull(row, "daemon_started_at");
      if (row === null || startedAt === null) return null;
      const squealVersion2 = strOrNull(row, "daemon_version");
      const token2 = tokenOf(id, startedAt, squealVersion2);
      return { startedAt, squealVersion: squealVersion2, ...token2 === void 0 ? {} : { token: token2 } };
    },
    remove: (id) => {
      conn.transaction(() => {
        conn.run("DELETE FROM worktrees WHERE id = ?", id);
        for (const table of WORKTREE_SCOPED_TABLES) {
          conn.run(`DELETE FROM ${table} WHERE worktree_id = ?`, id);
        }
        for (const row of Object.keys(WORKTREE_META_ROWS)) {
          conn.run("DELETE FROM meta WHERE key = ?", worktreeMetaKey(row, id));
        }
      });
    }
  };
}
function fromRow(row) {
  const socketPath = strOrNull(row, "daemon_socket");
  const lastHeartbeatAt = numOrNull(row, "daemon_heartbeat_at");
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
    },
    ...socketPath === null && lastHeartbeatAt !== null ? { lastHeartbeatAt } : {}
  };
}

// src/core/store/prune.ts
function prune(conn, worktrees, paths, options) {
  const counts = noneRemoved();
  for (const slice of pruneSlices(conn, worktrees, paths, options, counts)) slice();
  return pruneReport(conn, counts);
}
function noneRemoved() {
  return {
    resultsRemoved: 0,
    runsRemoved: 0,
    checkpointsRemoved: 0,
    checksRemoved: 0,
    worktreesRemoved: 0
  };
}
function pruneReport(conn, counts) {
  return {
    ...counts,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size")
  };
}
function* pruneSlices(conn, worktrees, paths, options, counts) {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  for (const worktree of worktrees.list()) {
    if (!isGone(worktree.root)) continue;
    yield* removeWorktree(conn, worktrees, worktree, counts);
  }
  yield* writeIf(
    conn,
    () => readReplaced(conn).some((entry2) => entry2.provenance.recordedAt < cutoff),
    () => expireReplaced(conn, cutoff)
  );
  yield* writeIf(
    conn,
    () => hasFallenUnknownRuns(conn),
    () => dropFallenUnknownRuns(conn)
  );
  yield* dropPrunable(conn, cutoff, counts);
  if (options.maxSizeMb !== null) {
    yield* evictToCap(conn, options.maxSizeMb * 1024 * 1024, counts);
  }
  yield* emptyLoadedModules(conn);
  yield* dropRuns(conn, paths, cutoff, counts);
  yield* dropEndedCheckpoints(conn, cutoff, counts);
  yield* dropUnusedChecks(conn, counts);
  yield* vacuum(conn);
}
function* writeIf(conn, needed, write2) {
  let due = false;
  yield () => {
    due = conn.read(needed);
    return false;
  };
  if (due) yield () => conn.transaction(write2) > 0;
}
function isGone(root) {
  return !existsSync2(join2(root, ".git"));
}
var BATCH_KEYS = {
  // `WITHOUT ROWID`, keyed by `(worktree_id, path)`.
  file_hashes: "path"
};
function* removeWorktree(conn, worktrees, worktree, counts) {
  for (const table of WORKTREE_SCOPED_TABLES) {
    const key = BATCH_KEYS[table] ?? "rowid";
    let removed = DELETE_BATCH;
    while (removed === DELETE_BATCH) {
      removed = 0;
      yield () => {
        if (!isGone(worktree.root)) return false;
        removed = conn.transaction(
          () => conn.run(
            `DELETE FROM ${table} WHERE worktree_id = ? AND ${key} IN (
               SELECT ${key} FROM ${table} WHERE worktree_id = ? LIMIT ?)`,
            worktree.id,
            worktree.id,
            DELETE_BATCH
          )
        );
        return removed > 0;
      };
    }
  }
  yield () => {
    if (!isGone(worktree.root)) return;
    worktrees.remove(worktree.id);
    counts.worktreesRemoved++;
  };
}
function* dropRuns(conn, paths, cutoff, counts) {
  const DROPPABLE = `${UNREFERENCED_RUN}
    AND (worktree_id NOT IN (SELECT id FROM worktrees)
         OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))`;
  const ids = conn.read(() => conn.all(`SELECT id FROM runs WHERE ${DROPPABLE}`, keptRuns(conn), cutoff)).map((row) => str(row, "id"));
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    yield () => {
      const dropped = conn.transaction(
        () => conn.all(
          `DELETE FROM runs WHERE id IN (SELECT value FROM json_each(?)) AND ${DROPPABLE}
           RETURNING log_dir`,
          batch,
          keptRuns(conn),
          cutoff
        )
      );
      for (const row of dropped) removeRunLog(paths, str(row, "log_dir"));
      counts.runsRemoved += dropped.length;
      return dropped.length > 0;
    };
  }
}
function* dropPrunable(conn, cutoff, counts) {
  const ids = conn.read(() => conn.all(`SELECT rowid AS id FROM results WHERE ${PRUNABLE}`, cutoff)).map((row) => num(row, "id"));
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    yield () => {
      const n = conn.transaction(
        () => conn.run(
          `DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND ${PRUNABLE_BY_KEY}`,
          batch,
          cutoff
        )
      );
      counts.resultsRemoved += n;
      return n > 0;
    };
  }
  yield* dropOrphanTexts(conn);
}
function* evictToCap(conn, capBytes, counts) {
  const tiers = [UNPROTECTED, `key NOT IN (${LIVE_KEYS})`];
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      let batch = 0;
      yield () => {
        batch = conn.transaction(() => {
          const n = conn.run(
            `DELETE FROM results WHERE rowid IN (
               SELECT rowid FROM results WHERE ${tier} ORDER BY last_used_at, rowid LIMIT ?)`,
            EVICTION_BATCH
          );
          dropOrphanFailureTexts(conn);
          return n;
        });
        counts.resultsRemoved += batch;
        return batch > 0;
      };
      if (batch === 0) break;
    }
  }
}
function dropOrphanFailureTexts(conn) {
  conn.run(
    `DELETE FROM failure_texts
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)
       AND id NOT IN (SELECT value FROM json_each(?))`,
    keptTexts(conn)
  );
}
function usedBytes(conn) {
  const pages = pragmaNumber(conn, "page_count") - pragmaNumber(conn, "freelist_count");
  return pages * pragmaNumber(conn, "page_size");
}
function pragmaNumber(conn, name2) {
  const row = conn.get(`PRAGMA ${name2}`);
  if (row === null) throw new Error(`squeal store: PRAGMA ${name2} returned nothing`);
  return num(row, name2);
}
function removeRunLog(paths, logDir) {
  const runsDir = resolve(paths.runsDir);
  const target = resolve(logDir);
  if (target.startsWith(runsDir + sep)) rmSync(target, { recursive: true, force: true });
}

// src/core/store/repos/consumers.ts
var OUTCOMES2 = ["pass", "fail", "skip", "unknown"];
var WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";
function consumerParams(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createConsumerRepo(conn) {
  const unregister = (consumer) => conn.transaction(() => {
    conn.run(`DELETE FROM consumer_views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    conn.run(`DELETE FROM consumers WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
  });
  const idleSince = (cutoff) => conn.all(
    `SELECT * FROM consumers
         WHERE last_seen_at < ? AND coalesce(last_delivered_at, 0) < ?
         ORDER BY worktree_id, session_id, agent_id`,
    cutoff,
    cutoff
  ).map(toConsumer);
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
     * on registration (row 005-106: the states that are not `pass` while the
     * store keeps birth marks, else every known state), so entries left by
     * an earlier registration of the same consumer are dropped.
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
      const expired = idleSince(cutoff).map((record) => record.consumer);
      for (const consumer of expired) unregister(consumer);
      return expired;
    }),
    idleSince
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
    list: (consumer, files2) => {
      const only = files2 === void 0 ? null : inTestFiles("v.check_id", files2);
      return conn.all(
        `SELECT v.*, ${CHECK_COLUMNS} FROM consumer_views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ?
             ${only === null ? "" : `AND ${only.sql}`}
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
        ...consumerParams(consumer),
        ...only?.params ?? []
      ).map(toView);
    },
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
    outcome: oneOf(row, "outcome", OUTCOMES2),
    fingerprint: strOrNull(row, "fingerprint"),
    toldAt: num(row, "told_at")
  };
}

// src/core/store/repos/failures.ts
var FAILING_ROWS = `results r INDEXED BY results_by_failure CROSS JOIN checks c ON c.id = r.check_id`;
function rowWhere(alias, { worktreeId, since, errors = [] }) {
  const sql = [`${alias}.failure_id IS NOT NULL`, `${alias}.outcome = 'fail'`];
  const params = [];
  if (worktreeId !== null) {
    sql.push(`${alias}.worktree_id = ?`);
    params.push(worktreeId);
  }
  if (since !== null) {
    sql.push(`${alias}.recorded_at >= ?`);
    params.push(since);
  }
  if (errors.length > 0) {
    sql.push(`EXISTS (SELECT 1 FROM json_each(?) e JOIN failure_texts t
      ON t.id = ${alias}.failure_id WHERE instr(t.summary, e.value) > 0)`);
    params.push(JSON.stringify(errors));
  }
  return { sql, params };
}
function where(selection) {
  const { paths, checks } = selection;
  const { sql, params } = rowWhere("r", selection);
  if (paths.length > 0) {
    sql.push(`EXISTS (SELECT 1 FROM json_each(?) p WHERE c.test_path = p.value
      OR substr(c.test_path, 1, length(p.value) + 1) = p.value || '/')`);
    params.push(JSON.stringify(paths));
  }
  if (checks !== null) {
    sql.push(`r.check_id IN (SELECT k.id FROM json_each(?) j JOIN checks k
      ON k.project = json_extract(j.value, '$[0]') AND k.test_path = json_extract(j.value, '$[1]')
      AND k.kind = json_extract(j.value, '$[2]') AND k.full_name = json_extract(j.value, '$[3]'))`);
    params.push(JSON.stringify(checks.map(checkParams)));
  }
  if (selection.perCheck === true) {
    const newer = rowWhere("n", selection);
    sql.push(`NOT EXISTS (SELECT 1 FROM results n WHERE n.check_id = r.check_id
      AND (n.recorded_at > r.recorded_at OR (n.recorded_at = r.recorded_at AND n.rowid > r.rowid))
      AND ${newer.sql.join(" AND ")})`);
    params.push(...newer.params);
  }
  return { sql: sql.join(" AND "), params };
}
var FAILURE_STATEMENTS = {
  list: (selection, limit) => {
    const w = where(selection);
    return {
      sql: `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM ${FAILING_ROWS}
        LEFT JOIN failure_texts f ON f.id = r.failure_id
        WHERE ${w.sql} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
      params: [...w.params, limit]
    };
  },
  count: (selection) => {
    const w = where(selection);
    return { sql: `SELECT COUNT(*) AS n FROM ${FAILING_ROWS} WHERE ${w.sql}`, params: w.params };
  },
  failingChecks: (selection) => {
    const w = where(selection);
    return {
      sql: `SELECT DISTINCT ${CHECK_COLUMNS} FROM ${FAILING_ROWS} WHERE ${w.sql}
        ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      params: w.params
    };
  }
};
function createFailureRepo(conn) {
  const all = ({ sql, params }) => conn.all(sql, ...params);
  return {
    list: (selection, limit) => all(FAILURE_STATEMENTS.list(selection, limit)).map(toResult),
    count: (selection) => num(all(FAILURE_STATEMENTS.count(selection))[0] ?? { n: 0 }, "n"),
    failingChecks: (selection) => all(FAILURE_STATEMENTS.failingChecks(selection)).map(checkFrom),
    failingAt: (key) => failingAt(conn, key),
    keepReplaced: (failing, records, loadOf2) => keepReplaced(conn, failing, records, loadOf2),
    replaced: () => readReplaced(conn),
    text: (id) => {
      const row = conn.get("SELECT summary, errors FROM failure_texts WHERE id = ?", id);
      return row === null ? null : { summary: strOrNull(row, "summary"), errors: json(row, "errors") };
    },
    recordUnknownRuns: (worktreeId, revision, marked2, at) => recordUnknownRuns(conn, worktreeId, revision, marked2, at),
    unknownRuns: (worktreeId) => readUnknownRuns(conn).filter((r) => r.worktreeId === worktreeId)
  };
}

// src/core/store/repos/results.ts
import { createHash } from "node:crypto";
var SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
var KEYS_SINCE = `
  SELECT key, MAX(recorded_at) AS recorded_at FROM results INDEXED BY results_by_time
  WHERE recorded_at > ? GROUP BY key`;
var KEYS_WITH_RESULTS = `
  SELECT value AS key FROM json_each(?)
  WHERE EXISTS (SELECT 1 FROM results WHERE key = value)`;
var KEYS_WITH_RESULTS_CHUNK = 1e3;
var NEWEST_OF_FILE = `${SELECT_RESULTS}
  WHERE c.project = ? AND c.test_path = ? AND r.key = (
    SELECT r2.key FROM checks c2 JOIN results r2 ON r2.check_id = c2.id
    WHERE c2.project = ? AND c2.test_path = ?
    ORDER BY r2.recorded_at DESC, r2.rowid DESC LIMIT 1)
  ORDER BY c.kind, c.full_name`;
var COPY_SET = `
  INSERT INTO results (check_id, key, outcome, duration_ms, location_path, location_line,
    location_column, fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id,
    recorded_at, last_used_at)
  SELECT check_id, ?, outcome, duration_ms, location_path, location_line, location_column,
    fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id, recorded_at,
    last_used_at
  FROM results WHERE key = ? AND NOT EXISTS (SELECT 1 FROM results WHERE key = ?)`;
var RESULT_TOUCH_INTERVAL_MS = 36e5;
function createResultRepo(conn) {
  return {
    byKey: (key, usedAt = Date.now()) => {
      if (usedAt > 0) {
        conn.run(
          "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
          usedAt,
          key,
          Math.max(0, usedAt - RESULT_TOUCH_INTERVAL_MS)
        );
      }
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
    newestForTestFile: ({ project, path }) => conn.all(NEWEST_OF_FILE, project, path, project, path).map(toResult),
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
    copyNewest: (key, from) => {
      if (from.length === 0) return false;
      const newest = conn.get(
        `SELECT key FROM results WHERE key IN (${from.map(() => "?").join(", ")})
         GROUP BY key ORDER BY MAX(recorded_at) DESC, key LIMIT 1`,
        ...from
      );
      if (newest === null) return false;
      return conn.run(COPY_SET, key, str(newest, "key"), key) > 0;
    },
    keysSince: (since) => conn.all(KEYS_SINCE, since).map((row) => ({ key: str(row, "key"), recordedAt: num(row, "recorded_at") })),
    keysWithResults: (keys) => {
      const unique = [...new Set(keys)];
      const found2 = [];
      for (let i = 0; i < unique.length; i += KEYS_WITH_RESULTS_CHUNK) {
        const chunk = JSON.stringify(unique.slice(i, i + KEYS_WITH_RESULTS_CHUNK));
        for (const row of conn.all(KEYS_WITH_RESULTS, chunk)) found2.push(str(row, "key"));
      }
      return found2;
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
  const text2 = JSON.stringify(errors);
  const id = createHash("sha256").update(JSON.stringify([summary, text2])).digest("hex");
  conn.run(
    "INSERT INTO failure_texts (id, summary, errors) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    id,
    summary,
    text2
  );
  return id;
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
    },
    inFlight: (worktreeId, startedSince) => conn.all(
      `SELECT * FROM runs WHERE worktree_id = ? AND end_state IS NULL AND started_at >= ?
           ORDER BY started_at, rowid`,
      worktreeId,
      startedSince
    ).map(toRun)
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
  const lanes = (worktreeId) => readLanes(conn, worktreeId);
  const withLane = (row) => {
    const record = toCheckpoint(row);
    const lane = lanes(record.worktreeId)[record.id];
    return lane === void 0 ? record : { ...record, lane };
  };
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
      if (record.lane !== void 0) writeLane(conn, record.worktreeId, record.id, record.lane);
      return { ...record, completedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE checkpoints SET end_state = ?, completed_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM checkpoints WHERE id = ?", id);
      return row === null ? null : withLane(row);
    },
    lastCompleted: (worktreeId) => {
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId
      );
      return row === null ? null : withLane(row);
    },
    lastCompletedFull: (worktreeId) => {
      const oneLane = Object.keys(lanes(worktreeId));
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
           AND id NOT IN (SELECT value FROM json_each(?))
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId,
        JSON.stringify(oneLane)
      );
      return row === null ? null : toCheckpoint(row);
    }
  };
}
function readLanes(conn, worktreeId) {
  const row = conn.get(
    "SELECT value FROM meta WHERE key = ?",
    worktreeMetaKey("checkpointLanes", worktreeId)
  );
  if (row === null) return {};
  try {
    return toCheckpointLanes(JSON.parse(str(row, "value"))) ?? {};
  } catch {
    return {};
  }
}
function toCheckpointLanes(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const lanes = {};
  for (const [id, lane] of Object.entries(value)) {
    if (lane === "fast" || lane === "slow") lanes[id] = lane;
  }
  return lanes;
}
function writeLane(conn, worktreeId, id, lane) {
  const lanes = readLanes(conn, worktreeId);
  const live = new Set(
    conn.all(
      "SELECT id FROM checkpoints WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(Object.keys(lanes))
    ).map((row) => str(row, "id"))
  );
  const kept2 = Object.entries(lanes).filter(([id2]) => live.has(id2));
  conn.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    worktreeMetaKey("checkpointLanes", worktreeId),
    JSON.stringify(Object.fromEntries([...kept2, [id, lane]]))
  );
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

// src/core/types/state.ts
var IMPORT_MARK = "import:";
function importMark(importId) {
  return `${IMPORT_MARK}${importId}`;
}
function importIdOf(worktreeId) {
  return worktreeId.startsWith(IMPORT_MARK) ? worktreeId.slice(IMPORT_MARK.length) : null;
}
function originWorktree(origin) {
  if (origin.kind === "own") return null;
  return origin.kind === "inherited" ? origin.worktreeId : importMark(origin.importId);
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
    list: (worktreeId, files2) => {
      const only = files2 === void 0 ? null : inTestFiles("s.check_id", files2);
      return conn.all(
        `${SELECT_STATES} WHERE s.worktree_id = ? ${only === null ? "" : `AND ${only.sql}`}
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
        worktreeId,
        ...only?.params ?? []
      ).map(toKnownState);
    },
    untold: (consumer) => conn.all(
      `${SELECT_STATES} WHERE s.worktree_id = ? AND NOT EXISTS (
             SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
               AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      consumer.worktreeId,
      consumer.sessionId,
      consumer.agentId
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
          storedKind(origin),
          origin === null ? null : originWorktree(origin),
          origin === null || origin.kind === "own" ? null : origin.commit,
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
function storedKind(origin) {
  return origin === null || origin.kind === "imported" ? null : origin.kind;
}
function toOrigin(row) {
  const stored3 = strOrNull(row, "origin_kind");
  const kind = stored3 === "own" || stored3 === "inherited" ? stored3 : null;
  if (stored3 !== null && kind === null) return null;
  if (kind === null) {
    const marked2 = strOrNull(row, "origin_worktree");
    const importId = marked2 === null ? null : importIdOf(marked2);
    if (importId === null) return null;
    return { kind: "imported", importId, commit: strOrNull(row, "origin_commit") };
  }
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
    list: (worktreeId, files2) => {
      if (files2?.length === 0) return [];
      const only = files2 === void 0 ? "" : `AND (project, path) IN (VALUES ${files2.map(() => "(?, ?)").join(", ")})`;
      return conn.all(
        `SELECT * FROM test_file_keys WHERE worktree_id = ? ${only} ORDER BY project, path`,
        worktreeId,
        ...(files2 ?? []).flatMap((f) => [f.project, f.path])
      ).map(toTestFileKey);
    },
    withKey: (key) => conn.all("SELECT * FROM test_file_keys WHERE key = ? ORDER BY worktree_id, project, path", key).map(toTestFileKey),
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
    remove: (worktreeId, testFiles2) => conn.transaction(() => {
      for (const t of testFiles2) {
        conn.run(
          "DELETE FROM test_file_keys WHERE worktree_id = ? AND project = ? AND path = ?",
          worktreeId,
          t.project,
          t.path
        );
      }
    }),
    releaseRunning: (worktreeId) => {
      conn.run(
        "UPDATE test_file_keys SET pending = 'queued' WHERE worktree_id = ? AND pending = 'running'",
        worktreeId
      );
    },
    claimed: (worktreeId, key, live) => conn.get(
      `SELECT 1 AS one FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
         WHERE k.key = ? AND k.pending = 'running' AND k.worktree_id <> ? AND ${LIVE} LIMIT 1`,
      key,
      worktreeId,
      live.now,
      live.graceIntervals
    ) !== null,
    sharers: (worktreeId, live) => {
      const row = conn.get(
        `SELECT COUNT(DISTINCT k.worktree_id) AS n FROM test_file_keys own
         JOIN test_file_keys k ON k.key = own.key AND k.worktree_id <> own.worktree_id
         JOIN worktrees w ON w.id = k.worktree_id
         WHERE own.worktree_id = ? AND own.pending = 'queued' AND k.pending IS NOT NULL AND ${LIVE}`,
        worktreeId,
        live.now,
        live.graceIntervals
      );
      return row === null ? 0 : num(row, "n");
    }
  };
}
var LIVE = `w.daemon_socket IS NOT NULL
  AND w.daemon_heartbeat_at >= ? - ? * w.daemon_heartbeat_interval_ms`;
function toTestFileKey(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    testFile: { project: str(row, "project"), path: str(row, "path") },
    key: strOrNull(row, "key"),
    revision: num(row, "revision"),
    pending: oneOfOrNull(row, "pending", PENDING2)
  };
}
function isProjectRunner(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.project === "string" && typeof v.runner === "string";
}
function createCheckRepo(conn) {
  const runners = (worktreeId) => new Map(
    readMetaList(conn, worktreeMetaKey("runners", worktreeId), isProjectRunner).map((e) => [
      e.project,
      e.runner
    ])
  );
  const recordRunners = (worktreeId, named2) => {
    const kept2 = runners(worktreeId);
    let changed = false;
    for (const [project, runner] of named2) {
      if (runner === void 0 || kept2.get(project) === runner) continue;
      kept2.set(project, runner);
      changed = true;
    }
    if (!changed) return;
    const entries = [...kept2].map(([project, runner]) => ({ project, runner }));
    writeMetaList(conn, worktreeMetaKey("runners", worktreeId), entries);
  };
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
    }),
    runnersOf: runners,
    recordRunners
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
      const stored3 = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
      conn.run(
        `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        stored3.worktreeId,
        stored3.number,
        stored3.createdAt,
        stored3.head,
        flag(stored3.dirty),
        stored3.trigger,
        JSON.stringify(stored3.changes)
      );
      return stored3;
    }),
    latest: (worktreeId) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? ORDER BY number DESC LIMIT 1",
        worktreeId
      );
      return row === null ? null : toRevision(row);
    },
    lastAtOtherHead: (worktreeId, head) => {
      const row = conn.get(
        `SELECT number FROM revisions WHERE worktree_id = ? AND head IS NOT ?
         ORDER BY number DESC LIMIT 1`,
        worktreeId,
        head
      );
      return row === null ? null : num(row, "number");
    },
    get: (worktreeId, number) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? AND number = ?",
        worktreeId,
        number
      );
      return row === null ? null : toRevision(row);
    },
    range: (worktreeId, after, upTo) => conn.all(
      `SELECT * FROM revisions WHERE worktree_id = ? AND number > ? AND number <= ?
           ORDER BY number`,
      worktreeId,
      after,
      upTo
    ).map(toRevision)
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

// src/core/store/store.ts
var connections = /* @__PURE__ */ new WeakMap();
function connectionOf(store) {
  const conn = connections.get(store);
  if (conn === void 0) throw new Error("squeal store: not opened by openStore");
  return conn;
}
var CONNECTION = /* @__PURE__ */ Symbol("squeal.connection");
function readTransaction(store, fn) {
  const conn = store[CONNECTION];
  if (conn === void 0) throw new Error("squeal store: not opened by openStore");
  return conn.read(fn);
}
function changeMarker(store) {
  const conn = store[CONNECTION];
  if (conn === void 0) return null;
  const row = conn.get(
    "SELECT data_version AS others, total_changes() AS own FROM pragma_data_version"
  );
  if (row === null) throw new Error("squeal store: no data_version");
  return { others: num(row, "others"), own: num(row, "own") };
}
var STORE_PATHS = /* @__PURE__ */ Symbol("squeal.storePaths");
function storePathsOf(store) {
  return store[STORE_PATHS] ?? null;
}
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
    failures: createFailureRepo(conn),
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
  Object.defineProperty(store, CONNECTION, { value: conn });
  Object.defineProperty(store, STORE_PATHS, { value: paths });
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
    },
    delete: (key) => {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    }
  };
}

// src/core/presence/stored.ts
function daemonExitMetaKey(worktreeId) {
  return worktreeMetaKey("daemonExit", worktreeId);
}
function daemonRestMetaKey(worktreeId) {
  return worktreeMetaKey("daemonRest", worktreeId);
}
function readRest(store, worktreeId) {
  const rest = parsed(store.meta.get(daemonRestMetaKey(worktreeId)));
  if (!isRecord(rest) || typeof rest.at !== "number") return null;
  const spawnedAt2 = typeof rest.spawnedAt === "number" ? { spawnedAt: rest.spawnedAt } : {};
  return { at: rest.at, ...spawnedAt2 };
}
function stoppedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonStopped", worktreeId);
}
function readStop(store, worktreeId, lockFile) {
  const file = lockFile ?? stopLockFile(store, worktreeId);
  const inFile = file === null ? null : readStopFile(file);
  return inFile ?? readLegacyStop(store, worktreeId);
}
function readLegacyStop(store, worktreeId) {
  return stopMarkOf(parsed(store.meta.get(stoppedMetaKey(worktreeId))));
}
function stopLockFile(store, worktreeId) {
  const paths = storePathsOf(store);
  return paths === null ? null : join3(paths.locksDir, `${worktreeId}.sqlite`);
}
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;
function handoffMetaKey(worktreeId) {
  return worktreeMetaKey("daemonHandoff", worktreeId);
}
function handoffFrom(record) {
  return daemonIncarnation(record) ?? `${record.squealVersion}@${record.startedAt}`;
}
function readHandoff(store, worktreeId) {
  const text2 = store.meta.get(handoffMetaKey(worktreeId));
  if (text2 === null) return null;
  try {
    const claim = JSON.parse(text2);
    if (!isRecord(claim)) return null;
    const { from, to, at, boundAt, attempt } = claim;
    if (typeof from !== "string" || typeof to !== "string") return null;
    if (typeof at !== "number" || typeof boundAt !== "number") return null;
    const read4 = { from, to, at, boundAt };
    return typeof attempt === "string" ? { ...read4, attempt } : read4;
  } catch {
    return null;
  }
}
function liveHandoff(store, worktreeId, from, now) {
  const claim = readHandoff(store, worktreeId);
  return claim !== null && claim.from === from && now < claim.boundAt ? claim : null;
}
function shortHandoffMetaKey(worktreeId) {
  return worktreeMetaKey("daemonHandoffShort", worktreeId);
}
function readShortHandoff(store, worktreeId) {
  const text2 = store.meta.get(shortHandoffMetaKey(worktreeId));
  if (text2 === null) return null;
  try {
    const mark = JSON.parse(text2);
    if (!isRecord(mark)) return null;
    const { of, version, claimed, at } = mark;
    if (typeof of !== "string" || typeof version !== "string") return null;
    if (typeof claimed !== "string" || typeof at !== "number") return null;
    return { of, version, claimed, at };
  } catch {
    return null;
  }
}
function feedDeliveredMetaKey(worktreeId) {
  return worktreeMetaKey("feedDelivered", worktreeId);
}
function readFeedDelivered(store, worktreeId) {
  const raw = store.meta.get(feedDeliveredMetaKey(worktreeId));
  const at = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(at) ? at : null;
}
function parsed(text2) {
  if (text2 === null) return null;
  try {
    return JSON.parse(text2);
  } catch {
    return null;
  }
}

// src/core/presence/facts.ts
function readPresenceFacts(store, worktreeId, now, row, commonDir) {
  const worktree = once(() => row === void 0 ? store.worktrees.get(worktreeId) : row);
  const self = once(() => daemonIncarnation(worktree()?.daemon ?? null));
  const exitNote = once(() => {
    const incarnation = self();
    if (incarnation === null) return void 0;
    return readDaemonNotes(store, worktreeId).find((n) => n.exitOf === incarnation);
  });
  const lockFile = once(
    () => lockFileOf(
      worktree(),
      commonDir === void 0 ? void 0 : lockFileFor(commonDir, worktreeId)
    )
  );
  return {
    worktreeId,
    row: worktree,
    shutDown: once(() => {
      const incarnation = self();
      if (incarnation === null) return false;
      if (store.meta.get(daemonExitMetaKey(worktreeId)) === incarnation) return true;
      return exitNote() !== void 0;
    }),
    exitNoteAt: () => exitNote()?.at ?? null,
    claim: once(() => readHandoff(store, worktreeId)),
    short: once(() => readShortHandoff(store, worktreeId)),
    rest: once(() => readRest(store, worktreeId)),
    stop: once(() => readStop(store, worktreeId, lockFile())),
    feedDelivered: once(() => readFeedDelivered(store, worktreeId)),
    marks: once(() => {
      const file = lockFile();
      return file === void 0 ? null : readLockMarks(file, now);
    }),
    lockFree: once(() => {
      const file = lockFile();
      return file !== void 0 && lockFree(file);
    }),
    inFlight: once(() => {
      const w = worktree();
      const record = w?.daemon ?? null;
      if (w === null || record === null) return [];
      return store.runs.inFlight(w.id, record.startedAt).map((run2) => ({ id: run2.id, revision: run2.revision, testFiles: run2.testFiles }));
    })
  };
}
function restAfterHeartbeats(rest, row) {
  const heartbeat = lastHeartbeat(row) ?? Number.POSITIVE_INFINITY;
  return rest === null || rest.at < heartbeat ? null : rest;
}

// src/core/types/watcher.ts
var WATCHER_TIMINGS = {
  quietMs: 100,
  maxBatchMs: 500,
  reconcileIntervalMs: 3e4
};

// src/core/status/feed-late.ts
var FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;
function runnersHave(runners, start) {
  if (runners === void 0 || runners.length === 0) {
    return `${start ? "The" : "the"} test runner has`;
  }
  const last = runners.at(-1);
  if (runners.length === 1) return `${last} has`;
  return `${runners.slice(0, -1).join(", ")} and ${last} have`;
}
function unlisted({ revision, runners, files: files2 = "test files" }, start) {
  return `${runnersHave(runners, start)} not yet listed the test files of revision ${revision}, so new ${files2} are not counted`;
}
function unlistedText(what) {
  return `${unlisted(what, true)}.`;
}
function readWaitText(command) {
  return `\`${command} status --wait 60000 <path>...\` asks it to read them and waits for the files your paths select.`;
}
function listWaitText(command) {
  return `\`${command} status --wait 60000 <path>...\` waits until they are listed, then for the files your paths select.`;
}
function lateText(late, revision, command) {
  return `Squeal has not yet read edits made after ${utcTimeText(late.since)}; these results cover revision ${revision} and earlier. ${readWaitText(command)}`;
}
function behindText(late, revision, command, runners) {
  return `Squeal is behind: it has not read edits made after ${utcTimeText(late.since)}, and ${runnersHave(runners, false)} not listed revision ${revision}'s test files yet, so new test files are not counted. ${readWaitText(command)}`;
}
function delaysText(header, late, command) {
  const { revision } = header;
  const pending = header.runnerPartPending === true;
  if (late === void 0) {
    return pending ? unlistedText({ revision, runners: header.listingRunners }) : null;
  }
  return pending ? behindText(late, revision, command, header.listingRunners) : lateText(late, revision, command);
}
function lateOf(daemon) {
  return daemon?.state === "alive" ? daemon.late : void 0;
}

// src/core/presence/findings.ts
function liveOf(facts, at) {
  const row = facts.row();
  return daemonLiveness(row?.daemon ?? null, at, row?.lastHeartbeatAt ?? null);
}
function spawnStartCurrent(row, now, lockFile) {
  const file = lockFileOf(row, lockFile);
  if (file === void 0) return false;
  const marks = readLockMarks(file, now);
  return startCurrentOf(startOf(marks, now, lastHeartbeat(row)), row?.daemon ?? null);
}
function startCurrentOf(marks, record) {
  return marks?.kind === "locked" || marks?.kind === "spawned" && record === null;
}
function stopHeld(facts, at) {
  return heldStop(facts, liveOf(facts, at));
}
function heldStop(facts, heartbeat) {
  if (heartbeat.state === "alive") return null;
  const mark = facts.stop();
  if (mark === null || mark.untilStart === true) return mark;
  const last = lastHeartbeat(facts.row());
  return last !== null && last > mark.at ? null : mark;
}
function stoppingOf(facts, record, shutDown, heartbeat, marks, at) {
  if (facts.row() === null) return null;
  if (record === null) {
    const claim2 = facts.claim();
    if (claim2 === null || at >= claim2.boundAt) return null;
    const from = claim2.from.slice(0, Math.max(0, claim2.from.indexOf("@"))) || claim2.from;
    return { from, since: claim2.at, to: claim2.to, boundAt: claim2.boundAt, overdue: false };
  }
  if (!shutDown()) return null;
  if (heartbeat.state === "down") {
    const start = marks();
    if (start?.kind === "locked") return null;
    if (start === null && facts.lockFree()) return null;
  }
  const since = facts.exitNoteAt() ?? record.heartbeatAt;
  const claim = facts.claim();
  const handoff = claim !== null && claim.from === daemonIncarnation(record) ? claim : null;
  const boundAt = handoff?.boundAt ?? since + HANDOFF_BOUND_MS;
  return {
    from: record.squealVersion,
    since,
    ...handoff === null ? {} : { to: handoff.to, boundAt: handoff.boundAt },
    overdue: at >= boundAt
  };
}
function startOfMarks(record, down, stopping, marks) {
  if (!down) return null;
  const start = marks();
  if (start === null) return null;
  const mark = start.kind === "locked" ? "start" : "spawn";
  if (record === null) return stopping() === null ? { since: start.since, mark } : null;
  return start.kind === "locked" ? { since: start.since, mark } : null;
}
function restOf(facts, at) {
  const row = facts.row();
  if (row === null || row.daemon !== null) return null;
  const rest = restAfterHeartbeats(facts.rest(), row);
  if (rest === null) return null;
  const { spawnedAt: spawnedAt2 } = rest;
  if (spawnedAt2 === void 0) return { kind: "quiet" };
  return at - spawnedAt2 <= DAEMON_START_GRACE_MS ? { kind: "quiet", spawnedAt: spawnedAt2 } : { kind: "overdue" };
}
function shortOf(facts, record, shutDown, heartbeat) {
  if (heartbeat.state !== "alive" || record === null || shutDown()) return null;
  const mark = facts.short();
  if (mark === null || mark.of !== handoffFrom(record)) return null;
  const { of, version, claimed, at: since } = mark;
  return { of, version, claimed, since };
}
function lateOf2(facts, record, heartbeat, stopping, at) {
  if (heartbeat.state !== "alive" || record === null || stopping() !== null) return null;
  const since = facts.feedDelivered();
  if (since === null || since < record.startedAt || at - since <= FEED_LATE_MS) return null;
  return { since };
}

// src/core/presence/decide.ts
function readPresence(store, worktreeId, now, row, commonDir) {
  return decidePresence(readPresenceFacts(store, worktreeId, now, row, commonDir), now);
}
function decidePresence(facts, at) {
  const record = once(() => facts.row()?.daemon ?? null);
  const heartbeat = once(() => liveOf(facts, at));
  const down = () => heartbeat().state === "down";
  const shutDown = once(() => daemonIncarnation(record()) !== null && facts.shutDown());
  const marks = once(() => {
    const read4 = facts.marks();
    return read4 === null ? null : startOf(read4, at, lastHeartbeat(facts.row()));
  });
  const startCurrent2 = once(() => startCurrentOf(marks(), record()));
  const stop = once(() => heldStop(facts, heartbeat()));
  const stopped = once(() => !startCurrent2() && stop() !== null);
  const stopping = once(() => stoppingOf(facts, record(), shutDown, heartbeat(), marks, at));
  const start = once(() => startOfMarks(record(), down(), stopping, marks));
  const died = once(() => {
    if (!down() || record() === null || shutDown() || marks() !== null) return null;
    return facts.lockFree() ? { runs: facts.inFlight() } : null;
  });
  const rest = once(() => restOf(facts, at));
  const short = once(() => shortOf(facts, record(), shutDown, heartbeat()));
  const late = once(() => lateOf2(facts, record(), heartbeat(), stopping, at));
  const heartbeatLate = once(() => {
    const daemon = record();
    if (!down() || daemon === null || shutDown() || start() !== null || stopped()) return null;
    return died() === null ? { ageMs: heartbeatAge(daemon, at) } : null;
  });
  return {
    facts,
    at,
    get record() {
      return record();
    },
    get heartbeat() {
      return heartbeat();
    },
    get shutDown() {
      return shutDown();
    },
    get marks() {
      return marks();
    },
    get startCurrent() {
      return startCurrent2();
    },
    get stop() {
      return stop();
    },
    get stopped() {
      return stopped();
    },
    get stopping() {
      return stopping();
    },
    get start() {
      return start();
    },
    get rest() {
      return rest();
    },
    get short() {
      return short();
    },
    get late() {
      return late();
    },
    died,
    heartbeatLate
  };
}

// src/core/presence/told.ts
var STATES = /* @__PURE__ */ new Set([
  "validating",
  "stopping",
  "starting",
  "stopped by request",
  "resting",
  "heartbeat late",
  "gone"
]);
var NOTES = /* @__PURE__ */ new Set([
  "last one died",
  "handoff ended short",
  "change feed late",
  "start slow",
  "start stopped"
]);
function readTold(value) {
  if (value === "down") return "down";
  if (!isRecord(value)) return "alive";
  const { state, notes, short, startingSince } = value;
  if (typeof state === "string" && STATES.has(state)) {
    const said = Array.isArray(notes) ? notes.filter((n) => NOTES.has(n)) : [];
    return {
      state,
      notes: said,
      ...typeof short === "string" ? { short } : {}
    };
  }
  if (typeof short === "string") return { short };
  return typeof startingSince === "number" ? { startingSince } : "alive";
}
function alreadyTold(told, now) {
  if (typeof told === "object" && "state" in told) {
    const notes = now.notes.every((note) => told.notes.includes(note));
    return told.state === now.state && notes && (now.short === void 0 || told.short === now.short);
  }
  if (now.state !== "validating") return told === "down";
  if (now.short === void 0) return told !== "down";
  return typeof told === "object" && "short" in told && told.short === now.short;
}

// src/core/presence/views.ts
function headerView(p, told) {
  if (p.heartbeat.state === "alive") return aliveView(p, p.heartbeat);
  const rested = withRest(p, withStop(p, p.heartbeat));
  const live = withLateHeartbeat(p, withRecordFacts(p, rested));
  return withStartState(p, told === void 0 ? live : withToldStart(live, told, p.at));
}
function newsChange(p, told) {
  const live = withStartState(p, newsView(p, told));
  let forgetRest2 = false;
  if (live.state === "down" && live.stopped !== true) {
    if (live.startingSince !== void 0 && live.startSlow !== true && live.startStopped !== true) {
      return { change: null, forgetRest: forgetRest2 };
    }
    if (p.rest?.kind === "quiet" && live.startStopped !== true) return { change: null, forgetRest: forgetRest2 };
    forgetRest2 = p.rest?.kind === "overdue";
  }
  if (shortLate(live)) return { change: null, forgetRest: forgetRest2 };
  return { change: alreadyTold(told, toldOf(live)) ? null : live, forgetRest: forgetRest2 };
}
function shortLate(live) {
  return live.state === "down" && live.heartbeatLate !== void 0 && live.heartbeatLate.ageMs < LATE_HEARTBEAT_NEWS_MS;
}
function toldAtRegistration(live) {
  return shortLate(live) ? { state: "validating", notes: [] } : toldOf(live);
}
function withToldStart(live, told, at) {
  if (live.state === "alive" || typeof told !== "object" || !("startingSince" in told)) return live;
  if (live.startMark === "start") return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  const { heartbeatLate: _late, ...starting } = withoutStop(live);
  return { ...starting, startingSince };
}
function withStartState(p, live) {
  if (live.state !== "down" || live.startMark !== "start" || live.startingSince === void 0) {
    return live;
  }
  const marks = p.marks;
  if (marks?.kind === "locked" && marks.stopped === true) return { ...live, startStopped: true };
  return p.at - live.startingSince > DAEMON_START_SLOW_MS ? { ...live, startSlow: true } : live;
}
function withoutStop(live) {
  const { stopped: _stopped, untilStart: _untilStart, ...rest } = live;
  return rest;
}
function toldOf(live) {
  if (live.state === "alive") {
    const { short } = live;
    return short === void 0 ? { state: "validating", notes: [] } : { state: "validating", notes: ["handoff ended short"], short: short.of };
  }
  const died = live.died === void 0 ? [] : ["last one died"];
  if (live.stopping !== void 0) return { state: "stopping", notes: [] };
  if (stopOf(live) !== null) return { state: "stopped by request", notes: [] };
  if (live.startingSince !== void 0) {
    if (live.startStopped === true) return { state: "starting", notes: [...died, "start stopped"] };
    return { state: "starting", notes: live.startSlow === true ? [...died, "start slow"] : died };
  }
  if (live.resting === true) return { state: "resting", notes: [] };
  if (live.heartbeatLate !== void 0) return { state: "heartbeat late", notes: [] };
  return { state: "gone", notes: died };
}
function stopOf(live) {
  if (live?.state !== "down" || live.stopped !== true || live.startingSince !== void 0) {
    return null;
  }
  return live.untilStart === true ? "until-start" : "until-edit";
}
function aliveView(p, heartbeat, late = true) {
  let live = heartbeat;
  if (p.stopping !== null) live = { ...live, stopping: p.stopping };
  if (p.short !== null) live = { ...live, short: p.short };
  if (late && p.late !== null) live = { ...live, late: p.late };
  return live;
}
function withStop(p, live) {
  if (!p.stopped) return live;
  return { ...live, stopped: true, ...p.stop?.untilStart === true ? { untilStart: true } : {} };
}
function withRest(p, live) {
  if (live.stopped === true || p.rest?.kind !== "quiet") return live;
  const { spawnedAt: spawnedAt2 } = p.rest;
  return spawnedAt2 === void 0 ? { ...live, resting: true } : { ...live, startingSince: spawnedAt2 };
}
function withRecordFacts(p, live, deathUnderStop = true) {
  if (p.record === null) {
    const stopping2 = p.stopping;
    if (stopping2 !== null) return { ...live, stopping: stopping2 };
    if (live.stopped === true || live.startingSince !== void 0) return live;
    return withStart(live, p.start);
  }
  if (!p.shutDown) {
    if (live.startingSince !== void 0) return live;
    const start2 = p.start;
    if (start2 !== null) return withStart(live, start2);
    if (!deathUnderStop && live.stopped === true) return live;
    const died = p.died();
    return died === null ? live : { ...live, died };
  }
  const start = p.start;
  if (start !== null) return withStart(live, start);
  const stopping = p.stopping;
  return stopping === null ? live : { ...live, stopping };
}
function withStart(live, start) {
  return start === null ? live : { ...live, startingSince: start.since, startMark: start.mark };
}
function withLateHeartbeat(p, live) {
  const late = p.heartbeatLate();
  return late === null ? live : { ...live, heartbeatLate: late };
}
function newsView(p, told) {
  const live = withToldStart(p.heartbeat, told, p.at);
  if (live.state === "alive") return aliveView(p, live, false);
  if (live.startingSince !== void 0) return withRecordFacts(p, live, false);
  return withLateHeartbeat(p, withRecordFacts(p, withStop(p, live), false));
}

// src/core/fs/compare.ts
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/core/keys/reverse-index.ts
function testFileId(ref2) {
  return `${ref2.project}\0${ref2.path}`;
}

// src/core/state/fingerprint.ts
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
var SUMMARY_MAX_CHARS = 300;
var VOLATILE = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  [/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms"],
  [/\b0x[0-9a-f]+\b/gi, "0x<addr>"],
  // An IPv4 address, `localhost`, a bracketed IPv6 address or a URL's host; never `path:line:col`.
  [
    /(?<![\w.-])((?:\d{1,3}\.){3}\d{1,3}|localhost|\[[0-9a-f:.]+\]|(?<=:\/\/)[\w.-]+):\d{1,5}\b(?!:\d)/gi,
    "$1:<port>"
  ],
  [/\b(port\s+)\d{1,5}\b/gi, "$1<port>"],
  // A cache path names a tool's scratch space; its segments are hashes and run ids.
  [/(?:[^\s'"`(]*\/)?node_modules\/\.cache\/[^\s'"`):,]*/g, "<cache>"],
  [() => tempRoots().pattern, maskTemp],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // At least one letter, so a long decimal value in an assertion is kept.
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, "<hex>"]
];
var SQUEAL_SCRATCH = /^squeal-\d+\/tmp\/[^/]+(?=\/)/;
var MASKED_SQUEAL_SCRATCH = /^<tmp>\/tmp\/(?:<hex>|\d{16})(?=\/)/;
function maskTemp(path) {
  const root = deepestRoot(path);
  if (root === null) return path;
  const [, ...tail] = path.slice(root.length + 1).split("/");
  return ["<tmp>", ...tail].join("/");
}
function deepestRoot(path) {
  if (path.startsWith("<tmp>/")) return MASKED_SQUEAL_SCRATCH.exec(path)?.[0] ?? null;
  const held = tempRoots().roots.filter((r) => path.startsWith(`${r}/`)).map((r) => {
    const scratch = SQUEAL_SCRATCH.exec(path.slice(r.length + 1));
    return scratch === null ? r : `${r}/${scratch[0]}`;
  });
  return held.reduce((a, b) => a === null || b.length > a.length ? b : a, null);
}
var cachedRoots = null;
function tempRoots() {
  const dir = tmpdir().replace(/\/+$/, "");
  if (cachedRoots?.dir === dir) return cachedRoots;
  let real2 = dir;
  try {
    real2 = realpathSync(dir);
  } catch {
  }
  const roots = [.../* @__PURE__ */ new Set([dir, real2, "/tmp"])].filter((p) => p !== "").sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\w.-])(?:<tmp>|${roots.map(escapeRegExp).join("|")})(?:/[^\\s/'"\`):,]+)+`,
    "g"
  );
  cachedRoots = { dir, roots, pattern };
  return cachedRoots;
}
function escapeRegExp(text2) {
  return text2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function firstLine2(text2) {
  const line = stripVTControlCharacters(text2).split(/\r?\n/).find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}
function normalize(line) {
  return VOLATILE.reduce((text2, [rule, replacement]) => {
    const pattern = typeof rule === "function" ? rule() : rule;
    return typeof replacement === "string" ? text2.replace(pattern, replacement) : text2.replace(pattern, replacement);
  }, line);
}
function where2(location2) {
  return location2 === null ? "?" : `${location2.path}:${location2.line}:${location2.column}`;
}
var PHASE_PREFIX = {
  load: "",
  "after-tests": "error after its tests ran: ",
  setup: "setup failed: "
};
function describeFailure(errors, fallback2) {
  const first = errors[0];
  if (first === void 0) {
    return { fingerprint: `fail @ ${where2(fallback2)}`, summary: "failed without an error message" };
  }
  const line = firstLine2(first.message);
  const location2 = first.location ?? fallback2;
  const more = errors.length - 1;
  const text2 = withCauses(
    `${PHASE_PREFIX[first.phase ?? "load"]}${withCode(line === "" ? first.name : line, first.code)}`,
    first.causes ?? []
  );
  const summary = more > 0 ? `${text2} (${more} more error${more === 1 ? "" : "s"})` : text2;
  const recorder = errors.find((e) => e.recorder !== void 0)?.recorder;
  return {
    fingerprint: `${first.name}: ${normalize(line)} @ ${where2(location2)}`,
    summary: withRecorder(
      withDiff(summary, first.diff === null ? null : diffText(first.diff)),
      recorder
    )
  };
}
function renormalizeFingerprint(fingerprint) {
  const at = fingerprint.lastIndexOf(" @ ");
  if (at < 0) return fingerprint;
  let text2 = fingerprint.slice(0, at);
  for (let next = normalize(text2); next !== text2; next = normalize(text2)) text2 = next;
  return `${text2}${fingerprint.slice(at)}`;
}
function sameFingerprint(a, b) {
  if (a === b) return true;
  return a !== null && b !== null && renormalizeFingerprint(a) === renormalizeFingerprint(b);
}
function withRecorder(summary, recorder) {
  if (recorder === void 0) return summary;
  const note = cap(
    `; ran under Squeal's recorder in NODE_OPTIONS: ${recorder}`,
    SUMMARY_MAX_CHARS / 2
  );
  return `${cap(summary, SUMMARY_MAX_CHARS - note.length)}${note}`;
}
function causeText(cause) {
  return withCode(cause.message === "" ? cause.code ?? "" : cause.message, cause.code);
}
function withCode(text2, code) {
  return code === void 0 || text2.includes(code) ? text2 : `${text2} (${code})`;
}
function withCauses(text2, causes) {
  if (causes.length === 0) return text2;
  const chain = causes.map((c) => `; cause: ${causeText(c)}`).join("");
  const shown = cap(chain, SUMMARY_MAX_CHARS - Math.min(text2.length, LINE_MIN_CHARS));
  return `${cap(text2, SUMMARY_MAX_CHARS - shown.length)}${shown}`;
}
var LINE_MIN_CHARS = 120;
var DIFF_LINES = 8;
function diffText(diff) {
  const lines = stripVTControlCharacters(diff).split(/\r?\n/);
  const legend = lines.slice(0, 2).map((l) => l.trim());
  const labelled = /^- \S/.test(legend[0] ?? "") && /^\+ \S/.test(legend[1] ?? "");
  const changed = (labelled ? lines.slice(2) : lines).filter((l) => /^[-+]/.test(l)).slice(0, DIFF_LINES).map((l) => `${l[0]} ${l.slice(1).trim().replace(/\s+/g, " ")}`);
  if (changed.length === 0) return null;
  return `diff${labelled ? ` (${legend.join(", ")})` : ""}: ${changed.join(" | ")}`;
}
function withDiff(summary, diff) {
  if (diff === null) return cap(summary, SUMMARY_MAX_CHARS);
  const separator = "; ";
  const room = SUMMARY_MAX_CHARS - separator.length;
  const shownDiff = cap(diff, room - Math.min(summary.length, LINE_MIN_CHARS));
  return `${cap(summary, room - shownDiff.length)}${separator}${shownDiff}`;
}

// src/core/state/derive.ts
function checkIdentity(check) {
  const name2 = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name2}`;
}
function testFileKeyOf(check) {
  return testFileId(testFileOf(check));
}
function testFileOf(check) {
  return { project: check.project, path: check.testPath };
}

// src/core/state/flaky.ts
var FLAKY_META_KEY = "flaky-checks";
function readFlakyNotes(store) {
  const raw = store.meta.get(FLAKY_META_KEY);
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter((entry2) => isNote(entry2[1]))
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
var OUTCOMES4 = /* @__PURE__ */ new Set(["pass", "fail"]);
function isNote(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.key === "string" && OUTCOMES4.has(v.from) && OUTCOMES4.has(v.to) && typeof v.fromWorktreeId === "string" && typeof v.toWorktreeId === "string" && typeof v.at === "number" && (v.failure === void 0 || typeof v.failure === "string");
}
var NO_EARLIER_PASS_TEXT = "no pass at these inputs is on record before";
function flakyText(note) {
  const flip = `flaky: ${note.from.toUpperCase()} -> ${note.to.toUpperCase()} under the same tracked inputs`;
  return note.noEarlierPass === true ? `${flip}; ${NO_EARLIER_PASS_TEXT} the FAIL, so the flakiness may be new with the changed files it reads` : flip;
}
var FLAKY_INPUTS_TEXT = "A file a test reads that Squeal does not track can differ between the two runs; `inputs` in squeal.config.json declares such a file.";

// src/core/state/slow-text.ts
var WAITING_FOR = {
  fast: "fast test files",
  idle: "the agent to pause",
  slot: "capacity (whether the slow slot or the shared worker pool holds it is not known)",
  pool: "the shared worker pool",
  load: "host load to drop"
};
function slotWaitText(slot2, why) {
  switch (why) {
    case "in use":
      return `${slot2} (in use)`;
    case "free":
      return `${slot2} (taken at its last try, free now)`;
    case "held":
      return `${slot2} (taken at its last try)`;
    case "turn":
      return `${slot2} (its turn went to another worktree that waits for it)`;
  }
}
var SLOT_HELD = "the slow slot another worktree's slow tier holds";
function slotHeld(slot2) {
  if (slot2 === void 0) return false;
  const held = slot2.holders.reduce((sum, h) => sum + h.permits, 0);
  return held >= slot2.permits && slot2.holders.every((h) => h.kind === "live" && h.self !== true);
}
function clockText(at) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function filesText(paths) {
  const [a, b] = paths;
  if (paths.length === 1) return a ?? "";
  if (paths.length === 2) return `${a} and ${b}`;
  return `${a}, ${b} and ${paths.length - 2} more`;
}
function slowWords(slot2) {
  return {
    waitingFor: (wait, why) => {
      if (wait !== "slot") return WAITING_FOR[wait];
      if (slotHeld(slot2)) return SLOT_HELD;
      return why === void 0 ? WAITING_FOR.slot : slotWaitText("the slow slot", why);
    },
    files: "slow files"
  };
}
function sharedWaitText(wait) {
  return WAITING_FOR[wait];
}
function pendingText(pending, activity, late, words) {
  if (activity === null) return `${pending} pending`;
  const reported = late ? "last reported " : "";
  if (activity.kind === "waiting") {
    return `${pending} pending, ${reported}waiting for ${words.waitingFor(activity.for, activity.slot)}`;
  }
  const paths = activity.paths ?? [activity.path];
  const several = paths.length > 1;
  const since = clockText(activity.since);
  const last = activity.lastDurationMs === null ? "no earlier run" : `${several ? "longest " : ""}last run ${durationText(activity.lastDurationMs)}`;
  const what = several ? `${paths.length} ${words.files} since ${since}: ${filesText(paths)}` : `${activity.path} since ${since}`;
  const running = `${reported}running ${what} (${last})`;
  return pending === paths.length ? running : `${pending} pending, ${running}`;
}
function currentText(tier) {
  return tier.currentUpTo === void 0 ? `current at revision ${tier.currentAt}` : `current at revisions ${tier.currentAt} to ${tier.currentUpTo}`;
}
function slowTierText(header, command) {
  const tier = header.slowTier;
  if (tier === void 0) return null;
  if (tier.testFiles === 0) return `Slow tier: no slow test files listed yet; ${stopText(tier)}.`;
  const parts = [];
  if (tier.current > 0) parts.push(`${tier.current} ${currentText(tier)}`);
  if (tier.pending > 0) {
    const late = header.daemon?.state === "down";
    parts.push(pendingText(tier.pending, tier.activity, late, slowWords(header.slowSlot)));
  }
  if (tier.notRun > 0) parts.push(`${tier.notRun} not run at revision ${header.revision}`);
  const open2 = tier.testFiles - tier.current;
  const runs = open2 <= 0 ? "" : `; ${slowWaitText(command, open2)}`;
  return `Slow tier: ${plural(tier.testFiles, "test file")}; ${parts.join("; ")}. ${capitalized(stopText(tier))}${runs}.`;
}
function slowWaitText(command, open2) {
  return `\`${command} run --slow --wait 60000\` waits for ${open2 === 1 ? "its result" : "their results"}`;
}
function stopText(tier) {
  if (tier.stopWaitMs !== void 0) {
    return `Stop waits up to ${durationText(tier.stopWaitMs)} for them or holds the agent ${holdsText(tier.maxHolds)}`;
  }
  const when = slowRunsWhen(tier);
  if (tier.notRun === 0) return `Squeal runs them ${when}`;
  if (tier.pending === 0) return "Squeal has not queued them";
  return `Squeal runs the pending ones ${when} and has not queued the rest`;
}
function holdsText(maxHolds) {
  return maxHolds === void 0 || maxHolds <= 1 ? "once" : `up to ${maxHolds} times in a turn`;
}
function slowRunsWhen(tier) {
  return tier.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
}
function capitalized(text2) {
  return `${text2.charAt(0).toUpperCase()}${text2.slice(1)}`;
}

// src/core/state/group-text.ts
function groupTierLines(header, command, only) {
  const late = header.daemon?.state === "down";
  return (header.groupTiers ?? []).flatMap((group) => {
    if (only !== void 0 && !only.includes(group.name)) return [];
    const line = groupTierText(group, header.revision, late, command);
    return line === null ? [] : [line];
  });
}
function groupTierText(group, revision, late, command) {
  const open2 = group.testFiles - group.current;
  if (open2 <= 0) return null;
  const parts = [];
  if (group.current > 0) parts.push(`${group.current} ${currentText(group)}`);
  if (group.pending > 0) parts.push(groupPendingText(group, late, command));
  if (group.notRun > 0) parts.push(`${group.notRun} not run at revision ${revision}`);
  return `${group.name}: ${plural(group.testFiles, "test file")}; ${parts.join("; ")}. ${capitalized(groupDoes(group))}; ${groupRunText(group, command, open2)}.`;
}
function groupPendingText(group, late, command) {
  const held = group.at === "commit" || group.at === "manual";
  if (group.activity !== null || !held)
    return pendingText(group.pending, group.activity, late, groupWords(group));
  const asked = requestedOf(group);
  const waiting = group.pending - asked;
  const parts = [];
  if (asked > 0) parts.push(`${asked} queued by a request (${requestsText(group, command)})`);
  if (waiting > 0) {
    const what = group.at === "commit" ? "a commit" : `\`${command} run ${group.name}\``;
    parts.push(`${waiting} pending${outsideText(group, waiting)}, waiting for ${what}`);
  }
  return parts.join(", ");
}
function outsideText(group, waiting) {
  const paths = group.pendingOutside ?? [];
  return paths.length === waiting ? ` (${paths.join(", ")})` : "";
}
function requestedOf(group) {
  return Math.min(group.pending, group.requested ?? 0);
}
function requestsText(group, command) {
  return `\`${command} status --at <commit> --run\` or \`${command} run ${group.name} <path>...\``;
}
function groupWords(group) {
  const waitingFor = (wait, why) => {
    if (wait === "fast") return followedGroupsText(group.after);
    if (wait === "slot") {
      if (why !== void 0) return slotWaitText(`the ${group.name} group's slot`, why);
      return `capacity (whether the ${group.name} group's slot or the shared worker pool holds it is not known)`;
    }
    return sharedWaitText(wait);
  };
  return { waitingFor, files: `${group.name} files` };
}
function followedGroupsText(after) {
  return after.length === 0 ? "an earlier group" : afterText(after);
}
function afterText(names3) {
  if (names3.length === 1) return `the ${names3[0]} group's files`;
  return `the ${names3.slice(0, -1).join(", ")} and ${names3.at(-1)} groups' files`;
}
function groupDoes(group) {
  const when = groupWhenText(group);
  const asked = requestedOf(group);
  const runs = asked > 0 ? requestedDoes(group, asked, when) : group.notRun === 0 ? `Squeal runs them ${when}` : group.pending === 0 ? "Squeal has not queued them" : `Squeal runs the pending ones ${when} and has not queued the rest`;
  const stop = group.stopWaitMs === void 0 ? "" : `, and Stop waits up to ${durationText(group.stopWaitMs)} for them`;
  return `${runs}${stop}`;
}
function requestedDoes(group, asked, when) {
  const now = asked === group.pending ? "runs them now" : "runs the requested ones now";
  const rest = group.pending - asked;
  if (rest === 0 && group.notRun === 0) return `Squeal ${now}`;
  if (rest === 0) return `Squeal ${now} and has not queued the rest`;
  const queued = `the other pending ones ${when}`;
  return group.notRun === 0 ? `Squeal ${now}, ${queued}` : `Squeal ${now}, ${queued}, and has not queued the rest`;
}
function groupWhenText(group) {
  const following = group.after.length === 0 ? "" : ` and after ${afterText(group.after)}`;
  switch (group.at) {
    case "edit": {
      const quiet = group.quietMs > 0 ? ` once no edit came for ${durationText(group.quietMs)}` : "";
      return `after each edit${quiet}${following}`;
    }
    case "pause":
    case "stop":
      return `when the agent pauses${following}`;
    case "commit":
      return "at each commit";
    case "manual":
      return "only on request";
  }
}
function groupRunText(group, command, open2) {
  const one = open2 === 1;
  const results = one ? "its result" : "their results";
  const requested = group.notRun === 0 && requestedOf(group) === group.pending;
  const waiting = !requested && (group.at !== "edit" || group.notRun > 0 || group.activity?.kind === "waiting");
  const does = waiting ? `runs ${one ? "it" : "them"} now and waits for ${results}` : `waits for ${results}`;
  return `\`${command} run ${group.name} --wait 60000\` ${does}`;
}

// src/core/retry/kept.ts
var ASKED_KEY_MS = 7 * 24 * 60 * 60 * 1e3;

// src/core/retry/records.ts
var RETRIES_META_KEY = "retries";
var RETRY_REASONS = ["load", "environment"];
function readRetries(store) {
  const raw = store.meta.get(RETRIES_META_KEY);
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isRecord2) : [];
  } catch {
    return [];
  }
}
function retriesAt(records, testFile, key) {
  const id = testFileId(testFile);
  return records.filter((r) => r.key === key && testFileId(r.testFile) === id);
}
function isRecord2(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  const ref2 = v.testFile;
  return typeof v.id === "string" && typeof ref2 === "object" && ref2 !== null && typeof ref2.project === "string" && typeof ref2.path === "string" && typeof v.key === "string" && typeof v.session === "string" && RETRY_REASONS.includes(v.reason) && typeof v.askedAt === "number" && typeof v.askedIn === "string" && (v.claim === null || typeof v.claim === "object") && (v.end === null || typeof v.end === "object");
}

// src/core/retry/gate.ts
var LOAD_RETRY_WAIT_MS = 6e5;

// src/core/retry/load.ts
function loadAllows(load) {
  return load.oneMinute === null || load.oneMinute < load.cpus;
}
var RUN_LOADS_META_KEY = "failed-run-loads";
function readRunLoads(store) {
  const raw = store.meta.get(RUN_LOADS_META_KEY);
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter((e) => typeof e[1] === "number")
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}

// src/core/retry/text.ts
function waitedText(ms) {
  return durationText(ms, Math.floor);
}
var BOUND_TEXT = waitedText(LOAD_RETRY_WAIT_MS);
function outcomeText(outcome) {
  switch (outcome) {
    case "passed":
      return "it passed";
    case "failed":
      return "it failed again";
    case "unknown":
      return "its run gave no result";
    case "cancelled":
      return "it was withdrawn";
  }
}
function retryText(fact) {
  const asked = `retry asked (${fact.reason}) at these inputs`;
  return fact.outcome === "pending" ? `${asked}, pending` : `${asked}: ${outcomeText(fact.outcome)}`;
}
function agoText(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 6e4);
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
var RECORDED_UNKNOWN_TEXT = "recorded at an unknown time and load: the result that produced it is no longer identifiable in the store";
function loadPerCpuText(loadPerCpu) {
  return loadPerCpu === null ? "load per CPU then not recorded" : `load ${loadPerCpu.toFixed(2)} per CPU when it ran`;
}
function recordedText(facts, here, now, words) {
  const fresh2 = facts.noEarlierPass === true;
  const retry = facts.retry === void 0 ? `${retryStateText(facts)}${loadRetryText(facts.loadPerCpu, words, fresh2)}` : retryStateText(facts);
  const lead = fresh2 ? `${NO_EARLIER_PASS_TEXT} this failure: look first at the changed files it reads; ` : "";
  return `${lead}${recordedWhereText(facts, here, now)}; ${retry}`;
}
function ranWhereText(remote, label) {
  return remote.startsWith("container ") ? `in ${remote}` : `${label} ${remote}`;
}
function recordedWhereText(facts, here, now) {
  const where3 = facts.worktreeId === here ? "this worktree" : facts.worktreeRoot ?? `worktree ${facts.worktreeId}`;
  const ago = facts.recordedAt === void 0 ? "" : ` ${agoText(now - facts.recordedAt)}`;
  const remote = facts.remote === void 0 ? "" : ` ${ranWhereText(facts.remote, "on remote")}`;
  return `recorded${ago}${remote} in ${where3} at revision ${facts.revision}, ${loadPerCpuText(facts.loadPerCpu)}`;
}
function retryStateText(facts) {
  return facts.retry === void 0 ? "no retry asked at these inputs" : retryText(facts.retry);
}
function busyLoad(loadPerCpu) {
  return loadPerCpu !== null && !loadAllows({ oneMinute: loadPerCpu, cpus: 1 });
}
function loadRetryText(loadPerCpu, words, fresh2) {
  if (!busyLoad(loadPerCpu)) return "";
  const when = fresh2 ? "if the changed files are not the cause, " : "";
  return `; ${when}\`${words.command} retry ${shellWord(words.path)} --reason load\` runs it once more when the one-minute load average is below the CPU count`;
}

// src/core/retry/advice.ts
var FILES_NAMED = 5;
var FILES_NAMED_MAX_CHARS = 400;
function recordedShortText(facts, here, now) {
  const fresh2 = facts.noEarlierPass === true ? `; ${NO_EARLIER_PASS_TEXT} it` : "";
  return `${recordedWhereText(facts, here, now)}${fresh2}; ${retryStateText(facts)}`;
}
function retryAdviceText(failures, command) {
  const fresh2 = failures.some((f) => f.facts.noEarlierPass === true);
  const busy2 = failures.filter((f) => f.facts.retry === void 0 && busyLoad(f.facts.loadPerCpu));
  const parts = [];
  if (fresh2) {
    parts.push(`Where ${NO_EARLIER_PASS_TEXT} a failure, look first at the changed files it reads`);
  }
  if (busy2.length > 0) {
    const files2 = [...new Set(busy2.map((f) => f.path))];
    const words = files2.map(shellWord).join(" ");
    const named2 = files2.length > FILES_NAMED || words.length > FILES_NAMED_MAX_CHARS ? "<test file>..." : words;
    const when = busy2.every((f) => f.facts.noEarlierPass === true) ? "if the changed files are not the cause, " : "";
    const them = files2.length === 1 ? "it" : "them";
    parts.push(
      `${when}\`${command} retry ${named2} --reason load\` runs ${them} once more when the one-minute load average is below the CPU count`
    );
  }
  if (parts.length === 0) return null;
  const text2 = parts.join("; ");
  return `${text2.charAt(0).toUpperCase()}${text2.slice(1)}`;
}

// src/core/status/checks.ts
function countChecks(checks) {
  const testFiles2 = checks.filter((check) => check.kind === "file").length;
  const setups = checks.filter((check) => check.kind === "setup").length;
  return {
    tests: checks.length - testFiles2 - setups,
    testFiles: testFiles2,
    ...setups > 0 ? { setups } : {}
  };
}
function checkPartsText({ tests: tests2, testFiles: testFiles2, setups = 0 }, fileLevel = "loaded") {
  return [
    ...tests2 > 0 ? [plural(tests2, "test")] : [],
    ...testFiles2 > 0 ? [`${plural(testFiles2, "test file")} ${fileLevel}`] : [],
    ...setups > 0 ? [plural(setups, "global setup")] : []
  ].join(", ");
}
function checksText(checks, noun = "check", fileLevel) {
  const parts = checks.length === 0 ? "" : ` (${checkPartsText(countChecks(checks), fileLevel)})`;
  return `${plural(checks.length, noun)}${parts}`;
}
function failureCountText(checks) {
  if (checks.length === 0) return "0";
  return `${checks.length} (${checkPartsText(countChecks(checks), "that did not load")})`;
}
function splitByValidity(failures) {
  return {
    current: failures.filter((f) => f.validity === "current"),
    pending: failures.filter((f) => f.validity === "pending"),
    stale: failures.filter((f) => f.validity !== "current" && f.validity !== "pending")
  };
}
function knownFailureCounts(failures) {
  const { current: current2, pending, stale } = splitByValidity(failures);
  return { current: current2.length, pending: pending.length, stale: stale.length };
}
function earlierFailuresLines({ pending, stale }) {
  if (pending + stale === 0) return [];
  return [
    `Earlier failures: ${pending} pending rerun, ${stale} stale (not counted until a rerun fails)`
  ];
}

// src/core/run-log.ts
function testFileLabel(project, path) {
  return project ? `[${project}] ${path}` : path;
}

// src/core/status/died.ts
var DIED_FILES_SHOWN = 5;
function deathHookText(died) {
  if (died.runs.length === 0) return "died without shutting down, between runs";
  return `died without shutting down while running ${files(died.runs.flatMap((run2) => run2.testFiles))}`;
}
var DEATH_CAUSE = "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";
function files(refs) {
  const shown = refs.slice(0, DIED_FILES_SHOWN).map((ref2) => testFileLabel(ref2.project, ref2.path));
  const more = refs.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

// src/core/delivery/harness-process.ts
import { readFileSync as readFileSync3, readlinkSync } from "node:fs";

// src/core/delivery/slots.ts
var slot = (consumer) => `${consumer.sessionId}
${consumer.agentId}`;
function readAll(store, key) {
  const raw = store.meta.get(key);
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}
function readSlot(store, key, consumer) {
  return readAll(store, key)[slot(consumer)];
}
function writeSlot(store, key, consumer, value) {
  const registered = new Set(
    store.consumers.list(consumer.worktreeId).map((r) => slot(r.consumer))
  );
  const all = readAll(store, key);
  const next = {};
  for (const [k, v] of Object.entries(all)) if (registered.has(k)) next[k] = v;
  if (value === null) delete next[slot(consumer)];
  else next[slot(consumer)] = value;
  if (Object.keys(next).length === 0 && Object.keys(all).length === 0) return;
  store.meta.set(key, JSON.stringify(next));
}

// src/core/delivery/harness-process.ts
function readProcStat(pid) {
  let text2;
  try {
    text2 = readFileSync3(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const open2 = text2.indexOf("(");
  const close = text2.lastIndexOf(")");
  const rest = text2.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  const startTime = Number(rest[19]);
  if (open2 < 0 || close < open2 || !Number.isInteger(ppid) || !Number.isInteger(startTime)) {
    throw new Error(`unreadable /proc/${pid}/stat`);
  }
  return { comm: text2.slice(open2 + 1, close), state: rest[0] ?? "", ppid, startTime };
}
function pidNamespace() {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}
function harnessGone(harness, namespace) {
  try {
    return harnessAlive(harness, namespace, readProcStat) === false;
  } catch {
    return false;
  }
}
function harnessAlive(harness, namespace, statOf2) {
  if (namespace === null || harness.pidNamespace !== namespace) return null;
  const stat = statOf2(harness.pid);
  return stat !== null && stat.startTime === harness.startTime && stat.state !== "Z";
}
function harnessMetaKey(worktreeId) {
  return worktreeMetaKey("harnessProcess", worktreeId);
}
function recordHarness(store, consumer, harness) {
  writeSlot(store, harnessMetaKey(consumer.worktreeId), consumer, harness);
}
function toHarness(value) {
  if (!isRecord(value)) return void 0;
  const { pid, startTime, pidNamespace: pidNamespace2 } = value;
  return typeof pid === "number" && typeof startTime === "number" && typeof pidNamespace2 === "string" ? { pid, startTime, pidNamespace: pidNamespace2 } : void 0;
}

// src/core/scheduler/hold-rows.ts
function mergeHoldMetaKey(worktreeId) {
  return worktreeMetaKey("mergeHold", worktreeId);
}
function commandHoldMetaKey(worktreeId) {
  return worktreeMetaKey("commandHold", worktreeId);
}
function readMergeHold(store, worktreeId, daemonStartedAt) {
  const raw = store.meta.get(mergeHoldMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const row = JSON.parse(raw);
    if (!isRecord(row) || row.v !== 1 || typeof row.since !== "number") return null;
    if (row.since < daemonStartedAt || typeof row.revision !== "number") return null;
    if (!Array.isArray(row.paths) || typeof row.count !== "number") return null;
    const paths = row.paths.filter((p) => typeof p === "string");
    return { v: 1, since: row.since, revision: row.revision, paths, count: row.count };
  } catch {
    return null;
  }
}
function readCommandHolds(store, worktreeId) {
  const raw = store.meta.get(commandHoldMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const row = JSON.parse(raw);
    if (!isRecord(row) || row.v !== 1 || !Array.isArray(row.entries)) return [];
    return row.entries.filter(isCommandHold);
  } catch {
    return [];
  }
}
function isCommandHold(entry2) {
  if (!isRecord(entry2)) return false;
  const { token: token2, since, until, command, wrapper, child } = entry2;
  return typeof token2 === "string" && typeof since === "number" && typeof until === "number" && typeof command === "string" && (wrapper === null || toHarness(wrapper) !== void 0) && (child === null || toHarness(child) !== void 0);
}

// src/core/status/open-runs.ts
function liveStartedAt(worktree, daemon) {
  const record = worktree?.daemon ?? null;
  return record === null || daemon.state !== "alive" ? null : record.startedAt;
}
function openRuns(store, worktree, daemon) {
  const startedAt = liveStartedAt(worktree, daemon);
  if (worktree === null || startedAt === null) return [];
  return store.runs.inFlight(worktree.id, startedAt);
}

// src/core/status/holds.ts
var HOLD_PATHS_SHOWN = 3;
function readHolds(store, worktree, daemon, now, namespace = pidNamespace()) {
  return readKeyedHolds(store, worktree, daemon, now, namespace).map((k) => k.hold);
}
function readKeyedHolds(store, worktree, daemon, now, namespace = pidNamespace()) {
  if (worktree === null) return [];
  const startedAt = liveStartedAt(worktree, daemon);
  const row = startedAt === null ? null : readMergeHold(store, worktree.id, startedAt);
  const merge2 = row === null ? [] : [
    {
      id: "merge",
      hold: {
        cause: "merge",
        since: row.since,
        revision: row.revision,
        paths: row.paths,
        pathCount: Math.max(row.count, row.paths.length)
      }
    }
  ];
  const commands2 = readCommandHolds(store, worktree.id).sort((a, b) => a.since - b.since).map((entry2) => {
    const recorded = [entry2.wrapper, entry2.child].filter((p) => p !== null);
    const gone = recorded.length > 0 && recorded.every((p) => harnessGone(p, namespace));
    const hold = {
      cause: "command",
      since: entry2.since,
      command: entry2.command,
      pid: entry2.child?.pid ?? entry2.wrapper?.pid ?? null,
      until: entry2.until,
      ...gone ? { gone: true } : {},
      ...entry2.until <= now ? { expired: true } : {}
    };
    return { id: `command:${entry2.token}`, hold };
  });
  return [...merge2, ...commands2];
}
function unmergedPathsText(hold) {
  const shown = hold.paths.slice(0, HOLD_PATHS_SHOWN).join(", ");
  const more = hold.pathCount - Math.min(hold.paths.length, HOLD_PATHS_SHOWN);
  return more > 0 ? `${shown} and ${more} more` : shown;
}
function listedText(hold) {
  return `git lists ${plural(hold.pathCount, "unmerged path")} (${unmergedPathsText(hold)})`;
}
function mergeEndText(hold) {
  const them = hold.pathCount === 1 ? "it" : "them";
  return `Resolve ${them} and \`git add\` ${them}, or abort.`;
}
function commandText(hold) {
  return `for \`${hold.command}\`${hold.pid === null ? "" : ` (pid ${hold.pid})`}`;
}
function endingText(hold) {
  if (hold.expired === true) return `its bound passed at ${timeText(hold.until)}`;
  return hold.gone === true ? "its command is gone" : null;
}
function holdLine(hold, command = "squeal") {
  const since = timeText(hold.since);
  if (hold.cause === "merge") {
    return `On hold: unresolved merge since ${since}, ${listedText(hold)}; no test runs until git lists none. ${mergeEndText(hold)}`;
  }
  const head = `On hold: \`${command} hold\` since ${since}, ${commandText(hold)}`;
  const ending = endingText(hold);
  if (ending !== null) return `${head}; ${ending}; the daemon ends the hold at its next heartbeat.`;
  return `${head}, until it exits, at most until ${timeText(hold.until)}; edits are recorded and not run. \`${command} start\` ends the hold.`;
}
function holdStartText(hold, command = "squeal") {
  if (hold.cause === "merge") {
    const them = hold.pathCount === 1 ? "it" : "them";
    return `${listedText(hold)}. No test runs until git lists none: resolve ${them} and \`git add\` ${them}, or abort.`;
  }
  const runs = `\`${command} hold\` runs \`${hold.command}\`${hold.pid === null ? "" : ` (pid ${hold.pid})`}`;
  return `${runs}. Edits are recorded and not run until it exits, at most until ${timeText(hold.until)}; \`${command} start\` ends the hold.`;
}
function endedText(ended) {
  if (ended.cause === "merge") return "git lists no unmerged path";
  const pid = ended.pid === void 0 || ended.pid === null ? "" : ` (pid ${ended.pid})`;
  return `the hold for \`${ended.command}\`${pid} ended`;
}
function holdEndedText(change2) {
  const [first] = change2.holds;
  if (first === void 0) return `${endedText(change2.ended)}.`;
  const name2 = first.cause === "merge" ? "for the unresolved merge" : commandText(first);
  const more = change2.holds.length - 1;
  return `${endedText(change2.ended)}; still on hold ${name2}${more > 0 ? ` and ${plural(more, "more hold")}` : ""}.`;
}
function holdEndText(change2) {
  const running = change2.running === 0 ? "" : `, ${change2.running} running`;
  return `${endedText(change2.ended)}; ${plural(change2.queued, "test file")} queued${running}.`;
}

// src/core/status/ignored-config.ts
import { isDeepStrictEqual } from "node:util";

// src/core/daemon/policy.ts
import { join as join4 } from "node:path";

// src/core/keys/glob.ts
function globToRegExp(glob) {
  if (glob.startsWith("!")) throw new Error(`squeal: negated input glob is not supported: ${glob}`);
  if (glob.startsWith("/")) throw new Error(`squeal: input glob must be relative: ${glob}`);
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  return new RegExp(`^${compile(source, glob)}$`, "s");
}
function createInputMatcher(globs4) {
  if (globs4.length === 0) return () => false;
  const patterns = globs4.map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
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
function matchingBrace(glob, open2, original) {
  let depth = 0;
  for (let i = open2; i < glob.length; i++) {
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

// src/core/daemon/check-groups.ts
var CHECK_MOMENTS = ["edit", "pause", "stop", "commit", "manual"];
function heldUntilAsked(at) {
  return at === "commit" || at === "manual";
}
var CHECK_RUNNERS = ["vitest", "nodeTest", "pytest"];
var DEFAULT_GROUP_NAMES = ["tests", "slow"];
var NO_LIMITS = {
  maxParallel: null,
  maxWorkers: null,
  priority: "normal",
  deferUnderLoad: null
};
function defaultGroups(policy) {
  const { slow, stop } = policy;
  const marked2 = (isSlow) => ({
    kind: "marked",
    slow: isSlow,
    include: slow.include,
    projects: [
      ...policy.nodeTest.filter((p) => p.slow === true).map((p) => ({ runner: "nodeTest", name: p.name })),
      ...policy.pytest.filter((p) => p.slow === true).map((p) => ({ runner: "pytest", name: p.name }))
    ]
  });
  const continuous = slow.trigger === "continuous";
  const slowAt = continuous ? "edit" : stop.requireSlowSuite ? "stop" : "pause";
  return [
    {
      name: "tests",
      index: null,
      at: "edit",
      stopRequires: false,
      after: [],
      quietMs: 0,
      limits: NO_LIMITS,
      select: marked2(false)
    },
    {
      name: "slow",
      index: null,
      at: slowAt,
      stopRequires: stop.requireSlowSuite,
      after: ["tests"],
      quietMs: continuous ? slow.quietMs : 0,
      limits: {
        maxParallel: slow.maxParallel,
        maxWorkers: slow.maxWorkers,
        priority: "low",
        deferUnderLoad: { maxLoadPerCpu: slow.maxLoadPerCpu, maxDeferMs: slow.maxDeferMs }
      },
      select: marked2(true)
    }
  ];
}
function resolveGroups(policy) {
  return [...policy.checks.map(resolveEntry), ...defaultGroups(policy)];
}
function resolveEntry(group, index) {
  const given = group.limits ?? {};
  const defer = given.deferUnderLoad;
  return {
    name: group.name,
    index,
    at: group.at,
    ...group.description === void 0 ? {} : { description: group.description },
    stopRequires: group.at === "stop",
    after: group.after ?? [],
    quietMs: group.quietMs ?? 0,
    limits: {
      maxParallel: given.maxParallel ?? null,
      maxWorkers: given.maxWorkers ?? null,
      priority: given.priority ?? "normal",
      deferUnderLoad: defer === void 0 ? null : {
        maxLoadPerCpu: defer.maxLoadPerCpu ?? DEFER_DEFAULTS.maxLoadPerCpu,
        maxDeferMs: defer.maxDeferMs ?? DEFER_DEFAULTS.maxDeferMs
      }
    },
    select: "lint" in group ? { kind: "lint", tools: group.lint === true ? null : group.lint } : {
      kind: "tests",
      runner: group.runner,
      project: group.project ?? null,
      tests: group.tests ?? null
    }
  };
}
var DEFER_DEFAULTS = { maxLoadPerCpu: 1, maxDeferMs: 6e5 };
function groupOf(groups2, check) {
  return groups2.find((group) => selects(group.select, check)) ?? null;
}
function selects(selector, check) {
  switch (selector.kind) {
    case "lint":
      return check.kind === "lint" && (selector.tools?.includes(check.tool) ?? true);
    case "tests":
      return check.kind === "test" && check.runner === selector.runner && (selector.project === null || check.project === selector.project) && (selector.tests === null || matcher(selector.tests)(check.path));
    case "marked":
      return check.kind === "test" && markedSlow(selector, check) === selector.slow;
  }
}
function markedSlow(selector, check) {
  return selector.projects.some((p) => p.runner === check.runner && p.name === check.project) || matcher(selector.include)(check.path);
}
var matchers = /* @__PURE__ */ new WeakMap();
function matcher(globs4) {
  let match = matchers.get(globs4);
  if (match === void 0) {
    match = createInputMatcher(globs4);
    matchers.set(globs4, match);
  }
  return match;
}

// src/core/slow/classify.ts
import { posix } from "node:path";
function slowFiles(policy, projects) {
  const matches2 = createInputMatcher(policy.slow.include);
  const slowProjects = new Set(
    marked(policy, projects).map((project) => project.name)
  );
  return (testFile) => slowProjects.has(testFile.project) || matches2(testFile.path);
}
function slowGlobs(policy, projects) {
  const globs4 = [...policy.slow.include];
  for (const project of marked(policy, projects)) {
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs4.push(posix.join(cwd, glob));
  }
  return globs4;
}
function marked(policy, projects) {
  return [...projects, ...policy.pytest].filter((project) => project.slow === true);
}

// src/core/scheduler/slow.ts
var groupViews = /* @__PURE__ */ new WeakMap();
function groupView(policy) {
  let view = groupViews.get(policy);
  if (view === void 0) {
    const groups2 = resolveGroups(policy);
    const owners = /* @__PURE__ */ new Map();
    const of = (ref2) => {
      const id = testFileId(ref2);
      let owner = owners.get(id);
      if (owner === void 0) {
        const check = { kind: "test", runner: runnerOf(policy, ref2.project), ...ref2 };
        owner = groupOf(groups2, check) ?? fallback(groups2);
        owners.set(id, owner);
      }
      return owner;
    };
    view = { groups: groups2, of };
    groupViews.set(policy, view);
  }
  return view;
}
function fallback(groups2) {
  const tests2 = groups2.find((group) => group.index === null && group.name === TESTS_GROUP);
  if (tests2 === void 0) throw new Error("the default tests group is missing");
  return tests2;
}
function runnerOf(policy, project) {
  if (policy.nodeTest.some((p) => p.name === project)) return "nodeTest";
  if (policy.pytest.some((p) => p.name === project)) return "pytest";
  return "vitest";
}

// src/core/types/policy.ts
var DEFAULT_POLICY = {
  interrupt: { onRegression: true },
  stop: {
    blockOnKnownFailures: false,
    requireFullSuite: false,
    waitMs: 0,
    requireSlowSuite: false,
    slowWaitMs: 12e4,
    maxHolds: 1
  },
  checks: [],
  testCommand: { denyWhenCurrent: false },
  baseline: { onStart: "lookup-only" },
  inputs: [],
  runtimeFiles: [],
  observe: { runtimeInputs: true },
  env: { allowlist: [] },
  runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 6e5, hostIdleMinutes: null },
  nodeTest: [],
  pytest: [],
  jest: [],
  containers: {},
  vitest: { excludeProjects: [], exclude: [] },
  slow: {
    include: [],
    maxWorkers: 2,
    maxLoadPerCpu: 1,
    maxDeferMs: 6e5,
    maxParallel: 4,
    rank: "tokens",
    trigger: "continuous",
    quietMs: 3e3
  },
  delivery: { uncoveredEdits: true },
  daemon: { idleExitMinutes: 60, unusedExitMinutes: 30 },
  store: { retentionDays: 7, maxSizeMb: null },
  complexity: {
    enabled: true,
    threshold: 20,
    include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"],
    exclude: ["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
    maxFileBytes: 524288,
    blocking: false
  },
  coverage: { enabled: true, untested: true, exclude: [], children: false },
  crap: { enabled: true, threshold: 30 },
  lint: {
    enabled: false,
    include: ["**"],
    exclude: [],
    blocking: false,
    tools: ["eslint", "oxlint"]
  },
  gate: { groups: null },
  shared: { ref: null, lookAgain: { everySeconds: 30, forSeconds: 600 } },
  node: "project",
  requires: { commands: [] },
  remote: { allowed: true, needsRepository: [], alwaysLocal: [], setup: null }
};

// src/core/daemon/config-file.ts
import { readFileSync as readFileSync4 } from "node:fs";

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/daemon/config-file.ts
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
var lastLoads = /* @__PURE__ */ new WeakMap();
function loadConfigFile(path, shape, defaults) {
  let text2;
  try {
    text2 = readFileSync4(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) {
      return { value: defaults, problems: [`could not be read: ${String(error)}`], unparsed: true };
    }
    text2 = null;
  }
  let byPath = lastLoads.get(shape);
  const last = byPath?.get(path);
  if (last !== void 0 && last.text === text2 && last.defaults === defaults) {
    return last.loaded;
  }
  const loaded = text2 === null ? { value: defaults, problems: [] } : parse(text2, shape, defaults);
  if (byPath === void 0) {
    byPath = /* @__PURE__ */ new Map();
    lastLoads.set(shape, byPath);
  }
  byPath.set(path, { text: text2, defaults, loaded });
  return loaded;
}
function parse(text2, shape, defaults) {
  let parsed2;
  try {
    parsed2 = JSON.parse(text2);
  } catch (error) {
    const problem = `not valid JSON (${error.message})`;
    return { value: defaults, problems: [problem], unparsed: true };
  }
  if (!isRecord(parsed2)) {
    const got = Array.isArray(parsed2) ? "an array" : JSON.stringify(parsed2);
    return { value: defaults, problems: [`must be a JSON object, got ${got}`], unparsed: true };
  }
  const problems = [];
  const unknownKeys = [];
  const merged = merge(shape, defaults, parsed2, "", { problems, unknownKeys });
  return {
    value: merged,
    problems,
    ...unknownKeys.length === 0 ? {} : { unknownKeys }
  };
}
function merge(shape, defaults, given, prefix, found2) {
  const { problems } = found2;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    const path = `${prefix}${key}`;
    const rule = Object.hasOwn(shape, key) ? shape[key] : void 0;
    if (rule === void 0) {
      problems.push(unknownKey(path));
      found2.unknownKeys.push(path);
    } else if (typeof rule === "function") {
      const expected = rule(value);
      if (expected === null) result[key] = value;
      else if (typeof expected === "object" && "kept" in expected) {
        result[key] = expected.kept;
        problems.push(...expected.problems);
      } else if (typeof expected === "object") problems.push(`"${path}" ${expected.problem}`);
      else problems.push(`"${path}" must be ${expected}, got ${JSON.stringify(value)}`);
    } else if (!isRecord(value)) {
      problems.push(`"${path}" must be an object, got ${JSON.stringify(value)}`);
    } else {
      const nested = defaults[key] ?? {};
      result[key] = merge(rule, nested, value, `${path}.`, found2);
    }
  }
  return result;
}
function unknownKey(path) {
  return `unknown key "${path}"`;
}

// src/core/daemon/host-idle.ts
var GIB = 2 ** 30;
var hostIdleMinutes = (v) => Number.isSafeInteger(v) && v >= 0 ? null : "a whole number of minutes >= 0";

// src/core/daemon/policy-node-test.ts
import { isAbsolute, posix as posix2 } from "node:path";
function compiles(globs4) {
  for (const glob of globs4) {
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
  const normal = posix2.normalize(v.replaceAll("\\", "/"));
  return isAbsolute(v) || normal === ".." || normal.startsWith("../") ? "a path inside the worktree, relative to its root" : null;
};
var PREPARE_SHAPE = "{ command: [executable, ...arguments], timeoutSeconds?: seconds }";
var prepare = (v) => {
  if (!isRecord(v)) return PREPARE_SHAPE;
  const unknown = Object.keys(v).find((key) => key !== "command" && key !== "timeoutSeconds");
  if (unknown !== void 0) {
    return { problem: `has an unknown key "${unknown}"; it takes ${PREPARE_SHAPE}` };
  }
  const { command, timeoutSeconds } = v;
  const list = Array.isArray(command) && command.every((s) => typeof s === "string");
  if (!list || command.length === 0 || command[0] === "") {
    return {
      problem: `has a command that is not a list with an executable first: ${JSON.stringify(command)}; it takes ${PREPARE_SHAPE}`
    };
  }
  const positive = typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0;
  if (timeoutSeconds !== void 0 && !positive) {
    return {
      problem: `has a timeoutSeconds that is not a positive number: ${JSON.stringify(timeoutSeconds)}`
    };
  }
  return null;
};
var FIELDS = {
  name: nonEmptyString,
  cwd: insideRoot,
  node: nonEmptyString,
  argv: strings,
  env: variables,
  include: globs,
  exclude: globs,
  slow: boolean,
  prepare,
  container: nonEmptyString
};
var REQUIRED = /* @__PURE__ */ new Set(["name", "include"]);
function nodeTestProjects(value, path) {
  return projectEntries(value, path, FIELDS, REQUIRED, withDefaults);
}
function withDefaults(entry2) {
  return { ...entry2, argv: entry2.argv ?? [], env: entry2.env ?? {} };
}
function projectEntries(value, path, fields, required, withDefaults4, check) {
  if (!Array.isArray(value)) return "an array of projects";
  const kept2 = [];
  const problems = [];
  value.forEach((entry2, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry2, at, kept2, fields, required, check);
    if (problem === null) kept2.push(withDefaults4(entry2));
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function entryProblem(entry2, at, kept2, fields, required, check) {
  if (!isRecord(entry2))
    return `"${at}" must be an object, got ${JSON.stringify(entry2)}; it is skipped`;
  const named2 = nonEmptyString(entry2.name) === null ? entry2.name : null;
  const skipped = named2 === null ? "it is skipped" : `project ${JSON.stringify(named2)} is skipped`;
  for (const key of Object.keys(entry2)) {
    if (!Object.hasOwn(fields, key)) return `unknown key "${at}.${key}"; ${skipped}`;
  }
  for (const [key, field] of Object.entries(fields)) {
    const given = entry2[key];
    if (given === void 0 && !required.has(key)) continue;
    const expected = field(given);
    if (expected === null) continue;
    const why = typeof expected === "object" ? expected.problem : `must be ${expected}, got ${given === void 0 ? "undefined" : JSON.stringify(given)}`;
    return `"${at}.${key}" ${why}; ${skipped}`;
  }
  const across = check?.(entry2) ?? null;
  if (across !== null) return `"${at}.${across.key}" ${across.problem}; ${skipped}`;
  if (kept2.some((project) => project.name === named2)) {
    return `"${at}.name" repeats ${JSON.stringify(named2)} of an earlier project; it is skipped`;
  }
  return null;
}

// src/core/daemon/policy-checks.ts
var show = (value) => value === void 0 ? "undefined" : JSON.stringify(value);
var must = (expected, ok) => (value, path) => ok(value) ? null : `"${path}" must be ${expected}, got ${show(value)}`;
var oneOf2 = (values) => must(`one of ${values.map((v) => `"${v}"`).join(", ")}`, (v) => values.includes(v));
var isNumber = (v) => typeof v === "number" && Number.isFinite(v);
var positiveInteger2 = must("a positive integer", (v) => Number.isInteger(v) && v > 0);
var atLeastZero = must("a number >= 0", (v) => isNumber(v) && v >= 0);
var aboveZero = must("a number > 0", (v) => isNumber(v) && v > 0);
var NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var name = must(
  "a name of letters, digits, - and _",
  (v) => typeof v === "string" && NAME.test(v)
);
var names = must(
  "an array of group names",
  (v) => Array.isArray(v) && v.every((s) => typeof s === "string")
);
var DESCRIPTION_MAX_CHARS = 200;
var description = must(
  `one line of 1 to ${DESCRIPTION_MAX_CHARS} characters`,
  (v) => typeof v === "string" && v.trim().length > 0 && v.length <= DESCRIPTION_MAX_CHARS && !/[\r\n]/.test(v)
);
var tests = (value, path) => {
  const wrong = must(
    "a non-empty array of strings",
    (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string")
  )(value, path);
  if (wrong !== null) return wrong;
  const bad = compiles(value);
  return bad === null ? null : `"${path}" ${bad.problem}`;
};
var lint = must(
  `true, or a non-empty array of "eslint" and "oxlint"`,
  (v) => v === true || Array.isArray(v) && v.length > 0 && v.every((s) => s === "eslint" || s === "oxlint")
);
var object = (rules) => (value, path) => {
  if (!isRecord(value)) return `"${path}" must be an object, got ${show(value)}`;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(rules, key)) return `unknown key "${path}.${key}"`;
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (value[key] === void 0) continue;
    const problem = rule(value[key], `${path}.${key}`);
    if (problem !== null) return problem;
  }
  return null;
};
var limits = object({
  maxParallel: positiveInteger2,
  maxWorkers: positiveInteger2,
  priority: oneOf2(["normal", "low"]),
  deferUnderLoad: object({ maxLoadPerCpu: aboveZero, maxDeferMs: atLeastZero })
});
var moment = oneOf2(CHECK_MOMENTS);
var COMMON = {
  name,
  at: moment,
  description,
  after: names,
  quietMs: atLeastZero,
  limits
};
var TEST_RULES = object({
  ...COMMON,
  runner: oneOf2(CHECK_RUNNERS),
  project: must("a non-empty string", (v) => typeof v === "string" && v.length > 0),
  tests
});
var LINT_RULES = object({ name, at: moment, description, lint });
var TEST_ONLY = ["project", "tests"];
var TEST_GROUP_ONLY = ["after", "quietMs", "limits"];
function checkGroups(value) {
  if (!Array.isArray(value)) return "an array of check groups";
  const kept2 = [];
  const problems = [];
  value.forEach((entry2, index) => {
    const at = `checks[${index}]`;
    const problem = entryProblem2(entry2, at) ?? nameProblem(entry2, at, kept2);
    if (problem === null) kept2.push(entry2);
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function nameProblem(entry2, at, kept2) {
  if (DEFAULT_GROUP_NAMES.includes(entry2.name)) {
    return `"${at}.name" is "${entry2.name}", the name of a default group; it is left out`;
  }
  if (kept2.some((group) => group.name === entry2.name)) {
    return `"${at}.name" repeats "${entry2.name}" of an earlier group; it is left out`;
  }
  return null;
}
function entryProblem2(entry2, at) {
  if (!isRecord(entry2)) return `"${at}" must be an object, got ${show(entry2)}; it is left out`;
  const problem = shapeProblem(entry2, at);
  return problem === null ? null : `${problem}; ${leftOut(entry2)}`;
}
function shapeProblem(entry2, at) {
  const isTest = entry2.runner !== void 0;
  const isLint = entry2.lint !== void 0;
  if (isTest && isLint) return `"${at}" has both "runner" and "lint"; a group has one`;
  if (!isTest && !isLint) return `"${at}" has neither "runner" nor "lint"; a group needs one`;
  if (isLint) {
    const testKey = TEST_ONLY.find((key) => entry2[key] !== void 0);
    if (testKey !== void 0) return `"${at}.${testKey}" needs "runner"; a lint group has none`;
    const unbuilt = TEST_GROUP_ONLY.find((key) => entry2[key] !== void 0);
    if (unbuilt !== void 0) {
      return `"${at}.${unbuilt}" applies to test groups only; a lint group has "name", "lint", "at" and "description"`;
    }
  }
  for (const key of ["name", "at"]) {
    if (entry2[key] === void 0) return `"${at}.${key}" is missing; every group needs one`;
  }
  return (isTest ? TEST_RULES : LINT_RULES)(entry2, at);
}
function leftOut(entry2) {
  return typeof entry2.name === "string" && NAME.test(entry2.name) ? `group "${entry2.name}" is left out` : "it is left out";
}

// src/core/daemon/policy-checks-settle.ts
function settleChecks(policy) {
  const why = /* @__PURE__ */ new Map();
  for (const group of policy.checks) {
    const problem = keyProblem(policy, group);
    if (problem !== null) why.set(group, problem);
  }
  const defaults = new Map(defaultGroups(policy).map((group) => [group.name, group.at]));
  for (let changed = true; changed; ) {
    const alive = policy.checks.filter((group) => !why.has(group));
    const byName = new Map(alive.map((group) => [group.name, group]));
    const found2 = /* @__PURE__ */ new Map();
    for (const group of alive) {
      const problem = afterProblem(group, byName, defaults, policy.checks) ?? cycleOf(group, byName);
      if (problem !== null) found2.set(group, problem);
    }
    for (const [group, problem] of found2) why.set(group, problem);
    changed = found2.size > 0;
  }
  return {
    checks: policy.checks.filter((group) => !why.has(group)),
    problems: policy.checks.flatMap((group) => {
      const problem = why.get(group);
      return problem === void 0 ? [] : [`"checks" group "${group.name}": ${problem}; it is left out`];
    })
  };
}
function keyProblem(policy, group) {
  if ("lint" in group) {
    if (group.lint === true) return null;
    const missing = group.lint.find((tool) => !policy.lint.tools.includes(tool));
    return missing === void 0 ? null : `"lint" names "${missing}", which "lint.tools" does not run`;
  }
  if (group.project === void 0 || group.runner === "vitest") return null;
  const projects = group.runner === "nodeTest" ? policy.nodeTest : policy.pytest;
  return projects.some((project) => project.name === group.project) ? null : `"project" names no ${group.runner} project "${group.project}"`;
}
function afterProblem(group, byName, defaults, all) {
  for (const name2 of group.after ?? []) {
    const named2 = byName.get(name2);
    if (named2 !== void 0 && "lint" in named2) {
      return `"after" names "${name2}", a lint group; a group follows test groups only`;
    }
    const at = named2?.at ?? defaults.get(name2);
    if (at === void 0) {
      return all.some((other) => other.name === name2) ? `"after" names "${name2}", a group that is left out` : `"after" names no group "${name2}"`;
    }
    if (CHECK_MOMENTS.indexOf(at) > CHECK_MOMENTS.indexOf(group.at)) {
      return `"after" names "${name2}", a group at "${at}", later than its own "${group.at}"`;
    }
  }
  return null;
}
function cycleOf(group, byName) {
  const seen = /* @__PURE__ */ new Set();
  const paths = [[group.name]];
  for (let path = paths.pop(); path !== void 0; path = paths.pop()) {
    for (const next of byName.get(path.at(-1))?.after ?? []) {
      if (next === group.name) return `"after" makes a cycle (${[...path, next].join(" after ")})`;
      if (seen.has(next) || !byName.has(next)) continue;
      seen.add(next);
      paths.push([...path, next]);
    }
  }
  return null;
}

// src/core/daemon/policy-code.ts
var boolean2 = (v) => typeof v === "boolean" ? null : "true or false";
var globs2 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? compiles(v) : "an array of strings";
var aboveZero2 = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "a number > 0";
var CODE_SHAPE = {
  complexity: {
    enabled: boolean2,
    threshold: positiveInteger,
    include: globs2,
    exclude: globs2,
    maxFileBytes: positiveInteger,
    blocking: boolean2
  },
  coverage: { enabled: boolean2, untested: boolean2, exclude: globs2, children: boolean2 },
  crap: { enabled: boolean2, threshold: aboveZero2 }
};

// src/core/types/policy-containers.ts
var CONTAINER_TARGET_DEFAULTS = {
  keyMode: "build-content",
  dockerfileInputs: [],
  dependencyServices: [],
  env: {}
};

// src/core/runner-host/remote/tree-wire.ts
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

// src/core/hash/blob.ts
import { constants } from "node:fs";
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/runner-host/remote/tree-wire.ts
var LOG_BYTES = 2 * 1024 * 1024;
function insideRoot2(path) {
  if (path === "" || path.startsWith("/") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts[0] === ".git") return false;
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}
var zip = promisify(gzip);
var unzip = promisify(gunzip);

// src/core/daemon/policy-remote.ts
var boolean3 = (v) => typeof v === "boolean" ? null : "true or false";
var kept = (key, bad) => (value) => {
  if (!Array.isArray(value) || !value.every((entry2) => typeof entry2 === "string")) {
    return "an array of strings";
  }
  const good = [];
  const problems = [];
  value.forEach((entry2, index) => {
    const why = bad(entry2);
    if (why === null) good.push(entry2);
    else problems.push(`"${key}[${index}]" ${why}; it is left out`);
  });
  return { kept: good, problems };
};
function commandName(entry2) {
  return /^[^-\s/\\][^\s/\\]*$/.test(entry2) && !new RegExp("\\p{Cc}", "u").test(entry2);
}
var nameProblem2 = (entry2) => commandName(entry2) ? null : `must be a command name such as "git", got ${JSON.stringify(entry2)}`;
var commandList = kept("requires.commands", nameProblem2);
function needProblem(entry2) {
  if (typeof entry2 === "string") return nameProblem2(entry2);
  const expected = `must be a command name or { "command": "<name>", "version": "<argument>" }, got ${JSON.stringify(entry2)}`;
  if (!isRecord(entry2) || Object.keys(entry2).some((key) => key !== "command" && key !== "version")) {
    return expected;
  }
  const { command, version } = entry2;
  if (typeof command !== "string" || !commandName(command)) return expected;
  const argument = typeof version === "string" && version !== "" && !new RegExp("\\p{Cc}", "u").test(version);
  return version === void 0 || argument ? null : expected;
}
var commands = (value) => {
  if (Array.isArray(value)) return commandList(value);
  if (!isRecord(value))
    return "an array of command names, or an object of test-file globs to lists of them";
  const good = {};
  const problems = [];
  for (const [glob, entries] of Object.entries(value)) {
    const at = `"requires.commands.${glob}"`;
    const bad = glob === "*" ? null : compiles([glob])?.problem ?? null;
    if (bad !== null) problems.push(`${at} ${bad}; it is left out`);
    else if (!Array.isArray(entries)) {
      problems.push(
        `${at} must be an array of commands, got ${JSON.stringify(entries)}; it is left out`
      );
    } else {
      good[glob] = entries.filter((entry2, index) => {
        const why = needProblem(entry2);
        if (why !== null)
          problems.push(`"requires.commands.${glob}[${index}]" ${why}; it is left out`);
        return why === null;
      });
    }
  }
  return { kept: good, problems };
};
var needsRepository = kept("remote.needsRepository", (glob) => compiles([glob])?.problem ?? null);
var alwaysLocal = kept("remote.alwaysLocal", (glob) => compiles([glob])?.problem ?? null);
var setup = (value) => value === null || typeof value === "string" && insideRoot2(value) ? null : 'null or a repository-relative path to a script, such as ".squeal/remote-setup.sh"';
var REMOTE_SHAPE = {
  requires: { commands },
  remote: { allowed: boolean3, needsRepository, alwaysLocal, setup }
};

// src/core/daemon/policy-containers.ts
function dockerToken(value) {
  return typeof value === "string" && /^[^-\s]\S*$/.test(value) && !new RegExp("\\p{Cc}", "u").test(value);
}
var token = (what) => (v) => dockerToken(v) ? null : `${what} with no space, control character or leading "-"`;
var KEY_MODES = ["build-content", "image-id"];
var keyMode = (v) => KEY_MODES.includes(v) ? null : '"build-content" or "image-id"';
var workdir = (v) => typeof v === "string" && v.startsWith("/") && !new RegExp("\\p{Cc}", "u").test(v) ? null : "an absolute POSIX path such as /app";
var listOf = (what, each) => (v) => Array.isArray(v) && v.every(each) ? null : `an array of ${what}`;
var repositoryPath = (v) => typeof v === "string" && v !== "" && !v.startsWith("\\") && insideRoot(v) === null;
var FIELDS2 = {
  image: token("an image name"),
  network: token("a network name"),
  workdir,
  keyMode,
  dockerfileInputs: listOf("repository-relative paths", repositoryPath),
  dependencyServices: listOf("service names", dockerToken),
  env: variables
};
function targetProblem(entry2) {
  if (!isRecord(entry2)) return `must be an object, got ${JSON.stringify(entry2)}`;
  const unknown = Object.keys(entry2).find((key) => !Object.hasOwn(FIELDS2, key));
  if (unknown !== void 0) return `has unknown key "${unknown}"`;
  if (entry2.image === void 0) return 'has no "image"';
  for (const [key, field] of Object.entries(FIELDS2)) {
    const given = entry2[key];
    if (given === void 0) continue;
    const expected = field(given);
    if (expected !== null) {
      const why = typeof expected === "object" ? expected.problem : `must be ${expected}`;
      return `"${key}" ${why}, got ${JSON.stringify(given)}`;
    }
  }
  return null;
}
function containerTargets(value) {
  if (!isRecord(value)) return "an object from target name to a container target";
  const kept2 = {};
  const problems = [];
  for (const [name2, entry2] of Object.entries(value)) {
    const problem = commandName(name2) ? targetProblem(entry2) : 'has a name with a space, "/", "\\", control character or leading "-"';
    if (problem === null) {
      kept2[name2] = {
        ...CONTAINER_TARGET_DEFAULTS,
        ...entry2
      };
    } else problems.push(`"containers.${name2}" ${problem}; it is left out`);
  }
  return { kept: kept2, problems };
}
var RUNNER_LISTS = ["nodeTest", "pytest", "jest"];
function settleContainers(policy) {
  const problems = [];
  let settled2 = policy;
  for (const list of RUNNER_LISTS) {
    const projects = policy[list];
    const kept2 = projects.filter((project) => {
      const { container } = project;
      if (container === void 0 || Object.hasOwn(policy.containers, container)) return true;
      problems.push(
        `"${list}" project ${JSON.stringify(project.name)} names container ${JSON.stringify(container)}, which "containers" does not declare; it is skipped`
      );
      return false;
    });
    if (kept2.length !== projects.length) settled2 = { ...settled2, [list]: kept2 };
  }
  return { policy: settled2, problems };
}

// src/core/daemon/policy-gate.ts
var groups = (v) => v === null || Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of check-group names, or null";
var GATE_SHAPE = { gate: { groups } };

// src/core/daemon/policy-jest.ts
import { posix as posix3 } from "node:path";
var CONFIG_EXTENSIONS = [
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json"
];
var configPath = (v) => nonEmptyString(v) ?? insideRoot(v);
var positiveInteger3 = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
var FIELDS3 = {
  name: nonEmptyString,
  config: configPath,
  project: nonEmptyString,
  cwd: insideRoot,
  include: globs,
  exclude: globs,
  args: strings,
  env: variables,
  slow: boolean,
  batchSize: positiveInteger3,
  warmMemoryLimitMb: positiveInteger3,
  container: nonEmptyString
};
var REQUIRED2 = /* @__PURE__ */ new Set(["name", "config"]);
function jestProjects(value, path) {
  return projectEntries(value, path, FIELDS3, REQUIRED2, withDefaults2, configFile);
}
function withDefaults2(entry2) {
  return {
    ...entry2,
    include: entry2.include ?? [],
    exclude: entry2.exclude ?? [],
    args: entry2.args ?? [],
    env: entry2.env ?? {}
  };
}
var configFile = (entry2) => {
  const config = posix3.basename(entry2.config.replaceAll("\\", "/"));
  if (config === "package.json" || CONFIG_EXTENSIONS.includes(posix3.extname(config))) return null;
  return {
    key: "config",
    problem: `must name a Jest config file (${CONFIG_EXTENSIONS.join(", ")}) or a package.json, got ${JSON.stringify(entry2.config)}`
  };
};

// src/core/daemon/policy-lint.ts
var boolean4 = (v) => typeof v === "boolean" ? null : "true or false";
var globs3 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? compiles(v) : "an array of strings";
var TOOL_NAMES = ["eslint", "oxlint"];
var tools = (v) => Array.isArray(v) && v.every((s) => TOOL_NAMES.includes(s)) ? null : `an array of ${TOOL_NAMES.join(" and ")}`;
var LINT_SHAPE = {
  lint: { enabled: boolean4, include: globs3, exclude: globs3, blocking: boolean4, tools }
};

// src/core/daemon/policy-node.ts
var node = (v) => v === "project" || v === "session" ? null : '"project" or "session"';
var NODE_SHAPE = { node };

// src/core/daemon/policy-pytest.ts
import { isAbsolute as isAbsolute2, posix as posix4 } from "node:path";
var FIELDS4 = {
  name: nonEmptyString,
  cwd: insideRoot,
  python: nonEmptyString,
  args: strings,
  env: variables,
  include: globs,
  exclude: globs,
  slow: boolean,
  batchSize: positiveInteger4,
  slots,
  container: nonEmptyString
};
var REQUIRED3 = /* @__PURE__ */ new Set(["name", "include"]);
function positiveInteger4(value) {
  return Number.isInteger(value) && value > 0 ? null : "a positive integer";
}
var SLOT_FIELDS = {
  toxParallelEnv: boolean,
  max: positiveInteger4
};
function slots(value) {
  const valid = isRecord(value) && Object.entries(value).every(([k, v]) => SLOT_FIELDS[k]?.(v) === null);
  return valid ? null : "{ toxParallelEnv?: true or false, max?: a positive integer }";
}
function pytestProjects(value, path) {
  return projectEntries(value, path, FIELDS4, REQUIRED3, withDefaults3, pythonInsideRoot);
}
function withDefaults3(entry2) {
  return { ...entry2, args: entry2.args ?? [], env: entry2.env ?? {} };
}
var pythonInsideRoot = (entry2) => {
  const python = entry2.python;
  if (python === void 0 || isAbsolute2(python)) return null;
  const path = posix4.join(entry2.cwd ?? ".", python.replaceAll("\\", "/"));
  if (insideRoot(path) === null) return null;
  return {
    key: "python",
    problem: `must stay inside the worktree when relative (absolute only for an environment outside it), got ${JSON.stringify(python)}`
  };
};

// src/core/keys/observed.ts
import { createHash as createHash2 } from "node:crypto";
var ABSENT_LISTING = createHash2("sha1").update("\0absent").digest("hex");
var EMPTY_LISTING = createHash2("sha1").update("\0empty").digest("hex");

// src/core/keys/runtime-files.ts
function normalizeRuntimePath(given) {
  const path = given.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const parts = path.split("/");
  if (!path || path === "." || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\0") || /[*?{}[\]!]/.test(path) || parts.some((part) => ["..", ".git", "node_modules"].includes(part)) || path.endsWith("/"))
    throw new Error(`invalid exact runtime file: ${given}`);
  return parts.filter((part) => part !== "" && part !== ".").join("/");
}

// src/core/daemon/policy-runtime.ts
var runtimeFiles = (value) => {
  if (!Array.isArray(value)) return "an array of runtime-file rules";
  const kept2 = [];
  const problems = [];
  for (const [i, rule] of value.entries()) {
    try {
      if (!isRecord(rule)) throw new Error("must be an object");
      const unknown = Object.keys(rule).filter(
        (key) => !["project", "tests", "paths"].includes(key)
      );
      if (unknown.length) throw new Error(`unknown fields: ${unknown.join(", ")}`);
      if (typeof rule.project !== "string") throw new Error("project must be a string");
      for (const key of ["tests", "paths"]) {
        if (!Array.isArray(rule[key]) || rule[key].length === 0 || !rule[key].every((v) => typeof v === "string" && v.length > 0))
          throw new Error(`${key} must be a nonempty array of nonempty strings`);
      }
      const tests2 = rule.tests.map(
        (glob) => glob.replaceAll("\\", "/").replace(/^(\.\/)+/, "")
      );
      if (tests2.some((glob) => glob.startsWith("!") || glob.includes("\0")))
        throw new Error("invalid test glob");
      const problem = compiles(tests2);
      if (problem !== null)
        throw new Error(typeof problem === "string" ? problem : problem.problem);
      kept2.push({
        project: rule.project,
        tests: tests2,
        paths: [...new Set(rule.paths.map(normalizeRuntimePath))].sort()
      });
    } catch (error) {
      problems.push(`runtimeFiles[${i}]: ${error.message}`);
    }
  }
  return { kept: kept2, problems };
};

// src/core/daemon/policy-shared.ts
var RESERVED = ["refs/heads", "refs/tags", "refs/remotes"];
var COMPONENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
function isSharedRef(prefix) {
  const parts = prefix.split("/");
  if (parts[0] !== "refs" || parts.length < 2) return false;
  if (RESERVED.some((r) => prefix === r || prefix.startsWith(`${r}/`))) return false;
  return parts.slice(1).every((p) => COMPONENT.test(p) && !p.includes("..") && !p.endsWith(".lock"));
}
var ref = (v) => v === null || typeof v === "string" && isSharedRef(v) ? null : 'a ref prefix outside refs/heads, refs/tags and refs/remotes, such as "refs/squeal", or null';
var MAX_LOOK_AGAIN_SECONDS = 2147483;
var seconds = (min) => (v) => Number.isInteger(v) && v >= min && v <= MAX_LOOK_AGAIN_SECONDS ? null : `a whole number from ${min} to ${MAX_LOOK_AGAIN_SECONDS}`;
var SHARED_SHAPE = {
  shared: { ref, lookAgain: { everySeconds: seconds(1), forSeconds: seconds(0) } }
};

// src/core/daemon/policy-slow.ts
function slowInclude(value) {
  if (!Array.isArray(value) || !value.every((glob) => typeof glob === "string")) {
    return "an array of strings";
  }
  const kept2 = [];
  const problems = [];
  value.forEach((glob, index) => {
    const bad = compiles([glob]);
    if (bad === null) kept2.push(glob);
    else problems.push(`"slow.include[${index}]" ${bad.problem}; it is left out`);
  });
  return { kept: kept2, problems };
}

// src/core/daemon/policy.ts
var POLICY_FILE = "squeal.config.json";
var boolean5 = (v) => typeof v === "boolean" ? null : "true or false";
var strings2 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
var inputs = (v) => {
  const isList = strings2(v) === null;
  if (!isList && !(isRecord(v) && Object.values(v).every((globs5) => strings2(globs5) === null))) {
    return "an array of strings, or an object from test-file glob to an array of strings";
  }
  const globs4 = isList ? v : Object.entries(v).flatMap(([test, input]) => [test, ...input]);
  return compiles(globs4);
};
var atLeastZero2 = (v) => isNumber2(v) && v >= 0 ? null : "a number >= 0";
var aboveZero3 = (v) => isNumber2(v) && v > 0 ? null : "a number > 0";
var orNull = (leaf) => (v) => {
  const expected = v === null ? null : leaf(v);
  return expected === null || typeof expected === "object" ? expected : `${expected}, or null`;
};
var oneOf3 = (...values) => (v) => values.includes(v) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;
var SHAPE = {
  interrupt: { onRegression: boolean5 },
  stop: {
    blockOnKnownFailures: boolean5,
    requireFullSuite: boolean5,
    waitMs: atLeastZero2,
    requireSlowSuite: boolean5,
    slowWaitMs: atLeastZero2,
    // Spec 019 D4 step 3.
    maxHolds: positiveInteger
  },
  // Spec 019 D1.
  checks: checkGroups,
  testCommand: { denyWhenCurrent: boolean5 },
  baseline: { onStart: oneOf3("lookup-then-run-missing", "lookup-only") },
  inputs,
  runtimeFiles,
  observe: { runtimeInputs: boolean5 },
  env: { allowlist: strings2 },
  runner: {
    tierSize: positiveInteger,
    backlogTierSize: positiveInteger,
    timeoutMs: orNull(positiveInteger),
    // Spec 021 D20.4 (row 021-26).
    hostIdleMinutes: orNull(hostIdleMinutes)
  },
  nodeTest: (v) => nodeTestProjects(v, "nodeTest"),
  pytest: (v) => pytestProjects(v, "pytest"),
  // Spec 028 D1 (row 028-05).
  jest: (v) => jestProjects(v, "jest"),
  // Spec 027 D4 (row 027-04).
  containers: containerTargets,
  vitest: { excludeProjects: strings2, exclude: (v) => strings2(v) ?? compiles(v) },
  slow: {
    include: slowInclude,
    maxWorkers: positiveInteger,
    maxLoadPerCpu: aboveZero3,
    maxDeferMs: atLeastZero2,
    maxParallel: positiveInteger,
    rank: oneOf3("tokens", "duration"),
    // Spec 004 D2, D7 as amended 2026-10-18 (row 004-80).
    trigger: oneOf3("continuous", "idle"),
    quietMs: atLeastZero2
  },
  delivery: { uncoveredEdits: boolean5 },
  daemon: {
    idleExitMinutes: aboveZero3,
    unusedExitMinutes: aboveZero3,
    // Spec 023 D7.4 (row 023-40).
    maxCommitDaemons: orNull(positiveInteger)
  },
  store: { retentionDays: atLeastZero2, maxSizeMb: orNull(aboveZero3) },
  ...CODE_SHAPE,
  ...LINT_SHAPE,
  ...SHARED_SHAPE,
  ...REMOTE_SHAPE,
  ...GATE_SHAPE,
  ...NODE_SHAPE
};
function loadPolicy(root) {
  const loaded = loadConfigFile(join4(root, POLICY_FILE), SHAPE, UNSET_EXITS);
  const last = lastPolicies.get(root);
  if (last?.loaded === loaded) return last.policy;
  const policy = settle(loaded);
  lastPolicies.set(root, { loaded, policy });
  return policy;
}
var lastPolicies = /* @__PURE__ */ new Map();
function settle(loaded) {
  const named2 = settleJestNames(loaded.value);
  const contained = settleContainers(named2.policy);
  const settled2 = settleChecks(contained.policy);
  return {
    policy: withExits(
      settled2.problems.length === 0 ? contained.policy : { ...contained.policy, checks: settled2.checks }
    ),
    problems: [...loaded.problems, ...named2.problems, ...contained.problems, ...settled2.problems],
    ...loaded.unparsed === true ? { unparsed: true } : {},
    ...loaded.unknownKeys === void 0 ? {} : { unknownKeys: loaded.unknownKeys }
  };
}
function settleJestNames(policy) {
  if (policy.jest.length === 0) return { policy, problems: [] };
  const taken = new Set([...policy.nodeTest, ...policy.pytest].map((project) => project.name));
  const problems = [];
  const jest = policy.jest.filter((project) => {
    if (!taken.has(project.name)) return true;
    problems.push(
      `"jest" project ${JSON.stringify(project.name)} has the name of another project, and names are unique across runners; it is skipped`
    );
    return false;
  });
  return { policy: jest.length === policy.jest.length ? policy : { ...policy, jest }, problems };
}
var UNSET_EXITS = {
  ...DEFAULT_POLICY,
  daemon: { ...DEFAULT_POLICY.daemon, idleExitMinutes: Number.NaN, unusedExitMinutes: Number.NaN }
};
function withExits(policy) {
  const { idleExitMinutes: idle, unusedExitMinutes: unused } = policy.daemon;
  const defaults = DEFAULT_POLICY.daemon;
  const set = { idleExitMinutes: !Number.isNaN(idle), unusedExitMinutes: !Number.isNaN(unused) };
  const daemon = {
    ...policy.daemon,
    idleExitMinutes: set.idleExitMinutes ? idle : defaults.idleExitMinutes,
    unusedExitMinutes: set.unusedExitMinutes ? unused : defaults.unusedExitMinutes,
    ...set.idleExitMinutes || set.unusedExitMinutes ? { set } : {}
  };
  return { ...policy, daemon };
}
function readPolicy(root) {
  return loadPolicy(root).policy;
}
function isNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/daemon/version.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname3, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var PACKAGE_NAME = "squeal";
function squealVersion() {
  if (true) return "0.1.664";
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}
function manifestVersion(module) {
  let dir = dirname3(fileURLToPath(module));
  for (; ; ) {
    const version = readVersion(join5(dir, "package.json"));
    if (version !== null) return version;
    const parent2 = dirname3(dir);
    if (parent2 === dir) return null;
    dir = parent2;
  }
}
function readVersion(path) {
  try {
    const parsed2 = JSON.parse(readFileSync5(path, "utf8"));
    if (typeof parsed2 !== "object" || parsed2 === null) return null;
    const { name: name2, version } = parsed2;
    return name2 === PACKAGE_NAME && typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}
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

// src/core/status/ignored-config.ts
var ADDED = {
  // `research/issue-120.md`: 0.1.369 added it; without it, the observed files stay in the keys.
  runtimeFiles: {
    in: "0.1.369",
    cost: "extra re-runs: a change to a runtime file it names re-runs the tests that read it"
  }
};
function ignoredConfigOf(root, daemon, own = squealVersion()) {
  const { policy, unknownKeys = [] } = loadPolicy(root);
  const differs = daemon !== null && daemon !== own ? { daemonVersion: daemon } : {};
  const rules = unknownKeys.map((key) => ({
    key,
    by: "command",
    version: own,
    ...differs
  }));
  for (const [key, added] of Object.entries(ADDED)) {
    const name2 = key;
    if (daemon === null || !isNewerVersion(added.in, daemon)) continue;
    if (isDeepStrictEqual(policy[name2], DEFAULT_POLICY[name2])) continue;
    rules.push({ key, by: "daemon", version: daemon, addedIn: added.in, cost: added.cost });
  }
  return rules.length === 0 ? {} : { ignoredConfig: rules };
}
function liveDaemonVersion(worktree, liveness) {
  const serving = liveness?.state === "alive" && liveness.stopping === void 0;
  return serving ? worktree?.daemon?.squealVersion ?? null : null;
}
function ignoredConfigAt(worktree, liveness) {
  return worktree === null ? {} : ignoredConfigOf(worktree.root, liveDaemonVersion(worktree, liveness));
}
function ignoredConfigLines(result, command, own = squealVersion()) {
  const rules = result.ignoredConfig ?? [];
  const unknown = /* @__PURE__ */ new Map();
  for (const rule of rules.filter((r) => r.by === "command")) {
    const group = `${rule.version} ${rule.daemonVersion ?? ""}`;
    unknown.set(group, [...unknown.get(group) ?? [], rule]);
  }
  return [
    ...[...unknown.values()].map((group) => unknownLine(group, command)),
    ...rules.filter((r) => r.by === "daemon").map(
      (r) => `Not applied: ${POLICY_FILE} key "${r.key}": the daemon runs squeal ${r.version}${r.addedIn === void 0 ? ", which does not apply it" : `, older than ${r.addedIn}, which added it`}.${r.cost === void 0 ? "" : ` Cost: ${r.cost}.`} \`${command} stop\`, then \`${command} start\`, starts squeal ${own} in its place.`
    )
  ];
}
function unknownLine(rules, command) {
  const [first] = rules;
  const one = rules.length === 1;
  const it = one ? "it" : "them";
  const keys = listPaths(rules.map((r) => `"${r.key}"`));
  const daemon = first?.daemonVersion === void 0 ? "" : `; the daemon runs squeal ${first.daemonVersion}, and whether it applies ${it} is not known`;
  return [
    `Not applied: ${POLICY_FILE} ${one ? "key" : "keys"} ${keys} ${one ? "is" : "are"} unknown to squeal ${first?.version}, the version that read ${it} here:`,
    `${one ? "a typo, or a key" : "typos, or keys"} a newer Squeal added. Validation goes on without ${it}${daemon}.`,
    `\`${command} setup --check\` names each problem; \`${command} update\` installs the newest Squeal, and a session keeps the version it started on until it restarts.`
  ].join(" ");
}

// src/core/scheduler/head-move-record.ts
function headMoveMetaKey(worktreeId) {
  return worktreeMetaKey("headMove", worktreeId);
}
function readHeadMove(store, worktreeId) {
  const raw = store.meta.get(headMoveMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    const { head, dirty, revision } = value;
    if (head !== null && typeof head !== "string") return null;
    if (typeof dirty !== "boolean" || !Number.isInteger(revision)) return null;
    return { head, dirty, revision };
  } catch {
    return null;
  }
}

// src/core/state/revision-commit.ts
function readRevisionCommit(store, worktreeId, latest = store.revisions.latest(worktreeId)) {
  const moved = readHeadMove(store, worktreeId);
  const number = latest?.number ?? 0;
  if (moved !== null && moved.revision >= number && moved.head !== latest?.head) {
    return moved.head === null ? void 0 : { head: moved.head, sinceHead: 0, dirty: moved.dirty };
  }
  if (latest === null || latest.head === null) return void 0;
  const current2 = moved !== null && moved.revision >= number;
  const other = store.revisions.lastAtOtherHead(worktreeId, latest.head);
  const since = moved !== null && moved.head === latest.head && moved.revision >= (other ?? 0) ? moved.revision : other === null ? 0 : other + 1;
  const dirty = current2 ? moved.dirty : latest.dirty;
  return { head: latest.head, sinceHead: Math.max(0, number - since), dirty };
}

// src/core/status/git-head.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { join as join7 } from "node:path";

// src/core/fs/git.ts
import { spawn } from "node:child_process";
var REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY"
];
function runGit(cwd, args, options = {}) {
  const okCodes = options.okCodes ?? [0];
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name2 of REPOSITORY_VARIABLES) delete env[name2];
  return new Promise((resolve8, reject) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = options.timeoutMs === void 0 ? void 0 : setTimeout(() => {
      child.kill();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(
        new Error(
          `squeal: git ${args.join(" ")} timed out after ${options.timeoutMs} ms in ${cwd}`
        )
      );
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`squeal: git ${args.join(" ")} failed in ${cwd}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== null && okCodes.includes(code)) {
        resolve8(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`squeal: git ${args.join(" ")} exited ${code} in ${cwd}: ${message}`));
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(options.input ?? "");
  });
}
function splitNul(output) {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}

// src/core/fs/git-layout.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync3, lstatSync, readFileSync as readFileSync6, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute3, join as join6, resolve as resolve2 } from "node:path";
var GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
function findWorktreeRoot(path) {
  let dir = resolve2(path);
  if (existsSync3(dir)) dir = realpathSync2(dir);
  for (; ; ) {
    if (existsSync3(join6(dir, ".git"))) return dir;
    const parent2 = dirname4(dir);
    if (parent2 === dir) return null;
    dir = parent2;
  }
}
function worktreeIdFor(root) {
  return worktreeIdOfRealPath(realpathSync2(root));
}
function worktreeIdOfRealPath(realPath3) {
  return createHash3("sha256").update(realPath3).digest("hex").slice(0, 16);
}
function gitDirOf(root) {
  return dotGit(root)?.gitDir ?? null;
}
function resolveCommonDir(root) {
  const entry2 = dotGit(root);
  if (entry2 === null) return null;
  if (!entry2.isFile) return realpathSync2(entry2.gitDir);
  const { gitDir } = entry2;
  if (lstatOrNull(gitDir) === null) return null;
  const commondirFile = join6(gitDir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync2(gitDir);
  const commondir = readFileSync6(commondirFile, "utf8").trim();
  const common = isAbsolute3(commondir) ? commondir : resolve2(gitDir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync2(common);
}
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
function dotGit(root) {
  const path = join6(root, ".git");
  const stat = lstatOrNull(path);
  if (stat === null) return null;
  if (stat.isDirectory()) return { gitDir: path, isFile: false };
  if (!stat.isFile()) return null;
  const match = GITDIR_LINE.exec(readFileSync6(path, "utf8"));
  return match?.[1] ? { gitDir: resolve2(root, match[1]), isFile: true } : null;
}

// src/core/status/git-head.ts
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = gitDirOf(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read(join7(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref2 = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref2 === void 0) return null;
    value = read(join7(gitDir, ref2)) ?? read(join7(commonDir, ref2)) ?? packed(commonDir, ref2);
  }
  return null;
}
async function gitHead(root, options = {}) {
  const head = readGitHead(root);
  if (head !== null) return head;
  const verify = ["rev-parse", "--verify", "-q", "HEAD"];
  const out = await runGit(root, verify, { ...options, okCodes: [0, 1] });
  return out.trim() || null;
}
function packed(commonDir, ref2) {
  for (const line of (read(join7(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name2] = line.split(" ");
    if (name2 === ref2 && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read(path) {
  try {
    return readFileSync7(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// src/core/status/stopping.ts
function shortText(short, command) {
  const at = new Date(short.since).toISOString();
  return `the handoff to ${short.claimed} ended at ${at} with a ${short.version} daemon, which validates; no hook asks it to step down again, and \`${command} start\` of ${short.claimed} replaces it`;
}
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);
function stoppingState(stopping, age) {
  const what = stopping.to === void 0 ? "stopping" : `handing over from ${stopping.from} to ${stopping.to}`;
  const at = new Date(stopping.since).toISOString();
  const past = stopping.overdue ? `, past its ${BOUND_S} s bound` : "";
  return `${what} since ${at}${age === void 0 ? "" : ` (${age})`}${past}`;
}
function stoppingNext(stopping, command) {
  if (stopping.overdue) return `\`${command} start\` finishes it`;
  return stopping.to === void 0 ? "nothing validates until its lock frees" : `${stopping.to} serves once the old daemon's lock frees`;
}
function stoppingText(stopping, command, age) {
  return `${stoppingState(stopping, age)}; ${stoppingNext(stopping, command)}`;
}

// src/core/state/file-class.ts
var noPending = () => ({
  test: { queued: 0, running: 0, none: 0 },
  file: { queued: 0, running: 0, none: 0 },
  setup: { queued: 0, running: 0, none: 0 }
});
function phasesOf(pending, held, filePhase) {
  const all = pending.queued + pending.running + pending.none;
  if (held) return { queued: 0, running: all };
  const none3 = filePhase ?? "queued";
  return {
    queued: pending.queued + (none3 === "queued" ? pending.none : 0),
    running: pending.running + (none3 === "running" ? pending.none : 0)
  };
}
function isNotable(state) {
  return state.outcome === "fail" || state.validity === "unknown" || state.check.kind === "setup";
}
var counted = /* @__PURE__ */ new WeakMap();
function worktreeStatesOf(states) {
  if (!Object.isFrozen(states)) return countStates(states);
  let counts = counted.get(states);
  if (counts === void 0) {
    counts = countStates(states);
    counted.set(states, counts);
  }
  return counts;
}
function countStates(states) {
  const groups2 = /* @__PURE__ */ new Map();
  const own = /* @__PURE__ */ new Map();
  for (const state of states) {
    const origin = state.validity === "current" ? state.origin : null;
    const id = JSON.stringify([state.check.kind, state.validity, state.outcome, origin]);
    const group = groups2.get(id);
    if (group === void 0) {
      const { validity, outcome } = state;
      groups2.set(id, { kind: state.check.kind, validity, outcome, origin, count: 1 });
    } else group.count++;
    const file = testFileKeyOf(state.check);
    const list = own.get(file);
    if (list === void 0) own.set(file, [state]);
    else list.push(state);
  }
  const files2 = /* @__PURE__ */ new Map();
  for (const [id, list] of own) files2.set(id, fileStatesOf(list));
  return { groups: [...groups2.values()], files: files2, notable: states.filter(isNotable) };
}
function fileStatesOf(own) {
  let currentAt = null;
  let currentUpTo = null;
  const pending = noPending();
  for (const s of own) {
    if (s.validity === "pending") pending[s.check.kind][s.pendingPhase ?? "none"]++;
    if (s.validity !== "current" || s.observedAt === null) continue;
    currentAt = currentAt === null ? s.observedAt : Math.min(currentAt, s.observedAt);
    currentUpTo = currentUpTo === null ? s.observedAt : Math.max(currentUpTo, s.observedAt);
  }
  return {
    testFile: testFileOf(own[0].check),
    all: tallyOf(own),
    checks: tallyOf(own.filter((s) => s.check.kind !== "setup")),
    currentAt,
    currentUpTo,
    pending
  };
}
var isRunning = (state) => state.pendingPhase === "running";
function tallyOf(own) {
  const validity = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const outcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  for (const s of own) {
    validity[s.validity]++;
    outcome[s.outcome]++;
  }
  return { count: own.length, validity, outcome, running: own.some(isRunning) };
}
var NO_STATES = tallyOf([]);
function classOf(row, own = NO_STATES) {
  const has = (validity) => own.validity[validity] > 0;
  const queued = row !== void 0 && row.key !== null && row.pending !== null;
  const unkeyed = row === void 0 || row.key === null;
  if (queued || has("pending")) return "pending";
  if (unkeyed || own.count === 0 || has("unknown")) return "unknown";
  return has("stale") ? "stale" : "current";
}
function notCurrentOf(states, keys, openFiles = /* @__PURE__ */ new Set(), onRequest = /* @__PURE__ */ new Set()) {
  const testFileCounts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const testFilesByPhase = { running: 0, queued: 0, onRequest: 0 };
  const testsByPhase = { running: 0, queued: 0, onRequest: 0 };
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = states.files.get(id)?.checks;
    const fileClass = classOf(row, own);
    testFileCounts[fileClass]++;
    if (fileClass !== "pending") continue;
    const running = openFiles.has(id) || row.pending === "running" || own?.running === true;
    testFilesByPhase[running ? "running" : onRequest.has(id) ? "onRequest" : "queued"]++;
  }
  const filePhase = new Map(keys.map((row) => [testFileId(row.testFile), row.pending]));
  for (const [id, file] of states.files) {
    const phases = phasesOf(file.pending.test, openFiles.has(id), filePhase.get(id));
    testsByPhase[onRequest.has(id) ? "onRequest" : "queued"] += phases.queued;
    testsByPhase.running += phases.running;
  }
  return {
    testFileCounts,
    testFilesByPhase: withoutZero(testFilesByPhase),
    testsByPhase: withoutZero(testsByPhase)
  };
}
function withoutZero({ onRequest, ...phases }) {
  return onRequest === 0 ? phases : { ...phases, onRequest };
}

// src/core/status/status-detail.ts
function holdAcrossEditsText(command) {
  return `For a manual run across edits, \`${command} hold -- <command>\` holds validation until the command exits.`;
}
function untilStartText(command) {
  return `stopped until \`${command} start\` (\`${command} stop --until-start\`)`;
}
function lateHeartbeatDetail(late, since) {
  const at = since === null ? "" : `, at ${new Date(since).toISOString()}`;
  return `the last one was ${ageText(late.ageMs)} ago${at}; the daemon may be busy or stopped`;
}
function ageText(ms) {
  return ms < AGE_HOURS_FROM_MS ? durationText(ms) : `${Math.round(ms / 36e5)} h`;
}
var AGE_HOURS_FROM_MS = 2 * 36e5;
function startStoppedText(since, time = (at) => new Date(at).toISOString()) {
  const at = since === null ? "" : ` since ${time(since)}`;
  return `a daemon has been starting${at}, and it may be stopped: no results come until it runs again`;
}

// src/core/status/test-frame.ts
var V8_FRAME = /^\s*at (?:async (?!\(.*\)\s*$))?(.+?)\s*$/;
var V8_POSITION = /^(.+):(\d+):(\d+)$/;
var PYTEST_ENTRY = /^(\S[^:]*):(\d+):(?: |$)/;
var NATIVE_ENTRY = /^\s*File "(.+)", line (\d+)/;
function v8Position(frame) {
  const open2 = frame.indexOf(" (");
  const where3 = open2 !== -1 && frame.endsWith(")") ? frame.slice(open2 + 2, -1) : frame;
  const match = V8_POSITION.exec(where3);
  if (match === null) return null;
  return { path: match[1], line: Number(match[2]), column: Number(match[3]) };
}
function positions(stack) {
  return stack.split("\n").flatMap((text2) => {
    const v8 = V8_FRAME.exec(text2);
    const position = v8 === null ? null : v8Position(v8[1]);
    if (position !== null) return [position];
    const entry2 = PYTEST_ENTRY.exec(text2) ?? NATIVE_ENTRY.exec(text2);
    return entry2 === null ? [] : [{ path: entry2[1], line: Number(entry2[2]) }];
  });
}
function prefixOf(found2, location2) {
  const named2 = found2.find(
    (p) => p.line === location2.line && (p.column === void 0 || p.column === location2.column) && (p.path === location2.path || location2.path.endsWith(`/${p.path}`))
  );
  return named2 === void 0 ? null : location2.path.slice(0, -named2.path.length);
}
function testFileFrame(check, errors) {
  const first = errors[0];
  const location2 = first?.location ?? null;
  const stack = first?.stack ?? null;
  if (check.kind === "setup" || check.testPath === "" || location2 === null || stack === null) {
    return null;
  }
  if (location2.path === check.testPath) return null;
  const found2 = positions(stack);
  const prefix = prefixOf(found2, location2);
  if (prefix === null) return null;
  const frame = found2.find((p) => `${prefix}${p.path}` === check.testPath);
  if (frame === void 0) return null;
  return {
    path: check.testPath,
    line: frame.line,
    ...frame.column === void 0 ? {} : { column: frame.column }
  };
}
function positionText({ path, line, column }) {
  return column === void 0 ? `${path}:${line}` : `${path}:${line}:${column}`;
}
function locationText(location2, frame) {
  const at = positionText(location2);
  return frame === void 0 ? at : `${at}, called from ${positionText(frame)}`;
}
function atText(location2, frame) {
  return `at ${locationText(location2, frame)}`;
}

// src/core/code/pass/failed.ts
var uncountableKey = (worktreeId) => `uncountable:${worktreeId}`;
function readUncountable(meta, worktreeId) {
  const text2 = meta.get(uncountableKey(worktreeId));
  if (text2 === null) return /* @__PURE__ */ new Map();
  try {
    const record = JSON.parse(text2);
    return new Map(Object.entries(record));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function spentFailure(failed2, file) {
  const f = failed2.get(file.path);
  return f !== void 0 && f.blob === file.blob && f.retryAt === null ? f : null;
}
function uncountableFiles(store, worktreeId, files2) {
  const failed2 = readUncountable(store.meta, worktreeId);
  const spent = /* @__PURE__ */ new Map();
  if (failed2.size === 0) return spent;
  for (const file of files2) {
    const f = spentFailure(failed2, file);
    if (f === null) continue;
    if (store.counts.get(file.blob, file.language, file.counterVersion) === null)
      spent.set(file.path, f);
  }
  return spent;
}

// src/core/code/gate/rule.ts
var UNRUN_GAPS = ["not-prepared", "not-finished"];
var UNRUN = new Set(UNRUN_GAPS);

// src/core/code/crap/summary.ts
var summaryKey = (worktreeId) => `coverage:${worktreeId}`;
var crapRecountKey = (worktreeId) => `crapRecount:${worktreeId}`;
var changeKey = (worktreeId) => `coverageChange:${worktreeId}`;
var evidenceKey = (worktreeId, path) => `coverage:${worktreeId}:${path}`;
var functionKey = (fn) => `${fn.qualifiedName}\0${fn.occurrence}`;
function parse2(text2, valid) {
  if (text2 === null) return null;
  try {
    const value = JSON.parse(text2);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function readSummary(meta, worktreeId) {
  return parse2(
    meta.get(summaryKey(worktreeId)),
    (v) => isObject(v) && v.v === 1 && typeof v.since === "number" && isObject(v.files)
  );
}
function readCoverageChange(meta, worktreeId) {
  return parse2(
    meta.get(changeKey(worktreeId)),
    (v) => isObject(v) && typeof v.revision === "number" && typeof v.at === "number" && Array.isArray(v.off) && typeof v.excluded === "number"
  );
}
function readCrapRecount(meta, worktreeId) {
  return parse2(
    meta.get(crapRecountKey(worktreeId)),
    (v) => isObject(v) && typeof v.revision === "number" && typeof v.at === "number" && typeof v.threshold === "number"
  );
}
function readEvidence(meta, worktreeId, path) {
  return parse2(
    meta.get(evidenceKey(worktreeId, path)),
    (v) => isObject(v) && typeof v.blob === "string" && isObject(v.functions)
  );
}

// src/core/code/crap/seed.ts
var COVERAGE_MEASURES = ["crap", "uncovered"];

// src/core/delivery/code-coverage-words.ts
var NOT_RUN = "no test runs it in the test's own thread";
var NOT_RUN_CHILDREN = "no test runs it, in the test's own thread or in a process or thread the test starts";
var UNMEASURED = "Squeal does not measure worker threads or child processes.";
var LOWER_BOUND = "Squeal counts what the processes and threads a test starts run as a lower bound: a process that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE is not counted.";
var UNTESTED = `untested: ${NOT_RUN}`;
var UNTESTED_CHILDREN = `untested: ${NOT_RUN_CHILDREN}`;
var MEASURED = `  Coverage counts what ran in the test's own thread. ${UNMEASURED}`;
var MEASURED_CHILDREN = `  Coverage counts what ran in the test's own thread and in the processes and threads it started. ${LOWER_BOUND}`;

// src/core/delivery/code-coverage.ts
function coverageMeasures(store, worktreeId) {
  return readSummary(store.meta, worktreeId) === null ? [] : COVERAGE_MEASURES;
}
function evidenceOf(store, worktreeId, entry2) {
  if (entry2.measure === "complexity" || entry2.kind === "removed") return {};
  const [file] = store.files.list(worktreeId, [entry2.check.path]);
  const evidence = readEvidence(store.meta, worktreeId, entry2.check.path);
  const fn = evidence?.functions[functionKey(entry2.check)];
  if (file === void 0 || fn === void 0) return {};
  const count2 = store.counts.get(file.blob, file.language, file.counterVersion);
  const counted2 = count2?.functions.find(
    (f) => f.qualifiedName === entry2.check.qualifiedName && f.occurrence === entry2.check.occurrence
  );
  if (counted2 === void 0) return {};
  const [lines, covered, testFiles2, ...first] = fn;
  const children = readSummary(store.meta, worktreeId)?.children === true ? { children: true } : {};
  return {
    evidence: { complexity: counted2.complexity, lines, covered, testFiles: testFiles2, first, ...children }
  };
}
var withChildren = (e) => e?.children === true;
function fileLoadersOf(entry2) {
  if (entry2.fileLoaders !== void 0) return entry2.fileLoaders;
  const e = entry2.evidence;
  if (e?.loaders === void 0) return void 0;
  return e.processes === true ? { count: e.loaders, processes: true } : { count: e.loaders };
}
function notRun(file, after, children) {
  const reason = `${children ? NOT_RUN_CHILDREN : NOT_RUN}${after}`;
  if (file === void 0 || file.count === 0) return reason;
  return `${reason}; ${plural(file.count, "test file")} ${file.count === 1 ? "loads" : "load"} this file`;
}
var EXCLUDE_HINT = "To stop checking such files, add them to coverage.exclude in squeal.config.json.";
var labelOf = (measure2) => measure2 === "crap" ? "CRAP" : measure2 === "uncovered" ? "untested" : measure2;
var named = (at, joiner) => at === null ? "" : `${at}${joiner}`;
var score = (value) => value === null ? "unknown" : Number.isInteger(value) ? `${value}` : value.toFixed(1);
var share = ({ lines, covered }) => lines === 0 ? "it has no line that runs" : `${Math.round(covered / lines * 100)}% of its lines ran`;
function testFiles(e) {
  const rest = e.testFiles - e.first.length;
  const names3 = e.first.join(", ");
  return rest > 0 ? `${names3} and ${plural(rest, "more test file")}` : names3;
}
var shows = (others, measure2) => others.some((e) => e.measure === measure2 && e.kind !== "removed");
var showsComplexity = (others) => shows(others, "complexity") || others.some((e) => e.measure === "crap" && e.kind !== "removed" && e.kind !== "fail-to-pass");
function crapEvidence(entry2, others) {
  const e = entry2.evidence;
  if (e === void 0) return "";
  const why = e.testFiles === 0 && !shows(others, "uncovered");
  const children = withChildren(e);
  const parts = [
    ...shows(others, "complexity") ? [] : [`complexity ${e.complexity}`],
    ...e.testFiles > 0 ? [`${share(e)} in ${testFiles(e)}`] : [],
    ...why ? [notRun(fileLoadersOf(entry2), "", children)] : []
  ];
  if (parts.length === 0) return "";
  return ` (${parts.join("; ")})${why ? `. ${children ? LOWER_BOUND : UNMEASURED}` : ""}`;
}
function untestedEvidence(e, others) {
  const parts = [
    ...showsComplexity(others) ? [] : [`complexity ${e.complexity}`],
    ...e.crap === void 0 || shows(others, "crap") ? [] : [`CRAP ${score(e.crap)}`]
  ];
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
function untestedWhy(entry2, after, block3) {
  const file = fileLoadersOf(entry2);
  const e = entry2.evidence;
  const children = withChildren(e);
  const evidence = e === void 0 ? "" : untestedEvidence(e, block3.others);
  const why = `${notRun(file, after, children)}${evidence}`;
  if (file?.processes !== true) return `${why}. ${children ? LOWER_BOUND : UNMEASURED}`;
  const hint = block3.hint() ? ` ${EXCLUDE_HINT}` : "";
  return `${why}. ${children ? missedWords(file.count) : unmeasuredWords(file.count)}${hint}`;
}
function unmeasuredWords(count2) {
  const may = count2 === 1 ? "The test file may run it in a worker thread or a process it starts" : "They may run it in a worker thread or a process they start";
  return `${may}, which Squeal does not measure.`;
}
function missedWords(count2) {
  const may = count2 === 1 ? "The test file may run it in a process it starts that Squeal misses" : "They may run it in a process they start that Squeal misses";
  return `${may}: one that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE.`;
}
var then = (text2, rest) => `${text2}${text2.endsWith(".") ? " " : "; "}${rest}`;
function quietHint(entry2, command) {
  const until = entry2.measure !== "uncovered" ? `it is at or under ${entry2.threshold}` : withChildren(entry2.evidence) ? "a test runs it" : "a test runs it in its own thread";
  const shows2 = entry2.measure === "uncovered" ? "its coverage" : "its CRAP";
  return `Squeal stays quiet about it until ${until}, and ${command} code ${entry2.check.path} shows ${shows2}.`;
}
function stillFailLine(entry2, at, command, block3) {
  const before = entry2.kind === "edited";
  const what = entry2.measure === "uncovered" ? untestedWhy(
    entry2,
    before ? " after the edit, nor did one before it" : " after the edit",
    block3
  ) : `${score(entry2.value)} after the edit${before ? `; it was already over ${entry2.threshold} before it` : `, over ${entry2.threshold}`}${crapEvidence(entry2, block3.others)}`;
  return `STILL FAIL ${labelOf(entry2.measure)}: ${named(at, ": ")}${then(what, quietHint(entry2, command))}`;
}
function runsIt(e) {
  const children = withChildren(e);
  if (e === void 0 || e.testFiles === 0) {
    return children ? "a test runs it" : "a test runs it in its own thread";
  }
  if (children) return `${testFiles(e)} ${e.testFiles === 1 ? "runs" : "run"} it`;
  return e.testFiles === 1 ? `${testFiles(e)} runs it in its own thread` : `${testFiles(e)} run it in their own threads`;
}
function coverageEntryLine(entry2, at, command, block3) {
  const label = labelOf(entry2.measure);
  if (entry2.kind === "removed")
    return `RESOLVED ${label}: ${named(at, " is ")}no longer in the code`;
  if (entry2.kind === "edited" || entry2.kind === "edited-after-fail") {
    return stillFailLine(entry2, at, command, block3);
  }
  if (entry2.measure === "uncovered") {
    return entry2.kind === "fail-to-pass" ? `PASS ${label}: ${named(at, ": ")}${runsIt(entry2.evidence)}` : `FAIL ${label}: ${named(at, ": ")}${untestedWhy(entry2, "", block3)}`;
  }
  if (entry2.kind === "fail-to-pass") {
    return `PASS ${label}: ${named(at, ": ")}${score(entry2.value)}, at or under ${entry2.threshold}`;
  }
  return `FAIL ${label}: ${named(at, ": ")}${score(entry2.value)}, over ${entry2.threshold}${crapEvidence(entry2, block3.others)}`;
}
var isCoverage = (entry2) => entry2.measure !== "complexity";

// src/core/delivery/code-delta.ts
function isOwn(bound, revision) {
  if (bound === null) return true;
  return revision > bound.since && !bound.gaps.some(([after, upTo]) => revision > after && revision <= upTo);
}
function codeKey({ check, measure: measure2 }) {
  return JSON.stringify([check.path, check.qualifiedName, check.occurrence, measure2]);
}
function seedEntry(state, toldAt) {
  return {
    check: state.check,
    measure: state.measure,
    outcome: state.outcome,
    threshold: state.threshold,
    told: "count",
    toldAt
  };
}
var judged = (state) => state.outcome === "pass" || state.outcome === "fail";
var RANK = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-to-pass": 1,
  removed: 2,
  edited: 3,
  "edited-after-fail": 3
};
var isStillFail = (kind) => kind === "edited" || kind === "edited-after-fail";
function toldKind(told, now, last, after, input) {
  if (last === null || last.at <= after || !isOwn(input.seenUpTo, last.revision)) return null;
  const byGit = () => told?.told === "count" && input.pulled?.(last.check.path, last.revision);
  if (now === null) {
    return told?.outcome === "fail" && last.kind === "removed" && !byGit() ? "removed" : null;
  }
  if (now.outcome === "fail" && told?.outcome !== "fail") {
    return last.kind === "first-seen-fail" || last.kind === "pass-to-fail" ? last.kind : null;
  }
  if (now.outcome === "pass" && told?.outcome === "fail") {
    return last.kind === "fail-to-pass" && !byGit() ? last.kind : null;
  }
  return null;
}
function editToTell(told, now, input) {
  if (now.outcome !== "fail" || told.told === "still") return null;
  const edit = input.edit(now.check, now.measure);
  if (edit === null || !isOwn(input.seenUpTo, edit.revision)) return null;
  return edit.at > Math.max(input.seededAt, told.toldAt) ? edit : null;
}
function entryOf(state, kind, revision) {
  const { check, measure: measure2, value, threshold } = state;
  return { check, measure: measure2, kind, value, threshold, revision };
}
function stateStep(state, before, input) {
  if (state.outcome === "pass" && before === null) return {};
  if (before?.outcome === state.outcome && before.threshold === state.threshold) {
    const edit = editToTell(before, state, input);
    if (edit === null) return {};
    return {
      write: { ...seedEntry(state, Math.max(input.toldAt, edit.at)), told: "still" },
      entry: entryOf(
        state,
        before.told === "count" ? "edited" : "edited-after-fail",
        edit.revision
      )
    };
  }
  const last = input.last(state.check, state.measure);
  const kind = toldKind(before, state, last, Math.max(input.seededAt, before?.toldAt ?? 0), input);
  const asOf = Math.max(
    input.toldAt,
    last?.at ?? 0,
    input.edit(state.check, state.measure)?.at ?? 0
  );
  const view = state.outcome === "pass" ? { removal: { check: state.check, measure: state.measure } } : { write: { ...seedEntry(state, asOf), told: kind === null ? "count" : "full" } };
  if (kind === null) return view;
  return { ...view, entry: entryOf(state, kind, last?.revision ?? state.changedAt) };
}
function planCodeDelta(input) {
  const told = new Map(input.view.map((v) => [codeKey(v), v]));
  const entries = [];
  const writes = [];
  const removals = [];
  for (const state of input.states) {
    const key = codeKey(state);
    const before = told.get(key) ?? null;
    told.delete(key);
    if (!judged(state)) continue;
    const { write: write2, removal, entry: entry2 } = stateStep(state, before, input);
    if (write2 !== void 0) writes.push(write2);
    if (removal !== void 0) removals.push(removal);
    if (entry2 !== void 0) entries.push(entry2);
  }
  for (const view of told.values()) {
    removals.push({ check: view.check, measure: view.measure });
    const last = view.outcome === "fail" ? input.last(view.check, view.measure) : null;
    if (last === null || toldKind(view, null, last, view.toldAt, input) === null) continue;
    entries.push({
      check: view.check,
      measure: view.measure,
      kind: "removed",
      value: last.fromValue,
      threshold: view.threshold,
      revision: last.revision
    });
  }
  const sorted = entries.map((entry2, i) => ({ entry: entry2, i })).sort((a, b) => RANK[a.entry.kind] - RANK[b.entry.kind] || a.i - b.i).map(({ entry: entry2 }) => entry2);
  return { entries: sorted, writes, removals };
}

// src/runners/jest/describe.ts
import { readFileSync as readFileSync8, realpathSync as realpathSync3, statSync as statSync2 } from "node:fs";
import { dirname as dirname5, join as join9, resolve as resolve3 } from "node:path";

// src/core/fs/paths.ts
import { isAbsolute as isAbsolute4, join as join8, relative, sep as sep2 } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute4(rel)) return null;
  return sep2 === "/" ? rel : rel.split(sep2).join("/");
}
function toAbsolute(root, rel) {
  return join8(root, ...rel.split("/"));
}

// src/runners/jest/describe.ts
var OUTPUT_FLAGS = /* @__PURE__ */ new Set([
  "--verbose",
  "--silent",
  "--no-color",
  "--colors",
  "--ci",
  "--runInBand"
]);
var JEST = {
  runner: "jest",
  name: "Jest",
  unconfigured: {},
  projects: (policy) => policy.jest,
  coverage: ({ projects }) => ({ jest: projects }),
  excluded: () => null,
  context: (policy, root, cwd) => ({ jest: jestHere(root, cwd, policy.jest) }),
  command: (words, context, split) => jestCommand(words, context.jest ?? [], split),
  resolves: () => true,
  files: (command, listing) => command.runner === "jest" ? jestFiles(command, listing) : null,
  // The daemon reads `jest[].slow` from the policy itself, as `pytest[].slow` (004 D1).
  slowProjects: () => []
};
function jestHere(root, cwd, projects) {
  return projects.flatMap((project) => {
    if (project.project !== void 0) return [];
    const config = toAbsolute(root, project.config);
    const dir = project.cwd === void 0 ? dirname5(config) : toAbsolute(root, project.cwd);
    if (realPath(dir) !== cwd || realPath(dirname5(config)) !== cwd) return [];
    if (!discovers(dir, config)) return [];
    return [{ project, dir, scripts: scriptsIn(dir) }];
  });
}
var CONFIG_NAMES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.mts",
  "jest.config.cts",
  "jest.config.json"
];
function discovers(dir, config) {
  const candidates = CONFIG_NAMES.map((name2) => join9(dir, name2)).filter(isFile);
  const manifest = join9(dir, "package.json");
  if (isFile(manifest)) {
    let parsed2;
    try {
      parsed2 = JSON.parse(readFileSync8(manifest, "utf8"));
    } catch {
      return false;
    }
    if (isRecord(parsed2) && Object.hasOwn(parsed2, "jest")) candidates.push(manifest);
  }
  if (candidates.length !== 1) return false;
  const found2 = realPath(candidates[0]);
  return found2 !== null && found2 === realPath(config);
}
function jestCommand(words, here, split) {
  if (here.length !== 1) return null;
  const at = here[0];
  if (Object.keys(at.project.env).length > 0) return null;
  const [first, second] = words;
  if ((first === "npm" || first === "pnpm") && second === "test" && words.length === 2) {
    const { scripts } = at;
    if (!Object.hasOwn(scripts, "test")) return null;
    if (Object.hasOwn(scripts, "pretest") || Object.hasOwn(scripts, "posttest")) return null;
    const script = split(scripts.test);
    const command = script === null ? null : direct(script, at);
    return command?.paths === null ? command : null;
  }
  return direct(words, at);
}
function direct(words, at) {
  const start = invocation(words, at.dir);
  if (start === null) return null;
  const rest = words.slice(start);
  const { args } = at.project;
  if (!args.every((arg, i) => rest[i] === arg)) return null;
  const paths = [];
  for (const word of rest.slice(args.length)) {
    if (OUTPUT_FLAGS.has(word)) continue;
    if (word.startsWith("-") || word === "") return null;
    paths.push(word);
  }
  const { include, exclude } = at.project;
  if (paths.length > 0 && include.length + exclude.length > 0) return null;
  return {
    runner: "jest",
    project: at.project.name,
    dir: at.dir,
    paths: paths.length === 0 ? null : paths
  };
}
function invocation(words, dir) {
  const [first, second, third] = words;
  if (first === "jest") return 1;
  if (first?.includes("/") === true && resolve3(dir, first) === join9(dir, "node_modules/.bin/jest"))
    return 1;
  if (first === "npx" && second === "jest") return 2;
  if (first === "pnpm" && second === "exec" && third === "jest") return 3;
  return null;
}
function jestFiles(command, listing) {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref2) => ref2.project === command.project);
  const named2 = new Set(command.paths.map((path) => listing.pathOf(resolve3(command.dir, path))));
  if (![...named2].every((rel) => own.some((ref2) => ref2.path === rel))) return null;
  let patterns;
  try {
    patterns = command.paths.map((path) => new RegExp(path, "i"));
  } catch {
    return null;
  }
  const selected2 = own.filter((ref2) => {
    const path = join9(listing.root, ref2.path);
    return patterns.some((pattern) => pattern.test(path));
  });
  if (!selected2.every((ref2) => named2.has(ref2.path))) return null;
  return own.filter((ref2) => named2.has(ref2.path));
}
function realPath(path) {
  try {
    return realpathSync3(resolve3(path));
  } catch {
    return null;
  }
}
function isFile(path) {
  try {
    return statSync2(path).isFile();
  } catch {
    return false;
  }
}
function scriptsIn(dir) {
  try {
    const manifest = JSON.parse(readFileSync8(join9(dir, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(
        (entry2) => typeof entry2[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

// src/runners/node-test/describe.ts
var UNCONFIGURED = { nodeTest: [] };
var NODE_TEST = {
  runner: "node-test",
  name: "node:test",
  unconfigured: UNCONFIGURED,
  projects: (policy) => policy.nodeTest,
  coverage: ({ projects }) => ({ nodeTest: projects }),
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
  const own = listing.files.filter((ref2) => ref2.project === command.project);
  if (command.files === null) return own.length === 0 ? null : own;
  const byPath = new Map(own.map((ref2) => [ref2.path, ref2]));
  const files2 = command.files.map((file) => byPath.get(listing.pathOf(file) ?? ""));
  return files2.every((ref2) => ref2 !== void 0) ? [...new Set(files2)] : null;
}

// src/runners/pytest/describe.ts
import { realpathSync as realpathSync4 } from "node:fs";
import { join as join11, resolve as resolve5 } from "node:path";

// src/runners/pytest/environment/discover.ts
import { existsSync as existsSync4, readdirSync as readdirSync3, readFileSync as readFileSync9, statSync as statSync3 } from "node:fs";
import { basename as basename2, dirname as dirname6, isAbsolute as isAbsolute5, join as join10, relative as relative2, resolve as resolve4 } from "node:path";
function projectDir(root, project) {
  return project.cwd === void 0 ? root : toAbsolute(root, project.cwd);
}
function discoverEnvironment(root, project) {
  const cwd = projectDir(root, project);
  if (project.python !== void 0) {
    const declared = resolve4(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join10(declared, "bin", "python"));
    if (existsSync4(declared)) return found("declared", dirname6(dirname6(declared)), declared);
    const target = basename2(declared).startsWith("python") ? dirname6(dirname6(declared)) : declared;
    return none(root, cwd, [declared], target);
  }
  const venv = join10(cwd, ".venv");
  if (existsSync4(join10(venv, "pyvenv.cfg"))) return found("venv", venv, join10(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname6(dirname6(pdm)), pdm);
  return none(root, cwd, [venv, join10(cwd, ".pdm-python")], venv);
}
function found(source, env, python) {
  return { kind: "found", source, env, python };
}
function pdmPython(root, cwd) {
  let text2;
  try {
    text2 = readFileSync9(join10(cwd, ".pdm-python"), "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!isAbsolute5(text2) || toRelative(root, text2) === null || !existsSync4(text2)) return null;
  return text2;
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
  for (let dir = cwd; ; dir = dirname6(dir)) {
    dirs.push(dir);
    if (toRelative(root, dir) === null) break;
  }
  for (const dir of dirs) {
    const hit = LOCKFILES.find(([file]) => existsSync4(join10(dir, file)));
    if (hit !== void 0)
      return { kind: "none", looked, command: hit[1], from: join10(dir, hit[0]) };
  }
  for (const dir of dirs) {
    const files2 = requirementsIn(dir).map((file) => join10(dir, file));
    if (files2.length === 0) continue;
    const install = files2.map((file) => `-r ${relative2(cwd, file)}`).join(" ");
    const command = `python -m venv ${venv} && ${venv}/bin/pip install ${install}`;
    return { kind: "none", looked, command, from: files2[0] };
  }
  return { kind: "none", looked, command: `python -m venv ${venv}`, from: null };
}
function requirementsIn(dir) {
  let names3;
  try {
    names3 = readdirSync3(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names3.filter((name2) => REQUIREMENTS.test(name2)).sort();
}
function isDirectory(path) {
  try {
    return statSync3(path).isDirectory();
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
  unconfigured: {},
  projects: (policy) => policy.pytest,
  coverage: ({ projects }) => ({ pytest: projects }),
  excluded: () => null,
  context: (policy, root, cwd) => ({ pytest: pytestHere(root, cwd, policy.pytest) }),
  command: (words, context) => pytestCommand(words, context.pytest ?? []),
  resolves: () => true,
  files: (command, listing) => command.runner === "pytest" ? pytestFiles(command, listing) : null,
  // `slowFiles` and `slowGlobs` read `pytest[].slow` from the policy itself (004 D1, 007 D1; row 019-10).
  slowProjects: () => []
};
function pytestHere(root, cwd, projects) {
  return projects.flatMap((project) => {
    const dir = projectDir(root, project);
    if (realPath2(dir) !== cwd) return [];
    let env = null;
    try {
      const found2 = discoverEnvironment(root, project);
      if (found2.kind === "found") env = found2.env;
    } catch {
    }
    return [{ project, dir, env }];
  });
}
function realPath2(path) {
  try {
    return realpathSync4(resolve5(path));
  } catch {
    return null;
  }
}
function pytestCommand(words, here) {
  if (here.length !== 1) return null;
  const { project, dir, env } = here[0];
  if (Object.keys(project.env).length > 0) return null;
  const start = invocation2(words, dir, env);
  if (start === null) return null;
  const rest = words.slice(start);
  const { args } = project;
  if (!args.every((arg, i) => rest[i] === arg)) return null;
  const paths = [];
  for (const word of rest.slice(args.length)) {
    if (OUTPUT_FLAG.test(word)) continue;
    const path = word.split("::")[0];
    if (word.startsWith("-") || path === "") return null;
    paths.push(resolve5(dir, path));
  }
  return { runner: "pytest", project: project.name, paths: paths.length === 0 ? null : paths };
}
function invocation2(words, dir, env) {
  const [first, second, third] = words;
  const inEnv = (name2) => env !== null && first?.includes("/") === true && resolve5(dir, first) === join11(env, "bin", name2);
  if (first === "pytest" || inEnv("pytest")) return 1;
  if (first === "uv" && second === "run" && third === "pytest") return 3;
  if ((first === "python" || inEnv("python")) && second === "-m" && third === "pytest") return 3;
  return null;
}
function pytestFiles(command, listing) {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref2) => ref2.project === command.project);
  const named2 = new Set(command.paths.map((path) => listing.pathOf(path)));
  if (![...named2].every((rel) => own.some((ref2) => ref2.path === rel))) return null;
  return own.filter((ref2) => named2.has(ref2.path));
}

// src/runners/vitest/describe.ts
import { readFileSync as readFileSync11 } from "node:fs";
import { isAbsolute as isAbsolute6, join as join13, relative as relative3, resolve as resolve6 } from "node:path";

// src/core/daemon/runner.ts
import { readdirSync as readdirSync4, readFileSync as readFileSync10 } from "node:fs";
import { join as join12, posix as posix5 } from "node:path";

// src/core/types/runner-traits.ts
function declareTraits(stated = {}) {
  const { omittedTestFiles, slowWidth, tierWidth, tierPart, besideBacklog, backlogSlot: backlogSlot2 } = stated;
  const { focuses, lane } = stated;
  return {
    omittedTestFiles: () => omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles2) => Math.max(1, slowWidth?.(testFiles2) ?? testFiles2.length),
    tierWidth: (testFile, grant) => Math.max(1, tierWidth?.(testFile, grant) ?? grant),
    tierPart: (testFile) => tierPart?.(testFile) ?? "",
    besideBacklog: (testFile) => besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => {
      const files2 = backlogSlot2?.(testFile) ?? null;
      return files2 === null ? null : Math.max(1, Math.floor(files2));
    },
    focuses: (testFile) => focuses?.(testFile) ?? false,
    lane: (testFile) => lane?.(testFile) ?? ""
  };
}
var NO_TRAITS = declareTraits();

// src/core/daemon/runner.ts
var VITEST_CONFIG = /^(vitest\.(config|workspace|projects)|vite\.config)\.[cm]?[jt]s$/;
function vitestDetected(root) {
  let names3;
  try {
    names3 = readdirSync4(root);
  } catch {
    return false;
  }
  if (names3.some((name2) => VITEST_CONFIG.test(name2))) return true;
  return listsVitest(readManifest(join12(root, "package.json")));
}
function runsVitest(root, policy) {
  return policy.nodeTest.length + policy.pytest.length + (policy.jest?.length ?? 0) === 0 || vitestDetected(root);
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
    return JSON.parse(readFileSync10(path, "utf8"));
  } catch {
    return null;
  }
}

// src/runners/vitest/describe.ts
var UNCONFIGURED2 = { vitest: true };
var REPORTER = "--reporter";
var SILENT_VALUES = /* @__PURE__ */ new Set(["true", "false", "yes", "no", "passed-only"]);
var VITEST = {
  runner: "vitest",
  name: "Vitest",
  unconfigured: UNCONFIGURED2,
  projects: () => [],
  coverage({ policy, root, configured }) {
    const vitest = !configured || vitestDetected(root);
    return {
      vitest,
      vitestExcludedFiles: vitest ? policy.vitest.exclude : []
    };
  },
  // Spec 004 D8 as amended 2026-10-18 (task 004-81): the `vitest.exclude` globs, named.
  excluded(coverage) {
    const globs4 = coverage.vitestExcludedFiles ?? [];
    return globs4.length === 0 ? null : excludedFilesText(globs4);
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
  const name2 = words.length === 2 && words[1] === "test" ? "test" : words.length === 3 && words[1] === "run" ? words[2] : void 0;
  if (name2 === void 0) return null;
  if (!Object.hasOwn(scripts, name2)) return null;
  if (Object.hasOwn(scripts, `pre${name2}`) || Object.hasOwn(scripts, `post${name2}`)) return null;
  const script = split(scripts[name2]);
  return script === null ? null : vitestCommand(script);
}
function vitestFiles(command, listing) {
  const { root, configured } = listing;
  if (listing.omitted !== 0) return null;
  const vitest = listing.files.filter((ref2) => !configured.has(ref2.project));
  if (new Set(vitest.map((ref2) => ref2.project)).size !== 1) return null;
  if (command.filters.length === 0) return vitest;
  const selected2 = /* @__PURE__ */ new Set();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref2) => matchesFilter(join13(root, ref2.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref2 of hits) selected2.add(ref2);
  }
  return vitest.filter((ref2) => selected2.has(ref2));
}
function matchesFilter(file, filter, root) {
  if (isAbsolute6(filter) && file.startsWith(filter)) return true;
  const testFile = relative3(root, file).toLocaleLowerCase();
  const rel = relative3(root, resolve6(root, filter));
  const relativePath = filter.endsWith("/") ? join13(rel, "/") : rel;
  return testFile.includes(filter.toLocaleLowerCase()) || testFile.includes(relativePath.toLocaleLowerCase());
}
function rootScripts(root) {
  try {
    const manifest = JSON.parse(readFileSync11(join13(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text2]) => typeof text2 === "string")
    );
  } catch {
    return {};
  }
}

// src/runners/descriptions.ts
var DESCRIPTIONS = [VITEST, NODE_TEST, PYTEST, JEST];
var UNCONFIGURED3 = {
  ...VITEST.unconfigured,
  ...NODE_TEST.unconfigured,
  ...PYTEST.unconfigured,
  ...JEST.unconfigured
};

// src/core/code/coverage/runtime.ts
var RECORDING_RUNNERS = /* @__PURE__ */ new Set(["vitest", "node-test", "jest"]);
function coverageOn(policy) {
  return policy.coverage.enabled && policy.complexity.enabled;
}

// src/core/delivery/code-runners.ts
function recordingNames() {
  return DESCRIPTIONS.filter((d) => RECORDING_RUNNERS.has(d.runner)).map((d) => d.name);
}
function notMeasuredNames(policy) {
  if (!coverageOn(policy)) return [];
  return DESCRIPTIONS.filter(
    (d) => !RECORDING_RUNNERS.has(d.runner) && d.projects(policy).length > 0
  ).map((d) => d.name);
}
function joined(names3, word = "or") {
  const last = names3.at(-1) ?? "";
  return names3.length < 2 ? last : `${names3.slice(0, -1).join(", ")} ${word} ${last}`;
}

// src/core/delivery/code-format.ts
function functionName(check) {
  return check.occurrence === 0 ? check.qualifiedName : `${check.qualifiedName} (occurrence ${check.occurrence + 1})`;
}
var ruleOf2 = (check) => check.path.endsWith(".py") ? "radon rule" : "ESLint rule";
var whereOf = (check, line) => line === null ? check.path : `${check.path}:${line}`;
var quietHint2 = (entry2, command) => `Squeal stays quiet about it until it is at or under ${entry2.threshold}, and ${command} code ${entry2.check.path} shows its count.`;
var atOf = (check, line) => `${functionName(check)} (${whereOf(check, line)})`;
function codeEntryLine(entry2, command, at = atOf(entry2.check, entry2.line), block3 = { others: [], hint: () => false }) {
  if (isCoverage(entry2)) return coverageEntryLine(entry2, at, command, block3);
  const is = named(at, " is ");
  switch (entry2.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
      return `FAIL complexity: ${is}${entry2.value}, over ${entry2.threshold} (${ruleOf2(entry2.check)})`;
    case "fail-to-pass":
      return `PASS complexity: ${is}${entry2.value}, at or under ${entry2.threshold}`;
    case "removed":
      return `RESOLVED complexity: ${is}no longer in the code`;
    case "edited":
      return `STILL FAIL complexity: ${is}${entry2.value} after the edit; it was already over ${entry2.threshold} before it (${ruleOf2(entry2.check)}); ${quietHint2(entry2, command)}`;
    case "edited-after-fail":
      return `STILL FAIL complexity: ${is}${entry2.value} after the edit, over ${entry2.threshold} (${ruleOf2(entry2.check)}); ${quietHint2(entry2, command)}`;
  }
}
var BLOCK_ORDER = ["complexity", "uncovered", "crap"];
function functionLines(news, command) {
  const byFunction = /* @__PURE__ */ new Map();
  for (const e of news.entries) {
    const key = JSON.stringify([e.check.path, e.check.qualifiedName, e.check.occurrence]);
    byFunction.set(key, [...byFunction.get(key) ?? [], e]);
  }
  let owed2 = news.excludeHint === true;
  const hint = () => {
    const told = owed2;
    owed2 = false;
    return told;
  };
  return [...byFunction.values()].flatMap((entries) => {
    const [first] = entries;
    if (first === void 0) return [];
    if (entries.length === 1) {
      return [codeEntryLine(first, command, void 0, { others: [], hint })];
    }
    const sorted = [...entries].sort(
      (a, b) => BLOCK_ORDER.indexOf(a.measure) - BLOCK_ORDER.indexOf(b.measure)
    );
    const line = entries.find((e) => e.line !== null)?.line ?? null;
    return [
      `${atOf(first.check, line)}:`,
      ...sorted.map(
        (e) => `- ${codeEntryLine(e, command, null, { others: sorted.filter((o) => o !== e), hint })}`
      )
    ];
  });
}
function recountLine(recount, command) {
  const lists = `${command} code lists them.`;
  const over = plural(recount.over, "function");
  switch (recount.reason) {
    case "threshold":
      return `Complexity threshold is now ${recount.threshold}: ${over} over; ${lists}`;
    case "first":
      return `Complexity counted: ${over} over ${recount.threshold}; ${lists}`;
    case "include":
      return `Complexity counted again, the included files changed: ${over} over ${recount.threshold}; ${lists}`;
    case "counter":
      return `Complexity counted again by a new counter: ${over} over ${recount.threshold}; ${lists}`;
  }
}
function crapRecountLine({ threshold, over }, command) {
  return `CRAP threshold is now ${threshold}: ${plural(over, "function")} over; ${command} code lists them.`;
}
function coverageChangeLine({
  off,
  excluded
}) {
  const parts = [
    ...off.includes("crap") ? ["CRAP off (crap.enabled)"] : [],
    ...off.includes("uncovered") ? ["untested off (coverage.untested)"] : [],
    ...excluded === 0 ? [] : [`${plural(excluded, "file")} no longer checked (coverage.exclude)`]
  ];
  return `Coverage checks changed: ${parts.join("; ")}.`;
}
var kib = (bytes) => `${Math.round(bytes / 1024)} KiB`;
function tooBigLine({ path, size, limit }) {
  return `${path} is ${kib(size)}, over the ${kib(limit)} limit (complexity.maxFileBytes); its functions are not counted.`;
}
function codeLines(news, command) {
  return [
    ...news.recount === void 0 ? [] : [recountLine(news.recount, command)],
    ...news.crapRecount === void 0 ? [] : [crapRecountLine(news.crapRecount, command)],
    ...news.coverageChange === void 0 ? [] : [coverageChangeLine(news.coverageChange)],
    ...functionLines(news, command),
    ...news.more === 0 ? [] : [
      `and ${news.more} more ${changesWord(news)} ${news.more === 1 ? "change" : "changes"}; ${command} code --changed lists them.`
    ],
    ...(news.tooBig ?? []).map(tooBigLine)
  ];
}
var changesWord = (news) => news.coverage === true ? "code" : "complexity";
var codeChanges = (news) => news.entries.filter((e) => !isStillFail(e.kind)).length + news.more;
function codeTitleWords(news) {
  const changes = codeChanges(news);
  const still = news.entries.filter((e) => isStillFail(e.kind));
  const functions = new Set(
    still.map((e) => JSON.stringify([e.check.path, functionName(e.check)]))
  );
  const words = [
    ...changes === 0 ? [] : [`${changes} ${changesWord(news)} ${changes === 1 ? "change" : "changes"}`],
    ...still.length === 0 ? [] : still.some(isCoverage) ? [`${plural(functions.size, "function")} still failing a code check`] : [`${plural(still.length, "function")} still over the complexity threshold`]
  ];
  return words.length === 0 ? null : words.join(" and ");
}
function toldOverWords({
  count: count2,
  threshold,
  crap,
  uncovered
}) {
  const parts = [
    ...count2 === 0 ? [] : [[count2, `over ${threshold}`]],
    ...crap === void 0 ? [] : [[crap.count, `over CRAP ${crap.threshold}`]],
    ...uncovered === void 0 ? [] : [[uncovered, "untested"]]
  ];
  const words = parts.map(([n, what], i) => `${i === 0 ? plural(n, "function") : n} ${what}`);
  const last = words.pop() ?? "";
  return words.length === 0 ? last : `${words.join(", ")} and ${last},`;
}
var andList = (words) => words.length < 2 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
var notJudgedFile = (file) => file.reason === "too-big" ? `${file.path} (${kib(file.size)}, over the ${kib(file.limit)} limit of complexity.maxFileBytes)` : `${file.path} (could not count)`;
function notJudgedWords({ files: files2, more }) {
  const total = files2.length + more;
  const named2 = files2.map(notJudgedFile);
  const list = more === 0 ? andList(named2) : `${named2.join(", ")} and ${more} more`;
  return `${plural(total, "file")} this session changed ${total === 1 ? "is" : "are"} not judged: ${list}`;
}
function toldOverLine({ toldOver: toldOver2, notJudged }, command) {
  const parts = [
    ...toldOver2 === void 0 ? [] : [`${toldOverWords(toldOver2)} that this session was told about`],
    ...notJudged === void 0 ? [] : [notJudgedWords(notJudged)]
  ];
  return parts.length === 0 ? null : `Code: ${parts.join("; ")}; ${command} code --told lists them.`;
}
function knownFailuresTailLine(failures, command) {
  return `Tests: ${plural(failures, "known failure")}; ${command} status lists them.`;
}
function codeRegistrationLine(code, command) {
  const names3 = code.notMeasured ?? [];
  const sentence = names3.length === 0 ? "" : ` Coverage comes from ${joined(recordingNames(), "and")} runs only; functions that only ${joined(names3)} tests run read not measured.`;
  return `${complexityLine(code, command)}${sentence}`;
}
function complexityLine(code, command) {
  if (code.counting !== void 0) {
    const { done, total } = code.counting;
    return total === 0 ? "Complexity: counting has not started." : `Complexity: counting, ${done} of ${plural(total, "file")}.`;
  }
  return `Complexity: ${plural(code.over, "function")} over ${code.threshold}; ${command} code lists them.`;
}

// src/core/state/check-name.ts
var FILE_LEVEL = " (file-level)";
var GLOBAL_SETUP = "(global setup)";
function formatCheck(check) {
  const project = check.project === "" ? "" : `[${check.project}] `;
  if (check.kind === "setup") {
    return `${project}${check.testPath === "" ? "" : `${check.testPath} `}${GLOBAL_SETUP}`;
  }
  return check.kind === "test" ? `${project}${check.testPath} > ${check.fullName}` : `${project}${check.testPath}${FILE_LEVEL}`;
}

// src/core/delivery/collapse.ts
var LISTED_MAX = 5;
var FILES_SHOWN = 10;
function checkName(check) {
  return cap(formatCheck(check), SUMMARY_MAX_CHARS);
}
var fileName = (check) => `${check.project === "" ? "" : `[${check.project}] `}${check.testPath}`;
function nameLines(checks, fileLevel) {
  if (checks.length <= LISTED_MAX) return checks.map(checkName);
  const grouped = byFile(checks, fileLevel);
  return grouped.length < checks.length ? grouped : checks.map(checkName);
}
function byFile(checks, fileLevel) {
  const byFile2 = /* @__PURE__ */ new Map();
  for (const check of checks) {
    byFile2.set(fileName(check), [...byFile2.get(fileName(check)) ?? [], check]);
  }
  const files2 = [...byFile2].sort(
    ([a, m], [b, n]) => n.length - m.length || (a < b ? -1 : a > b ? 1 : 0)
  );
  const parts = (list) => checkPartsText(countChecks(list), fileLevel);
  const lines = files2.slice(0, FILES_SHOWN).map(([file, list]) => `${parts(list)} in ${file}`);
  const rest = files2.slice(FILES_SHOWN);
  if (rest.length === 0) return lines;
  const restChecks = rest.flatMap(([, list]) => list);
  return [...lines, `and ${plural(rest.length, "more test file")} (${parts(restChecks)})`];
}
function collapse(head, changed, stillFailing) {
  if (changed.length <= LISTED_MAX) return null;
  const changedLines = nameLines(changed);
  if (stillFailing === void 0) return { head, lines: changedLines };
  const failingLines = [
    `still failing: ${failureCountText(stillFailing)}`,
    ...nameLines(stillFailing, "that did not load")
  ];
  return { head, lines: failingLines.length <= changedLines.length ? failingLines : changedLines };
}

// src/core/delivery/slow-told.ts
function slowToldMetaKey(worktreeId) {
  return worktreeMetaKey("slowTierTold", worktreeId);
}
function slowTierState(tier) {
  if (tier === void 0) return null;
  return JSON.stringify([
    tier.testFiles,
    tier.current,
    tier.pending,
    tier.notRun,
    tier.currentAt,
    tier.currentUpTo ?? null
  ]);
}
function slowTierChanged(store, consumer, tier) {
  const state = slowTierState(tier);
  return state !== null && readSlot(store, slowToldMetaKey(consumer.worktreeId), consumer) !== state;
}
function tellSlowTier(store, consumer, tier) {
  writeSlot(store, slowToldMetaKey(consumer.worktreeId), consumer, slowTierState(tier));
}
function groupKind(group) {
  if (group.current >= group.testFiles) return "current";
  if (group.pending > 0 && (group.requested ?? 0) > 0) return "queued";
  return group.pending > 0 ? "waiting" : "not run";
}
function groupsToldMetaKey(worktreeId) {
  return worktreeMetaKey("groupTiersTold", worktreeId);
}
function groupTiersState(groups2) {
  if (groups2 === void 0) return null;
  return JSON.stringify(groups2.map((group) => [group.name, groupKind(group)]));
}
function changedGroups(store, consumer, groups2) {
  if (groups2 === void 0) return [];
  const told = toldKinds(readSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer));
  return groups2.filter((g) => told.get(g.name) !== groupKind(g)).map((g) => g.name);
}
function toldKinds(stored3) {
  if (typeof stored3 !== "string") return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(stored3);
    if (!Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      value.flatMap(
        (entry2) => Array.isArray(entry2) && typeof entry2[0] === "string" && typeof entry2[1] === "string" ? [[entry2[0], entry2[1]]] : []
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function tellGroupTiers(store, consumer, groups2) {
  writeSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer, groupTiersState(groups2));
}

// src/core/delivery/content-title.ts
function contentWords(delta) {
  const { sawEdit, header } = delta;
  const words = [];
  if (delta.editsLate !== void 0) words.push("results for your edits are late");
  if (delta.caughtUp !== void 0) words.push("caught up");
  if (sawEdit !== void 0) {
    const did = header.noTestsAtEdit === true ? "affects" : "queued";
    words.push(`your edit ${did} ${plural(sawEdit.queued, "test file")}`);
  }
  if (delta.countsOwed !== void 0) words.push("first results in this worktree");
  if (delta.groupTiersChanged !== void 0) {
    for (const group of header.groupTiers ?? []) {
      if (!delta.groupTiersChanged.includes(group.name)) continue;
      const kind = groupKind(group);
      if (kind !== "current") words.push(`${group.name} group ${kind}`);
    }
  }
  if (delta.slowTierChanged === true && header.slowTier !== void 0) {
    words.push(`slow tier ${groupKind(header.slowTier)}`);
  }
  words.push(...codeWords(delta.code), ...lintWords(delta.lint));
  const commit = delta.commitChanged === true ? header.commitLine : void 0;
  if (commit !== void 0) {
    words.push(`commit ${/^Commit (\S+?):/.exec(commit.text)?.[1] ?? commit.commit.slice(0, 7)}`);
  }
  return words;
}
function lintWords(lint2) {
  if (lint2 === void 0 || lintTitleWords(lint2) !== null) return [];
  return [
    ...lint2.summary === void 0 ? [] : [lint2.summary.reason === "config" ? "lint config changed" : "lint summary"],
    ...lint2.failed === void 0 ? [] : ["lint unknown"],
    ...lint2.off === void 0 ? [] : ["lint off"]
  ];
}
function codeWords(code) {
  if (code === void 0 || codeTitleWords(code) !== null) return [];
  const too = code.tooBig?.length ?? 0;
  return [
    ...code.recount === void 0 ? [] : [
      code.recount.reason === "threshold" ? "complexity threshold changed" : "complexity counted"
    ],
    ...code.crapRecount === void 0 ? [] : ["CRAP threshold changed"],
    ...code.coverageChange === void 0 ? [] : ["coverage checks changed"],
    ...too === 0 ? [] : [`${plural(too, "file")} too big to count`]
  ];
}

// src/core/delivery/provenance.ts
var upper = (outcome) => outcome.toUpperCase();
var TOUCHED_SHOWN = 3;
function change(entry2) {
  switch (entry2.kind) {
    case "first-seen-fail":
      if (entry2.from !== null) return `${upper(entry2.from)} -> FAIL`;
      return entry2.beforeEdits?.outcome === "pass" ? "PASS -> FAIL" : "first observed: FAIL";
    case "fail-changed":
      return "FAIL -> FAIL, failure changed";
    default:
      return `${entry2.from === null ? "NONE" : upper(entry2.from)} -> ${upper(entry2.to)}`;
  }
}
var commitText = (commit) => commit === null ? "no commit" : `commit ${commit.slice(0, 12)}`;
function inheritedFrom(entry2) {
  if (entry2.origin.kind !== "inherited") return null;
  return `${entry2.originRoot ?? `worktree ${entry2.origin.worktreeId}`} at ${commitText(entry2.origin.commit)}`;
}
function importedFrom(entry2) {
  if (entry2.origin.kind !== "imported") return null;
  return entry2.originSource ?? `import ${entry2.origin.importId} at ${commitText(entry2.origin.commit)}`;
}
var NO_EARLIER_RESULT_TEXT = "Squeal has no earlier result for this test, so it cannot tell whether your edits caused it";
function beforeEditsText(before) {
  switch (before?.outcome) {
    case "none": {
      const settle2 = before.commit === null ? "" : `; to settle it, run it in a checkout of ${before.commit.slice(0, 12)}: its result is shared with this worktree`;
      return `${NO_EARLIER_RESULT_TEXT}${settle2}`;
    }
    case "fail": {
      const where3 = before.worktreeRoot ?? `worktree ${before.worktreeId}`;
      return `it also failed before your edits (${where3} at ${commitText(before.commit)})`;
    }
    default:
      return null;
  }
}
function changeBefore(entry2) {
  const before = entry2.kind === "first-seen-fail" ? beforeEditsText(entry2.beforeEdits) : null;
  return before === null ? { text: change(entry2), joined: ", " } : { text: `${change(entry2)}; ${before}`, joined: "; " };
}
function validityText(entry2, revision) {
  if (entry2.validity === "pending") return `revision ${revision} pending`;
  return entry2.validity === "stale" ? "stale" : null;
}
function seenLine(entry2, revision) {
  const from = inheritedFrom(entry2);
  const imported = importedFrom(entry2);
  const baseline = entry2.baseline === true;
  const { text: text2, joined: joined2 } = changeBefore(entry2);
  const by = baseline ? "by the baseline " : "";
  const parts = [
    imported !== null ? `imported from ${imported} ${by}at revision ${entry2.observedAt}` : from === null ? `seen by Squeal's ${baseline ? "baseline " : ""}run at revision ${entry2.observedAt}` : `seen by Squeal's run in ${from}, inherited ${by}at revision ${entry2.observedAt}`,
    validityText(entry2, revision)
  ];
  return `${text2}${joined2}${parts.filter((p) => p !== null).join(", ")}`;
}
function recoveryProvenance(entry2, revision) {
  const parts = [];
  if (entry2.validity === "stale") parts.push(`stale, observed at revision ${entry2.observedAt}`);
  if (entry2.validity === "pending") {
    parts.push(`observed at revision ${entry2.observedAt}, revision ${revision} pending`);
  }
  const from = inheritedFrom(entry2);
  if (from !== null) parts.push(`inherited from ${from}`);
  const imported = importedFrom(entry2);
  if (imported !== null) parts.push(`imported from ${imported}`);
  return parts.length === 0 ? null : parts.join("; ");
}
var CHANGED_HERE = "files changed here since this session started";
function closureLine(paths) {
  if (paths === void 0) return null;
  if (paths.length === 0) return `none of the ${CHANGED_HERE} are in its imports`;
  return `its imports include ${CHANGED_HERE}: ${closurePaths(paths)}`;
}
function closurePaths(paths) {
  const more = paths.length - TOUCHED_SHOWN;
  return `${paths.slice(0, TOUCHED_SHOWN).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
function loadLine(entry2) {
  return entry2.loadAverage === void 0 ? null : `load average ${entry2.loadAverage.toFixed(2)} when it ran`;
}
function installSentences(header) {
  if (header.dependenciesInstalled === false) {
    return " No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.";
  }
  const lockfile = header.installedLockfile;
  return lockfile === void 0 ? "" : ` These results follow a dependency install (${lockfile} changed).`;
}

// src/core/delivery/failure-groups.ts
var FILES_NAMED2 = 3;
var ERROR_CHARS = 120;
function flakyLines() {
  let pointed = false;
  return (note) => {
    if (note === void 0) return [];
    const line = capitalize(flakyText(note));
    if (pointed) return [line];
    pointed = true;
    return [line, FLAKY_INPUTS_TEXT];
  };
}
function groupKey(entry2, revision) {
  if (entry2.summary === null) return null;
  return JSON.stringify([
    seenLine(entry2, revision),
    entry2.summary,
    entry2.location === null ? null : atText(entry2.location, void 0),
    entry2.flaky === void 0 ? null : flakyText(entry2.flaky),
    entry2.retry === void 0 ? null : retryText(entry2.retry)
  ]);
}
function failureGroups(failures, revision) {
  const byKey = /* @__PURE__ */ new Map();
  const groups2 = [];
  for (const failure2 of failures) {
    const key = groupKey(failure2, revision);
    const group = key === null ? void 0 : byKey.get(key);
    if (group !== void 0) {
      group.push(failure2);
      continue;
    }
    const fresh2 = [failure2];
    if (key !== null) byKey.set(key, fresh2);
    groups2.push(fresh2);
  }
  return groups2;
}
function shared(group, line) {
  const lines = group.map(line);
  return lines.every((l) => l === lines[0]) ? lines[0] ?? null : null;
}
function loadsLine(group) {
  const loads = group.flatMap((e) => e.loadAverage === void 0 ? [] : [e.loadAverage]);
  if (loads.length === 0) return null;
  const [low, high] = [Math.min(...loads), Math.max(...loads)].map((l) => l.toFixed(2));
  return `load average ${low === high ? low : `${low} to ${high}`} when they ran`;
}
function commonDirectory(paths) {
  const split = paths.map((p) => p.split("/").slice(0, -1));
  const first = split[0] ?? [];
  let depth = 0;
  while (depth < first.length && split.every((s) => s[depth] === first[depth])) depth++;
  return first.slice(0, depth).join("/");
}
function failuresCommand(group, command) {
  const first = group[0];
  const files2 = [...new Set(group.map((e) => e.check.testPath))];
  const selected2 = files2.includes("") ? [] : files2.length <= FILES_NAMED2 ? files2 : [commonDirectory(files2)].filter((d) => d !== "");
  const error = Array.from((first.summary ?? "").split("\n")[0] ?? "").slice(0, ERROR_CHARS).join("");
  return [
    `${command} failures`,
    ...selected2.map(shellWord),
    ...error === "" ? [] : [`--error ${shellWord(error)}`],
    "--per-check --limit all",
    ...first.origin.kind === "inherited" ? ["--all-worktrees"] : []
  ].join(" ");
}
function groupLines(group, revision, command, flaky, closure) {
  const first = group[0];
  const checks = group.map((e) => e.check);
  const at = (e) => e.location === null ? null : atText(e.location, e.testFileFrame);
  const lines = [
    seenLine(first, revision),
    cap(first.summary ?? "", SUMMARY_MAX_CHARS),
    first.location === null ? null : shared(group, at) ?? atText(first.location, void 0),
    shared(group, (e) => closure(e.changesInClosure)),
    loadsLine(group),
    ...flaky(first.flaky),
    first.retry === void 0 ? null : capitalize(retryText(first.retry)),
    ...nameLines(checks, "that did not load"),
    `Full list: ${failuresCommand(group, command)}`
  ];
  return {
    head: `FAIL  ${plural(group.length, "check")} with one error and location (${checkPartsText(countChecks(checks), "that did not load")})`,
    lines: lines.filter((l) => l !== null)
  };
}

// src/core/scheduler/awaiting-install.ts
var MISSING_INSTALLS_SHOWN = 3;
function awaitingInstallSentence(missing, command) {
  const more = missing.length - MISSING_INSTALLS_SHOWN;
  const where3 = missing.length === 0 ? "in this worktree" : `at this worktree's root or in ${missing.slice(0, MISSING_INSTALLS_SHOWN).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  const install = command === void 0 ? "Install them" : `Run \`${command}\` to install them`;
  return `No dependencies are installed ${where3}, so Squeal runs none of its tests and inherits none of their results. ${install}: Squeal then inherits the results other worktrees recorded for the same code and dependencies, and runs the rest.`;
}

// src/core/delivery/header-daemon.ts
function awaitingInstallText(header) {
  if (header.awaitingInstall !== true || header.daemon?.state === "down") return null;
  return awaitingInstallSentence(header.missingInstalls ?? [], header.installCommand);
}
function daemonText(header, command, unlisted2 = false) {
  const awaiting = awaitingInstallText(header);
  const { daemon } = header;
  const liveness = unlisted2 && daemon?.state === "down" && daemon.startingSince !== void 0 ? diedText(daemon) : livenessSentence(daemon, header.revision, command);
  return liveness + (awaiting === null ? installSentences(header) : ` ${awaiting}`);
}
function stoppedText(command) {
  return `The daemon is stopped by request (\`${command} stop\`); a hook starts one at the next edit, or run \`${command} start\``;
}
function livenessSentence(daemon, revision, command) {
  if (daemon === void 0) return "";
  const asOf = `results are as of revision ${revision}`;
  if (daemon.stopping !== void 0) {
    return ` The daemon is ${stoppingText(daemon.stopping, command)}; ${asOf}.`;
  }
  if (daemon.state === "alive") {
    return daemon.short === void 0 ? "" : ` The daemon is up: ${shortText(daemon.short, command)}.`;
  }
  const died = diedText(daemon);
  const { state, notes } = toldOf(daemon);
  switch (state) {
    case "stopped by request":
      return stopOf(daemon) === "until-start" ? ` The daemon is ${untilStartText(command)}; no edit or Git operation starts one; ${asOf}.` : ` ${stoppedText(command)}; ${asOf}. ${holdAcrossEditsText(command)}`;
    case "starting":
      if (notes.includes("start stopped")) return ` ${stoppedStartText(daemon)}; ${asOf}.${died}`;
      if (notes.includes("start slow")) return ` ${slowStartText(daemon)}; ${asOf}.${died}`;
      return ` A daemon is starting; ${asOf}.${died}`;
    case "resting":
      return ` The daemon stopped while unused; ${asOf}.`;
    case "heartbeat late":
      if (daemon.heartbeatLate !== void 0) {
        return ` The daemon's heartbeat is late: ${lateHeartbeatDetail(daemon.heartbeatLate, daemon.since)}; ${asOf}.`;
      }
      break;
  }
  const since = capitalize(notValidatedSinceText(daemon.since));
  const restart = died === "" ? "" : ` ${restartText(command)}`;
  return ` ${since}; ${asOf}.${died}${restart}`;
}
function notValidatedSinceText(since) {
  return since === null ? "no daemon is running" : `no daemon has validated since ${utcTimeText(since)}`;
}
var restartText = (command) => `\`${command} start\` starts one.`;
function slowStartText(daemon) {
  const since = daemon.startingSince === void 0 ? "" : ` since ${utcTimeText(daemon.startingSince)}`;
  return `A daemon has been starting${since}`;
}
function stoppedStartText(daemon) {
  const text2 = startStoppedText(daemon.startingSince ?? null, utcTimeText);
  return `${text2[0]?.toUpperCase()}${text2.slice(1)}`;
}
function diedText(daemon) {
  return daemon.died === void 0 ? "" : ` The last daemon ${deathHookText(daemon.died)}. ${DEATH_CAUSE}`;
}
function noneRunning(daemon) {
  return daemon?.state === "down" && toldOf(daemon).state === "gone";
}

// src/core/status/overrun-facts.ts
function firstOverrunning(files2, row, now) {
  const left = /* @__PURE__ */ new Set();
  for (const [runId, tier] of row.overruns ?? []) {
    if (now < tier.at) continue;
    const ended = new Set((row.endedFiles.get(runId) ?? []).map(testFileId));
    for (const f of tier.files) if (!ended.has(testFileId(f))) left.add(testFileId(f));
  }
  return files2.find((f) => left.has(testFileId(f))) ?? null;
}

// src/core/scheduler/yield-row.ts
var NO_YIELD_ROW = {
  tiers: /* @__PURE__ */ new Map(),
  ended: /* @__PURE__ */ new Map(),
  endedFiles: /* @__PURE__ */ new Map(),
  last: null,
  lanes: /* @__PURE__ */ new Map()
};
function readYieldRow(raw, daemonStartedAt) {
  if (raw === null) return NO_YIELD_ROW;
  try {
    const row = JSON.parse(raw);
    if (typeof row.at !== "number" || row.at < daemonStartedAt) return NO_YIELD_ROW;
    if (typeof row.tiers !== "object" || row.tiers === null) return NO_YIELD_ROW;
    return {
      tiers: new Map(
        Object.entries(row.tiers).filter((e) => isYield(e[1]))
      ),
      ended: new Map(entriesOf(row.ended).filter((e) => isCount(e[1]))),
      endedFiles: new Map(
        entriesOf(row.endedFiles).filter((e) => isRefs(e[1]))
      ),
      last: isLastYield(row.last) ? row.last : null,
      lanes: new Map(entriesOf(row.lanes).filter((e) => isRef(e[1]))),
      overruns: new Map(
        entriesOf(row.overruns).filter((e) => isOverrun(e[1]))
      ),
      at: row.at
    };
  } catch {
    return NO_YIELD_ROW;
  }
}
function entriesOf(value) {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}
function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isYield(value) {
  if (typeof value !== "object" || value === null) return false;
  const { kind, remainderMs, yieldsAt } = value;
  if (kind === "remainder") return typeof remainderMs === "number";
  if (kind === "overrun") return typeof yieldsAt === "number";
  return kind === "yields" || kind === "cut" || kind === "turn" || kind === "runner" || kind === "named";
}
function isLastYield(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.at === "number" && typeof v.runId === "string" && (v.to === "edit" || v.to === "promoted" || v.to === "runner") && (v.rule === "remainder" || v.rule === "overrun") && typeof v.remainderMs === "number" && typeof v.lane === "string" && Array.isArray(v.files) && v.files.every(isRef) && typeof v.runStartedAt === "number" && (v.runEndedAt === null || typeof v.runEndedAt === "number");
}
function isRefs(value) {
  return Array.isArray(value) && value.every(isRef);
}
function isRef(value) {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value;
  return typeof project === "string" && typeof path === "string";
}
function isOverrun(value) {
  if (typeof value !== "object" || value === null) return false;
  const { startedAt, at, deadline, files: files2, laneWaits } = value;
  return typeof startedAt === "number" && typeof at === "number" && (deadline === null || typeof deadline === "number") && Array.isArray(files2) && files2.every(isOverrunFile) && (laneWaits === void 0 || laneWaits === "either" || laneWaits === "it");
}
function isOverrunFile(value) {
  if (!isRef(value)) return false;
  const { usualMs } = value;
  return usualMs === null || typeof usualMs === "number";
}

// src/core/slow/rank.ts
var MAX_READ_BYTES = 1024 * 1024;

// src/core/slow/state.ts
function slowTierMetaKey(worktreeId) {
  return worktreeMetaKey("slowTier", worktreeId);
}
function readSlowActivity(store, worktreeId) {
  const raw = store.meta.get(slowTierMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    return toSlowActivity(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}
function groupTiersMetaKey(worktreeId) {
  return worktreeMetaKey("groupTiers", worktreeId);
}
function readGroupActivities(store, worktreeId) {
  const entries = groupEntries(store.meta.get(groupTiersMetaKey(worktreeId)));
  return (group) => toSlowActivity(entries[group] ?? null) ?? null;
}
function groupEntries(raw) {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
var WAITS = /* @__PURE__ */ new Set(["fast", "idle", "slot", "pool", "load"]);
var SLOT_WAITS = /* @__PURE__ */ new Set(["held", "turn", "in use", "free"]);
function slotAtOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const { dir, permits } = value;
  if (typeof dir !== "string" || typeof permits !== "number" || !(permits >= 1)) return void 0;
  return { dir, permits };
}
function toSlowActivity(value) {
  if (value === null) return null;
  if (typeof value !== "object") return void 0;
  const v = value;
  if (v.kind === "waiting" && WAITS.has(v.for)) {
    const wait = v.for;
    const slot2 = wait === "slot" && SLOT_WAITS.has(v.slot) ? v.slot : void 0;
    const at = slot2 === void 0 ? void 0 : slotAtOf(v.slotAt);
    return {
      kind: "waiting",
      for: wait,
      ...slot2 === void 0 ? {} : { slot: slot2 },
      ...at === void 0 ? {} : { slotAt: at }
    };
  }
  if (v.kind === "running" && typeof v.path === "string" && typeof v.since === "number") {
    const last = typeof v.lastDurationMs === "number" ? v.lastDurationMs : null;
    const paths = Array.isArray(v.paths) ? v.paths : [];
    const several = paths.length > 1 && paths.every((p) => typeof p === "string");
    return {
      kind: "running",
      path: v.path,
      ...several ? { paths } : {},
      since: v.since,
      lastDurationMs: last
    };
  }
  return void 0;
}
function failureKeysMetaKey(worktreeId) {
  return worktreeMetaKey("failureKeys", worktreeId);
}
function readFailureKeys(store, worktreeId) {
  const raw = store.meta.get(failureKeysMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter(
        (entry2) => typeof entry2[1] === "string"
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}

// src/core/scheduler/files.ts
function durationOf(results) {
  if (results.length === 0) return null;
  let fileMs = 0;
  let testsMs = 0;
  for (const result of results) {
    if (result.check.kind === "file") fileMs = Math.max(fileMs, result.durationMs);
    else testsMs += result.durationMs;
  }
  return Math.max(fileMs, testsMs);
}

// src/core/scheduler/checkpoint-progress.ts
function checkpointMetaKey(worktreeId) {
  return worktreeMetaKey("checkpoint", worktreeId);
}
function readCheckpointProgress(store, worktreeId) {
  const raw = store.meta.get(checkpointMetaKey(worktreeId));
  if (raw === null || !raw.startsWith("{")) return null;
  try {
    const value = JSON.parse(raw);
    const numbers = [value.revision, value.startedAt, value.done, value.total];
    if (typeof value.id !== "string" || numbers.some((n) => typeof n !== "number")) return null;
    if (value.kind !== "run-all" && value.kind !== "baseline") return null;
    const owed2 = value.owed;
    const lists = owed2 === void 0 ? [] : [owed2.ids, owed2.remaining, owed2.strict];
    if (!lists.every(Array.isArray)) return null;
    return value;
  } catch {
    return null;
  }
}

// src/core/state/baseline.ts
function baselineMetaKey(worktreeId) {
  return worktreeMetaKey("baselineFindings", worktreeId);
}
function entry(check, fingerprint) {
  return `${checkIdentity(check)}\0${fingerprint ?? ""}`;
}
function current(e) {
  const at = e.lastIndexOf("\0");
  return `${e.slice(0, at + 1)}${renormalizeFingerprint(e.slice(at + 1))}`;
}
function read2(store, worktreeId) {
  const raw = store.meta.get(baselineMetaKey(worktreeId));
  return raw === null ? null : JSON.parse(raw);
}
function baselineFindings(store, worktreeId) {
  const entries = new Set(read2(store, worktreeId)?.entries.map(current));
  return (check, fingerprint) => entries.has(current(entry(check, fingerprint)));
}

// src/core/state/shown-result.ts
function fingerprintOf(result) {
  if (result.outcome !== "fail") return null;
  return result.fingerprint ?? describeFailure(result.errors, result.location).fingerprint;
}

// src/core/state/producers.ts
function failureProducersMetaKey(worktreeId) {
  return worktreeMetaKey("failureProducers", worktreeId);
}
function isProducer(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.runId === "string" && typeof v.recordedAt === "number";
}
function readFailureProducers(store, worktreeId) {
  const raw = store.meta.get(failureProducersMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter((e) => isProducer(e[1]))
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function producingResult(worktreeId, state, producer, failureKey, results) {
  const origin = state.origin;
  if (producer === void 0 || failureKey === void 0 || origin === null) return null;
  return results.find(
    (r) => r.provenance.runId === producer.runId && r.provenance.recordedAt === producer.recordedAt && r.key === failureKey && r.outcome === state.outcome && sameFingerprint(fingerprintOf(r), state.fingerprint) && r.provenance.commit === state.commit && (origin.kind === "own" ? r.provenance.worktreeId === worktreeId && r.provenance.revision === state.observedAt : r.provenance.worktreeId === originWorktree(origin))
  ) ?? null;
}

// src/core/state/transitions.ts
function transitionKind(from, to) {
  const before = from?.outcome ?? null;
  switch (to.outcome) {
    case "fail":
      if (before === "pass") return "pass-to-fail";
      if (before === "fail")
        return sameFingerprint(from?.fingerprint ?? null, to.fingerprint) ? null : "fail-changed";
      return "first-seen-fail";
    case "pass":
      return before === "fail" ? "fail-to-pass" : null;
    case "unknown":
      return before === "pass" || before === "fail" ? "to-unknown" : null;
    case "skip":
      return null;
  }
}

// src/core/scheduler/queue.ts
var Group = { first: 0, catchUp: 1, second: 2 };
var GROUP_ORDER = {
  edits: [Group.first, Group.catchUp, Group.second],
  turn: [Group.catchUp, Group.second, Group.first]
};

// src/core/scheduler/refined.ts
function refinedMetaKey(worktreeId) {
  return worktreeMetaKey("refined", worktreeId);
}
function readRefined(store, worktreeId) {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}
function isRefined(store, worktreeId, revision) {
  return covers(readRefined(store, worktreeId), revision);
}
function covers(refined, revision) {
  return refined === null || revision <= refined;
}

// src/core/scheduler/rekeyed-moves.ts
var MOVES_RETENTION_MS = 60 * 6e4;

// src/core/scheduler/rekeyed-record.ts
function rekeyedMetaKey(worktreeId) {
  return worktreeMetaKey("rekeyed", worktreeId);
}
var isRevision = (value) => typeof value === "number" && Number.isInteger(value);
function readRekeyed(store, worktreeId) {
  const raw = store.meta.get(rekeyedMetaKey(worktreeId));
  const entries = /* @__PURE__ */ new Map();
  let value = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!isRecord(value)) return entries;
  for (const [id, entry2] of Object.entries(value)) {
    if (!Array.isArray(entry2) || !isRevision(entry2[1])) continue;
    entries.set(id, { open: isRevision(entry2[0]) ? entry2[0] : null, last: entry2[1] });
  }
  return entries;
}
function write(store, worktreeId, entries) {
  const key = rekeyedMetaKey(worktreeId);
  if (entries.size === 0) {
    if (store.meta.get(key) !== null) store.meta.delete(key);
    return;
  }
  const row = Object.fromEntries([...entries].map(([id, e]) => [id, [e.open, e.last]]));
  store.meta.set(key, JSON.stringify(row));
}
function pruneRekeyed(store, worktreeId, upTo) {
  const entries = readRekeyed(store, worktreeId);
  const before = entries.size;
  for (const [id, entry2] of entries) {
    if (entry2.open === null && entry2.last <= upTo) entries.delete(id);
  }
  if (entries.size !== before) write(store, worktreeId, entries);
}

// src/core/retry/remote.ts
var RUN_REMOTES_META_KEY = "failed-run-remotes";
function keptRemote(remotes, runId, testFile) {
  return remotes.get(runId)?.[testFileId(testFile)];
}
function readRunRemotes(store) {
  const raw = store.meta.get(RUN_REMOTES_META_KEY);
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (!isRecord3(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).flatMap(([runId, files2]) => {
        if (!isRecord3(files2)) return [];
        const kept2 = Object.entries(files2).filter(
          (e) => typeof e[1] === "string"
        );
        return [[runId, Object.fromEntries(kept2)]];
      })
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/daemon/paths.ts
import { chmodSync, lstatSync as lstatSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute7, join as join14 } from "node:path";
function runtimeDir(env = process.env) {
  return xdgRuntimeDir(env) ?? userTmpDir();
}
var MAX_SOCKET_PATH_BYTES = 103;
function socketPathFor(worktreeId, env = process.env) {
  const name2 = socketNameFor(worktreeId);
  const path = join14(runtimeDir(env), name2);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join14(userTmpDir(), name2);
}
function socketNameFor(worktreeId) {
  return `squeal-${worktreeId}.sock`;
}
function preparePrivateDir(dir, uid = currentUid(), role = "socket directory") {
  mkdirSync2(dirname7(dir), { recursive: true });
  try {
    mkdirSync2(dir, { mode: 448 });
    chmodSync(dir, 448);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  checkPrivateDir(dir, uid, role);
}
function checkPrivateDir(dir, uid, role = "socket directory") {
  const stat = lstatSync2(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${role} ${dir} is not a directory; refusing to use it`);
  }
  if (stat.uid !== uid) {
    throw new Error(`${role} ${dir} is owned by uid ${stat.uid}, not ${uid}; refusing to use it`);
  }
  if ((stat.mode & 63) !== 0) {
    const mode = (stat.mode & 511).toString(8).padStart(3, "0");
    throw new Error(`${role} ${dir} has mode ${mode}, not 700; refusing to use it`);
  }
}
function userTmpDir(uid = currentUid()) {
  return join14("/tmp", `squeal-${uid}`);
}
function xdgRuntimeDir(env) {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== void 0 && xdg !== "" && isAbsolute7(xdg) ? xdg : null;
}
function currentUid() {
  return process.getuid?.() ?? 0;
}

// src/core/slow/slot.ts
import { existsSync as existsSync5 } from "node:fs";
import { dirname as dirname9, isAbsolute as isAbsolute8, join as join17 } from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/slow/slot-files.ts
import { createHash as createHash5 } from "node:crypto";
import { basename as basename4, join as join16 } from "node:path";

// src/core/daemon/scratch.ts
import { createHash as createHash4, randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync3,
  mkdtempSync,
  readdirSync as readdirSync5,
  readFileSync as readFileSync12,
  renameSync,
  rmSync as rmSync2,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename as basename3, dirname as dirname8, join as join15 } from "node:path";
function repositoryId(commonDir) {
  const dir = storePaths(commonDir).dir;
  const file = join15(dir, "repository-id");
  mkdirSync3(dir, { recursive: true });
  const draft = `${file}.${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(draft, `${randomBytes(16).toString("hex")}
`);
  try {
    linkSync(draft, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    unlinkSync(draft);
  }
  return readFileSync12(file, "utf8").trim();
}

// src/core/slow/slot-files.ts
var SLOW_LOCK_FILE = "slow.lock";
var SLOW_GROUP2 = "slow";
var GROUP_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var DEFAULT_GROUP_SLOT_SCOPE = "repository";
function slotFiles(group = SLOW_GROUP2, scope = DEFAULT_GROUP_SLOT_SCOPE) {
  const dir = (base, commonDir) => scope === "user" ? base : join16(base, `repo.${hash(repositoryId(commonDir))}`);
  if (group === SLOW_GROUP2) {
    return {
      dir,
      permit: (i) => i === 0 ? SLOW_LOCK_FILE : `slow.${i}.lock`,
      waiterPrefix: "slow.wait."
    };
  }
  if (!GROUP_NAME.test(group)) throw new Error(`not a check group name: ${JSON.stringify(group)}`);
  return { dir, permit: (i) => `group.${group}.${i}.lock`, waiterPrefix: `group.${group}.wait.` };
}
function hash(text2) {
  return createHash5("sha256").update(text2).digest("hex").slice(0, 16);
}
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/slow/slot-holding.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
import { pathToFileURL } from "node:url";
var RAN_FRESH_MS = 3 * 60 * 6e4;
function holdingOf(db, pid, since) {
  let row;
  try {
    row = db.prepare("SELECT pid, since, files FROM holding LIMIT 1").get();
  } catch {
    return void 0;
  }
  if (row === void 0 || row.pid !== pid || row.since !== since) return void 0;
  if (typeof row.files !== "string") return void 0;
  try {
    const parsed2 = JSON.parse(row.files);
    return Array.isArray(parsed2) && parsed2.every(isSlotFile) ? parsed2 : void 0;
  } catch {
    return void 0;
  }
}
function isSlotFile(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  const duration = v.durationMs === null || typeof v.durationMs === "number";
  return typeof v.project === "string" && typeof v.path === "string" && duration;
}
function readRecord(path) {
  let db;
  try {
    db = new DatabaseSync2(immutableUrl(path), { readOnly: true });
  } catch {
    return "unreadable";
  }
  try {
    const row = db.prepare("SELECT pid, worktree_id, since FROM holder LIMIT 1").get();
    if (row === void 0) return "missing";
    const { pid, worktree_id: worktreeId, since } = row;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(since)) return "unreadable";
    if (typeof worktreeId !== "string") return "unreadable";
    const files2 = holdingOf(db, pid, since);
    return {
      pid,
      worktreeId,
      since,
      ...files2 === void 0 ? {} : { files: files2 }
    };
  } catch (error) {
    return String(error).includes("no such table") ? "missing" : "unreadable";
  } finally {
    db.close();
  }
}
function immutableUrl(path) {
  const url = pathToFileURL(path);
  url.search = "immutable=1";
  return url;
}

// src/core/slow/slot.ts
function heldPermits(request) {
  const { dir } = request;
  const files2 = slotFiles(request.group);
  if (!existsSync5(dir)) return [];
  checkPrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const held = [];
  for (let i = 0; i < Math.max(1, request.permits ?? 1); i++) {
    const file = files2.permit(i);
    const path = join17(dir, file);
    if (!existsSync5(path)) continue;
    let free;
    try {
      free = permitFree(path);
    } catch {
      held.push({ file, record: { kind: "unreadable" }, unknown: true });
      continue;
    }
    if (!free) held.push({ file, record: permitRecord(path) });
  }
  return held;
}
function permitRecord(path) {
  const record = readRecord(path);
  return typeof record === "string" ? { kind: record } : { kind: "holder", ...record };
}
function permitFree(path) {
  const db = new DatabaseSync3(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
    return true;
  } catch (error) {
    if (isBusy(error)) return false;
    throw error;
  } finally {
    db.close();
  }
}

// src/core/daemon/outlived.ts
import { execFile } from "node:child_process";
import { readdirSync as readdirSync6, readFileSync as readFileSync13 } from "node:fs";
import { readFile as readFile2 } from "node:fs/promises";
import { promisify as promisify2 } from "node:util";

// src/runners/process/recorders.ts
var UNOBSERVED = JSON.stringify({ out: "" });

// src/core/daemon/outlived.ts
var PF_EXITING2 = 4;
var CHUNK = 64;
function procRow(pid) {
  let text2;
  try {
    text2 = readFileSync13(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  const fields = text2.slice(text2.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X" || (Number(fields[6]) & PF_EXITING2) !== 0) return null;
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
    const names3 = readdirSync6("/proc").filter((name2) => /^\d+$/.test(name2));
    const rows = [];
    for (let at = 0; at < names3.length; at += CHUNK) {
      if (at > 0) await new Promise((done) => setImmediate(done));
      for (const name2 of names3.slice(at, at + CHUNK)) {
        const row = procRow(Number(name2));
        if (row !== null) rows.push(row);
      }
    }
    return rows;
  },
  async variable(pid, variable) {
    let environ;
    try {
      environ = `\0${await readFile2(`/proc/${pid}/environ`, "latin1")}`;
    } catch {
      return null;
    }
    const needle = `\0${variable}=`;
    const at = environ.indexOf(needle);
    if (at < 0) return null;
    const end = environ.indexOf("\0", at + needle.length);
    return environ.slice(at + needle.length, end < 0 ? void 0 : end);
  },
  running: async (found2) => found2.flatMap(({ pid, start }) => {
    const row = procRow(pid);
    return row?.start === start ? [row] : [];
  }),
  command: commandLine
};
var run = promisify2(execFile);
var COMMAND_CHARS2 = 120;
var PS_TIMEOUT_MS = 2e3;
var PS_MAX_BYTES = 16 * 1024 * 1024;
var PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/;
function psLines(text2) {
  return text2.split("\n").flatMap((line) => {
    const [, pid, ppid, pgrp, state, month, day, time, year, shown] = PS_LINE.exec(line) ?? [];
    if (state === void 0 || state.startsWith("Z")) return [];
    const start = Date.parse(`${month} ${day} ${year} ${time}`) / 1e3;
    if (!Number.isInteger(start)) return [];
    const row = { pid: Number(pid), ppid: Number(ppid), pgrp: Number(pgrp), session: null, start };
    return [{ row, shown: shown ?? "" }];
  });
}
function shownValue(shown, name2) {
  const needle = ` ${name2}=`;
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
    variable: async (pid, name2) => {
      const line = shown.get(pid);
      return line === void 0 ? null : shownValue(line, name2);
    },
    running: async (found2) => (await list()).filter(
      (row) => found2.some(({ pid, start }) => row.pid === pid && row.start === start)
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
      const text2 = stdout.trim();
      return text2.length > COMMAND_CHARS2 ? `${text2.slice(0, COMMAND_CHARS2 - 3)}...` : text2;
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

// src/core/ps/proc.ts
var MARK = Buffer.from(`${CHILD_VARIABLE}=`);

// src/core/capacity/pool.ts
var MARK_REFRESH_MS = SLOT_WAITER_FRESH_MS / 3;

// src/core/keys/hidden-lockfile.ts
import { createHash as createHash6 } from "node:crypto";
import { lstatSync as lstatSync4, readdirSync as readdirSync7, readFileSync as readFileSync14, readlinkSync as readlinkSync2 } from "node:fs";
import { isAbsolute as isAbsolute9, join as join18 } from "node:path";
var HIDDEN_LOCKFILE = "node_modules/.package-lock.json";
var PACKAGE_FOLDERS_ENCODING = "squeal-package-folders/1";
function staleHiddenLockfile(dir, lockfile) {
  const listed2 = lockfile === null ? null : packagesIn(lockfile);
  if (listed2 === null) return "not valid JSON";
  const lockTime = lstatSync4(join18(dir, HIDDEN_LOCKFILE)).mtimeMs;
  const folders = packageFolders(dir, workspaces(listed2));
  const seen = new Set(folders.map((folder) => folder.path));
  const unlisted2 = folders.filter((folder) => !Object.hasOwn(listed2, folder.path)).map((folder) => folder.path);
  const newer = folders.filter(
    (folder) => Object.hasOwn(listed2, folder.path) && folder.mtimeMs > lockTime
  );
  const missing = Object.keys(listed2).filter((path) => isInstalledFolder(path) && !seen.has(path));
  const parts = [
    ["not listed in it", unlisted2],
    ["newer than it", newer.map((folder) => folder.path)],
    ["missing", missing]
  ];
  const reasons = parts.filter(([, paths]) => paths.length > 0).map(([label, paths]) => `${label}: ${example(paths)}`);
  return reasons.length === 0 ? null : reasons.join("; ");
}
function packageFoldersFingerprint(dir, lockfile) {
  const folders = packageFolders(dir, workspaces(lockfile === null ? {} : packagesIn(lockfile)));
  folders.sort((a, b) => compare(a.path, b.path));
  const entries = folders.map(
    ({ path, link }) => link ? [path, "link", readlinkSync2(join18(dir, path))] : [path, ...nameAndVersion(dir, path)]
  );
  return createHash6("sha256").update(JSON.stringify([PACKAGE_FOLDERS_ENCODING, entries])).digest("hex");
}
function parseHiddenLockfile(content) {
  let parsed2;
  try {
    parsed2 = JSON.parse(content.toString("utf8"));
  } catch {
    return null;
  }
  return isRecord(parsed2) ? parsed2 : {};
}
function withoutOwnVersions(lockfile) {
  const { name: _name, version: _version, ...rest } = lockfile;
  const own = (path, entry2) => (path === "" || isWorkspace(path)) && isRecord(entry2) ? { ...entry2, version: void 0 } : entry2;
  const packages = isRecord(rest.packages) ? Object.fromEntries(Object.entries(rest.packages).map(([path, e]) => [path, own(path, e)])) : rest.packages;
  return JSON.stringify({ ...rest, packages });
}
function packagesIn(lockfile) {
  return isRecord(lockfile.packages) ? lockfile.packages : {};
}
function isInstalledFolder(path) {
  return insideInstall(path) && (path.startsWith("node_modules/") || path.includes("/node_modules/"));
}
function insideInstall(path) {
  return path !== "" && !isAbsolute9(path) && path !== ".." && !path.startsWith("../");
}
function isWorkspace(path) {
  return insideInstall(path) && !isInstalledFolder(path);
}
function workspaces(listed2) {
  return Object.keys(listed2).filter(isWorkspace);
}
function packageFolders(dir, workspaceFolders) {
  const folders = [];
  const visit = (path, entry2) => {
    if (!entry2.isSymbolicLink() && !entry2.isDirectory()) return;
    const link = entry2.isSymbolicLink();
    folders.push({ path, link, mtimeMs: lstatSync4(join18(dir, path)).mtimeMs });
    if (!link) walk(`${path}/node_modules`);
  };
  const walk = (modules) => {
    for (const entry2 of entriesOf2(join18(dir, modules))) {
      if (entry2.name.startsWith(".")) continue;
      const path = `${modules}/${entry2.name}`;
      if (entry2.name.startsWith("@") && entry2.isDirectory()) {
        for (const child of entriesOf2(join18(dir, path))) visit(`${path}/${child.name}`, child);
      } else {
        visit(path, entry2);
      }
    }
  };
  for (const path of ["", ...workspaceFolders])
    walk(path === "" ? "node_modules" : `${path}/node_modules`);
  return folders;
}
function entriesOf2(path) {
  try {
    return readdirSync7(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || error.code === "ENOTDIR") return [];
    throw error;
  }
}
function nameAndVersion(dir, path) {
  try {
    const manifest = JSON.parse(readFileSync14(join18(dir, path, "package.json"), "utf8"));
    if (!isRecord(manifest)) return [null, null];
    return [manifest.name ?? null, manifest.version ?? null];
  } catch {
    return [null, null];
  }
}
function example(paths) {
  const [first] = [...paths].sort(compare);
  return paths.length === 1 ? `${first}` : `${first} and ${paths.length - 1} more`;
}

// src/core/keys/packages.ts
import { join as join20, posix as posix6 } from "node:path";

// src/core/keys/package-scans.ts
import { readdirSync as readdirSync8, readFileSync as readFileSync15 } from "node:fs";
import { join as join19 } from "node:path";
var NOT_RUNTIME = [
  /\.d\.[cm]?ts(?:\.map)?$/,
  /^package\.json$/,
  /\.(?:md|markdown|txt)$/i,
  /^(?:licen[cs]e|readme|changelog|notice|authors|history|copying)(?:[.-].*)?$/i
];
var CODE = /\.(?:[cm]?[jt]sx?)$/;
var DECLARATION = /\.d\.[cm]?ts$/;
var OPAQUE_REFERENCE = /(["'`])(?:node:)?(?:child_process|worker_threads)\1|(["'`])node:(?:module|cluster)\2|(?:require|\bimport|\bfrom|getBuiltinModule)\s*\(?\s*(["'`])(?:module|cluster)\3/;
var PackageScans = class {
  #typesOnly = /* @__PURE__ */ new Map();
  #opaque = /* @__PURE__ */ new Map();
  /** Opaque scans done, and the time they took, for measurement. */
  scanned = 0;
  scanMs = 0;
  /** Whether the package at `dir` ships no file Node could load. */
  typesOnly(identity3, dir) {
    let known = this.#typesOnly.get(identity3);
    if (known === void 0) {
      known = !hasRuntimeFile(dir);
      this.#typesOnly.set(identity3, known);
    }
    return known;
  }
  /** Whether the code of the package at `dir` references an opaque builtin. */
  opaque(identity3, dir) {
    let known = this.#opaque.get(identity3);
    if (known === void 0) {
      const start = performance.now();
      known = referencesOpaque(dir);
      this.scanMs += performance.now() - start;
      this.scanned += 1;
      this.#opaque.set(identity3, known);
    }
    return known;
  }
};
function hasRuntimeFile(dir) {
  const entries = entriesOf3(dir);
  if (entries === null) return true;
  return entries.some((entry2) => {
    if (entry2.name === "node_modules") return false;
    if (entry2.isDirectory()) return hasRuntimeFile(join19(dir, entry2.name));
    return !NOT_RUNTIME.some((pattern) => pattern.test(entry2.name));
  });
}
function referencesOpaque(dir) {
  const entries = entriesOf3(dir);
  if (entries === null) return true;
  return entries.some((entry2) => {
    if (entry2.name === "node_modules") return false;
    const path = join19(dir, entry2.name);
    if (entry2.isDirectory()) return referencesOpaque(path);
    if (!entry2.isFile() || !CODE.test(entry2.name) || DECLARATION.test(entry2.name)) return false;
    try {
      return OPAQUE_REFERENCE.test(readFileSync15(path, "utf8"));
    } catch {
      return true;
    }
  });
}
function entriesOf3(dir) {
  try {
    return readdirSync8(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// src/core/keys/packages.ts
var EDGES = ["dependencies", "optionalDependencies", "peerDependencies"];
var InstalledGraph = class {
  /**
   * `base` is the directory holding `node_modules`, relative to the worktree
   * root (`""` for the root). `scans` caches the on-disk scans by identity,
   * so a re-read of an unchanged install scans nothing.
   */
  constructor(dir, base, packages, scans = new PackageScans()) {
    this.dir = dir;
    this.base = base;
    this.scans = scans;
    const entries = {};
    for (const [location2, entry2] of Object.entries(packages)) {
      if (isRecord(entry2)) entries[location2] = entry2;
    }
    this.#packages = entries;
  }
  dir;
  base;
  scans;
  #packages;
  #closures = /* @__PURE__ */ new Map();
  /** The location of each installed identity a closure produced. */
  #locations = /* @__PURE__ */ new Map();
  /**
   * The sorted identities of every installed package `imports` can load,
   * without those in `exclude`.
   */
  identities(imports, exclude) {
    const found2 = /* @__PURE__ */ new Set();
    const starts = /* @__PURE__ */ new Set();
    for (const { from, name: name2, manifest } of imports) {
      const local = this.#local(from);
      const location2 = local === null ? null : this.#resolve(local, name2);
      const entry2 = location2 === null ? void 0 : this.#packages[location2];
      if (location2 === null) found2.add(absent(local ?? from, name2));
      else if (manifest === true && entry2 !== void 0 && isInstalled(location2)) {
        found2.add(identityOf(location2, entry2));
      } else starts.add(location2);
    }
    for (const location2 of starts) {
      for (const identity3 of this.#closure(location2)) found2.add(identity3);
    }
    const sorted = [...found2].filter((identity3) => !exclude?.has(identity3));
    return sorted.sort(compare);
  }
  /**
   * Whether the code of one of `identities`, as `identities()` returned
   * them, reaches `child_process`, `worker_threads`, `module` or `cluster`
   * (task 001-109, review wave-11b B3): a package that starts a process or a
   * worker, or resolves by hand, can load packages its lockfile closure does
   * not hold. Scanned once per identity.
   */
  opaque(identities) {
    return identities.some((identity3) => {
      const location2 = this.#locations.get(identity3);
      return location2 !== void 0 && this.scans.opaque(this.#scanId(identity3), join20(this.dir, location2));
    });
  }
  /** A worktree-relative directory relative to the install, or `null` when outside it. */
  #local(from) {
    if (this.base === "") return from;
    if (from === this.base) return "";
    return from.startsWith(`${this.base}/`) ? from.slice(this.base.length + 1) : null;
  }
  /** The location of `name` looked up from `from`, a link followed to its target. */
  #resolve(from, name2) {
    for (let dir = from; ; dir = parent(dir)) {
      if (!dir.endsWith("node_modules")) {
        const location2 = dir === "" ? `node_modules/${name2}` : `${dir}/node_modules/${name2}`;
        const entry2 = this.#packages[location2];
        if (entry2 !== void 0) {
          return entry2.link === true && typeof entry2.resolved === "string" ? entry2.resolved : location2;
        }
      }
      if (dir === "") return null;
    }
  }
  /** Identities of `start` and everything it can load, memoized per location. */
  #closure(start) {
    const memo = this.#closures.get(start);
    if (memo !== void 0) return memo;
    const identities = [];
    const seen = /* @__PURE__ */ new Set();
    const stack = [start];
    for (let location2 = stack.pop(); location2 !== void 0; location2 = stack.pop()) {
      if (seen.has(location2)) continue;
      seen.add(location2);
      const entry2 = this.#packages[location2];
      if (entry2 === void 0 || !isInstalled(location2)) {
        identities.push(`workspace:${location2}`);
        continue;
      }
      const identity3 = identityOf(location2, entry2);
      if (this.scans.typesOnly(this.#scanId(identity3), join20(this.dir, location2))) {
        identities.push(`${location2}@types-only`);
        continue;
      }
      identities.push(identity3);
      this.#locations.set(identity3, location2);
      for (const field of EDGES) {
        const names3 = entry2[field];
        if (!isRecord(names3)) continue;
        for (const name2 of Object.keys(names3)) {
          const target = this.#resolve(location2, name2);
          if (target === null) identities.push(absent(location2, name2));
          else stack.push(target);
        }
      }
    }
    this.#closures.set(start, identities);
    return identities;
  }
  /** An identity is unique within one install; the install's directory makes it unique across. */
  #scanId(identity3) {
    return `${this.dir}\0${identity3}`;
  }
};
function isInstalled(location2) {
  return location2.startsWith("node_modules/") || location2.includes("/node_modules/");
}
function identityOf(location2, entry2) {
  return `${location2}@${text(entry2.version)}#${text(entry2.integrity ?? entry2.resolved)}`;
}
function absent(from, name2) {
  return `absent:${from}>${name2}`;
}
function parent(dir) {
  const up = posix6.dirname(dir);
  return up === "." ? "" : up;
}
function text(value) {
  return typeof value === "string" ? value : "";
}
function npmReading(dir, base, content, scans) {
  const hidden = parseHiddenLockfile(content);
  const stale = staleHiddenLockfile(dir, hidden);
  if (stale !== null) {
    return { manager: "npm", stale, folders: packageFoldersFingerprint(dir, hidden), graph: null };
  }
  if (hidden === null) return WHOLE;
  const listed2 = packagesOf(content);
  const graph = listed2 === null || base === null ? null : new InstalledGraph(dir, base, listed2, scans);
  return { manager: "npm", stale, text: withoutOwnVersions(hidden), graph };
}
var WHOLE = { manager: null, stale: null, text: null, graph: null };
function packagesOf(content) {
  try {
    const parsed2 = JSON.parse(content.toString("utf8"));
    return isRecord(parsed2) && isRecord(parsed2.packages) ? parsed2.packages : null;
  } catch {
    return null;
  }
}

// src/core/keys/pnpm-install.ts
import { createHash as createHash8 } from "node:crypto";
import { lstatSync as lstatSync5, readdirSync as readdirSync9, readFileSync as readFileSync16, readlinkSync as readlinkSync3 } from "node:fs";
import { join as join22 } from "node:path";

// src/core/keys/pnpm-graph.ts
import { join as join21, posix as posix7 } from "node:path";

// src/core/keys/pnpm-lockfile.ts
import { createHash as createHash7 } from "node:crypto";
var PNPM_VIRTUAL_STORE = "node_modules/.pnpm";
var PNPM_LOCKFILE = `${PNPM_VIRTUAL_STORE}/lock.yaml`;
function withoutLinkedSpecifiers(text2) {
  const lines = text2.split("\n");
  return lines.filter((line, at) => !linkedSpecifier(line, lines[at + 1] ?? "")).join("\n");
}
function linkedSpecifier(line, next) {
  const indent = /^( +)specifier: /.exec(line)?.[1];
  return indent !== void 0 && next.startsWith(`${indent}version: link:`);
}
var IMPORTER_FIELDS = /* @__PURE__ */ new Set(["dependencies", "devDependencies", "optionalDependencies"]);
var SNAPSHOT_FIELDS = /* @__PURE__ */ new Set(["dependencies", "optionalDependencies"]);
var UNREAD = {
  root: /* @__PURE__ */ new Set([
    "settings",
    "catalogs",
    "overrides",
    "packageExtensionsChecksum",
    "pnpmfileChecksum",
    "patchedDependencies",
    "ignoredOptionalDependencies",
    "time"
  ]),
  importers: /* @__PURE__ */ new Set(["dependenciesMeta", "publishDirectory"]),
  packages: /* @__PURE__ */ new Set([
    "bundledDependencies",
    "cpu",
    "deprecated",
    "engines",
    "hasBin",
    "libc",
    "name",
    "os",
    "peerDependencies",
    "peerDependenciesMeta",
    "version"
  ]),
  snapshots: /* @__PURE__ */ new Set(["transitivePeerDependencies", "optional", "id"])
};
function readPnpmLockfile(text2) {
  const reader = {
    importers: /* @__PURE__ */ new Map(),
    integrity: /* @__PURE__ */ new Map(),
    snapshots: /* @__PURE__ */ new Map(),
    version: false,
    part: null,
    entry: null,
    id: "",
    reading: false,
    dependency: ""
  };
  for (const line of text2.split("\n")) {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const body = line.slice(indent);
    if (body === "" || body.startsWith("#")) continue;
    if (/^\s/.test(body) || indent % 2 !== 0) return null;
    const known = indent === 0 ? readTopLevel(reader, body) : reader.part === "packages" ? readPackageLine(reader, indent, body) : reader.part === null || readEntryLine(reader, reader.part, indent, body);
    if (!known) return null;
  }
  return lockfileOf(reader);
}
function readTopLevel(reader, body) {
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (key === "lockfileVersion") {
    if (!/^9\.\d+$/.test(value)) return false;
    reader.version = true;
  } else if (!UNREAD.root.has(key) && (!isPart(key) || value !== "")) return false;
  reader.part = isPart(key) ? key : null;
  [reader.entry, reader.id, reader.reading] = [null, "", false];
  return true;
}
function readPackageLine(reader, indent, body) {
  if (indent > 4) return true;
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (indent === 2) {
    if (value !== "") return false;
    reader.id = key;
  } else if (key === "resolution") {
    if (!value.startsWith("{")) return false;
    const found2 = /^\{(?:.*[ ,])?integrity: ([^\s,}]+)[,}]/.exec(value)?.[1];
    if (found2 !== void 0) reader.integrity.set(reader.id, found2);
  } else if (!UNREAD.packages.has(key)) return false;
  return true;
}
function readEntryLine(reader, part, indent, body) {
  if (indent > 4 && !reader.reading) return true;
  if (indent > (part === "importers" ? 8 : 6) || body.startsWith("- ")) return false;
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (indent === 2) {
    if (value !== "" && value !== "{}") return false;
    reader.entry = /* @__PURE__ */ new Map();
    reader[part].set(key, reader.entry);
    reader.reading = false;
    return true;
  }
  const { entry: entry2 } = reader;
  if (entry2 === null) return false;
  if (indent === 4) {
    reader.reading = (part === "importers" ? IMPORTER_FIELDS : SNAPSHOT_FIELDS).has(key);
    return reader.reading ? value === "" : UNREAD[part].has(key);
  }
  if (part === "snapshots") return isRef2(value) && setOnce(entry2, key, value);
  return readDependencyLine(reader, entry2, indent, pair);
}
function readDependencyLine(reader, entry2, indent, [key, value]) {
  if (indent === 6) {
    if (value !== "") return false;
    reader.dependency = key;
    if (!entry2.has(key)) entry2.set(key, "");
    return true;
  }
  if (key === "version") return isRef2(value) && setOnce(entry2, reader.dependency, value);
  return key === "specifier";
}
function lockfileOf({ version, importers, integrity, snapshots }) {
  for (const declared of importers.values()) {
    for (const ref2 of declared.values()) if (ref2 === "") return null;
  }
  return version && importers.has(".") ? { importers, integrity, snapshots } : null;
}
function isPart(key) {
  return key === "importers" || key === "packages" || key === "snapshots";
}
function isRef2(value) {
  return value !== "" && !value.startsWith("{") && !value.startsWith("[");
}
function setOnce(map, name2, value) {
  const known = map.get(name2);
  if (known !== void 0 && known !== "" && known !== value) return false;
  map.set(name2, value);
  return true;
}
function pairOf(body) {
  let key;
  let rest;
  if (body.startsWith("'")) {
    const quoted2 = singleQuoted(body);
    if (quoted2 === null) return null;
    [key, rest] = quoted2;
  } else {
    const at = body.search(/:(?: |$)/);
    if (at <= 0 || body.startsWith('"')) return null;
    key = body.slice(0, at);
    rest = body.slice(at);
  }
  if (rest !== ":" && !rest.startsWith(": ")) return null;
  const value = rest.slice(1).trim();
  if (value.startsWith('"')) return null;
  if (!value.startsWith("'")) return [key, value];
  const quoted = singleQuoted(value);
  return quoted === null || quoted[1] !== "" ? null : [key, quoted[0]];
}
function singleQuoted(text2) {
  const quoted = /^'((?:[^']|'')*)'/.exec(text2);
  const [all, inner] = quoted ?? [];
  return all === void 0 || inner === void 0 ? null : [inner.replaceAll("''", "'"), text2.slice(all.length)];
}
function pnpmFolderName(id, max) {
  let name2 = id.replace(/[\\/:*?"<>|#]/g, "+");
  if (name2.includes("(")) name2 = name2.replace(/\)$/, "").replace(/\)\(|\(|\)/g, "_");
  if (name2.length > max || name2 !== name2.toLowerCase() && !name2.startsWith("file+")) {
    const digest = createHash7("sha256").update(name2).digest("hex");
    return `${name2.slice(0, max - 33)}_${digest.slice(0, 32)}`;
  }
  return name2;
}

// src/core/keys/pnpm-graph.ts
var FOLDER_MAX_LENGTH = 120;
var PnpmGraph = class {
  /**
   * `base` is the directory holding `node_modules`, relative to the worktree
   * root (`""` for the root); `modules` is `.modules.yaml` as parsed JSON.
   * `scans` caches the on-disk scans by identity.
   */
  constructor(dir, base, lockfile, modules, scans = new PackageScans()) {
    this.dir = dir;
    this.base = base;
    this.lockfile = lockfile;
    this.scans = scans;
    const max = modules.virtualStoreDirMaxLength;
    const length = typeof max === "number" ? max : FOLDER_MAX_LENGTH;
    const folders = /* @__PURE__ */ new Map();
    for (const id of lockfile.snapshots.keys()) {
      const folder = pnpmFolderName(id, length);
      folders.set(id, folder);
      this.#snapshotOf.set(folder, id);
    }
    this.folders = folders;
    const skipped = Array.isArray(modules.skipped) ? modules.skipped : [];
    this.skipped = new Set(skipped.filter((id) => typeof id === "string"));
    const publicHoisted = /* @__PURE__ */ new Map();
    const privateHoisted = /* @__PURE__ */ new Map();
    const hoisted = isRecord(modules.hoistedDependencies) ? modules.hoistedDependencies : {};
    for (const [id, aliases] of Object.entries(hoisted)) {
      if (!isRecord(aliases)) continue;
      for (const [alias, kind] of Object.entries(aliases)) {
        if (kind === "public") publicHoisted.set(alias, id);
        else if (kind === "private") privateHoisted.set(alias, id);
      }
    }
    this.publicHoisted = publicHoisted;
    this.privateHoisted = privateHoisted;
  }
  dir;
  base;
  lockfile;
  scans;
  /** The `.pnpm` folder of each snapshot, by id. */
  folders;
  /** Snapshots `.modules.yaml` lists as skipped: optional packages pnpm did not install. */
  skipped;
  /** The snapshot each publicly hoisted name at the root links to. */
  publicHoisted;
  /** The snapshot each privately hoisted name in `.pnpm/node_modules` links to. */
  privateHoisted;
  #snapshotOf = /* @__PURE__ */ new Map();
  #closures = /* @__PURE__ */ new Map();
  /** The package folder of each installed identity a closure produced. */
  #packageFolders = /* @__PURE__ */ new Map();
  /** The sorted identities of every installed package `imports` can load, without those in `exclude`. */
  identities(imports, exclude) {
    const found2 = /* @__PURE__ */ new Set();
    const starts = /* @__PURE__ */ new Set();
    for (const { from, name: name2, manifest } of imports) {
      const local = this.#local(from);
      const targets = local === null ? [] : this.#resolve(local, name2);
      if (targets.length === 0) found2.add(`absent:${local ?? from}>${name2}`);
      for (const target of targets) {
        if (isMarker(target)) found2.add(target);
        else if (manifest === true) found2.add(this.#identity(target));
        else starts.add(target);
      }
    }
    for (const id of starts) {
      for (const identity3 of this.#closure(id)) found2.add(identity3);
    }
    return [...found2].filter((identity3) => !exclude?.has(identity3)).sort(compare);
  }
  /**
   * Whether one of `identities`, as `identities()` returned them, is a
   * folder no snapshot names, a snapshot without an integrity, or a package
   * whose code reaches `child_process`, `worker_threads`, `module` or
   * `cluster` (task 001-109). Scanned once per identity.
   */
  opaque(identities) {
    return identities.some((identity3) => {
      if (identity3.startsWith("unknown:") || identity3.startsWith("nointegrity:")) return true;
      const folder = this.#packageFolders.get(identity3);
      return folder !== void 0 && this.scans.opaque(this.#scanId(identity3), join21(this.dir, folder));
    });
  }
  /** A worktree-relative directory relative to the install, or `null` when outside it. */
  #local(from) {
    const prefix = this.base === "" ? "" : `${this.base}/`;
    if (from === this.base) return "";
    return from.startsWith(prefix) ? from.slice(prefix.length) : null;
  }
  /**
   * What `name` resolves to from `from`: the skipped packages Node walks
   * past, then the snapshot id or marker it finds; empty when absent.
   */
  #resolve(from, name2) {
    const store = `${PNPM_VIRTUAL_STORE}/`;
    if (!from.startsWith(store)) return this.#walk(this.#fromImporters(from, name2));
    const folder = from.slice(store.length).split("/")[0] ?? "";
    const id = this.#snapshotOf.get(folder);
    if (id === void 0) return [`unknown:${folder}`];
    return nameOf(id) === name2 ? [id] : this.#walk(this.#fromFolder(id, name2));
  }
  /** The candidates of a walk up to the first one pnpm installed: the skipped ones, then it. */
  #walk(candidates) {
    const found2 = [];
    for (const candidate of candidates) {
      if (candidate === void 0) continue;
      found2.push(candidate);
      if (!this.skipped.has(candidate)) break;
    }
    return found2;
  }
  /** Node's walk from snapshot `id`'s folder: its edges, pnpm's private hoisting, then the root. */
  *#fromFolder(id, name2) {
    const ref2 = this.lockfile.snapshots.get(id)?.get(name2);
    yield ref2 === void 0 ? void 0 : childOf(name2, ref2);
    yield this.privateHoisted.get(name2);
    yield* this.#fromImporters("", name2);
  }
  /**
   * Node's walk from a project directory: pnpm creates `node_modules` only
   * in importers, the root's with the names it hoists publicly.
   */
  *#fromImporters(from, name2) {
    for (let dir = from; ; dir = parent(dir)) {
      const ref2 = this.lockfile.importers.get(dir === "" ? "." : dir)?.get(name2);
      if (ref2?.startsWith("link:")) yield workspace(dir, ref2);
      else if (ref2 !== void 0) yield childOf(name2, ref2);
      if (dir === "") {
        yield this.publicHoisted.get(name2);
        return;
      }
    }
  }
  /** `<id>#<integrity>` and its sorted edges, or a marker the closure does not expand. */
  #identity(id) {
    const base = this.#base(id);
    if (!base.startsWith(`${id}#`)) return base;
    const edges = [...this.lockfile.snapshots.get(id) ?? []].map(
      ([name2, ref2]) => this.#typesOnly(childOf(name2, ref2)) ? `${name2}@types-only` : `${name2}@${ref2}`
    );
    return edges.length === 0 ? base : `${base}>${edges.sort(compare).join(",")}`;
  }
  /** `<id>#<integrity>`, or a marker: no such snapshot, no integrity, or skipped. */
  #base(id) {
    if (!this.lockfile.snapshots.has(id)) return `unknown:${id}`;
    const integrity = this.lockfile.integrity.get(id.replace(/\(.*$/, ""));
    if (integrity === void 0) return `nointegrity:${id}`;
    return this.skipped.has(id) ? `skipped:${id}#${integrity}` : `${id}#${integrity}`;
  }
  /** Whether `id` is an installed snapshot whose package has no runtime file (task 001-109). */
  #typesOnly(id) {
    const base = this.#base(id);
    return base.startsWith(`${id}#`) && this.scans.typesOnly(this.#scanId(base), join21(this.dir, this.#folderOf(id)));
  }
  /** The package folder of snapshot `id`, relative to the install. */
  #folderOf(id) {
    return `${PNPM_VIRTUAL_STORE}/${this.folders.get(id)}/node_modules/${nameOf(id)}`;
  }
  /** Identities of `start` and everything it can load, memoized per snapshot. */
  #closure(start) {
    const memo = this.#closures.get(start);
    if (memo !== void 0) return memo;
    const identities = [];
    const seen = /* @__PURE__ */ new Set();
    const stack = [start];
    for (let id = stack.pop(); id !== void 0; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const base = isMarker(id) ? id : this.#base(id);
      if (!base.startsWith(`${id}#`)) {
        identities.push(base);
        continue;
      }
      if (this.#typesOnly(id)) {
        identities.push(`${nameOf(id)}@types-only`);
        continue;
      }
      const identity3 = this.#identity(id);
      identities.push(identity3);
      this.#packageFolders.set(identity3, this.#folderOf(id));
      for (const name2 of this.lockfile.snapshots.get(id)?.keys() ?? [])
        stack.push(...this.#walk(this.#fromFolder(id, name2)));
    }
    this.#closures.set(start, identities);
    return identities;
  }
  /** An identity is unique within one install; the install's directory makes it unique across. */
  #scanId(identity3) {
    return `${this.dir}\0${identity3}`;
  }
};
function isMarker(target) {
  return target.startsWith("workspace:") || target.startsWith("unknown:");
}
function nameOf(id) {
  return id.slice(0, id.indexOf("@", 1));
}
function childOf(name2, ref2) {
  if (ref2.startsWith("link:")) return workspace("", ref2);
  return ref2.replace(/\(.*$/, "").indexOf("@", 1) > 0 ? ref2 : `${name2}@${ref2}`;
}
function workspace(dir, ref2) {
  return `workspace:${posix7.normalize(posix7.join(dir, ref2.slice("link:".length)))}`;
}

// src/core/keys/pnpm-install.ts
var PNPM_MODULES = "node_modules/.modules.yaml";
var PACKAGE_FOLDERS_ENCODING2 = "squeal-pnpm-package-folders/1";
function readPnpmInstall(dir, base, text2, scans) {
  const modules = layoutOf(dir);
  if (modules === null) return null;
  const lockfile = readPnpmLockfile(text2);
  if (lockfile === null) return null;
  const graph = new PnpmGraph(dir, base, lockfile, modules, scans);
  const stale = stalePnpmLockfile(dir, graph);
  if (stale === null) return { graph, stale };
  return {
    graph: null,
    stale,
    folders: pnpmPackageFoldersFingerprint(dir, lockfile.importers.keys())
  };
}
function pnpmReading(dir, base, content, scans) {
  const text2 = content.toString("utf8");
  const install = base === null ? null : readPnpmInstall(dir, base, text2, scans);
  if (install !== null && install.stale !== null) {
    return { manager: "pnpm", stale: install.stale, folders: install.folders, graph: null };
  }
  const graph = install?.graph ?? null;
  return { manager: "pnpm", stale: null, text: withoutLinkedSpecifiers(text2), graph };
}
function layoutOf(dir) {
  let modules;
  try {
    modules = JSON.parse(readFileSync16(join22(dir, PNPM_MODULES), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(modules) || modules.nodeLinker !== "isolated") return null;
  if (modules.virtualStoreDir !== ".pnpm" || modules.enableGlobalVirtualStore === true) return null;
  return modules;
}
function stalePnpmLockfile(dir, graph) {
  const lockTime = lstatSync5(join22(dir, PNPM_LOCKFILE)).mtimeMs;
  const stale = { unlisted: [], newer: [], missing: [], installed: [] };
  checkVirtualStore(dir, graph, lockTime, stale);
  checkImporters(dir, graph, lockTime, stale);
  const parts = [
    ["not listed in it", stale.unlisted],
    ["newer than it", stale.newer],
    ["missing", stale.missing],
    ["installed though skipped", stale.installed]
  ];
  const reasons = parts.filter(([, paths]) => paths.length > 0).map(([label, paths]) => `${label}: ${example2(paths)}`);
  return reasons.length === 0 ? null : reasons.join("; ");
}
function checkVirtualStore(dir, graph, lockTime, stale) {
  for (const [id, folder] of graph.folders) {
    if (graph.skipped.has(id)) continue;
    const modules = `${PNPM_VIRTUAL_STORE}/${folder}/node_modules`;
    const path = `${modules}/${id.slice(0, id.indexOf("@", 1))}`;
    const stat = lstatSync5(join22(dir, path), { throwIfNoEntry: false });
    if (stat === void 0) stale.missing.push(path);
    else if (stat.mtimeMs > lockTime) stale.newer.push(path);
    for (const [name2, ref2] of graph.lockfile.snapshots.get(id) ?? []) {
      const edge = `${modules}/${name2}`;
      expectLink(graph, stale, edge, childOf(name2, ref2), exists(dir, edge));
    }
  }
  for (const [alias, id] of graph.privateHoisted) {
    const path = `${PNPM_VIRTUAL_STORE}/node_modules/${alias}`;
    expectLink(graph, stale, path, id, exists(dir, path));
  }
}
function checkImporters(dir, graph, lockTime, stale) {
  for (const [importer, declared] of graph.lockfile.importers) {
    const modules = importer === "." ? "node_modules" : `${importer}/node_modules`;
    const present = new Set(namesIn(join22(dir, modules)));
    for (const name2 of present) {
      const path = `${modules}/${name2}`;
      if (!declared.has(name2) && !(importer === "." && graph.publicHoisted.has(name2))) {
        stale.unlisted.push(path);
      } else if (lstatSync5(join22(dir, path)).mtimeMs > lockTime) stale.newer.push(path);
    }
    const links = new Map([...declared].map(([name2, ref2]) => [name2, childOf(name2, ref2)]));
    for (const [alias, id] of importer === "." ? graph.publicHoisted : []) {
      const own = links.get(alias);
      if (own === void 0 || graph.skipped.has(own)) links.set(alias, id);
    }
    for (const [name2, target] of links) {
      expectLink(graph, stale, `${modules}/${name2}`, target, present.has(name2));
    }
  }
}
function expectLink(graph, stale, path, target, there) {
  if (graph.skipped.has(target)) {
    if (there) stale.installed.push(path);
  } else if (!there) stale.missing.push(path);
}
function exists(dir, path) {
  return lstatSync5(join22(dir, path), { throwIfNoEntry: false }) !== void 0;
}
function pnpmPackageFoldersFingerprint(dir, importers) {
  const roots = /* @__PURE__ */ new Set(["node_modules", `${PNPM_VIRTUAL_STORE}/node_modules`]);
  for (const importer of importers)
    roots.add(importer === "." ? "node_modules" : `${importer}/node_modules`);
  for (const folder of entriesOf4(join22(dir, PNPM_VIRTUAL_STORE))) {
    if (folder.isDirectory() && folder.name !== "node_modules") {
      roots.add(`${PNPM_VIRTUAL_STORE}/${folder.name}/node_modules`);
    }
  }
  const entries = [];
  const walk = (at) => {
    for (const name2 of namesIn(join22(dir, at))) {
      const path = `${at}/${name2}`;
      const link = lstatSync5(join22(dir, path)).isSymbolicLink();
      entries.push(
        link ? [path, "link", readlinkSync3(join22(dir, path))] : [path, ...manifestOf(dir, path)]
      );
      if (!link) walk(`${path}/node_modules`);
    }
  };
  for (const at of [...roots].sort(compare)) walk(at);
  return createHash8("sha256").update(JSON.stringify([PACKAGE_FOLDERS_ENCODING2, entries])).digest("hex");
}
function namesIn(modules) {
  const names3 = [];
  for (const entry2 of entriesOf4(modules)) {
    if (entry2.name.startsWith(".")) continue;
    if (entry2.name.startsWith("@") && entry2.isDirectory()) {
      for (const child of entriesOf4(join22(modules, entry2.name)))
        names3.push(`${entry2.name}/${child.name}`);
    } else names3.push(entry2.name);
  }
  return names3.sort(compare);
}
function entriesOf4(path) {
  try {
    return readdirSync9(path, { withFileTypes: true });
  } catch {
    return [];
  }
}
function manifestOf(dir, path) {
  try {
    const manifest = JSON.parse(readFileSync16(join22(dir, path, "package.json"), "utf8"));
    return isRecord(manifest) ? [manifest.name ?? null, manifest.version ?? null] : [null, null];
  } catch {
    return [null, null];
  }
}
function example2(paths) {
  const [first] = [...paths].sort(compare);
  return paths.length === 1 ? `${first}` : `${first} and ${paths.length - 1} more`;
}

// src/core/keys/environment.ts
function coreEnvironmentInputs(options) {
  const source = options.env ?? process.env;
  const env = {};
  for (const name2 of [...options.allowlist].sort(compare)) {
    const value = source[name2];
    if (value !== void 0) env[name2] = value;
  }
  return {
    squealVersion: options.squealVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    installedDependencies: options.installedDependencies,
    env
  };
}
var LOCKFILES2 = [
  { path: HIDDEN_LOCKFILE, patches: "patches", read: npmReading },
  { path: "node_modules/.yarn-state.yml", patches: null },
  { path: ".pnp.cjs", patches: ".yarn/patches" },
  { path: ".pnp.js", patches: ".yarn/patches" },
  { path: "node_modules/.yarn-integrity", patches: "patches" },
  { path: PNPM_LOCKFILE, patches: null, read: pnpmReading },
  { path: ".rush/temp/shrinkwrap-deps.json", patches: null },
  { path: "bun.lock", patches: "patches" },
  { path: "bun.lockb", patches: "patches" }
];
function isInstalledLockfile(path) {
  return LOCKFILES2.some((format) => path === format.path || path.endsWith(`/${format.path}`));
}

// src/core/scheduler/record-tier.ts
var HERE = coreEnvironmentInputs({
  squealVersion: "",
  installedDependencies: "",
  allowlist: []
});

// src/core/scheduler/backlog.ts
function wallEstimate(sum, longest, width) {
  return sum / width + (1 - 1 / width) * longest;
}

// src/core/scheduler/yields.ts
function yieldsMetaKey(worktreeId) {
  return worktreeMetaKey("yields", worktreeId);
}
function publishedYieldRow(store, worktreeId, daemonStartedAt) {
  return readYieldRow(store.meta.get(yieldsMetaKey(worktreeId)), daemonStartedAt);
}

// src/core/status/standing-yields.ts
function liveYieldRow(store, worktreeId, startedAt) {
  return startedAt === null ? NO_YIELD_ROW : publishedYieldRow(store, worktreeId, startedAt);
}

// src/core/scheduler/edit-timings.ts
function editTimingsMetaKey(worktreeId) {
  return worktreeMetaKey("editTimings", worktreeId);
}
var isNumber3 = (v) => typeof v === "number" && Number.isFinite(v);
function readEditTimings(store, worktreeId) {
  const raw = store.meta.get(editTimingsMetaKey(worktreeId));
  let value = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isNumber3(value.tierSize) || !isRecord(value.widths)) return null;
  const widths = {};
  for (const [project, w] of Object.entries(value.widths)) {
    if (isRecord(w) && isNumber3(w.width) && typeof w.part === "string") {
      widths[project] = { width: w.width, part: w.part };
    }
  }
  const list = (v) => Array.isArray(v) ? v.filter(isRecord) : [];
  return {
    tierSize: value.tierSize,
    widths,
    firsts: list(value.firsts).flatMap(
      (f) => isNumber3(f.revision) && isNumber3(f.delayMs) ? [{ revision: f.revision, delayMs: f.delayMs }] : []
    ),
    tiers: list(value.tiers).flatMap(
      (t) => typeof t.runId === "string" && isNumber3(t.estimateMs) ? [{ runId: t.runId, estimateMs: t.estimateMs }] : []
    )
  };
}

// src/core/delivery/late-bound.ts
var LATE_FACTOR = 2;
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function tierEstimate(tier) {
  const parts = /* @__PURE__ */ new Map();
  for (const f of tier) {
    const was = parts.get(f.part) ?? { sum: 0, longest: 0, count: 0, width: Infinity };
    parts.set(f.part, {
      sum: was.sum + f.ms,
      longest: Math.max(was.longest, f.ms),
      count: was.count + 1,
      width: Math.min(was.width, Math.max(1, Math.floor(f.width)))
    });
  }
  let total = 0;
  for (const p of parts.values())
    total += wallEstimate(p.sum, p.longest, Math.min(p.count, p.width));
  return total;
}
function lateBoundMs({ files: files2, tierSize, startMs, overheadMs }) {
  const fallback2 = median(files2.flatMap((f) => f.ms === null ? [] : [f.ms]));
  const ordered = files2.map((f) => ({ ...f, ms: f.ms ?? fallback2 })).sort((a, b) => a.ms - b.ms);
  const size = Math.max(1, tierSize);
  let tiers = 0;
  for (let i = 0; i < ordered.length; i += size) {
    tiers += overheadMs + tierEstimate(ordered.slice(i, i + size));
  }
  return LATE_FACTOR * (startMs + tiers);
}

// src/core/delivery/late-timings.ts
function worktreeMedians(store, worktreeId) {
  const timings = readEditTimings(store, worktreeId);
  if (timings === null) return { startMs: 0, overheadMs: 0 };
  const overheads = timings.tiers.flatMap(({ runId, estimateMs: estimateMs2 }) => {
    const run2 = store.runs.get(runId);
    return run2?.end === "completed" && run2.endedAt !== null ? [run2.endedAt - run2.startedAt - estimateMs2] : [];
  });
  return {
    startMs: Math.max(0, median(timings.firsts.map((f) => f.delayMs))),
    overheadMs: Math.max(0, median(overheads))
  };
}
function pastBound(store, worktreeId, files2, ageMs) {
  const timings = readEditTimings(store, worktreeId);
  const tierSize = timings?.tierSize ?? DEFAULT_POLICY.runner.tierSize;
  const bound = files2.map((file) => {
    const known = timings?.widths[file.project];
    return {
      ms: durationOf(store.results.newestForTestFile(file)),
      width: known?.width ?? 1,
      part: known?.part ?? ""
    };
  });
  const floor2 = lateBoundMs({ files: bound, tierSize, startMs: 0, overheadMs: 0 });
  if (ageMs <= floor2) return false;
  const medians = worktreeMedians(store, worktreeId);
  const measured = lateBoundMs({ files: bound, tierSize, ...medians });
  return ageMs > (measured === 0 ? FEED_LATE_MS : measured);
}

// src/core/delivery/late.ts
function lateMetaKey(worktreeId) {
  return worktreeMetaKey("editsLate", worktreeId);
}
function readSlotOf(store, consumer) {
  const value = readSlot(store, lateMetaKey(consumer.worktreeId), consumer);
  if (typeof value === "number") return value;
  return isRecord(value) && typeof value.ended === "number" ? { ended: value.ended } : null;
}
var endedAt = (slot2) => slot2 === null || typeof slot2 === "number" ? 0 : slot2.ended;
function readLate(store, consumer) {
  const slot2 = readSlotOf(store, consumer);
  return typeof slot2 === "number" ? slot2 : null;
}
function writeLate(store, consumer, slot2) {
  writeSlot(store, lateMetaKey(consumer.worktreeId), consumer, slot2);
}
function forgetLate(store, consumer) {
  writeLate(store, consumer, null);
}
function lateIsOpen(store, consumer) {
  return readLate(store, consumer) !== null;
}
function endLate(store, consumer) {
  if (!lateIsOpen(store, consumer)) return;
  writeLate(store, consumer, { ended: store.revisions.latest(consumer.worktreeId)?.number ?? 0 });
}
var NAMED_MAX = 3;
function lateNotes(store, consumer, own, at, header) {
  const slot2 = readSlotOf(store, consumer);
  const open2 = typeof slot2 === "number" ? slot2 : null;
  const after = Math.max(own.since, endedAt(slot2));
  if (open2 === null && own.revision <= after) return null;
  const daemon = headerView(readPresence(store, consumer.worktreeId, at));
  if (open2 === null) {
    if (daemon.state !== "alive" || daemon.stopping !== void 0) return null;
    const late = lateNow(store, consumer.worktreeId, { ...own, after }, at, lateOf(daemon)?.since);
    if (late === null || quietFor(header())) return null;
    return {
      open: false,
      late: late.kind === "unlisted" ? withRunners(late, header()) : late,
      tell: () => writeLate(store, consumer, late.revision)
    };
  }
  const done = own.refined && own.owed.length === 0 && lateOf(daemon) === void 0;
  if (done && own.files === 0) {
    writeLate(store, consumer, null);
    return null;
  }
  const caughtUp = done ? { revision: own.revision, files: own.files, unknown: own.unknown } : void 0;
  return {
    open: true,
    ...caughtUp === void 0 ? {} : { caughtUp },
    tell: () => {
      if (caughtUp !== void 0) writeLate(store, consumer, null);
    }
  };
}
function lateNow(store, worktreeId, own, at, unreadSince) {
  const { revision } = own;
  if (unreadSince !== void 0) return { kind: "unread", revision, since: unreadSince };
  if (!own.refined) {
    const age = at - (store.revisions.get(worktreeId, revision)?.createdAt ?? at);
    return age > FEED_LATE_MS && pastBound(store, worktreeId, [], age) ? { kind: "unlisted", revision } : null;
  }
  const owed2 = own.owed.filter((o) => o.from > own.after);
  const oldest = oldestOwed(store, worktreeId, owed2);
  if (oldest === null) return null;
  const ageMs = at - oldest.createdAt;
  const due = owed2.map((o) => o.file);
  if (!pastBound(store, worktreeId, due, ageMs)) return null;
  const files2 = own.owed.map((o) => o.file);
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? null;
  const hung = firstOverrunning(files2, liveYieldRow(store, worktreeId, startedAt), at);
  return {
    kind: "owed",
    revision,
    owed: own.owed.length,
    files: own.files,
    editRevision: oldest.from,
    ageMs,
    ...files2.length <= NAMED_MAX ? { named: files2.map((f) => f.path) } : {},
    ...hung === null ? {} : { hung: hung.path }
  };
}
function quietFor(header) {
  return (header.holds?.length ?? 0) > 0 || header.noTestsAtEdit === true || header.testFilesListed === false;
}
function lateMaySay(header) {
  const { daemon } = header;
  return daemon?.state === "alive" && daemon.stopping === void 0 && !quietFor(header);
}
function lateCarriesDelay(header, owed2, late) {
  return (owed2 > 0 || late !== void 0) && lateMaySay(header);
}
function withRunners(late, header) {
  const runners = header.listingRunners;
  return runners === void 0 ? late : { ...late, runners };
}
function oldestOwed(store, worktreeId, owed2) {
  if (owed2.length === 0) return null;
  const from = Math.min(...owed2.map((o) => o.from));
  const createdAt = store.revisions.get(worktreeId, from)?.createdAt;
  return createdAt === void 0 ? null : { from, createdAt };
}

// src/core/delivery/header.ts
var CURRENT_DEFINED = "(run on the files as they are now)";
function noResultsText(command) {
  return `Squeal is still starting in this worktree and has no results yet. \`${command} status --wait 60000 <path>...\` waits for the files you change.`;
}
var NO_RESULTS_HERE = "Squeal has no results in this worktree yet";
function unlistedLine(header, command) {
  if (header.testFilesListed !== false) return null;
  const { daemon } = header;
  if (daemon?.state === "down" && daemon.startStopped === true) {
    return `${revisionPrefix(header)}${stoppedStartText(daemon)}, and ${NO_RESULTS_HERE}.${diedText(daemon)}`;
  }
  if (daemon?.state === "down" && daemon.startSlow === true) {
    return `${revisionPrefix(header)}${slowStartText(daemon)}, and ${NO_RESULTS_HERE}.${diedText(daemon)}`;
  }
  if (noneRunning(daemon)) {
    return `${revisionPrefix(header)}${NO_RESULTS_HERE}, and no daemon is running; \`${command} start\` starts one.${diedText(daemon)}`;
  }
  return `${revisionPrefix(header)}${noResultsText(command)}${daemonText(header, command, true)}`;
}
function revisionPrefix(header) {
  return `Revision ${header.revision}${changedText(header)}: `;
}
var CHANGED_PATHS_SHOWN = 3;
function changedText(header) {
  const paths = header.changedPaths;
  if (paths === void 0 || paths.length === 0) return "";
  const ignored = new Set(header.ignoredPaths);
  const shown = paths.slice(0, CHANGED_PATHS_SHOWN).map((path) => ignored.has(path) ? `git-ignored ${path}` : path).join(", ");
  const more = paths.length - CHANGED_PATHS_SHOWN;
  return ` (changed ${shown}${more > 0 ? ` and ${more} more` : ""})`;
}
function incompleteText(header, command) {
  const late = header.daemon?.stopping === void 0 ? lateOf(header.daemon) : void 0;
  const delays = delaysText(header, late, command);
  return delays === null ? "" : ` ${delays}`;
}
function fullLine(header, command) {
  const unlisted2 = unlistedLine(header, command);
  if (unlisted2 !== null) return `${unlisted2}${holdsText2(header, command)}`;
  const rest = `${incompleteText(header, command)}${daemonText(header, command)}${holdsText2(header, command)}`;
  const revision = revisionPrefix(header).slice(0, -2);
  if (rest !== "") return `${revision}:${rest}`;
  return changedText(header) === "" ? null : `${revision}.`;
}
function currentFilesText(header, command) {
  const files2 = header.testFileCounts;
  if (files2 === void 0 || header.testFilesListed === false) return null;
  const total = files2.current + files2.pending + files2.stale + files2.unknown;
  if (total === 0) return "the daemon listed no test files.";
  const are = (...ns) => ns.includes(1) ? "is" : "are";
  if (files2.current < total) {
    return `${files2.current} of ${plural(total, "test file")} ${are(files2.current, total)} current ${CURRENT_DEFINED}, and \`${command} status\` counts the rest.`;
  }
  const live = header.daemon?.state === "alive" && header.daemon.late === void 0;
  const all = live && header.runnerPartPending !== true && header.awaitingInstall !== true;
  return `${all ? "all " : ""}${plural(total, "test file")} ${are(total)} current ${CURRENT_DEFINED}.`;
}
function holdsText2(header, command) {
  return (header.holds ?? []).map((hold) => ` ${holdLine(hold, command)}`).join("");
}
function newsLine(header, command, told) {
  const unlisted2 = unlistedLine(header, command);
  if (unlisted2 !== null) return unlisted2;
  const revision = revisionPrefix(header);
  const own = told.ownEdits;
  const delays = lateCarriesDelay(header, own?.owed ?? 0, told.editsLate) ? "" : incompleteText(header, command);
  if (!showsOwnCount(header, "news", told)) {
    const files2 = currentFilesText(header, command);
    const line2 = files2 === null ? `${revision.slice(0, -2)}.` : `${revision}${files2}`;
    return `${line2}${delays}${daemonText(header, command)}`;
  }
  const line = own === void 0 ? `${revision.slice(0, -2)}.` : `${revision}${ownCountText(own)}`;
  return `${line}${delays}${daemonText(header, command)}`;
}
function showsOwnCount(header, form, told) {
  return form === "news" && header.testFilesListed !== false && told.countsOwed === void 0;
}
function affected(files2) {
  return `the ${plural(files2, "test file")} your edits affect`;
}
function notRunText(owed2, files2) {
  const verb = owed2 === 1 ? "has" : "have";
  return owed2 === files2 ? `${affected(files2)} ${verb} not run` : `${owed2} of ${affected(files2)} ${verb} not run`;
}
function ownCountText({ files: files2, owed: owed2, unknown = 0 }) {
  const count2 = owed2 > 0 ? notRunText(owed2, files2) : `${affected(files2)} ${files2 === 1 ? "has run" : "have all run"}`;
  return unknown === 0 ? `${count2}.` : `${count2}; ${unknown} with no result (unknown).`;
}
function headerLines(...args) {
  const { line, tiers } = headerParts(...args);
  return line === null ? [...tiers] : [line, ...tiers];
}
function slowLine(header, command) {
  return header.slowTier?.testFiles === 0 ? null : slowTierText(header, command);
}
function headerParts(header, command, form = "full", told = {}) {
  const line = form === "full" ? fullLine(header, command) : newsLine(header, command, told);
  const slow = form === "full" || told.slowTierChanged ? slowLine(header, command) : null;
  const groups2 = form === "full" ? groupTierLines(header, command) : told.groupTiersChanged === void 0 ? [] : groupTierLines(header, command, told.groupTiersChanged);
  const commit = told.commitChanged === true ? header.commitLine?.text : void 0;
  return {
    line,
    tiers: [...slow === null ? [] : [slow], ...groups2, ...commit === void 0 ? [] : [commit]]
  };
}

// src/core/delivery/late-format.ts
function nowText(late, command) {
  if (late.named !== void 0) {
    const paths = late.named.map(shellWord).join(" ");
    const them = late.named.length === 1 ? "it" : "them";
    return `To have ${them} now, \`${command} status --wait 60000 ${paths}\` runs ${them} first.`;
  }
  return `To have them now, \`${command} status --wait 60000 <path>...\` runs the files your paths select first.`;
}
function hungText(late, command) {
  if (late.hung === void 0) return "";
  const path = shellWord(late.hung);
  return `${late.hung} has run far past its usual time and may be hung; \`${command} why ${path}\` shows its run. `;
}
var PASSES_SILENT_TEXT = "passes stay silent unless they follow a failure";
function lateLine(late, command) {
  switch (late.kind) {
    case "owed":
      return `${capitalize(notRunText(late.owed, late.files))}, ${durationText(late.ageMs, Math.floor)} after your edit at revision ${late.editRevision}. ${capitalize(PASSES_SILENT_TEXT)}; Squeal says once when it has caught up. ${hungText(late, command)}${nowText(late, command)}`;
    case "unread":
      return `Squeal has not read edits made after ${utcTimeText(late.since)}, so it has not queued their test files. ${readWaitText(command)}`;
    case "unlisted":
      return `${runnersHave(late.runners, true)} not yet listed the test files of revision ${late.revision}, so Squeal has not queued them. ${listWaitText(command)}`;
  }
}
function caughtUpLine({ revision, files: files2, unknown }) {
  const which = files2 === 1 ? `The 1 test file your edits affect has run at revision ${revision}` : `All ${files2} test files your edits affect have run at revision ${revision}`;
  if (unknown === 0) return `${which}, with no new failure.`;
  return `${which}: ${files2 - unknown} with results, ${unknown} with no result (unknown); no new failure.`;
}

// src/core/delivery/shared-closure.ts
var keyOf = (paths) => JSON.stringify(paths);
function sharedClosure(blocks2) {
  const counts = /* @__PURE__ */ new Map();
  for (const block3 of blocks2) {
    const key = blockKey(block3);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [shared2] = [...counts].reduce(
    (best, [key, count2]) => count2 >= 2 && count2 > best[1] ? [key, count2] : best,
    [null, 0]
  );
  if (shared2 === null) return { own: closureLine, line: null };
  const all = blocks2.flat();
  const n = all.filter((p) => p !== void 0 && keyOf(p) === shared2).length;
  const tests2 = n === all.length ? `the ${n} failing tests` : `${n} of the ${all.length} failing tests`;
  const paths = JSON.parse(shared2);
  const line = paths.length === 0 ? `None of the ${CHANGED_HERE} are imported by ${tests2}` : `${n === all.length ? `All ${n} failing tests` : capitalize(tests2)} import ${CHANGED_HERE}: ${closurePaths(paths)}`;
  return { own: (p) => p !== void 0 && keyOf(p) === shared2 ? null : closureLine(p), line };
}
function blockKey(block3) {
  const keys = block3.map((p) => p === void 0 ? null : keyOf(p));
  return keys.every((k) => k === keys[0]) ? keys[0] ?? null : null;
}

// src/core/delivery/format.ts
var MESSAGE_CAP_CHARS = 1e4;
var SHARED_LINE_MAX_CHARS = 1e3;
var OVERFLOW_RESERVE = 400;
var INDENT = "      ";
var SQUEAL_COMMAND = "squeal";
var statusPointer = (command) => `\`${command} status\` lists every known failure.`;
var partsText = (checks, fileLevel) => checkPartsText(countChecks(checks), fileLevel);
var fileLevelWord = (shown) => shown === "fail" ? "that did not load" : "loaded";
var upper2 = (outcome) => outcome.toUpperCase();
function whyLine(check, command) {
  return `Full output: ${command} why ${shellWord(checkName(check))}`;
}
function block2(head, lines, counted2) {
  const body = lines.filter((l) => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), counted: counted2 };
}
function entryBlock(entry2, revision, flaky, closure = () => null) {
  const failed2 = entry2.to === "fail";
  return block2(
    `${upper2(entry2.to)}  ${checkName(entry2.check)}`,
    [
      failed2 ? seenLine(entry2, revision) : change(entry2),
      entry2.summary === null ? null : cap(entry2.summary, SUMMARY_MAX_CHARS),
      entry2.location === null ? null : atText(entry2.location, entry2.testFileFrame),
      ...failed2 ? [closure(entry2.changesInClosure), loadLine(entry2)] : [recoveryProvenance(entry2, revision)],
      ...flaky(entry2.flaky),
      entry2.retry === void 0 ? null : capitalize(retryText(entry2.retry))
    ],
    [{ check: entry2.check, shown: entry2.to }]
  );
}
function retiredBlock(entry2) {
  return block2(
    `RESOLVED  ${checkName(entry2.check)}`,
    ["FAIL -> no longer reported by the runner"],
    [{ check: entry2.check, shown: "resolved" }]
  );
}
function collapsedBlock({ head, lines }, shown, checks) {
  return block2(
    head,
    lines,
    checks.map((check) => ({ check, shown }))
  );
}
function failureBlocks(groups2, revision, command, flaky, closure) {
  return groups2.map((group) => {
    const [first] = group;
    if (group.length === 1 && first !== void 0) {
      return entryBlock(first, revision, flaky, closure);
    }
    const lines = groupLines(group, revision, command, flaky, closure);
    return collapsedBlock(
      lines,
      "fail",
      group.map((e) => e.check)
    );
  });
}
function recoveryBlocks(entries, delta, flaky) {
  const checks = entries.map((e) => e.check);
  const head = `PASS  ${plural(checks.length, "check")} recovered (FAIL -> PASS): ${partsText(checks)}`;
  const collapsed = collapse(head, checks, delta.stillFailing);
  if (collapsed !== null) return [collapsedBlock(collapsed, "pass", checks)];
  return entries.map((e) => entryBlock(e, delta.header.revision, flaky));
}
function retiredBlocks(entries, delta) {
  const checks = entries.map((e) => e.check);
  const head = `RESOLVED  ${plural(checks.length, "check")} no longer reported by the runner (FAIL -> RESOLVED): ${partsText(checks)}`;
  const collapsed = collapse(head, checks, delta.stillFailing);
  if (collapsed !== null) return [collapsedBlock(collapsed, "resolved", checks)];
  return entries.map(retiredBlock);
}
function unknownBlocks(entries, command) {
  const byReason = /* @__PURE__ */ new Map();
  for (const e of entries) {
    const reason = e.summary ?? "no trusted result";
    byReason.set(reason, [...byReason.get(reason) ?? [], e]);
  }
  return [...byReason].map(([reason, group]) => {
    const files2 = [...new Set(group.map((e) => e.check.testPath))];
    const first = group[0]?.check;
    const from = (outcome) => group.filter((e) => e.from === outcome).map((e) => e.check);
    const counts = ["pass", "fail"].filter((o) => from(o).length > 0).map((o) => `${upper2(o)} -> UNKNOWN (${partsText(from(o))})`);
    const listed2 = files2.slice(0, 5).join(", ");
    const more = files2.length > 5 ? ` and ${plural(files2.length - 5, "more file")}` : "";
    return block2(
      `UNKNOWN  ${checksText(group.map((e) => e.check))} in ${plural(files2.length, "test file")}`,
      [
        counts.join(", "),
        cap(reason, SUMMARY_MAX_CHARS),
        `${listed2}${more}`,
        first === void 0 ? null : `Full reason: ${command} why ${shellWord(checkName(first))}`
      ],
      group.map((e) => ({ check: e.check, shown: "unknown" }))
    );
  });
}
function assemble(head, blocks2, overflow, tail, max) {
  const end = tail === null ? "" : `

${tail}`;
  const room = max - end.length;
  let out = head;
  for (const [i, b] of blocks2.entries()) {
    const next = `${out}

${b.text}`;
    const last = i === blocks2.length - 1;
    if (next.length <= room - (last ? 0 : OVERFLOW_RESERVE)) {
      out = next;
      continue;
    }
    return `${cap(`${out}

${overflow(blocks2.slice(i))}`, room)}${end}`;
  }
  return `${out}${end}`;
}
function formatDelta(delta, command = SQUEAL_COMMAND, max = MESSAGE_CAP_CHARS, form = "news") {
  const { header, entries } = delta;
  const changed = entries.filter((e) => e.kind !== "fail-retired");
  const retired = entries.filter((e) => e.kind === "fail-retired");
  const holds2 = (delta.holds ?? []).map((c) => holdChangeLine(c, header.revision, command));
  const holdTitle = entries.length === 0 && delta.liveness === void 0 ? holds2[0] : void 0;
  const title = titleOf(delta, holdTitle, command);
  const flaky = flakyLines();
  const failures = changed.filter((e) => e.to === "fail");
  const groups2 = failureGroups(failures, header.revision);
  const closure = sharedClosure(groups2.map((g) => g.map((e) => e.changesInClosure)));
  const blocks2 = [
    ...failureBlocks(groups2, header.revision, command, flaky, closure.own),
    ...unknownBlocks(
      changed.filter((e) => e.to === "unknown"),
      command
    ),
    ...recoveryBlocks(
      changed.filter((e) => e.to === "pass"),
      delta,
      flaky
    ),
    ...retiredBlocks(retired, delta)
  ];
  const [failed2] = failures;
  const overflow = (left) => {
    const counted2 = left.flatMap((b) => b.counted);
    const by = ["fail", "pass", "unknown", "resolved"].map((o) => [o, counted2.filter((c) => c.shown === o).map((c) => c.check)]).filter(([, checks]) => checks.length > 0).map(([o, checks]) => `${checks.length} ${upper2(o)}: ${partsText(checks, fileLevelWord(o))}`);
    return `Not shown: ${counted2.length} more changed checks (${by.join("; ")}). ${statusPointer(command)}`;
  };
  const code = delta.code === void 0 ? [] : codeLines(delta.code, command);
  const lint2 = delta.lint === void 0 ? [] : lintLines(delta.lint, command);
  const tail = [
    ...closure.line === null ? [] : [cap(closure.line, SHARED_LINE_MAX_CHARS)],
    ...failed2 === void 0 ? [] : [whyLine(failed2.check, command)],
    ...code.length === 0 ? [] : [code.join("\n")],
    ...lint2.length === 0 ? [] : [lint2.join("\n")],
    ...otherSideLines(delta, code.length > 0 || lint2.length > 0, command, form)
  ].join("\n\n") || null;
  return assemble(
    [
      title,
      ...headerLines(header, command, form, delta),
      ...holdTitle === void 0 ? holds2 : holds2.slice(1),
      ...editLines(delta, command)
    ].join("\n"),
    blocks2,
    overflow,
    tail,
    max
  );
}
function otherSideLines({ entries, code, knownFailures = 0 }, codeNews, command, form) {
  if (entries.length > 0) {
    const told = code === void 0 ? null : toldOverLine(code, command);
    return told === null ? [] : [told];
  }
  if (!codeNews || form === "full" || knownFailures === 0) return [];
  return [knownFailuresTailLine(knownFailures, command)];
}
function titleOf(delta, holdTitle, command) {
  const { header, entries } = delta;
  const words = [
    delta.code === void 0 ? null : codeTitleWords(delta.code),
    delta.lint === void 0 ? null : lintTitleWords(delta.lint)
  ].filter((w) => w !== null);
  const code = words.length === 0 ? null : words.join(" and ");
  const own = entries.length === 0 ? delta.liveness === void 0 ? holdTitle ?? null : livenessTitle(delta.liveness, header, command) : delta.label === "baseline" ? `SQUEAL \xB7 Squeal's baseline run found ${checksText(checksOf(entries), "failing check", "that did not load")} at revision ${header.revision}` : `SQUEAL \xB7 ${plural(entries.length, "check")} changed (${partsText(checksOf(entries))}) at revision ${header.revision}`;
  if (own === null) {
    const words2 = [code, ...contentWords(delta)].filter((w) => w !== null);
    return words2.length === 0 ? `SQUEAL \xB7 revision ${header.revision}` : `SQUEAL \xB7 ${words2.join("; ")} at revision ${header.revision}`;
  }
  return code === null ? own : `${own}; ${code}`;
}
function quietEditsText(command) {
  return `no test group runs after each edit, so silence between edits is not a pass; \`${command} run <group> <path>... --wait 60000\` runs the test files your paths select`;
}
function sawEditLine(queued, quiet = null, done = false) {
  if (done) return `Squeal saw your edit; ${quiet ?? PASSES_SILENT_TEXT}.`;
  if (quiet !== null) {
    return `Squeal saw your edit, which affects ${plural(queued, "test file")}; ${quiet}.`;
  }
  return `Squeal saw your edit and queued ${plural(queued, "test file")}; results arrive with later tool calls, and ${PASSES_SILENT_TEXT}.`;
}
function editLines({ sawEdit, ownEdits, editsLate, caughtUp, header }, command) {
  const quiet = header.noTestsAtEdit === true ? quietEditsText(command) : null;
  return [
    ...sawEdit === void 0 ? [] : [sawEditLine(sawEdit.queued, quiet, ownEdits?.owed === 0)],
    ...editsLate === void 0 ? [] : [lateLine(editsLate, command)],
    ...caughtUp === void 0 ? [] : [caughtUpLine(caughtUp)]
  ];
}
var checksOf = (entries) => entries.map((e) => e.check);
function holdChangeLine(change2, revision, command) {
  switch (change2.kind) {
    case "on-hold":
      return `SQUEAL \xB7 validation on hold at revision ${revision}: ${holdStartText(change2.hold, command)}`;
    case "ended":
      return `SQUEAL \xB7 a hold ended at revision ${revision}: ${holdEndedText(change2)}`;
    case "resumed":
      return `SQUEAL \xB7 validating again at revision ${revision}: ${holdEndText(change2)}`;
  }
}
function livenessTitle(liveness, header, command) {
  const { revision } = header;
  if (liveness?.stopping !== void 0) {
    const what = liveness.stopping.to === void 0 ? "stopping" : "handing over";
    return `SQUEAL \xB7 the daemon is ${what} at revision ${revision}`;
  }
  const told = liveness === void 0 ? void 0 : toldOf(liveness);
  switch (told?.state) {
    case "stopped by request":
      return stopOf(liveness) === "until-start" ? `SQUEAL \xB7 the daemon is stopped until \`${command} start\` at revision ${revision}` : `SQUEAL \xB7 the daemon is stopped by request at revision ${revision}`;
    case "validating":
      if (liveness?.state === "alive" && liveness.short !== void 0) {
        return `SQUEAL \xB7 a ${liveness.short.version} daemon is validating at revision ${revision}, not ${liveness.short.claimed}`;
      }
      return `SQUEAL \xB7 a daemon is validating again at revision ${revision}: its heartbeat is current`;
    case "starting":
      if (told.notes.includes("start stopped")) {
        return `SQUEAL \xB7 a starting daemon may be stopped at revision ${revision}`;
      }
      if (told.notes.includes("start slow")) {
        return `SQUEAL \xB7 a daemon is still starting at revision ${revision}`;
      }
      break;
  }
  return header.daemon?.state === "down" && header.daemon.heartbeatLate !== void 0 ? `SQUEAL \xB7 the daemon's heartbeat is late at revision ${revision}` : `SQUEAL \xB7 no daemon is validating at revision ${revision}`;
}
function knownFailuresCountLine(counted2, failures, header, command) {
  if (header?.testFilesListed === false && failures === 0) return null;
  const files2 = header === void 0 ? null : currentFilesText(header, command);
  return `${counted2}${files2 === null ? "" : `; ${files2}`}`;
}
function knownFailuresLines(header, failures, command) {
  const current2 = splitByValidity(failures).current.map((f) => f.check);
  const counted2 = `Known failures: ${failureCountText(current2)}`;
  const line = knownFailuresCountLine(counted2, failures.length, header, command);
  return line === null ? [] : [line];
}
function codeAndLintLines(registration2, command) {
  const { code, lint: lint2 } = registration2;
  const linting = lint2?.linting !== void 0 && lint2.off === void 0 && lint2.unreadable === void 0 && lint2.failed === void 0;
  return [
    ...code === void 0 || code.counting !== void 0 ? [] : [codeRegistrationLine(code, command)],
    ...lint2 === void 0 || linting ? [] : [lintRegistrationLine(lint2, command)]
  ];
}
function formatRegistration(registration2, max = MESSAGE_CAP_CHARS, command = SQUEAL_COMMAND, now = Date.now()) {
  const { header, knownFailures } = registration2;
  const { line, tiers } = headerParts(header, command);
  const head = [
    `SQUEAL \xB7 registered at revision ${header.revision}`,
    ...line === null ? [] : [line],
    // Spec 011 C6 as amended (gh-34): only current failures are counted; row 005-90: none while
    // the test files are not listed, unless the store holds a failure; row 005-94: first.
    ...knownFailuresLines(header, knownFailures, command),
    ...earlierFailuresLines(knownFailureCounts(knownFailures)),
    ...tiers,
    // Spec 001 D4 (task 001-176): said once, at registration; status lists it among the notes.
    ...header.optimizerOff === void 0 ? [] : [header.optimizerOff],
    // Spec 015 D6: a number and the command that lists them, never the list; spec 017 D8: one line.
    ...codeAndLintLines(registration2, command),
    // Row 011-275 (gh-120): the keys a runtime here leaves out, as status names them.
    ...ignoredConfigLines(registration2, command)
  ].join("\n");
  const closure = sharedClosure(knownFailures.map((f) => [f.changesInClosure]));
  const advised = knownFailures.filter((f) => f.recorded !== void 0).length >= 2;
  const recorded = (f, facts) => advised ? recordedShortText(facts, registration2.consumer.worktreeId, now) : (
    // Row 011-67 (gh-52): a failure recorded under load names its load retry.
    recordedText(facts, registration2.consumer.worktreeId, now, {
      command,
      path: f.check.testPath
    })
  );
  const advice = advised ? retryAdviceText(
    knownFailures.flatMap(
      (f) => f.recorded === void 0 ? [] : [{ facts: f.recorded, path: f.check.testPath }]
    ),
    command
  ) : null;
  const blocks2 = knownFailures.map(
    (f) => block2(
      `FAIL  ${checkName(f.check)}`,
      [
        f.summary === "" ? null : cap(f.summary, SUMMARY_MAX_CHARS),
        f.location === null ? null : atText(f.location, f.testFileFrame),
        f.validity === "current" ? null : `${f.validity}, observed at revision ${f.observedAt}`,
        f.recorded === void 0 ? f.recordedUnknown === true ? capitalize(RECORDED_UNKNOWN_TEXT) : null : capitalize(recorded(f, f.recorded)),
        closure.own(f.changesInClosure)
      ],
      [{ check: f.check, shown: "fail" }]
    )
  );
  const first = knownFailures[0];
  const notShown = (left) => checksText(
    left.flatMap((b) => b.counted.map((c) => c.check)),
    "more known failure",
    "that did not load"
  );
  return assemble(
    head,
    blocks2,
    (left) => `Not shown: ${notShown(left)}. ${statusPointer(command)}`,
    [
      closure.line === null ? null : cap(closure.line, SHARED_LINE_MAX_CHARS),
      advice,
      first === void 0 ? null : whyLine(first.check, command)
    ].filter((l) => l !== null).join("\n\n") || null,
    max
  );
}

// src/harness/shared/context.ts
import { existsSync as existsSync10 } from "node:fs";
import { join as join27 } from "node:path";

// src/core/store/mark.ts
import { randomUUID } from "node:crypto";
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync17,
  renameSync as renameSync2,
  rmSync as rmSync3,
  statSync as statSync4,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join23 } from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";
var MARK_FINDERS = ["full-check", "daemon", "hook", "unknown"];
var RECOVERY_LOCK = "store-recovery.sqlite";
function markUnder(commonDir, file, mark, waitMs) {
  const paths = storePaths(commonDir);
  mkdirSync4(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync4(join23(paths.locksDir, RECOVERY_LOCK));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.round(waitMs))}`);
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if ([5, 6].includes((error.errcode ?? 0) & 255)) return "busy";
      throw error;
    }
    const at = statSync4(paths.database, { throwIfNoEntry: false });
    if (at === void 0 || at.dev !== file.dev || at.ino !== file.ino) return "replaced";
    dropStaleMark(paths.database);
    if (currentMark(paths.database) !== null) return "kept";
    const named2 = { ...mark, file: { dev: file.dev, ino: file.ino } };
    writeFileSync2(markPath(paths.database), JSON.stringify(named2), { flag: "wx" });
    return "marked";
  } finally {
    rollback(lock);
    lock.close();
  }
}
function markPath(database) {
  return `${database}.check-failed`;
}
function currentMark(database) {
  const mark = readMark(markPath(database));
  return mark === null || names2(mark, database) ? mark : null;
}
function dropStaleMark(database) {
  const path = markPath(database);
  const mark = readMark(path);
  if (mark === null || names2(mark, database)) return;
  const aside = `${path}.stale-${randomUUID()}`;
  try {
    renameSync2(path, aside);
  } catch {
    return;
  }
  const moved = readMark(aside);
  if (moved !== null && names2(moved, database) && !existsSync6(path)) renameSync2(aside, path);
  else rmSync3(aside, { force: true });
}
function names2(mark, database) {
  if (mark.file === void 0) return true;
  const stat = statSync4(database, { throwIfNoEntry: false });
  return stat !== void 0 && stat.dev === mark.file.dev && stat.ino === mark.file.ino;
}
function readMark(path) {
  let text2;
  try {
    text2 = readFileSync17(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const { at, problem, found: found2, file } = JSON.parse(text2);
    if (typeof at === "number" && typeof problem === "string") {
      const finder = MARK_FINDERS.find((known) => known === found2);
      const named2 = fileOf(file);
      return {
        at,
        problem,
        ...finder === void 0 ? {} : { found: finder },
        ...named2 === null ? {} : { file: named2 }
      };
    }
  } catch {
  }
  return { at: 0, problem: "the mark beside the store could not be read", found: "unknown" };
}
function fileOf(value) {
  const { dev, ino } = value ?? {};
  return typeof dev === "number" && typeof ino === "number" ? { dev, ino } : null;
}

// src/core/store/open.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync5, renameSync as renameSync3, rmSync as rmSync4 } from "node:fs";
import { join as join24 } from "node:path";
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";

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
var STORE_INDEXES = {
  runs_open: "CREATE INDEX runs_open ON runs (worktree_id, started_at) WHERE end_state IS NULL",
  consumer_views_by_check: "CREATE INDEX consumer_views_by_check ON consumer_views (check_id)",
  known_states_non_pass: "CREATE INDEX known_states_non_pass ON known_states (worktree_id, check_id) WHERE outcome != 'pass'"
};
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

// src/core/store/open.ts
var DEFAULT_BUSY_TIMEOUT_MS = 1e3;
var JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;
var CONNECTION_PRAGMAS = ["PRAGMA cache_size = -16384", "PRAGMA temp_store = MEMORY"];
var META_STORE_RECOVERED = "store.recovered";
function isStoreOpenFailure(value) {
  return "reason" in value;
}
function openStore(commonDir, options = {}) {
  const paths = storePaths(commonDir);
  if (!existsSync7(paths.database)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync5(paths.dir, { recursive: true });
  }
  const opened = connect(paths, options);
  if (!("corrupt" in opened)) return opened;
  if (options.recoverFaults !== true) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}
function connect(paths, options) {
  let db;
  try {
    db = new DatabaseSync5(paths.database);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout(options)}`);
    const found2 = userVersion(db);
    if (found2 > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found: found2, supported: SCHEMA_VERSION };
    }
    if (options.recoverFaults === true) {
      dropStaleMark(paths.database);
      const mark = currentMark(paths.database);
      if (mark !== null) {
        db.close();
        return { corrupt: mark.problem, mark };
      }
    }
    const current2 = options.create === false && found2 === SCHEMA_VERSION;
    if (!current2 && pragmaNumber2(db, "page_count") === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    if (!current2 || journalMode(db) !== "wal") switchToWal(db, busyTimeout(options));
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
    for (const pragma of CONNECTION_PRAGMAS) db.exec(pragma);
    if (options.managedCheckpoint === true) db.exec("PRAGMA wal_autocheckpoint = 0");
    const version = current2 ? found2 : migrate(db);
    if (options.create !== false) makeIndexes(db);
    return createStore(options.connection?.(db) ?? new Connection(db), version, paths);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { corrupt: String(error) };
    throw error;
  }
}
function makeIndexes(db) {
  const found2 = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  const absent2 = () => Object.entries(STORE_INDEXES).filter(([name2]) => found2.get(name2) === void 0);
  if (absent2().length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [, sql] of absent2()) db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}
function busyTimeout(options) {
  const ms = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`busyTimeoutMs must be >= 0: ${ms}`);
  return ms;
}
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
function journalMode(db) {
  return db.prepare("PRAGMA journal_mode").get()?.journal_mode;
}
function pragmaNumber2(db, name2) {
  return Number(db.prepare(`PRAGMA ${name2}`).get()?.[name2]);
}
function isCorruption(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}
function recover(paths, options) {
  mkdirSync5(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync5(join24(paths.locksDir, RECOVERY_LOCK));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, options);
    if (!("corrupt" in again)) return again;
    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh2 = connect(paths, { ...options, recoverFaults: false });
    if ("corrupt" in fresh2) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh2)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt, ...foundBy(again.mark) });
      fresh2.transaction(() => fresh2.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh2;
  } finally {
    rollback(lock);
    lock.close();
  }
}
function foundBy(mark) {
  if (mark === void 0) return { found: "start" };
  const found2 = mark.found ?? "full-check";
  if (found2 === "unknown") return { found: found2 };
  if (found2 === "full-check") return { found: found2, check: "full", checkedAt: mark.at };
  return { found: found2, markedAt: mark.at };
}
function moveAside(database, at) {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync7(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync3(database, movedTo);
  if (existsSync7(`${database}-wal`)) renameSync3(`${database}-wal`, `${movedTo}-wal`);
  rmSync4(`${database}-shm`, { force: true });
  if (existsSync7(markPath(database))) renameSync3(markPath(database), markPath(movedTo));
  return movedTo;
}

// src/core/daemon/store-file.ts
import { statSync as statSync5 } from "node:fs";
function storeFileOf(commonDir) {
  const stat = statSync5(storePaths(commonDir).database, { throwIfNoEntry: false });
  return stat === void 0 ? null : { dev: stat.dev, ino: stat.ino };
}

// src/core/daemon/store-fault.ts
var HOOK_MARK_WAIT_MS = 200;
function markFault(commonDir, file, mark, waitMs) {
  return file === null ? null : markUnder(commonDir, file, mark, waitMs);
}
var OPEN_CORRUPT = "the store did not open: SQLite reports it corrupt or not a database";
function markHookFault(commonDir, file, problem, now) {
  try {
    markFault(commonDir, file, { at: now(), problem, found: "hook" }, HOOK_MARK_WAIT_MS);
  } catch {
  }
}
function storeFileOrNull(commonDir) {
  try {
    return storeFileOf(commonDir);
  } catch {
    return null;
  }
}

// src/core/code/store/open.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync6 } from "node:fs";
import { join as join25 } from "node:path";
import { DatabaseSync as DatabaseSync6 } from "node:sqlite";

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
  states_complexity_blob: "CREATE INDEX states_complexity_blob ON states (blob) WHERE measure = 'complexity'",
  views_by_check: "CREATE INDEX views_by_check ON views (check_id)"
};
var CODE_RETIRED_INDEXES = ["states_by_blob"];
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
    const name2 = `squeal_held_${++this.#savepoints}`;
    this.db.exec(`SAVEPOINT ${name2}`);
    try {
      const result = fn();
      this.db.exec(`RELEASE ${name2}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name2}; RELEASE ${name2}`);
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
    let open2 = true;
    const end = () => {
      open2 = false;
      this.#held = false;
      release(this.#file, this);
    };
    return {
      commit: () => {
        if (!open2) return;
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
        if (!open2) return;
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
    return new Promise((resolve8) => waiters.push({ file: this.#file, resolve: resolve8 }));
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
function holdingAny() {
  return holders.size > 0;
}
function holdFree(connection, boundMs) {
  const wait = connection?.heldElsewhere() ?? null;
  if (wait === null) return null;
  let timer;
  const bound = new Promise((done) => {
    timer = setTimeout(done, boundMs);
  });
  return Promise.race([wait, bound]).finally(() => clearTimeout(timer));
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
    const write2 = pending[i];
    if (write2.params[0] !== key) continue;
    if (SETS.has(write2.sql)) return { value: write2.params[1] };
    if (write2.sql === DELETE) return null;
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
    const failure2 = this.#failure;
    if (failure2 === null) return;
    this.#failure = null;
    this.#sender.surfaced?.();
    throw failure2;
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
    let open2 = true;
    return {
      commit: () => {
        if (!open2) return;
        open2 = false;
        this.#held = null;
        this.#track(this.#send(held, true), false);
      },
      rollback: () => {
        if (!open2) return;
        open2 = false;
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
    put(count2, at) {
      conn.run(
        `INSERT INTO counts (blob, language, counter_version, functions, errors, counted_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        count2.blob,
        count2.language,
        count2.counterVersion,
        JSON.stringify(count2.functions),
        JSON.stringify(count2.errors),
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
import { constants as constants2, deflateRawSync, inflateRawSync } from "node:zlib";
var SYNC = { finishFlush: constants2.Z_SYNC_FLUSH };
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
function readManifest2(bytes) {
  let read4;
  try {
    read4 = JSON.parse(inflateRawSync(bytes).toString("utf8"));
  } catch {
    return null;
  }
  const { parts: pairs, unreadAt, unread: paths } = read4 ?? {};
  if (!integers(pairs) || !integers(unreadAt) || !strings3(paths) || pairs.length % 2 !== 0) {
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
function assemble2(manifest, parts) {
  const pieces = [RECORD_HEAD];
  const unread2 = manifest.unread.map((i) => manifest.paths[i] ?? "");
  for (const { at, id } of manifest.parts) {
    const path = manifest.paths[at] ?? "";
    const part = parts.get(id);
    if (part === void 0 || part === null || part.path !== path) {
      unread2.push(path);
      continue;
    }
    if (pieces.length > 1) pieces.push(COMMA);
    pieces.push(part.bytes);
  }
  const left = [...new Set(unread2)].sort(compare);
  pieces.push(stored(`],"unread":${JSON.stringify(left)}}`, true));
  return Buffer.concat(pieces);
}
function partHead(path) {
  return `{"path":${JSON.stringify(path)},`;
}
function stored(text2, last = false) {
  const body = Buffer.from(text2, "utf8");
  const blocks2 = [];
  for (let at = 0; at === 0 || at < body.length; at += 65535) {
    const chunk = body.subarray(at, at + 65535);
    const head = Buffer.alloc(5);
    head[0] = last && at + 65535 >= body.length ? 1 : 0;
    head.writeUInt16LE(chunk.length, 1);
    head.writeUInt16LE(~chunk.length & 65535, 3);
    blocks2.push(head, chunk);
  }
  return Buffer.concat(blocks2);
}
function integers(value) {
  return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v));
}
function strings3(value) {
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
  const marked2 = /* @__PURE__ */ new Set();
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
    for (const part of readManifest2(bytes)?.parts ?? []) marked2.add(part.id);
  }
  return marked2;
}
function* sweepParts(conn, cutoff, marked2, batch, removed) {
  const ids = conn.all("SELECT id FROM coverage_parts WHERE used_at < ?", cutoff).map((row) => num(row, "id")).filter((id) => !marked2.has(id));
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
  const read4 = /* @__PURE__ */ new Map();
  const partsOf = (ids) => {
    parted ||= hasParts(conn);
    const missing = ids.filter((id) => !read4.has(id));
    if (!parted || missing.length === 0) return read4;
    for (const row of conn.all(
      "SELECT id, part FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(missing)
    )) {
      read4.set(num(row, "id"), row.part instanceof Uint8Array ? storedPart(row.part) : null);
    }
    const wanted = new Set(ids);
    for (const id of read4.keys()) {
      if (read4.size <= PART_CACHE_LIMIT) break;
      if (!wanted.has(id)) read4.delete(id);
    }
    return read4;
  };
  const storedAt2 = (key) => {
    const row = conn.get(
      `SELECT recorded_at FROM ${by} WHERE result_key = ? AND provider_version = ?`,
      key.resultKey,
      key.providerVersion
    );
    return row === null ? null : num(row, "recorded_at");
  };
  const writeParts = ({ key, record, at }) => {
    const before = storedAt2(key);
    const stored3 = before === null ? at : Math.max(at, before + 1);
    const known = /* @__PURE__ */ new Map();
    for (const row of conn.all(
      `SELECT j.key AS i, p.used_at FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash))
    )) {
      known.set(record.parts[num(row, "i")]?.hash ?? "", num(row, "used_at"));
    }
    for (const part of record.parts) {
      if (known.has(part.hash)) continue;
      known.set(part.hash, stored3);
      conn.run(
        `INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET used_at = max(used_at, excluded.used_at)`,
        part.hash,
        part.bytes,
        stored3
      );
    }
    const stale = [...known].filter(([, usedAt]) => usedAt < stored3 - PART_REFRESH_MS);
    if (stale.length > 0) {
      conn.run(
        `UPDATE coverage_parts SET used_at = ?
         WHERE hash IN (SELECT value FROM json_each(?)) AND used_at < ?`,
        stored3,
        JSON.stringify(stale.map(([hash3]) => hash3)),
        stored3 - PART_REFRESH_MS
      );
    }
    return stored3;
  };
  const writeManifest = ({ key, record }, stored3) => {
    const ids = /* @__PURE__ */ new Map();
    for (const row of conn.all(
      `SELECT j.value AS hash, p.id FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash))
    )) {
      ids.set(str(row, "hash"), num(row, "id"));
    }
    const listed2 = record.parts.map((part) => ids.get(part.hash));
    if (listed2.some((id) => id === void 0)) {
      throw new Error("squeal code store: a coverage part is missing after its insert");
    }
    conn.run(
      UPSERT,
      key.resultKey,
      key.providerVersion,
      manifestBytes(record, listed2),
      stored3
    );
  };
  const putPartsBatch = async (items) => {
    if (items.length === 0) return;
    const stored3 = conn.transaction(() => items.map(writeParts));
    if (sent !== void 0) await sent();
    conn.transaction(() => {
      items.forEach((item, i) => {
        writeManifest(item, stored3[i] ?? item.at);
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
        const manifest = readManifest2(record);
        return manifest === null ? null : assemble2(manifest, partsOf(manifest.parts.map((p) => p.id)));
      });
    },
    has: (key) => storedAt2(key) !== null,
    storedAt: storedAt2,
    put(key, record, at) {
      conn.run(UPSERT, key.resultKey, key.providerVersion, record, at);
    },
    putParts: (key, record, at) => putPartsBatch([{ key, record, at }]),
    putPartsBatch
  };
}

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
  AND NOT EXISTS (SELECT 1 FROM states s WHERE s.measure = 'complexity' AND s.blob = counts.blob)`;
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
  const indexed = conn.read(() => hasIndexes(conn, "states_complexity_blob", "views_by_check"));
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
  yield* dropRetired(conn);
  yield* vacuum(conn);
}
function* dropRetired(conn) {
  const held = () => CODE_RETIRED_INDEXES.filter((name2) => hasIndexes(conn, name2));
  if (conn.read(held).length === 0) return;
  yield () => conn.transaction(() => {
    const names3 = held();
    for (const name2 of names3) conn.db.exec(`DROP INDEX ${name2}`);
    return names3.length > 0;
  });
}
function deadWorktrees(conn, live) {
  const kept2 = /* @__PURE__ */ new Set([...live, ...live.map((id) => stagedId(id))]);
  const found2 = new Set(
    PER_WORKTREE.flatMap(([table]) => conn.all(worktreeIdsOf(table)).map((row) => str(row, "id")))
  );
  return [...found2].filter((id) => !kept2.has(id));
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
  const kept2 = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  yield* deleteByKey(conn, {
    table: "coverage",
    key,
    search: `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    searchParams: [JSON.stringify(held.filter((k) => !kept2.has(k))), COVERAGE_RECORD_VERSION],
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
var OUTCOMES5 = [
  "pass",
  "fail",
  "pending",
  "unknown"
];
var CHECK_WHERE2 = "path = ? AND qualified_name = ? AND occurrence = ?";
function checkParams2(check) {
  return [check.path, check.qualifiedName, check.occurrence];
}
function findCodeCheckId(conn, check) {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE2}`, ...checkParams2(check));
  return row === null ? null : num(row, "id");
}
var CHECK_ID = `(SELECT id FROM checks WHERE ${CHECK_WHERE2})`;
function ensureCodeCheck(conn, check) {
  const params = checkParams2(check);
  conn.run(
    "INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ...params
  );
  return params;
}
var LISTED_CHECKS = `SELECT c.id FROM json_each(?) j JOIN checks c ON c.path = j.value ->> 0
  AND c.qualified_name = j.value ->> 1 AND c.occurrence = j.value ->> 2`;
var listed = (checks) => JSON.stringify(checks.map((c) => [c.path, c.qualifiedName, c.occurrence]));
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
function indexesIn(conn, names3) {
  const rows = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(names3)
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
  const named2 = (index, used) => used && indexed.has(index) ? index : null;
  return {
    list(worktreeId, filter = {}) {
      const index = named2(STATES_FAILING, filter.outcome === "fail");
      const { from, params } = statesOf(worktreeId, filter.paths, index);
      const terms = filterTerms(filter);
      return conn.all(
        `SELECT s.*, ${CHECK_COLUMNS2} FROM ${from} ${terms.sql}
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
        ...params,
        ...terms.params
      ).map((row) => toState(worktreeId, row));
    },
    countNonPass(worktreeId, measure2) {
      const index = named2(STATES_NON_PASS, true);
      const states = index === null ? "states" : `states INDEXED BY ${index}`;
      const counts = { fail: 0, pending: 0, unknown: 0 };
      const rows = conn.all(
        `SELECT outcome, count(*) AS n FROM ${states}
         WHERE worktree_id = ? AND measure = ? AND outcome != 'pass' GROUP BY outcome`,
        worktreeId,
        measure2
      );
      for (const row of rows) {
        const outcome = oneOf(row, "outcome", OUTCOMES5);
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
    edits(worktreeId, measure2, paths) {
      const { from, params } = statesOf(worktreeId, paths, named2(STATES_EDITED, true));
      return conn.all(
        `SELECT s.measure, s.edited_revision, s.edited_at, ${CHECK_COLUMNS2} FROM ${from}
             AND s.measure = ? AND s.edited_at IS NOT NULL
           ORDER BY c.path, c.qualified_name, c.occurrence`,
        ...params,
        measure2
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
    removeOtherMeasures(worktreeId, checks, kept2) {
      if (checks.length === 0) return;
      conn.run(
        `DELETE FROM states WHERE worktree_id = ? AND measure != ? AND check_id IN (${LISTED_CHECKS})`,
        worktreeId,
        kept2,
        listed(checks)
      );
    },
    removeMeasure(worktreeId, measure2, paths) {
      if (paths === void 0) {
        conn.run("DELETE FROM states WHERE worktree_id = ? AND measure = ?", worktreeId, measure2);
        return;
      }
      conn.run(
        `DELETE FROM states WHERE worktree_id = ? AND measure = ? AND check_id IN (
           SELECT c.id FROM json_each(?) p JOIN checks c ON c.path = p.value)`,
        worktreeId,
        measure2,
        JSON.stringify(paths)
      );
    },
    move(worktreeId, from, to) {
      conn.transaction(() => {
        const fromId2 = findCodeCheckId(conn, from);
        if (fromId2 === null) return;
        const toId = ensureCodeCheck(conn, to);
        for (const table of ["states", "views"]) {
          conn.run(
            `UPDATE OR REPLACE ${table} SET check_id = ${CHECK_ID}
             WHERE worktree_id = ? AND check_id = ?`,
            ...toId,
            worktreeId,
            fromId2
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
          fromId2
        );
      });
    },
    adopt(worktreeId, staged, measure2, removed) {
      return conn.transaction(() => {
        const staging = conn.get(
          "SELECT count(*) AS n FROM states WHERE worktree_id = ? AND measure = ?",
          staged,
          measure2
        );
        const written2 = staging === null ? 0 : num(staging, "n");
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
          measure2
        );
        if (removed.length > 0) {
          conn.run(
            `DELETE FROM states WHERE worktree_id = ? AND check_id IN (${LISTED_CHECKS})`,
            worktreeId,
            listed(removed)
          );
        }
        return written2;
      });
    }
  };
}
function toState(worktreeId, row) {
  return {
    worktreeId,
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    outcome: oneOf(row, "outcome", OUTCOMES5),
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
var KINDS2 = [
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
      ).map(toTransition2);
    }
  };
}
function toTransition2(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom2(row),
    measure: oneOf(row, "measure", MEASURES),
    kind: oneOf(row, "kind", KINDS2),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES5),
    to: oneOfOrNull(row, "to_outcome", OUTCOMES5),
    fromValue: numOrNull(row, "from_value"),
    toValue: numOrNull(row, "to_value"),
    threshold: numOrNull(row, "threshold"),
    revision: num(row, "revision"),
    at: num(row, "at")
  };
}

// src/core/code/store/views.ts
var TOLD = ["count", "full", "still"];
var WHERE_CONSUMER2 = "worktree_id = ? AND session_id = ? AND agent_id = ?";
function consumerParams2(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createViewRepo2(conn) {
  return {
    list(consumer) {
      return conn.all(
        `SELECT v.*, ${CHECK_COLUMNS2} FROM views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ? AND v.outcome <> 'pass'
           ORDER BY c.path, c.qualified_name, c.occurrence, v.measure`,
        ...consumerParams2(consumer)
      ).map(toEntry);
    },
    writeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry2 of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, measure, outcome,
               threshold, told, told_at) VALUES (?, ?, ?, ${CHECK_ID}, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, threshold = excluded.threshold,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams2(consumer),
            ...ensureCodeCheck(conn, entry2.check),
            entry2.measure,
            entry2.outcome,
            entry2.threshold,
            entry2.told,
            entry2.toldAt
          );
        }
      });
    },
    removeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry2 of entries) {
          const id = findCodeCheckId(conn, entry2.check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER2} AND check_id = ? AND measure = ?`,
            ...consumerParams2(consumer),
            id,
            entry2.measure
          );
        }
      });
    },
    clear(consumer) {
      conn.run(`DELETE FROM views WHERE ${WHERE_CONSUMER2}`, ...consumerParams2(consumer));
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
    outcome: oneOf(row, "outcome", OUTCOMES5),
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
    meta: createMetaRepo2(conn),
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
function createMetaRepo2(conn) {
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
  return join25(storePaths(commonDir).dir, "code.sqlite");
}
function isCodeStoreOpenFailure(value) {
  return "reason" in value;
}
function openCodeStore(commonDir, policy, options = {}) {
  if (!policy.complexity.enabled) return { reason: "off" };
  const path = codeStorePath(commonDir);
  if (!existsSync8(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync6(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db;
  try {
    db = new DatabaseSync6(path);
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    const found2 = userVersion(db);
    if (found2 > CODE_SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found: found2, supported: CODE_SCHEMA_VERSION };
    }
    if (Number(db.prepare("PRAGMA page_count").get()?.page_count) === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    switchToWal(db, busyTimeoutMs);
    db.exec("PRAGMA synchronous = NORMAL");
    for (const pragma of CONNECTION_PRAGMAS) db.exec(pragma);
    const version = migrate(db, CODE_MIGRATIONS);
    if (options.create !== false) makeIndexes2(db);
    return createCodeStore(options.connection?.(db) ?? new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}
function makeIndexes2(db) {
  const found2 = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?");
  const absent2 = () => Object.entries({ ...CODE_TABLES, ...CODE_INDEXES }).filter(
    ([name2]) => found2.get(name2) === void 0
  );
  if (absent2().length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [, sql] of absent2()) db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

// src/core/delivery/code-source.ts
function codeSource(commonDir, root, {
  busyTimeoutMs,
  holding = false
} = {}) {
  const policy = () => {
    const { complexity } = readPolicy(root);
    return complexity.enabled ? complexity : null;
  };
  return {
    policy,
    notMeasured: () => notMeasuredNames(readPolicy(root)),
    open() {
      const complexity = policy();
      if (complexity === null) return null;
      let connection;
      const wait = holdingAny() ? 0 : busyTimeoutMs;
      const store = openCodeStore(
        commonDir,
        { complexity },
        {
          create: false,
          ...wait === void 0 ? {} : { busyTimeoutMs: wait },
          ...holding ? { connection: (db) => connection = new HoldingConnection(db) } : {}
        }
      );
      if (!isCodeStoreOpenFailure(store)) {
        return { store, complexity, ...connection === void 0 ? {} : { connection } };
      }
      return store.reason === "missing" ? "missing" : null;
    }
  };
}
function withCode2(source, fn) {
  let access = null;
  try {
    access = source?.open() ?? null;
    if (access === null || access === "missing") return access;
    return fn(access);
  } catch {
    return null;
  } finally {
    if (access !== null && access !== "missing" && access.connection?.held !== true) {
      access.store.close();
    }
  }
}
function codeLockFree(source) {
  withCode2(source, (access) => access.store.transaction(() => void 0));
}
function heldWrite(access, fn, holds2) {
  const held = holds2 === void 0 ? null : access.connection?.hold() ?? null;
  if (held === null || holds2 === void 0) return access.store.transaction(fn);
  let result;
  try {
    result = fn();
  } catch (error) {
    held.rollback();
    throw error;
  }
  const close = () => access.store.close();
  holds2.push({
    commit: () => {
      try {
        held.commit();
      } finally {
        close();
      }
    },
    rollback: () => {
      try {
        held.rollback();
      } finally {
        close();
      }
    }
  });
  return result;
}

// src/core/delivery/delivery.ts
import { setTimeout as sleep } from "node:timers/promises";

// src/core/types/lint-delivery.ts
var LINT_LISTED_MAX = 5;

// src/core/lint/pass/records.ts
var lintScope = (worktreeId, tool) => tool === "eslint" ? worktreeId : `${worktreeId}:${tool}`;
var cursorKey = (worktreeId) => `lint-cursor:${worktreeId}`;
var keyingKey = (worktreeId) => `lint-keying:${worktreeId}`;
var quietKey = (worktreeId) => `lint-quiet:${worktreeId}`;
var releaseKey = (worktreeId) => `lint-release:${worktreeId}`;
var heldKey = (worktreeId) => `lint-held:${worktreeId}`;
var offKey = (worktreeId) => `lint-off:${worktreeId}`;
var failedKey = (worktreeId) => `lint-failed:${worktreeId}`;
var failuresKey = (worktreeId) => `lint-failures:${worktreeId}`;
var offsKey = (worktreeId) => `lint-offs:${worktreeId}`;
function parse3(text2) {
  if (text2 === null) return null;
  try {
    return JSON.parse(text2);
  } catch {
    return null;
  }
}
function readCursor(meta, worktreeId) {
  const raw = parse3(meta.get(cursorKey(worktreeId)));
  if (typeof raw?.revision !== "number" || typeof raw.environment !== "string") return null;
  return { revision: raw.revision, environment: raw.environment };
}
function readKeying(meta, worktreeId) {
  const raw = parse3(meta.get(keyingKey(worktreeId)));
  const { seq, mode, revision, at, transition } = raw ?? {};
  const numbers = [seq, revision, at, transition];
  if (!numbers.every((n) => typeof n === "number")) return null;
  if (mode !== "first" && mode !== "config") return null;
  return { seq, mode, revision, at, transition };
}
function readBlobs(meta, key) {
  const raw = parse3(meta.get(key));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return /* @__PURE__ */ new Map();
  const entries = Object.entries(raw);
  return new Map(entries.filter((e) => typeof e[1] === "string"));
}
function readQuiet(meta, worktreeId) {
  const raw = parse3(meta.get(quietKey(worktreeId)));
  return new Set(Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : []);
}
function readCount(meta, key) {
  const value = parse3(meta.get(key));
  return typeof value === "number" ? value : 0;
}
var isNotInstalled = (reason) => /^no (ESLint|oxlint) installed in /.test(reason);

// src/core/lint/surface/told.ts
var SEPARATOR = "\0";
function lintCheckName(check) {
  return check.tool === "eslint" ? check.path : `${check.path}${SEPARATOR}${check.tool}`;
}
function lintCheckOf(name2) {
  const at = name2.indexOf(SEPARATOR);
  if (at < 0) return { kind: "lint", path: name2, tool: "eslint" };
  return { kind: "lint", path: name2.slice(0, at), tool: name2.slice(at + 1) };
}
var NO_MARK = {
  transition: 0,
  keying: 0,
  deferred: [],
  failures: 0,
  offs: 0
};
var toldKey = (c) => `lint-told:${c.worktreeId}:${c.sessionId}:${c.agentId}`;
var count = (value) => typeof value === "number" ? value : 0;
function readTold2(meta, consumer) {
  const raw = meta.get(toldKey(consumer));
  if (raw === null) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const { transition, keying, deferred } = value ?? {};
  if (typeof transition !== "number" || typeof keying !== "number" || !Array.isArray(deferred)) {
    return null;
  }
  const pairs = deferred.flatMap((d) => {
    if (!Array.isArray(d) || typeof d[0] !== "string" || typeof d[1] !== "number") return [];
    const tool = typeof d[2] === "string" ? d[2] : "eslint";
    return [[lintCheckName({ path: d[0], tool }), d[1]]];
  });
  return {
    transition,
    keying,
    deferred: pairs,
    failures: count(value.failures),
    offs: count(value.offs)
  };
}
function writeTold(meta, consumer, mark) {
  const deferred = mark.deferred.map(([name2, id]) => {
    const { path, tool } = lintCheckOf(name2);
    return tool === "eslint" ? [path, id] : [path, id, tool];
  });
  meta.set(toldKey(consumer), JSON.stringify({ ...mark, deferred }));
}
function sameMark(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// src/core/lint/surface/news.ts
function fromId(mark) {
  return Math.min(mark.transition, ...mark.deferred.map(([, id]) => id));
}
function candidatesOf(mark, transitions) {
  const bases = new Map(mark.deferred);
  const names3 = new Set(bases.keys());
  for (const t of transitions) {
    const name2 = lintCheckName(t.check);
    if (t.id > (bases.get(name2) ?? mark.transition)) names3.add(name2);
  }
  return [...names3].sort();
}
var settled = (s) => s.judged !== null && (s.outcome === "fail" || s.outcome === "pass" && !s.stale);
function netChange(transitions) {
  const net = /* @__PURE__ */ new Map();
  const entry2 = (f) => {
    const key = JSON.stringify([f.rule, f.message]);
    const found2 = net.get(key);
    if (found2 !== void 0) return found2;
    const e = { n: 0, added: [], removed: [] };
    net.set(key, e);
    return e;
  };
  for (const t of transitions) {
    for (const f of t.added) {
      const e = entry2(f);
      e.n++;
      e.added.push(f);
    }
    for (const f of t.removed) {
      const e = entry2(f);
      e.n--;
      e.removed.push(f);
    }
  }
  const added = [];
  const removed = [];
  for (const e of net.values()) {
    if (e.n > 0) added.push(...e.added.slice(-e.n));
    if (e.n < 0) removed.push(...e.removed.slice(0, -e.n));
  }
  return { added, removed };
}
function kindOf(toldFail, now, own) {
  if (now === null) return "removed";
  if (now.outcome === "pass") return "fail-to-pass";
  if (toldFail) return "fail-changed";
  return own[0]?.kind === "first-seen-fail" ? "first-seen-fail" : "pass-to-fail";
}
var RANK2 = {
  "first-seen-fail": 0,
  "pass-to-fail": 0,
  "fail-changed": 0,
  "fail-to-pass": 1,
  removed: 2
};
function toldAlike(told, now) {
  const nowFail = now?.outcome === "fail";
  if (told?.outcome === "fail" !== nowFail) return false;
  return !nowFail || told?.fingerprint === (now?.judged?.fingerprint ?? null);
}
function viewStep(check, now, told, tell, at) {
  if (now?.outcome !== "fail") return told === null ? {} : { removal: check };
  const fingerprint = now.judged?.fingerprint ?? null;
  const toldAs = tell ? "full" : "count";
  return { write: { check, outcome: "fail", fingerprint, told: toldAs, toldAt: at } };
}
function fileStep(input, name2, base) {
  const now = input.states.get(name2) ?? null;
  if (now !== null && !settled(now)) return { deferred: base };
  const told = input.view.get(name2) ?? null;
  if (toldAlike(told, now)) return {};
  const after = Math.max(base, input.keyedAfter);
  const ts = input.transitions.filter((t) => lintCheckName(t.check) === name2 && t.id > after);
  const last = ts.at(-1);
  const own = ts.filter((t) => isOwn(input.seenUpTo, t.revision));
  const change2 = netChange(own);
  const tell = last !== void 0 && isOwn(input.seenUpTo, last.revision) && change2.added.length + change2.removed.length > 0;
  const check = lintCheckOf(name2);
  const view = viewStep(check, now, told, tell, input.at);
  if (!tell || last === void 0) return view;
  const failing = now?.outcome === "fail" ? now : null;
  const entry2 = {
    path: check.path,
    ...check.tool === "eslint" ? {} : { tool: check.tool },
    kind: kindOf(told?.outcome === "fail", now, own),
    findings: failing === null ? 0 : input.findings(failing)?.length ?? null,
    ...change2,
    revision: last.revision,
    ...now?.stale === true ? { stale: true } : {}
  };
  return { ...view, entry: entry2 };
}
function planLintNews(input) {
  const bases = new Map(input.mark.deferred);
  const entries = [];
  const writes = [];
  const removals = [];
  const deferred = [];
  for (const name2 of candidatesOf(input.mark, input.transitions)) {
    const step = fileStep(input, name2, bases.get(name2) ?? input.mark.transition);
    if (step.deferred !== void 0) deferred.push([name2, step.deferred]);
    if (step.write !== void 0) writes.push(step.write);
    if (step.removal !== void 0) removals.push(step.removal);
    if (step.entry !== void 0) entries.push(step.entry);
  }
  const sorted = entries.map((entry2, i) => ({ entry: entry2, i })).sort((a, b) => RANK2[a.entry.kind] - RANK2[b.entry.kind] || a.i - b.i).map(({ entry: entry2 }) => entry2);
  return { entries: sorted, writes, removals, deferred };
}

// src/core/lint/pass/cpu-wait.ts
var cpuWaitKey = (scope) => `lint-cpu-wait:${scope}`;
function readRecord2(meta, scope) {
  const raw = meta.get(cpuWaitKey(scope));
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw);
    const busy2 = r.busy;
    if (typeof r.since !== "number" || typeof r.at !== "number" || typeof r.limit !== "number" || busy2 !== null && typeof busy2 !== "number")
      return null;
    return { since: r.since, at: r.at, busy: busy2, limit: r.limit };
  } catch {
    return null;
  }
}
function readCpuWait(meta, scope, now) {
  const r = readRecord2(meta, scope);
  if (r === null || now - r.at > SLOT_WAITER_FRESH_MS) return null;
  return { since: r.since, busy: r.busy, limit: r.limit };
}

// src/core/lint/pass/moment.ts
var MOMENTS = ["pause", "stop", "commit", "manual"];
function readHeld(meta, scope) {
  const raw = meta.get(heldKey(scope));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.group === "string" && MOMENTS.includes(value.at)) {
      return { group: value.group, at: value.at };
    }
  } catch {
  }
  return { group: raw, at: "commit" };
}

// src/core/lint/store/checks.ts
var TOOLS = ["eslint", "oxlint"];
var OUTCOMES6 = [
  "pass",
  "fail",
  "pending",
  "unknown"
];
var JUDGED = ["pass", "fail"];
function findLintCheckId(conn, check) {
  const row = conn.get("SELECT id FROM checks WHERE path = ? AND tool = ?", check.path, check.tool);
  return row === null ? null : num(row, "id");
}
function ensureLintCheckId(conn, check) {
  conn.run(
    "INSERT INTO checks (path, tool) VALUES (?, ?) ON CONFLICT DO NOTHING",
    check.path,
    check.tool
  );
  const id = findLintCheckId(conn, check);
  if (id === null) throw new Error("squeal lint store: check row missing after insert");
  return id;
}
var CHECK_COLUMNS3 = "c.path, c.tool";
function checkFrom3(row) {
  return { kind: "lint", path: str(row, "path"), tool: oneOf(row, "tool", TOOLS) };
}

// src/core/lint/surface/snapshot.ts
var isCurrentFail = (s) => s.outcome === "fail" && !s.stale;
function countsOf(states) {
  const reasons = /* @__PURE__ */ new Map();
  for (const s of states) {
    if (s.outcome !== "unknown") continue;
    const reason = s.reason ?? "no reason recorded";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    files: states.length,
    failing: states.filter(isCurrentFail).length,
    pending: states.filter((s) => s.outcome === "pending").length,
    stale: states.filter((s) => s.stale).length,
    unknown: states.filter((s) => s.outcome === "unknown").length,
    reasons: [...reasons].map(([reason, files2]) => ({ reason, files: files2 })).sort((a, b) => b.files - a.files || a.reason.localeCompare(b.reason))
  };
}
var scopes = (worktreeId) => TOOLS.map((tool) => [tool, lintScope(worktreeId, tool)]);
function anyKeyed(meta, worktreeId) {
  return scopes(worktreeId).some(([, scope]) => readCursor(meta, scope) !== null);
}
function heldOf(meta, scope, which = () => true) {
  const held = readHeld(meta, scope);
  if (held === null || !which(held)) return () => false;
  const released = readBlobs(meta, releaseKey(scope));
  return (path) => !released.has(path);
}
function progressOf(store, worktreeId, states, now = Date.now()) {
  const pending = states.filter((s) => s.outcome === "pending");
  let held = 0;
  let waiting = false;
  for (const [tool, scope] of scopes(worktreeId)) {
    const quiet = readQuiet(store.meta, scope);
    const isHeld = heldOf(store.meta, scope);
    for (const s of pending) {
      if (s.check.tool !== tool) continue;
      if (isHeld(s.check.path)) held += 1;
      else waiting ||= quiet.has(s.check.path);
    }
  }
  if (anyKeyed(store.meta, worktreeId) && !waiting) return void 0;
  const cpuWait = cpuWaitOf(store.meta, worktreeId, now);
  return {
    done: states.length - pending.length,
    total: states.length - held,
    ...cpuWait === null ? {} : { cpuWait }
  };
}
function cpuWaitOf(meta, worktreeId, now) {
  let found2 = null;
  for (const [, scope] of scopes(worktreeId)) {
    const wait = readCpuWait(meta, scope, now);
    if (wait !== null && (found2 === null || wait.since < found2.since)) found2 = wait;
  }
  return found2;
}
function keyingLinted(store, worktreeId, states) {
  if (!anyKeyed(store.meta, worktreeId)) return false;
  const pending = states.filter((s) => s.outcome === "pending");
  return !scopes(worktreeId).some(([tool, scope]) => {
    const quiet = readQuiet(store.meta, scope);
    return pending.some((s) => s.check.tool === tool && quiet.has(s.check.path));
  });
}
function reasonsOf({ meta }, worktreeId) {
  const offs = [];
  let lints = false;
  let failed2 = null;
  for (const [, scope] of scopes(worktreeId)) {
    const off2 = meta.get(offKey(scope));
    if (off2 !== null) offs.push(off2);
    else if (readCursor(meta, scope) !== null) lints = true;
    failed2 ??= meta.get(failedKey(scope));
  }
  const shown = offs.filter((r) => !isNotInstalled(r));
  const [off, ...others] = lints ? [] : [...shown, ...offs.filter(isNotInstalled)];
  const toolsOff = lints ? shown : others.filter((r) => !isNotInstalled(r));
  return {
    ...off === void 0 ? {} : { off },
    ...toolsOff.length === 0 ? {} : { toolsOff },
    ...failed2 === null ? {} : { failed: failed2 }
  };
}
function noticesOf({ meta }, worktreeId) {
  let failures = 0;
  let offs = 0;
  for (const [, scope] of scopes(worktreeId)) {
    failures += readCount(meta, failuresKey(scope));
    offs += readCount(meta, offsKey(scope));
  }
  return { failures, offs };
}
function findingsOf(store, state) {
  const judged2 = state.judged;
  if (judged2 === null || judged2.outcome === "pass") return [];
  return store.results.get(state.check, judged2.key)?.findings ?? null;
}

// src/core/lint/store/open.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync7 } from "node:fs";
import { join as join26 } from "node:path";
import { DatabaseSync as DatabaseSync7 } from "node:sqlite";

// src/core/lint/store/schema.ts
var V13 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  tool TEXT NOT NULL,
  UNIQUE (path, tool)
) STRICT;

CREATE TABLE results (
  check_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  findings TEXT NOT NULL,
  fingerprint TEXT,
  tool_version TEXT NOT NULL,
  linted_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (check_id, key)
) STRICT, WITHOUT ROWID;

CREATE TABLE states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  judged_key TEXT,
  judged_outcome TEXT,
  judged_fingerprint TEXT,
  judged_blob TEXT,
  judged_revision INTEGER,
  stale INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, check_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  added TEXT NOT NULL,
  removed TEXT NOT NULL,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  told TEXT NOT NULL,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id)
) STRICT, WITHOUT ROWID;
`;
var LINT_MIGRATIONS = [(db) => db.exec(V13)];
var LINT_SCHEMA_VERSION = LINT_MIGRATIONS.length;

// src/core/lint/store/results.ts
function createResultRepo2(conn) {
  return {
    get(check, key) {
      const row = conn.get(
        `SELECT r.*, ${CHECK_COLUMNS3} FROM checks c JOIN results r ON r.check_id = c.id
         WHERE c.path = ? AND c.tool = ? AND r.key = ?`,
        check.path,
        check.tool,
        key
      );
      return row === null ? null : toResult2(row);
    },
    put(result, at) {
      conn.run(
        `INSERT INTO results (check_id, key, outcome, findings, fingerprint, tool_version,
           linted_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (check_id, key) DO UPDATE SET
           outcome = excluded.outcome, findings = excluded.findings,
           fingerprint = excluded.fingerprint, tool_version = excluded.tool_version,
           linted_at = excluded.linted_at, used_at = excluded.used_at`,
        ensureLintCheckId(conn, result.check),
        result.key,
        result.outcome,
        JSON.stringify(result.findings),
        result.fingerprint,
        result.toolVersion,
        result.lintedAt,
        at
      );
    },
    use(check, key, at) {
      const id = findLintCheckId(conn, check);
      if (id === null) return;
      conn.run("UPDATE results SET used_at = ? WHERE check_id = ? AND key = ?", at, id, key);
    }
  };
}
function toResult2(row) {
  return {
    check: checkFrom3(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", JUDGED),
    findings: json(row, "findings"),
    fingerprint: strOrNull(row, "fingerprint"),
    toolVersion: str(row, "tool_version"),
    lintedAt: num(row, "linted_at")
  };
}

// src/core/lint/store/states.ts
function statesOf2(worktreeId, paths) {
  if (paths === void 0) {
    return {
      from: "states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?",
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
function createStateRepo2(conn) {
  return {
    list(worktreeId, filter = {}) {
      const { from, params } = statesOf2(worktreeId, filter.paths);
      return conn.all(
        `SELECT s.*, ${CHECK_COLUMNS3} FROM ${from} AND (? IS NULL OR s.outcome = ?)
             AND (? IS NULL OR c.tool = ?)
           ORDER BY c.path, c.tool`,
        ...params,
        ...Array(2).fill(filter.outcome ?? null),
        ...Array(2).fill(filter.tool ?? null)
      ).map((row) => toState2(worktreeId, row));
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          const judged2 = state.judged;
          conn.run(
            `INSERT INTO states (worktree_id, check_id, outcome, judged_key, judged_outcome,
               judged_fingerprint, judged_blob, judged_revision, stale, reason, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id) DO UPDATE SET
               outcome = excluded.outcome, judged_key = excluded.judged_key,
               judged_outcome = excluded.judged_outcome,
               judged_fingerprint = excluded.judged_fingerprint,
               judged_blob = excluded.judged_blob, judged_revision = excluded.judged_revision,
               stale = excluded.stale, reason = excluded.reason, changed_at = excluded.changed_at`,
            state.worktreeId,
            ensureLintCheckId(conn, state.check),
            state.outcome,
            judged2?.key ?? null,
            judged2?.outcome ?? null,
            judged2?.fingerprint ?? null,
            judged2?.blob ?? null,
            judged2?.revision ?? null,
            flag(state.stale),
            state.reason,
            state.changedAt
          );
        }
      });
    },
    removeMany(worktreeId, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findLintCheckId(conn, check);
          if (id === null) continue;
          conn.run("DELETE FROM states WHERE worktree_id = ? AND check_id = ?", worktreeId, id);
        }
      });
    }
  };
}
function toState2(worktreeId, row) {
  return {
    worktreeId,
    check: checkFrom3(row),
    outcome: oneOf(row, "outcome", OUTCOMES6),
    judged: judgedFrom(row),
    stale: bool(row, "stale"),
    reason: strOrNull(row, "reason"),
    changedAt: num(row, "changed_at")
  };
}
function judgedFrom(row) {
  const outcome = oneOfOrNull(row, "judged_outcome", JUDGED);
  const revision = numOrNull(row, "judged_revision");
  if (outcome === null || revision === null) return null;
  return {
    key: str(row, "judged_key"),
    outcome,
    fingerprint: strOrNull(row, "judged_fingerprint"),
    blob: str(row, "judged_blob"),
    revision
  };
}

// src/core/lint/store/transitions.ts
var KINDS3 = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "fail-changed",
  "removed"
];
function createTransitionRepo3(conn) {
  return {
    append(transitions) {
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (worktree_id, check_id, kind, added, removed, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureLintCheckId(conn, t.check),
            t.kind,
            JSON.stringify(t.added),
            JSON.stringify(t.removed),
            t.revision,
            t.at
          );
        }
      });
    },
    history(worktreeId, check) {
      const id = findLintCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS3} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.check_id = ? ORDER BY t.id`,
        worktreeId,
        id
      ).map(toTransition3);
    },
    after(worktreeId, id) {
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS3} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.id > ? ORDER BY t.id`,
        worktreeId,
        id
      ).map(toRecord);
    },
    latest(worktreeId) {
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS3} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.id IN (SELECT max(id) FROM transitions WHERE worktree_id = ? GROUP BY check_id)
           ORDER BY t.id`,
        worktreeId
      ).map(toRecord);
    },
    lastId(worktreeId) {
      const row = conn.get(
        "SELECT coalesce(max(id), 0) AS id FROM transitions WHERE worktree_id = ?",
        worktreeId
      );
      return row === null ? 0 : num(row, "id");
    }
  };
}
function toRecord(row) {
  return { ...toTransition3(row), id: num(row, "id") };
}
function toTransition3(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom3(row),
    kind: oneOf(row, "kind", KINDS3),
    added: json(row, "added"),
    removed: json(row, "removed"),
    revision: num(row, "revision"),
    at: num(row, "at")
  };
}

// src/core/lint/store/views.ts
var TOLD2 = ["count", "full"];
var WHERE_CONSUMER3 = "worktree_id = ? AND session_id = ? AND agent_id = ?";
function consumerParams3(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createViewRepo3(conn) {
  return {
    list(consumer) {
      return conn.all(
        `SELECT v.*, ${CHECK_COLUMNS3} FROM views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ? AND v.outcome <> 'pass'
           ORDER BY c.path, c.tool`,
        ...consumerParams3(consumer)
      ).map(toEntry2);
    },
    writeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry2 of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint,
               told, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id) DO UPDATE SET
               outcome = excluded.outcome, fingerprint = excluded.fingerprint,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams3(consumer),
            ensureLintCheckId(conn, entry2.check),
            entry2.outcome,
            entry2.fingerprint,
            entry2.told,
            entry2.toldAt
          );
        }
      });
    },
    removeMany(consumer, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findLintCheckId(conn, check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER3} AND check_id = ?`,
            ...consumerParams3(consumer),
            id
          );
        }
      });
    },
    clear(consumer) {
      conn.run(`DELETE FROM views WHERE ${WHERE_CONSUMER3}`, ...consumerParams3(consumer));
    }
  };
}
function toEntry2(row) {
  return {
    check: checkFrom3(row),
    outcome: oneOf(row, "outcome", OUTCOMES6),
    fingerprint: strOrNull(row, "fingerprint"),
    told: oneOf(row, "told", TOLD2),
    toldAt: num(row, "told_at")
  };
}

// src/core/lint/store/store.ts
function createLintStore(conn, schemaVersion, path) {
  return {
    path,
    schemaVersion,
    meta: createMetaRepo3(conn),
    results: createResultRepo2(conn),
    states: createStateRepo2(conn),
    transitions: createTransitionRepo3(conn),
    views: createViewRepo3(conn),
    transaction: (fn) => conn.transaction(fn),
    read: (fn) => conn.read(fn),
    close: () => conn.close()
  };
}
function createMetaRepo3(conn) {
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
    delete(key) {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    }
  };
}

// src/core/lint/store/open.ts
function lintStorePath(commonDir) {
  return join26(storePaths(commonDir).dir, "lint.sqlite");
}
function isLintStoreOpenFailure(value) {
  return "reason" in value;
}
function openLintStore(commonDir, policy, options = {}) {
  if (!policy.lint.enabled) return { reason: "off" };
  const path = lintStorePath(commonDir);
  if (!existsSync9(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync7(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db;
  try {
    db = new DatabaseSync7(path);
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    const found2 = userVersion(db);
    if (found2 > LINT_SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found: found2, supported: LINT_SCHEMA_VERSION };
    }
    if (Number(db.prepare("PRAGMA page_count").get()?.page_count) === 0) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    }
    switchToWal(db, busyTimeoutMs);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db, LINT_MIGRATIONS);
    return createLintStore(new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}

// src/core/lint/surface/source.ts
function unreadableOf(failure2) {
  switch (failure2.reason) {
    case "off":
      return null;
    case "missing":
      return "missing";
    case "newer-schema":
      return {
        unreadable: `a newer Squeal made it (schema ${failure2.found}; this one reads ${failure2.supported})`
      };
    case "corrupt":
      return { unreadable: `the file is damaged (${failure2.error})` };
  }
}
function openForReading(commonDir, lint2, busyTimeoutMs) {
  if (!lint2.enabled) return null;
  const store = openLintStore(
    commonDir,
    { lint: lint2 },
    { create: false, ...busyTimeoutMs === void 0 ? {} : { busyTimeoutMs } }
  );
  return isLintStoreOpenFailure(store) ? unreadableOf(store) : { store, lint: lint2 };
}
function lintStoreSource(commonDir, root, { busyTimeoutMs } = {}) {
  const policy = () => {
    const { lint: lint2 } = readPolicy(root);
    return lint2.enabled ? lint2 : null;
  };
  return {
    policy,
    open() {
      const lint2 = policy();
      return lint2 === null ? null : openForReading(commonDir, lint2, busyTimeoutMs);
    }
  };
}
function withLint(source, fn) {
  let access = null;
  try {
    access = source?.open() ?? null;
    if (access === null) return { closed: "off" };
    if (access === "missing") return { closed: "missing" };
    if ("unreadable" in access) return { closed: "unreadable", reason: access.unreadable };
    return { read: fn(access) };
  } catch {
    return { closed: "failed" };
  } finally {
    if (access !== null && access !== "missing" && "store" in access) access.store.close();
  }
}
var readOrNull = (read4) => "read" in read4 ? read4.read : null;

// src/core/lint/surface/deliver.ts
function seedEntries(states, at) {
  return states.flatMap(
    (s) => s.judged?.outcome === "fail" ? [
      {
        check: s.check,
        outcome: "fail",
        fingerprint: s.judged.fingerprint,
        told: "count",
        toldAt: at
      }
    ] : []
  );
}
function keyingSeen(store, consumer, states) {
  const seq = readKeying(store.meta, consumer.worktreeId)?.seq ?? 0;
  const linting = !keyingLinted(store, consumer.worktreeId, states);
  return Math.max(0, seq - (linting ? 1 : 0));
}
function summaryOf(store, consumer, keying, mark, states) {
  if (keying === null || keying.seq <= mark.keying) return null;
  const all = states();
  if (!keyingLinted(store, consumer.worktreeId, all)) return null;
  const { failing, stale } = countsOf(all);
  return {
    summary: { reason: keying.mode, revision: keying.revision, failing, stale },
    seq: keying.seq
  };
}
function lintStep(store, consumer, at, seenUpTo2) {
  const { worktreeId } = consumer;
  const prior = readTold2(store.meta, consumer);
  const mark = prior ?? NO_MARK;
  const lastId = store.transitions.lastId(worktreeId);
  const transitions = store.transitions.after(worktreeId, fromId(mark));
  const paths = [...new Set(candidatesOf(mark, transitions).map((n) => lintCheckOf(n).path))];
  const listed2 = (filter) => store.states.list(worktreeId, filter);
  const states = new Map(
    (paths.length === 0 ? [] : listed2({ paths })).map((s) => [lintCheckName(s.check), s])
  );
  const view = new Map(store.views.list(consumer).map((v) => [lintCheckName(v.check), v]));
  const keying = readKeying(store.meta, worktreeId);
  const plan = planLintNews({
    view,
    states,
    transitions,
    keyedAfter: keying?.transition ?? 0,
    mark,
    seenUpTo: seenUpTo2,
    findings: (s) => findingsOf(store, s),
    at
  });
  let all = null;
  const due = summaryOf(store, consumer, keying, mark, () => all ??= listed2({}));
  const told = plan.entries.slice(0, LINT_LISTED_MAX);
  const notices = noticesOf(store, worktreeId);
  const next = {
    transition: lastId,
    keying: due?.seq ?? mark.keying,
    deferred: due === null ? plan.deferred : [],
    ...notices
  };
  const writes = writesOf(plan, told, due === null ? null : all ?? [], at);
  const changed = due !== null || writes.length + plan.removals.length > 0 || !sameMark(mark, next);
  const reseed = due !== null;
  const reasons = newReasons(reasonsOf(store, worktreeId), notices, mark);
  return {
    news: newsOf(plan, told, due?.summary ?? null, reasons),
    untold: plan.entries,
    ack: changed ? { prior, reseed, writes, removals: reseed ? [] : plan.removals, mark: next } : null
  };
}
function writesOf(plan, told, reseed, at) {
  const full = new Set(told.map((e) => lintCheckName({ path: e.path, tool: e.tool ?? "eslint" })));
  const isFull = (w) => full.has(lintCheckName(w.check));
  if (reseed === null) {
    return plan.writes.map((w) => isFull(w) ? w : { ...w, told: "count" });
  }
  return [...seedEntries(reseed, at).filter((w) => !isFull(w)), ...plan.writes.filter(isFull)];
}
function newReasons(reasons, notices, mark) {
  const failed2 = notices.failures > mark.failures ? reasons.failed : void 0;
  const off = notices.offs > mark.offs ? reasons.off : void 0;
  return { ...failed2 === void 0 ? {} : { failed: failed2 }, ...off === void 0 ? {} : { off } };
}
function newsOf(plan, told, summary, reasons) {
  if (plan.entries.length === 0 && summary === null && Object.keys(reasons).length === 0) {
    return null;
  }
  return {
    v: 1,
    entries: told,
    more: plan.entries.length - told.length,
    ...summary === null ? {} : { summary },
    ...reasons
  };
}
function apply(store, consumer, ack) {
  store.transaction(() => {
    if (!sameMark(readTold2(store.meta, consumer), ack.prior)) return;
    if (ack.reseed) store.views.clear(consumer);
    store.views.removeMany(consumer, ack.removals);
    store.views.writeMany(consumer, ack.writes);
    writeTold(store.meta, consumer, ack.mark);
  });
}
function registerLint(source, consumer, at) {
  const { worktreeId } = consumer;
  const read4 = withLint(
    source,
    ({ store }) => store.transaction(() => {
      const states = store.states.list(worktreeId);
      store.views.clear(consumer);
      store.views.writeMany(consumer, seedEntries(states, at));
      const reasons = reasonsOf(store, worktreeId);
      writeTold(store.meta, consumer, {
        transition: store.transitions.lastId(worktreeId),
        keying: keyingSeen(store, consumer, states),
        deferred: [],
        ...noticesOf(store, worktreeId)
      });
      const { failing, stale } = countsOf(states);
      const linting = progressOf(store, worktreeId, states, at);
      return { v: 1, failing, stale, ...linting === void 0 ? {} : { linting }, ...reasons };
    })
  );
  if ("read" in read4) return read4.read;
  if (read4.closed === "missing")
    return { v: 1, failing: 0, stale: 0, linting: { done: 0, total: 0 } };
  if (read4.closed === "unreadable") return { v: 1, failing: 0, stale: 0, unreadable: read4.reason };
  return void 0;
}
function readLintNews(source, consumer, at, since) {
  return readOrNull(
    withLint(source, ({ store }) => store.read(() => lintStep(store, consumer, at, since())))
  );
}
function acknowledgeLint(source, consumer, ack) {
  withLint(source, ({ store }) => apply(store, consumer, ack));
}

// src/core/store/imports.ts
var IMPORT_TABLES = {
  imports: `
CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  header TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  imported_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`,
  import_files: `
CREATE TABLE import_files (
  import_id TEXT NOT NULL,
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  environment TEXT NOT NULL,
  closure TEXT NOT NULL,
  observed TEXT NOT NULL,
  PRIMARY KEY (import_id, project, path)
) STRICT, WITHOUT ROWID;
`
};
function sourceLabel(header) {
  const at = header.commit === null ? "an unborn commit" : header.commit.slice(0, 8);
  if (header.source.kind === "local") return `local export at ${at}`;
  const { runId, repository } = header.source;
  return `CI run ${runId ?? "?"} on ${repository ?? "an unnamed repository"} at ${at}`;
}
function hasTables(conn) {
  const found2 = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(Object.keys(IMPORT_TABLES))
  );
  return found2.length === Object.keys(IMPORT_TABLES).length;
}
function readable(store) {
  let conn;
  try {
    conn = connectionOf(store);
  } catch {
    return null;
  }
  return hasTables(conn) ? conn : null;
}
function listImports(store) {
  const conn = readable(store);
  if (conn === null) return [];
  return conn.all("SELECT * FROM imports ORDER BY imported_at DESC, id").flatMap((row) => {
    const header = parseHeader(row.header);
    return header === null ? [] : [
      {
        id: String(row.id),
        header,
        fileHash: String(row.file_hash),
        importedAt: Number(row.imported_at)
      }
    ];
  });
}
function importSourceOf(store) {
  let labels;
  return (importId) => {
    labels ??= new Map(listImports(store).map((i) => [i.id, sourceLabel(i.header)]));
    return labels.get(importId) ?? null;
  };
}
function parseHeader(text2) {
  if (typeof text2 !== "string") return null;
  try {
    const value = JSON.parse(text2);
    return isHeader(value) ? value : null;
  } catch {
    return null;
  }
}
function isHeader(value) {
  if (typeof value !== "object" || value === null) return false;
  const h = value;
  const source = h.source;
  return typeof h.squealVersion === "string" && typeof h.keyFormat === "number" && (typeof h.commit === "string" || h.commit === null) && typeof h.dirty === "boolean" && typeof h.createdAt === "number" && typeof source === "object" && source !== null && (source.kind === "local" || source.kind === "github");
}

// src/core/store/view-seed.ts
function statesToSeed(store, worktreeId) {
  const rows = connectionOf(store).all(
    `${SELECT_STATES} WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
    worktreeId
  );
  const states = [];
  const seed2 = [];
  for (const row of rows) {
    const state = toKnownState(row);
    states.push(state);
    seed2.push({
      checkId: num(row, "check_id"),
      outcome: state.outcome,
      fingerprint: state.fingerprint
    });
  }
  return { states, seed: seed2 };
}
function seedView(store, consumer, rows, toldAt) {
  connectionOf(store).run(
    `INSERT OR REPLACE INTO consumer_views
       (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
     SELECT ?, ?, ?, j.value ->> 0, j.value ->> 1, j.value ->> 2, ? FROM json_each(?) j`,
    consumer.worktreeId,
    consumer.sessionId,
    consumer.agentId,
    toldAt,
    JSON.stringify(rows.map((r) => [r.checkId, r.outcome, r.fingerprint]))
  );
}
function checksBornAfter(store, worktreeId, mark) {
  const rows = connectionOf(store).all(
    `SELECT ${CHECK_COLUMNS} FROM state_born b JOIN checks c ON c.id = b.check_id
     WHERE b.worktree_id = ? AND b.id > ?`,
    worktreeId,
    mark
  );
  return new Set(rows.map((row) => checkIdentity(checkFrom(row))));
}
var KNOWN_STATES_NON_PASS = "known_states_non_pass";
function relevantStates(store, consumer, mark) {
  const conn = connectionOf(store);
  const indexed = conn.get(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
    KNOWN_STATES_NON_PASS
  );
  const nonPass = indexed === null ? "known_states" : `known_states INDEXED BY ${KNOWN_STATES_NON_PASS}`;
  return conn.all(
    `SELECT s.*, ${CHECK_COLUMNS} FROM (
         SELECT check_id FROM ${nonPass} WHERE worktree_id = ? AND outcome != 'pass'
         UNION SELECT check_id FROM consumer_views
           WHERE worktree_id = ? AND session_id = ? AND agent_id = ?
         UNION SELECT check_id FROM state_born WHERE worktree_id = ? AND id > ?
       ) r
       CROSS JOIN known_states s ON s.worktree_id = ? AND s.check_id = r.check_id
       JOIN checks c ON c.id = s.check_id
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
    consumer.worktreeId,
    consumer.worktreeId,
    consumer.sessionId,
    consumer.agentId,
    consumer.worktreeId,
    mark,
    consumer.worktreeId
  ).map(toKnownState);
}
function untoldBornAfter(store, consumer, mark) {
  return connectionOf(store).all(
    `${SELECT_STATES} JOIN state_born b ON b.worktree_id = s.worktree_id AND b.check_id = s.check_id
       WHERE s.worktree_id = ? AND b.id > ? AND NOT EXISTS (
         SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
           AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
    consumer.worktreeId,
    mark,
    consumer.sessionId,
    consumer.agentId
  ).map(toKnownState);
}

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/scheduler/install-wait.ts
function awaitingInstallMetaKey(worktreeId) {
  return worktreeMetaKey("awaitingInstall", worktreeId);
}
function installCommandMetaKey(worktreeId) {
  return worktreeMetaKey("installCommand", worktreeId);
}
function readInstallWait(store, worktreeId) {
  const workspaces2 = parseWorkspaces(store.meta.get(awaitingInstallMetaKey(worktreeId)));
  if (workspaces2 === null) return null;
  const command = store.meta.get(installCommandMetaKey(worktreeId));
  return { workspaces: workspaces2, command: command === "" ? null : command };
}
function parseWorkspaces(raw) {
  if (raw === "true") return [];
  if (raw === null || !raw.startsWith("[")) return null;
  try {
    const parsed2 = JSON.parse(raw);
    return Array.isArray(parsed2) ? parsed2.filter((p) => typeof p === "string") : null;
  } catch {
    return null;
  }
}

// src/core/commit/report.ts
var isFailedReport = (report) => "failed" in report;
var isCount2 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function countsOf2(raw, keys) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  return keys.every((key) => isCount2(value[key])) ? value : null;
}
var TEST_KEYS = ["files", "failures", "notDetermined", "running", "unknown"];
var LINT_KEYS = ["findings", "notDetermined", "running"];
function parseCommitReport(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  const { commit, revision, at } = value;
  if (typeof commit !== "string" || !isCount2(revision) || !isCount2(at)) return null;
  const base = { commit, revision, at };
  if (typeof value.failed === "string") return { ...base, failed: value.failed };
  const tests2 = countsOf2(value.tests, TEST_KEYS);
  if (tests2 === null) return null;
  const pick = (counts, keys) => Object.fromEntries(keys.map((key) => [key, counts[key]]));
  const lint2 = value.lint === void 0 ? void 0 : lintOf(value.lint);
  if (lint2 === null) return null;
  const waiting = waitingOf(value.waiting);
  const { from } = value;
  const { untracked, unanswered, notDeterminedFiles } = value.tests;
  const files2 = notDeterminedOf(notDeterminedFiles);
  return {
    ...base,
    ...typeof from === "string" ? { from } : {},
    tests: {
      ...pick(tests2, TEST_KEYS),
      ...isCount2(untracked) && untracked > 0 ? { untracked } : {},
      ...isCount2(unanswered) && unanswered > 0 ? { unanswered } : {},
      ...files2.length > 0 ? { notDeterminedFiles: files2 } : {}
    },
    ...lint2 === void 0 ? {} : { lint: lint2 },
    ...waiting === null ? {} : { waiting },
    ...value.updated === true ? { updated: true } : {}
  };
}
var isText = (value) => typeof value === "string";
var TOOL_KEYS = ["files", ...LINT_KEYS];
function lintOf(raw) {
  const counts = countsOf2(raw, LINT_KEYS);
  if (counts === null) return null;
  const { tools: tools2, notRun: notRun2 } = raw;
  const own = Array.isArray(tools2) ? tools2.flatMap((entry2) => {
    const tool = countsOf2(entry2, TOOL_KEYS);
    const name2 = entry2?.tool;
    if (tool === null || !isText(name2)) return [];
    const { unlisted: unlisted2 } = entry2;
    return [
      {
        tool: name2,
        ...Object.fromEntries(TOOL_KEYS.map((k) => [k, tool[k]])),
        ...isCount2(unlisted2) && unlisted2 > 0 ? { unlisted: unlisted2 } : {}
      }
    ];
  }) : null;
  return {
    findings: counts.findings,
    notDetermined: counts.notDetermined,
    running: counts.running,
    ...own === null ? {} : { tools: own },
    ...isText(notRun2) ? { notRun: notRun2 } : {}
  };
}
function entriesOf5(raw, keys) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry2) => {
    if (typeof entry2 !== "object" || entry2 === null) return [];
    const value = entry2;
    if (!keys.every((key) => isText(value[key]))) return [];
    return [Object.fromEntries(keys.map((key) => [key, value[key]]))];
  });
}
function waitingOf(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  const tests2 = entriesOf5(value.tests, ["project", "path", "key"]);
  const lint2 = entriesOf5(value.lint, ["tool", "path", "blob"]);
  return tests2.length === 0 && lint2.length === 0 ? null : { tests: tests2, lint: lint2 };
}
function notDeterminedOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry2) => {
    if (typeof entry2 !== "object" || entry2 === null) return [];
    const { project, path, through, more, deleted, unanswered } = entry2;
    if (!isText(project) || !isText(path)) return [];
    if (!Array.isArray(through) || !through.every(isText)) return [];
    const silent = Array.isArray(unanswered) ? through.filter((p) => unanswered.includes(p)) : [];
    return [
      {
        project,
        path,
        through: [...through],
        ...isCount2(more) && more > 0 ? { more } : {},
        ...deleted === true ? { deleted: true } : {},
        ...silent.length > 0 ? { unanswered: silent } : {}
      }
    ];
  });
}

// src/core/commit/store.ts
function commitReportsMetaKey(worktreeId) {
  return worktreeMetaKey("commitReports", worktreeId);
}
function readCommitReports(meta, worktreeId) {
  const raw = meta.get(commitReportsMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.seen !== "string" || !Array.isArray(value.reports)) return null;
    const reports = value.reports.flatMap((r) => parseCommitReport(r) ?? []);
    return { seen: value.seen, reports };
  } catch {
    return null;
  }
}
function readCommitReport(meta, worktreeId, commit) {
  return readCommitReports(meta, worktreeId)?.reports.find((r) => r.commit === commit) ?? null;
}
function newestCommitReport(meta, worktreeId) {
  return readCommitReports(meta, worktreeId)?.reports[0] ?? null;
}

// src/core/commit/text.ts
var commitText2 = (commit) => commit.slice(0, 7);
function commitReportText(report) {
  const head = `Commit ${commitText2(report.commit)}`;
  if (isFailedReport(report)) return `${head}: no report (${report.failed})`;
  const { tests: tests2, lint: lint2 } = report;
  const parts = [plural(tests2.failures, "known failure")];
  if (lint2 !== void 0) parts.push(...lintParts(lint2));
  const untracked = Math.min(tests2.untracked ?? 0, tests2.notDetermined);
  const unanswered = Math.min(tests2.unanswered ?? 0, tests2.notDetermined - untracked);
  const unstaged = tests2.notDetermined - untracked - unanswered;
  if (unstaged > 0) {
    parts.push(`${plural(unstaged, "test file")} not determined (unstaged changes)`);
  }
  if (untracked > 0) {
    parts.push(`${plural(untracked, "test file")} not determined (untracked files)`);
  }
  if (unanswered > 0) {
    parts.push(`${plural(unanswered, "test file")} not determined (git did not answer)`);
  }
  if (tests2.running > 0) parts.push(`${plural(tests2.running, "test file")} still running`);
  if (tests2.unknown > 0) parts.push(`${plural(tests2.unknown, "test file")} unknown`);
  return `${head}: ${parts.join("; ")}`;
}
function lintParts(lint2) {
  if (lint2.tools === void 0) return [legacyLint(lint2)];
  if (lint2.tools.length === 0) return [`lint not run (${lint2.notRun ?? "no tool checked a file"})`];
  return lint2.tools.map(toolPart);
}
function toolPart(counts) {
  const { tool, files: files2, findings, notDetermined, running, unlisted: unlisted2 = 0 } = counts;
  const listed2 = unlisted2 > 0 ? "listed file" : "file";
  const of = `of ${plural(files2, listed2)}`;
  const complete = files2 - notDetermined - running;
  if (complete === files2 && unlisted2 === 0) {
    return `lint (${tool}): ${plural(findings, "finding")} in ${files2} ${of}`;
  }
  const open2 = [];
  if (unlisted2 > 0) open2.push(`${plural(unlisted2, "changed file")} not listed yet`);
  if (running > 0) open2.push(`${running} ${of} still running`);
  if (notDetermined > 0) {
    open2.push(`${notDetermined}${running > 0 ? "" : ` ${of}`} not determined`);
  }
  if (complete > 0) {
    const where3 = complete === files2 ? `${files2} ${of}` : `the other ${complete}`;
    open2.push(`${plural(findings, "finding")} in ${where3}`);
  }
  return `lint (${tool}): ${open2.join(", ")}`;
}
function legacyLint({ findings, notDetermined, running }) {
  const more = [
    ...notDetermined > 0 ? [`${plural(notDetermined, "file")} not determined`] : [],
    ...running > 0 ? [`${plural(running, "file")} still running`] : []
  ];
  return [`lint ${plural(findings, "finding")}`, ...more].join(", ");
}
function commitLine(report) {
  const line = { commit: report.commit, text: commitReportText(report) };
  if (isFailedReport(report)) return line;
  const { notDetermined: count2, notDeterminedFiles: files2 = [] } = report.tests;
  return count2 > 0 && files2.length > 0 ? { ...line, notDetermined: { count: count2, files: files2 } } : line;
}

// src/core/daemon/client.ts
import { statSync as statSync6 } from "node:fs";
import { createConnection } from "node:net";
function endpointAt(socketPath) {
  try {
    const { dev, ino, ctimeNs, birthtimeNs } = statSync6(socketPath, { bigint: true });
    return { dev, ino, ctimeNs, birthtimeNs };
  } catch {
    return null;
  }
}
function sameEndpoint(a, b) {
  return a !== null && a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs && a.birthtimeNs === b.birthtimeNs;
}
async function pinDaemon(record, timeoutMs) {
  const endpoint = endpointAt(record.socketPath);
  if (endpoint === null) return null;
  try {
    const ping2 = await requestDaemon(record.socketPath, { type: "ping" }, timeoutMs, endpoint);
    if (!ping2.ok || ping2.type !== "ping") return null;
    const same2 = ping2.startedAt === record.startedAt && ping2.squealVersion === record.squealVersion;
    return same2 ? { endpoint, ping: ping2 } : null;
  } catch {
    return null;
  }
}
function requestDaemon(socketPath, request, timeoutMs, endpoint, signal) {
  return new Promise((resolve8, reject) => {
    if (signal?.aborted) {
      reject(failure("ABORT_ERR", `request to ${socketPath} aborted`));
      return;
    }
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled2 = false;
    const settle2 = (error, response) => {
      if (settled2) return;
      settled2 = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      socket.destroy();
      if (error) reject(error);
      else resolve8(response);
    };
    const timer = setTimeout(
      () => settle2(failure("ETIMEDOUT", `no answer from ${socketPath} in ${timeoutMs} ms`)),
      timeoutMs
    );
    const aborted = () => settle2(failure("ABORT_ERR", `request to ${socketPath} aborted`));
    signal?.addEventListener("abort", aborted, { once: true });
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      if (endpoint !== void 0 && !sameEndpoint(endpointAt(socketPath), endpoint)) {
        settle2(failure("ESTALE", `${socketPath} is another daemon's socket now`));
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
        settle2(null, JSON.parse(buffer.slice(0, end)));
      } catch {
        settle2(failure("EPROTO", `malformed answer from ${socketPath}`));
      }
    });
    socket.on(
      "error",
      (error) => settle2(failure(error.code ?? "EIO", error.message))
    );
    socket.on(
      "close",
      () => settle2(failure("ECONNRESET", `${socketPath} closed without an answer`))
    );
  });
}
function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// src/core/slow/stop-wait.ts
var STOP_SLOW_WAIT_CAP_MS = 354e4;
function stopWaitBoundMs(policy) {
  return Math.max(0, Math.min(policy.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
}
function stopSlowWaitMs(policy) {
  const [, slow] = defaultGroups(policy);
  return slow.stopRequires ? stopWaitBoundMs(policy) : null;
}
function stopWaitMetaKey(worktreeId) {
  return worktreeMetaKey("stopWait", worktreeId);
}
function forgetStopWait(store, consumer) {
  writeSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer, null);
}

// src/core/scheduler/narrow-asks-row.ts
function narrowAsksMetaKey(worktreeId) {
  return worktreeMetaKey("narrowAsks", worktreeId);
}
var NO_REQUESTS = { narrow: /* @__PURE__ */ new Map(), commit: /* @__PURE__ */ new Map(), requested: /* @__PURE__ */ new Set() };
function publishedLaneRequests(store, worktreeId, daemonStartedAt) {
  const raw = store.meta.get(narrowAsksMetaKey(worktreeId));
  if (raw === null) return NO_REQUESTS;
  try {
    const row = JSON.parse(raw);
    if (typeof row.at !== "number" || row.at < daemonStartedAt || !Array.isArray(row.asks)) {
      return NO_REQUESTS;
    }
    const names3 = Array.isArray(row.requested) ? row.requested : [];
    return {
      narrow: entriesOf6(row.asks),
      commit: entriesOf6(row.commit),
      requested: new Set(names3.filter((name2) => typeof name2 === "string"))
    };
  } catch {
    return NO_REQUESTS;
  }
}
function entriesOf6(value) {
  const out = /* @__PURE__ */ new Map();
  if (!Array.isArray(value)) return out;
  for (const entry2 of value) {
    if (!Array.isArray(entry2)) continue;
    const [id, key] = entry2;
    if (typeof id === "string" && typeof key === "string") out.set(id, key);
  }
  return out;
}

// src/core/state/lane-reads.ts
var NO_REQUESTS2 = { narrow: /* @__PURE__ */ new Map(), commit: /* @__PURE__ */ new Map(), requested: /* @__PURE__ */ new Set() };
function laneReads(store, worktreeId) {
  const worktree = once2(() => store.worktrees.get(worktreeId) ?? void 0);
  const daemon = () => worktree()?.daemon ?? null;
  const slowActivity = once2(() => readSlowActivity(store, worktreeId));
  const groupActivities = once2(() => readGroupActivities(store, worktreeId));
  return {
    worktree,
    daemon,
    requests: once2(() => {
      const live = daemon();
      return live === null ? NO_REQUESTS2 : publishedLaneRequests(store, worktreeId, live.startedAt);
    }),
    activity: (group) => group === SLOW_GROUP ? slowActivity() : groupActivities()(group),
    inTurn: once2(() => consumerInTurn(store, worktreeId))
  };
}
function once2(read4) {
  let done = false;
  let value;
  return () => {
    if (!done) {
      value = read4();
      done = true;
    }
    return value;
  };
}
function consumerInTurn(store, worktreeId) {
  const turns = readAll(store, worktreeMetaKey("turn", worktreeId));
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
}

// src/core/state/slot-now.ts
function slotNow(activity, group) {
  const { slotAt, ...shown } = activity;
  const published = shown.slot;
  if (shown.for !== "slot" || slotAt === void 0) return shown;
  if (published !== "held" && published !== "turn") return shown;
  const now = permitsNow(slotAt.dir, slotAt.permits, group, published);
  return { ...shown, slot: now };
}
function permitsNow(dir, permits, group, published) {
  let held;
  try {
    held = heldPermits({ dir, permits, group });
  } catch {
    return published;
  }
  if (held.length < permits) return published === "held" ? "free" : "turn";
  const proved = held.filter((permit) => permit.unknown !== true).length;
  return proved >= permits ? "in use" : published;
}

// src/core/state/slow.ts
function slowPolicyView(policy) {
  const globs4 = slowGlobs(policy, policy.nodeTest);
  if (globs4.length === 0) return null;
  const groups2 = groupView(policy);
  return {
    isSlow: policy.checks.length === 0 ? slowFiles(policy, policy.nodeTest) : (ref2) => groups2.of(ref2).name === SLOW_GROUP,
    slowGlobs: globs4,
    stopWaitMs: stopSlowWaitMs(policy),
    maxHolds: Math.max(1, policy.stop.maxHolds),
    pausesOnly: policy.slow.trigger === "idle"
  };
}
function classifySlowFilesOf(states, keys, isSlow) {
  const files2 = /* @__PURE__ */ new Map();
  for (const row of keys) {
    if (!isSlow(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const own = states.files.get(id)?.all;
    const cls = own === void 0 || own.count === 0 ? row.key !== null && row.pending !== null ? "pending" : "notRun" : own.validity.pending > 0 ? "pending" : own.validity.current === own.count ? "current" : "notRun";
    files2.set(id, { ref: row.testFile, class: cls });
  }
  return files2;
}
function slowTierOf(lane, view) {
  return {
    ...lane,
    ...view.stopWaitMs === null ? {} : { stopWaitMs: view.stopWaitMs },
    ...view.stopWaitMs === null || view.maxHolds === 1 ? {} : { maxHolds: view.maxHolds },
    ...view.pausesOnly ? { pausesOnly: true } : {}
  };
}
function laneCounts(states, keys, inLane, classify2 = classifySlowFilesOf) {
  const files2 = classify2(states, keys, inLane);
  const counts = { current: 0, pending: 0, notRun: 0 };
  let currentAt = null;
  let currentUpTo = null;
  for (const [id, { class: cls }] of files2) {
    counts[cls]++;
    if (cls !== "current") continue;
    const own = states.files.get(id);
    if (own === void 0 || own.currentAt === null || own.currentUpTo === null) continue;
    currentAt = currentAt === null ? own.currentAt : Math.min(currentAt, own.currentAt);
    currentUpTo = Math.max(currentUpTo ?? own.currentUpTo, own.currentUpTo);
  }
  return {
    testFiles: files2.size,
    ...counts,
    currentAt,
    ...currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {}
  };
}
function liveActivity(store, worktreeId, keys, inLane, group, reads = laneReads(store, worktreeId)) {
  const activity = reads.activity(group);
  if (activity?.kind === "waiting") {
    if (activity.for === "slot") return slotNow(activity, group);
    if (activity.for !== "idle" || reads.inTurn()) return activity;
    const fast = keys.some((row) => row.pending !== null && !inLane(row.testFile));
    return fast ? { kind: "waiting", for: "fast" } : null;
  }
  if (activity === null) return null;
  const daemon = reads.daemon();
  if (daemon !== null && activity.since < daemon.startedAt) return null;
  const running = new Set(
    keys.filter((row) => row.pending === "running" && inLane(row.testFile)).map((row) => row.testFile.path)
  );
  const [path, ...rest] = (activity.paths ?? [activity.path]).filter((p) => running.has(p));
  if (path === void 0) return null;
  const { since, lastDurationMs } = activity;
  const paths = rest.length === 0 ? {} : { paths: [path, ...rest] };
  return { kind: "running", path, ...paths, since, lastDurationMs };
}

// src/core/state/groups.ts
function groupTextsShown(policy) {
  return policy.checks.length > 0;
}
function testsAtEdit(policy, listed2) {
  const view = groupView(policy);
  const owns = (name2) => listed2.some((row) => view.of(row.testFile).name === name2);
  return view.groups.some(
    (group) => group.at === "edit" && group.select.kind !== "lint" && (group.index !== null || group.name === TESTS_GROUP && listed2.length === 0 || owns(group.name))
  );
}
function groupLaneCounts(states, keys, policy) {
  const view = groupView(policy);
  const waitMs = stopWaitBoundMs(policy);
  return view.groups.flatMap((group) => {
    if (group.index === null || group.select.kind !== "tests") return [];
    const inLane = (ref2) => view.of(ref2) === group;
    return [
      {
        name: group.name,
        inLane,
        head: {
          name: group.name,
          at: group.at,
          after: group.after,
          quietMs: group.quietMs,
          ...laneCounts(states, keys, inLane, classifyGroupFilesOf)
        },
        ...group.stopRequires ? { stopWaitMs: waitMs } : {}
      }
    ];
  });
}
function groupTiersOf(store, worktreeId, keys, lanes, reads = laneReads(store, worktreeId)) {
  const requested = requestedOf2(keys, lanes, reads);
  return lanes.map(({ name: name2, inLane, head, stopWaitMs }) => {
    const { asked, outside } = requested(head.at, inLane);
    const few = head.at === "manual" && outside.length > 0 && outside.length <= NAMED_OUTSIDE;
    return {
      ...head,
      activity: liveActivity(store, worktreeId, keys, inLane, name2, reads),
      ...stopWaitMs === void 0 ? {} : { stopWaitMs },
      ...asked === 0 ? {} : { requested: asked },
      ...few ? { pendingOutside: outside.map((ref2) => ref2.path) } : {}
    };
  });
}
function requestedOf2(keys, lanes, reads) {
  const none3 = { asked: 0, outside: [] };
  if (!lanes.some((lane) => heldUntilAsked(lane.head.at))) return () => none3;
  const asked = reads.requests().narrow;
  const isAsked = (row) => row.key !== null && asked.get(testFileId(row.testFile)) === row.key;
  const pending = keys.filter((row) => row.pending !== null);
  return (at, inLane) => {
    if (!heldUntilAsked(at)) return none3;
    const lane = pending.filter((row) => inLane(row.testFile));
    const outside = lane.filter((row) => !isAsked(row)).map((row) => row.testFile);
    return { asked: lane.length - outside.length, outside };
  };
}
var NONE_ON_REQUEST = /* @__PURE__ */ new Set();
function onRequestFiles(store, worktreeId, keys, policy, reads = laneReads(store, worktreeId)) {
  if (policy === null || !groupTextsShown(policy)) return NONE_ON_REQUEST;
  const view = groupView(policy);
  const held = view.groups.filter(
    (group) => group.index !== null && group.select.kind === "tests" && heldUntilAsked(group.at)
  );
  if (held.length === 0 || runAllOpen(store, worktreeId)) return NONE_ON_REQUEST;
  const { narrow, commit, requested } = reads.requests();
  const waiting = new Set(held.filter((group) => !requested.has(group.name)));
  if (waiting.size === 0) return NONE_ON_REQUEST;
  const atKey2 = (asks, id, key) => key !== null && asks.get(id) === key;
  const out = /* @__PURE__ */ new Set();
  for (const row of keys) {
    if (row.pending !== "queued" || !waiting.has(view.of(row.testFile))) continue;
    const id = testFileId(row.testFile);
    if (atKey2(narrow, id, row.key) || atKey2(commit, id, row.key)) continue;
    out.add(id);
  }
  return out;
}
function runAllOpen(store, worktreeId) {
  const progress = readCheckpointProgress(store, worktreeId);
  if (progress?.kind !== "run-all") return false;
  return progress.owed !== void 0 || store.checkpoints.get(progress.id)?.end === null;
}
var NAMED_OUTSIDE = 3;
function classifyGroupFilesOf(states, keys, inLane) {
  const files2 = /* @__PURE__ */ new Map();
  for (const row of keys) {
    if (!inLane(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const cls = classOf(row, states.files.get(id)?.all);
    files2.set(id, {
      ref: row.testFile,
      class: cls === "current" || cls === "pending" ? cls : "notRun"
    });
  }
  return files2;
}
function inGroupLane(policy) {
  const view = groupView(policy);
  return (ref2) => view.of(ref2).name !== TESTS_GROUP;
}
function readCommitLine(store, worktreeId) {
  const report = newestCommitReport(store.meta, worktreeId);
  return report === null ? void 0 : commitLine(report);
}

// src/core/state/header-part.ts
function headerPart(states, keys, policy, isSlow, openFiles, onRequest = /* @__PURE__ */ new Set()) {
  return headerPartOf(worktreeStatesOf(states), keys, policy, isSlow, openFiles, onRequest);
}
function headerPartOf(states, keys, policy, isSlow, openFiles, onRequest = /* @__PURE__ */ new Set()) {
  const view = policy === null ? null : slowPolicyView(policy);
  const slow = isSlow ?? view?.isSlow;
  const shown = policy !== null && groupTextsShown(policy);
  const slowLane = view === null ? void 0 : laneCounts(states, keys, view.isSlow);
  const owned = slowLane !== void 0 && (slowLane.testFiles > 0 || keys.length === 0 || !shown);
  return {
    policy,
    onRequest,
    view,
    counted: countStates2(states),
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    notCurrent: notCurrentOf(states, keys, openFiles, onRequest),
    listed: keys.length > 0,
    ...slow === void 0 ? {} : { slowPending: countSlowPending(states, keys, slow) },
    ...owned ? { slowLane } : {},
    ...policy !== null && shown ? {
      groups: {
        lanes: groupLaneCounts(states, keys, policy),
        lanePending: countSlowPending(states, keys, inGroupLane(policy)),
        testsAtEdit: testsAtEdit(policy, keys)
      }
    } : {}
  };
}
function countStates2(states) {
  const counts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const fileLevelCounts = { ...counts };
  let inheritedCount = 0;
  let inheritedFileLevelCount = 0;
  let importedCount = 0;
  for (const group of states.groups) {
    if (group.kind === "setup") continue;
    const n = group.count;
    counts[group.validity] += n;
    if (group.kind === "file") fileLevelCounts[group.validity] += n;
    if (group.validity !== "current") continue;
    if (group.origin?.kind === "inherited") {
      inheritedCount += n;
      if (group.kind === "file") inheritedFileLevelCount += n;
    }
    if (group.origin?.kind === "imported") importedCount += n;
  }
  return { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount };
}
function countFilesWithoutChecks(states, keys) {
  const counts = { pending: 0, unknown: 0 };
  for (const row of keys) {
    if (states.files.has(testFileId(row.testFile))) continue;
    counts[hasKey(row) && row.pending !== null ? "pending" : "unknown"]++;
  }
  return counts;
}
var SLOW_FILES_NAMED = 3;
function countSlowPending(states, keys, isSlow) {
  const withChecks = states.files;
  const files2 = /* @__PURE__ */ new Map();
  let checks = 0;
  for (const [id, file] of withChecks) {
    if (!isSlow(file.testFile)) continue;
    const pending = Object.values(file.pending).reduce(
      (n, phases) => n + phases.queued + phases.running + phases.none,
      0
    );
    if (pending === 0) continue;
    checks += pending;
    files2.set(id, file.testFile);
  }
  let testFilesWithoutChecks = 0;
  for (const row of keys) {
    const id = testFileId(row.testFile);
    if (withChecks.has(id) || !hasKey(row) || row.pending === null || !isSlow(row.testFile)) {
      continue;
    }
    testFilesWithoutChecks++;
    files2.set(id, row.testFile);
  }
  const named2 = [...files2.values()].sort((a, b) => a.path.localeCompare(b.path) || a.project.localeCompare(b.project)).slice(0, SLOW_FILES_NAMED);
  return {
    testFiles: files2.size,
    checks,
    testFilesWithoutChecks,
    ...named2.length === 0 ? {} : { files: named2 }
  };
}
function hasKey(row) {
  return row.key !== null;
}

// src/core/state/optimizer-note.ts
function optimizerOffMetaKey(worktreeId) {
  return worktreeMetaKey("optimizerOff", worktreeId);
}
function readOptimizerOff(store, worktreeId) {
  const text2 = store.meta.get(optimizerOffMetaKey(worktreeId));
  return text2 === null || text2 === "" ? void 0 : text2;
}

// src/core/state/header.ts
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId), isSlow, openFiles) {
  return headerWith(
    store,
    worktreeId,
    keys,
    (policy, onRequest) => headerPart(states, keys, policy, isSlow, openFiles, onRequest)
  );
}
function headerWith(store, worktreeId, keys, partOf) {
  const reads = laneReads(store, worktreeId);
  const latest = store.revisions.latest(worktreeId);
  const revision = latest?.number ?? 0;
  const commit = readRevisionCommit(store, worktreeId, latest);
  const refinedRevision = readRefined(store, worktreeId);
  const wait = readInstallWait(store, worktreeId);
  const awaiting = wait !== null;
  const last = store.checkpoints.lastCompletedFull(worktreeId);
  const lane = awaiting ? null : laneAfter(store.checkpoints.lastCompleted(worktreeId), last);
  const root = reads.worktree()?.root;
  const policy = root === void 0 ? null : readPolicy(root);
  const part = partOf(policy, onRequestFiles(store, worktreeId, keys, policy, reads));
  const { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount } = part.counted;
  const optimizerOff = readOptimizerOff(store, worktreeId);
  const runnerPartPending = !covers(refinedRevision, revision);
  return {
    revision,
    ...commit === void 0 ? {} : { commit },
    counts,
    fileLevelCounts,
    testFilesWithoutChecks: part.testFilesWithoutChecks,
    ...part.notCurrent,
    fullSuite: {
      atCurrentRevision: !awaiting && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
      ...lane === null ? {} : { lane }
    },
    testFilesListed: part.listed || !awaiting && last !== null,
    inheritedCount,
    inheritedFileLevelCount,
    ...importedCount === 0 ? {} : { importedCount },
    refinedRevision,
    runnerPartPending,
    ...listingRunnersField(runnerPartPending, root, policy),
    ...part.slowPending === void 0 ? {} : { slowPending: part.slowPending },
    ...slowTierField(store, worktreeId, keys, part, reads),
    ...groupFields(store, worktreeId, keys, part, reads),
    ...installFields(wait),
    ...optimizerOff === void 0 ? {} : { optimizerOff }
  };
}
function installFields(wait) {
  if (wait === null) return {};
  const missing = wait.workspaces;
  return {
    awaitingInstall: true,
    ...missing.length > 0 ? { missingInstalls: missing } : {},
    ...wait.command === null ? {} : { installCommand: wait.command }
  };
}
function slowTierField(store, worktreeId, keys, { view, slowLane }, reads) {
  if (view === null || slowLane === void 0) return {};
  const activity = liveActivity(store, worktreeId, keys, view.isSlow, SLOW_GROUP, reads);
  return { slowTier: slowTierOf({ ...slowLane, activity }, view) };
}
function groupFields(store, worktreeId, keys, { groups: groups2 }, reads) {
  if (groups2 === void 0) return {};
  const commitLine2 = readCommitLine(store, worktreeId);
  return {
    groupTiers: groupTiersOf(store, worktreeId, keys, groups2.lanes, reads),
    lanePending: groups2.lanePending,
    ...groups2.testsAtEdit ? {} : { noTestsAtEdit: true },
    ...commitLine2 === void 0 ? {} : { commitLine: commitLine2 }
  };
}
function laneAfter(latest, full) {
  if (latest?.lane === void 0 || latest.id === full?.id) return null;
  return { lane: latest.lane, revision: latest.revision };
}
function listingRunnersField(pending, root, policy) {
  if (!pending || root === void 0 || policy === null) return {};
  return {
    listingRunners: [
      ...runsVitest(root, policy) ? ["Vitest"] : [],
      ...policy.nodeTest.length > 0 ? ["node:test"] : [],
      ...policy.pytest.length > 0 ? ["pytest"] : []
    ]
  };
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

// src/core/retry/recorded.ts
function retryFactOf(records) {
  const newest = records.filter((r) => r.noResult !== true).at(-1);
  if (newest === void 0) return void 0;
  return { reason: newest.reason, outcome: newest.end?.outcome ?? "pending" };
}
function passedRetry(store, testFile, key, runId) {
  return retryFactOf(
    retriesAt(readRetries(store), testFile, key).filter(
      (r) => r.end?.outcome === "passed" && r.end.runId === runId
    )
  );
}
function withRecorded(store, worktreeId, states, revision) {
  const failing = states.flatMap((state) => {
    const failure2 = toKnownFailure(state, revision);
    return failure2 === null ? [] : [{ state, failure: failure2 }];
  });
  if (failing.length === 0) return [];
  const producers = readFailureProducers(store, worktreeId);
  const failureKeys = readFailureKeys(store, worktreeId);
  const retries = readRetries(store);
  const loads = readRunLoads(store);
  const remotes = readRunRemotes(store);
  const notes = readFlakyNotes(store);
  return failing.map(({ state, failure: failure2 }) => {
    if (failure2.check.kind === "setup") return failure2;
    const testFile = testFileOf(failure2.check);
    const results = store.results.listForCheck(failure2.check, Number.MAX_SAFE_INTEGER);
    const id = checkIdentity(state.check);
    const row = producingResult(worktreeId, state, producers.get(id), failureKeys.get(id), results);
    if (row === null) return { ...failure2, recordedUnknown: true };
    const { provenance } = row;
    const retry = retryFactOf(retriesAt(retries, testFile, row.key));
    const remote = keptRemote(remotes, provenance.runId, testFile);
    const recorded = {
      worktreeId: provenance.worktreeId,
      worktreeRoot: store.worktrees.get(provenance.worktreeId)?.root ?? null,
      revision: provenance.revision,
      recordedAt: provenance.recordedAt,
      loadPerCpu: loads.get(provenance.runId) ?? null,
      ...remote === void 0 ? {} : { remote },
      ...retry === void 0 ? {} : { retry },
      ...notes.get(id)?.key === row.key ? {} : { noEarlierPass: true }
    };
    return { ...failure2, recorded };
  });
}

// src/core/state/before-edits.ts
function registeredKeysMetaKey(worktreeId) {
  return worktreeMetaKey("registeredKeys", worktreeId);
}
var EMPTY = { snapshots: [], slots: {} };
function toKeys(value) {
  const keys = {};
  if (!isRecord(value)) return keys;
  for (const [file, key] of Object.entries(value)) if (typeof key === "string") keys[file] = key;
  return keys;
}
function read3(store, worktreeId) {
  const raw = store.meta.get(registeredKeysMetaKey(worktreeId));
  if (raw === null) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.snapshots) || !isRecord(value.slots)) return EMPTY;
    const snapshots = value.snapshots.map(toKeys);
    const slots2 = {};
    for (const [slot2, at] of Object.entries(value.slots)) {
      if (typeof at === "number" && snapshots[at] !== void 0) slots2[slot2] = at;
    }
    return { snapshots, slots: slots2 };
  } catch {
    return EMPTY;
  }
}
var identity2 = (keys) => JSON.stringify(Object.entries(keys).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
function recordRegisteredKeys(store, worktreeId, slot2, { resumed, kept: kept2 }) {
  const recorded = read3(store, worktreeId);
  const named2 = /* @__PURE__ */ new Map();
  for (const [at, index] of Object.entries(recorded.slots)) {
    const keys = recorded.snapshots[index];
    if (keys !== void 0 && kept2.has(at) && (resumed || at !== slot2)) named2.set(at, keys);
  }
  if (!resumed) {
    const keys = {};
    for (const row of store.testFileKeys.list(worktreeId)) {
      if (row.key !== null) keys[testFileId(row.testFile)] = row.key;
    }
    named2.set(slot2, keys);
  }
  const snapshots = [];
  const indexOf = /* @__PURE__ */ new Map();
  const slots2 = {};
  for (const [at, keys] of named2) {
    const id = identity2(keys);
    let index = indexOf.get(id);
    if (index === void 0) {
      index = snapshots.push(keys) - 1;
      indexOf.set(id, index);
    }
    slots2[at] = index;
  }
  store.meta.set(registeredKeysMetaKey(worktreeId), JSON.stringify({ snapshots, slots: slots2 }));
}
function beforeEditsFor(store, worktreeId, slot2, since) {
  let keys;
  const results = /* @__PURE__ */ new Map();
  let none3;
  const noneAt = () => {
    none3 ??= { outcome: "none", commit: store.revisions.get(worktreeId, since)?.head ?? null };
    return none3;
  };
  const atKey2 = (key) => {
    let byCheck = results.get(key);
    if (byCheck === void 0) {
      byCheck = /* @__PURE__ */ new Map();
      for (const r of store.results.byKey(key)) {
        const { worktreeId: from, commit } = r.provenance;
        const before = r.outcome === "pass" ? { outcome: "pass" } : r.outcome === "fail" ? {
          outcome: "fail",
          worktreeId: from,
          worktreeRoot: store.worktrees.get(from)?.root ?? null,
          commit
        } : null;
        if (before !== null) byCheck.set(checkIdentity(r.check), before);
      }
      results.set(key, byCheck);
    }
    return byCheck;
  };
  return (check) => {
    if (keys === void 0) {
      const recorded = read3(store, worktreeId);
      const index = recorded.slots[slot2];
      keys = (index === void 0 ? void 0 : recorded.snapshots[index]) ?? {};
    }
    const key = keys[testFileId(testFileOf(check))];
    return (key === void 0 ? void 0 : atKey2(key).get(checkIdentity(check))) ?? noneAt();
  };
}

// src/core/delivery/closure.ts
function closureTrust(store, worktreeId) {
  const keys = /* @__PURE__ */ new Map();
  const keyOf2 = (id, ref2) => {
    let byFile2 = keys.get(id);
    if (byFile2 === void 0) {
      byFile2 = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile2);
    }
    return byFile2.get(testFileId(ref2)) ?? null;
  };
  return (record) => {
    if (record.updatedBy === worktreeId) return true;
    const key = keyOf2(worktreeId, record.testFile);
    return key !== null && key === keyOf2(record.updatedBy, record.testFile);
  };
}
function closureFor(store, worktreeId) {
  const trusts = closureTrust(store, worktreeId);
  return (ref2) => {
    const record = store.testFiles.get(ref2);
    return record !== null && trusts(record) ? record.closure.paths : void 0;
  };
}
function loaderCounts(store, worktreeId) {
  let closures;
  const read4 = () => {
    const listed2 = new Set(store.testFileKeys.list(worktreeId).map((r) => testFileId(r.testFile)));
    const trusts = closureTrust(store, worktreeId);
    return store.testFiles.list().filter((r) => listed2.has(testFileId(r.testFile)) && trusts(r)).map((r) => r.closure.paths);
  };
  return (path) => {
    closures ??= read4();
    return closures.filter((paths) => paths.includes(path)).length;
  };
}

// src/core/daemon/bootstrapped.ts
function bootstrappedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonBootstrapped", worktreeId);
}
function marker(store, worktreeId) {
  const [startedAt = "", head] = (store.meta.get(bootstrappedMetaKey(worktreeId)) ?? "").split(" ");
  return [startedAt, head];
}
function lastScannedBy(store, worktreeId) {
  const [startedAt] = marker(store, worktreeId);
  const value = startedAt === "" ? Number.NaN : Number(startedAt);
  return Number.isFinite(value) ? value : null;
}
function scannedBy(store, worktreeId, startedAt) {
  return lastScannedBy(store, worktreeId) === startedAt;
}

// src/core/delivery/registered.ts
function registeredMetaKey(worktreeId) {
  return worktreeMetaKey("registered", worktreeId);
}
function parkedMetaKey(worktreeId) {
  return worktreeMetaKey("registeredLeft", worktreeId);
}
var isNumber4 = (value) => typeof value === "number";
var isString = (value) => typeof value === "string";
var isGap = (value) => Array.isArray(value) && value.length === 2 && value.every(isNumber4);
function toRegistration(value) {
  if (isNumber4(value)) return { since: value, gaps: [] };
  if (!isRecord(value) || !isNumber4(value.since) || !Array.isArray(value.gaps)) return null;
  if (!value.gaps.every(isGap)) return null;
  return {
    since: value.since,
    gaps: value.gaps,
    ...isNumber4(value.scanned) ? { scanned: value.scanned } : {},
    ...isString(value.head) ? { head: value.head } : {}
  };
}
var stored2 = (r) => r.gaps.length === 0 && r.scanned === void 0 && r.head === void 0 ? r.since : r;
function registration(store, consumer) {
  return toRegistration(readSlot(store, registeredMetaKey(consumer.worktreeId), consumer));
}
function scannedDaemon(store, worktreeId, alive) {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (!alive || daemon === null) return null;
  return scannedBy(store, worktreeId, daemon.startedAt) ? daemon.startedAt : null;
}
function registrationHead(root) {
  try {
    return readGitHead(root);
  } catch {
    return null;
  }
}
function seesEveryChange(store, worktreeId, r) {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  return r.scanned !== void 0 && daemon?.startedAt === r.scanned;
}
function tellRegistered(store, consumer, revision, {
  at,
  scanned,
  head = null
}) {
  const parked = unpark(store, consumer, at);
  const next = parked === null ? fresh(revision, scanned, head) : back(parked, revision, scanned);
  writeSlot(store, registeredMetaKey(consumer.worktreeId), consumer, stored2(next));
  recordRegisteredKeys(store, consumer.worktreeId, slot(consumer), {
    resumed: parked !== null,
    kept: registeredSlots(store, consumer.worktreeId, at)
  });
  if (parked === null) return null;
  return {
    said: parked.said === true,
    uncovered: parked.uncovered ?? [],
    editsSince: parked.editsSince ?? null
  };
}
function registeredSlots(store, worktreeId, at) {
  const slots2 = new Set(Object.keys(readAll(store, registeredMetaKey(worktreeId))));
  for (const [k, v] of Object.entries(readAll(store, parkedMetaKey(worktreeId)))) {
    if (isRecord(v) && isNumber4(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) slots2.add(k);
  }
  return slots2;
}
function fresh(since, scanned, head) {
  return {
    since,
    gaps: [],
    ...scanned === null ? {} : { scanned },
    ...head === null ? {} : { head }
  };
}
function back(parked, revision, scanned) {
  const away = [parked.leftAt, revision];
  const r = {
    since: parked.since,
    gaps: revision >= parked.leftAt ? [...parked.gaps, away] : parked.gaps,
    ...parked.head === void 0 ? {} : { head: parked.head }
  };
  return scanned !== null && parked.scanned === scanned ? { ...r, scanned } : r;
}
function park(store, consumer, at, { said, uncovered, editsSince } = { said: false, uncovered: [], editsSince: null }) {
  const key = registeredMetaKey(consumer.worktreeId);
  const current2 = registration(store, consumer);
  if (readSlot(store, key, consumer) !== void 0) writeSlot(store, key, consumer, null);
  if (current2 === null) return;
  const leftAt = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  const told = {
    ...said ? { said: true } : {},
    ...uncovered.length > 0 ? { uncovered } : {},
    ...editsSince === null ? {} : { editsSince }
  };
  writeParked(store, consumer, at, { ...current2, leftAt, leftTime: at, ...told });
}
function parkedEditsSinces(store, worktreeId) {
  return Object.values(readAll(store, parkedMetaKey(worktreeId))).flatMap(
    (v) => isRecord(v) && isNumber4(v.editsSince) ? [v.editsSince] : []
  );
}
function unpark(store, consumer, at) {
  const value = readAll(store, parkedMetaKey(consumer.worktreeId))[slot(consumer)];
  if (value === void 0) return null;
  writeParked(store, consumer, at, null);
  const r = toRegistration(value);
  if (r === null || !isRecord(value) || !isNumber4(value.leftAt) || !isNumber4(value.leftTime)) {
    return null;
  }
  if (value.leftTime < at - CONSUMER_EXPIRY_MS) return null;
  const told = {
    ...value.said === true ? { said: true } : {},
    ...Array.isArray(value.uncovered) ? { uncovered: value.uncovered.filter((p) => typeof p === "string") } : {},
    ...isNumber4(value.editsSince) ? { editsSince: value.editsSince } : {}
  };
  return { ...r, leftAt: value.leftAt, leftTime: value.leftTime, ...told };
}
function writeParked(store, consumer, at, value) {
  const key = parkedMetaKey(consumer.worktreeId);
  const all = readAll(store, key);
  const next = {};
  for (const [k, v] of Object.entries(all)) {
    if (isRecord(v) && isNumber4(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) next[k] = v;
  }
  if (value === null) delete next[slot(consumer)];
  else next[slot(consumer)] = value;
  if (Object.keys(next).length === 0 && Object.keys(all).length === 0) return;
  store.meta.set(key, JSON.stringify(next));
}
function changedAfter(store, worktreeId, r, revision) {
  const changed = /* @__PURE__ */ new Set();
  const unknown = /* @__PURE__ */ new Set();
  for (const { number, trigger, changes } of store.revisions.range(
    worktreeId,
    Math.max(r.since - 1, 0),
    revision
  )) {
    if (r.gaps.some(([after, upTo]) => number > after && number <= upTo)) continue;
    const start = trigger === "start";
    if (number === r.since && (!start || r.scanned !== void 0)) continue;
    for (const change2 of changes) (start ? unknown : changed).add(change2.path);
  }
  return { changed, unknown };
}

// src/core/delivery/attribution.ts
var TIMED_OUT = /timed out in \d+ms/;
var LOAD_RESULTS_READ = 50;
function loadOf(store, worktreeId, entry2) {
  if (entry2.summary === null || !TIMED_OUT.test(entry2.summary)) return void 0;
  const from = originWorktree(entry2.origin) ?? worktreeId;
  const result = store.results.listForCheck(entry2.check, LOAD_RESULTS_READ).find((r) => r.outcome === "fail" && r.provenance.worktreeId === from);
  return result?.errors.find((e) => e.loadAverage !== void 0)?.loadAverage;
}
function attribute(store, consumer, entries, revision) {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const from = registration(store, consumer);
  const changesOf = closureChanges(store, consumer, revision);
  const before = from === null ? null : beforeEditsFor(store, consumer.worktreeId, slot(consumer), from.since);
  const frameOf = testFileFrames(store, consumer.worktreeId);
  return entries.map((entry2) => {
    if (entry2.kind === "fail-retired" || entry2.to !== "fail") return entry2;
    const load = loadOf(store, consumer.worktreeId, entry2);
    const firstSeen = entry2.kind === "first-seen-fail" && entry2.from === null && before !== null;
    const frame = frameOf(entry2.check, entry2.location);
    const facts = {
      ...load === void 0 ? {} : { loadAverage: load },
      ...firstSeen ? { beforeEdits: before(entry2.check) } : {},
      ...frame === void 0 ? {} : { testFileFrame: frame }
    };
    const told = changesOf(entry2.check);
    return { ...entry2, ...told === void 0 ? {} : { changesInClosure: told }, ...facts };
  });
}
function closureChanges(store, consumer, revision) {
  const from = registration(store, consumer);
  const changed = from === null ? null : changedAfter(store, consumer.worktreeId, from, revision);
  const sure = from !== null && seesEveryChange(store, consumer.worktreeId, from);
  const closureOf = closureFor(store, consumer.worktreeId);
  return ({ project, testPath }) => {
    const closure = changed === null ? void 0 : closureOf({ project, path: testPath });
    const touched = changed === null || closure === void 0 || closure.some((p) => changed.unknown.has(p)) ? void 0 : closure.filter((p) => changed.changed.has(p));
    return touched?.length === 0 && !sure ? void 0 : touched;
  };
}
function testFileFrames(store, worktreeId) {
  const keys = readFailureKeys(store, worktreeId);
  const rows = /* @__PURE__ */ new Map();
  return (check, location2) => {
    const identity3 = checkIdentity(check);
    const key = keys.get(identity3);
    if (key === void 0 || location2 === null) return void 0;
    if (!rows.has(key)) rows.set(key, store.results.byKey(key, 0));
    const row = rows.get(key)?.find((r) => r.outcome === "fail" && checkIdentity(r.check) === identity3);
    const thrown2 = row?.errors[0]?.location ?? null;
    if (row === void 0 || thrown2 === null || !samePosition(thrown2, location2)) return void 0;
    return testFileFrame(check, row.errors) ?? void 0;
  };
}
function samePosition(a, b) {
  return a.path === b.path && a.line === b.line && a.column === b.column;
}
function withTestFileFrames(store, worktreeId, failures) {
  if (failures.length === 0) return failures;
  const frameOf = testFileFrames(store, worktreeId);
  return failures.map((f) => {
    const frame = frameOf(f.check, f.location);
    return frame === void 0 ? f : { ...f, testFileFrame: frame };
  });
}
function withClosureChanges(store, consumer, failures, revision) {
  if (failures.length === 0) return failures;
  const changesOf = closureChanges(store, consumer, revision);
  return withTestFileFrames(store, consumer.worktreeId, failures).map((f) => {
    const paths = changesOf(f.check);
    return paths === void 0 || paths.length === 0 ? f : { ...f, changesInClosure: paths };
  });
}
function dependenciesInstalled(store, worktreeId) {
  const files2 = store.fileHashes.list(worktreeId);
  if (files2.length === 0) return void 0;
  return files2.some((f) => isInstalledLockfile(f.path));
}
function annotate(store, consumer, entries, header, states) {
  return {
    entries: withFlaky(
      store,
      consumer.worktreeId,
      attribute(store, consumer, entries, header.revision)
    ),
    header: withDependencies(
      store,
      consumer.worktreeId,
      header,
      entries.flatMap((e) => e.to === "fail" ? [e.check] : [])
    ),
    stillFailing: states.filter((s) => s.outcome === "fail").map((s) => s.check)
  };
}
function withFlaky(store, worktreeId, entries) {
  if (!entries.some((e) => e.kind !== "fail-retired")) return entries;
  const notes = readFlakyNotes(store);
  if (notes.size === 0) return entries;
  const keys = new Map(
    store.testFileKeys.list(worktreeId).map((r) => [testFileId(r.testFile), r.key])
  );
  const rows = /* @__PURE__ */ new Map();
  const runOf = (check, key) => {
    if (!rows.has(key)) rows.set(key, store.results.byKey(key));
    const identity3 = checkIdentity(check);
    return rows.get(key)?.find((r) => checkIdentity(r.check) === identity3)?.provenance.runId;
  };
  return entries.map((entry2) => {
    if (entry2.kind === "fail-retired") return entry2;
    const note = notes.get(checkIdentity(entry2.check));
    const key = keys.get(testFileId(testFileOf(entry2.check)));
    if (note === void 0 || note.key !== key) return entry2;
    const runId = entry2.kind === "fail-to-pass" && key !== null ? runOf(entry2.check, key) : void 0;
    const retry = runId !== void 0 && key !== null ? passedRetry(store, testFileOf(entry2.check), key, runId) : void 0;
    return { ...entry2, flaky: note, ...retry === void 0 ? {} : { retry } };
  });
}
function withDependencies(store, worktreeId, header, failing) {
  if (failing.length === 0) return header;
  const runners = store.checks.runnersOf(worktreeId);
  const node2 = failing.some((check) => NODE_RUNNERS.has(runners.get(check.project) ?? ""));
  const installed2 = node2 ? dependenciesInstalled(store, worktreeId) : void 0;
  return installed2 === void 0 ? header : { ...header, dependenciesInstalled: installed2 };
}
var NODE_RUNNERS = /* @__PURE__ */ new Set(["vitest", "node-test"]);

// src/core/code/pass/cursor.ts
var passKey = (worktreeId) => `pass:${worktreeId}`;
function readCursor2(meta, worktreeId) {
  const text2 = meta.get(passKey(worktreeId));
  if (text2 === null) return null;
  try {
    const cursor = JSON.parse(text2);
    return typeof cursor.revision === "number" ? cursor : null;
  } catch {
    return null;
  }
}
var awaitedKey = (worktreeId) => `awaited:${worktreeId}`;
function awaitFirstCount(meta, worktreeId) {
  meta.set(awaitedKey(worktreeId), "1");
}

// src/core/code/pass/pulled.ts
var pulledKey = (worktreeId) => `pulled:${worktreeId}`;
function readPulled(meta, worktreeId) {
  const text2 = meta.get(pulledKey(worktreeId));
  if (text2 === null) return /* @__PURE__ */ new Map();
  try {
    const pairs = JSON.parse(text2);
    if (!Array.isArray(pairs)) return /* @__PURE__ */ new Map();
    return new Map(
      pairs.filter(
        (p) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number"
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function pulledReader(meta, worktreeId) {
  let pulled = null;
  return (path, revision) => {
    pulled ??= readPulled(meta, worktreeId);
    const at = pulled.get(path);
    return at !== void 0 && at <= revision;
  };
}

// src/core/code/pass/too-big.ts
var editsKey = (worktreeId) => `tooBigEdits:${worktreeId}`;
function readTooBigEdits(meta, worktreeId) {
  const text2 = meta.get(editsKey(worktreeId));
  if (text2 === null) return /* @__PURE__ */ new Map();
  try {
    const pairs = JSON.parse(text2);
    if (!Array.isArray(pairs)) return /* @__PURE__ */ new Map();
    return new Map(
      pairs.filter(
        (p) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number"
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}

// src/core/types/code-delivery.ts
var CODE_LISTED_MAX = 5;
var CODE_NOT_JUDGED_MAX = 3;

// src/core/delivery/code-reads.ts
function codeReads(store, worktreeId) {
  const failing = /* @__PURE__ */ new Map();
  const edits = /* @__PURE__ */ new Map();
  const once3 = (cache, read4) => (measures) => measures.flatMap((measure2) => {
    const known = cache.get(measure2);
    if (known !== void 0) return known;
    const states = read4(measure2);
    cache.set(measure2, states);
    return states;
  });
  return {
    failing: once3(
      failing,
      (measure2) => store.states.list(worktreeId, { measure: measure2, outcome: "fail" })
    ),
    edits: once3(edits, (measure2) => store.states.edits(worktreeId, measure2))
  };
}

// src/core/delivery/code-told.ts
function toldOver(store, worktreeId, consumers, measures = ["complexity"], failing) {
  const told = new Set(
    consumers.flatMap(
      (c) => store.views.list(c).filter((v) => measures.includes(v.measure) && v.told !== "count").map(codeKey)
    )
  );
  if (told.size === 0) return [];
  return measures.flatMap(
    (measure2) => (failing === void 0 ? store.states.list(worktreeId, { measure: measure2, outcome: "fail" }) : failing.filter((s) => s.measure === measure2)).filter((s) => told.has(codeKey(s)))
  );
}
function changedNotJudged(store, worktreeId, bounds) {
  if (bounds.length === 0) return [];
  const own = (revision) => revision !== void 0 && bounds.some((b) => isOwn(b, revision));
  const big = readTooBigEdits(store.meta, worktreeId);
  const failed2 = readUncountable(store.meta, worktreeId);
  const paths = [
    ...[...big].flatMap(([path, revision]) => own(revision) ? [path] : []),
    ...[...failed2].flatMap(([path, f]) => own(f.editedAt) ? [path] : [])
  ];
  if (paths.length === 0) return [];
  const files2 = store.files.list(worktreeId, paths);
  const spent = uncountableFiles(store, worktreeId, files2);
  return files2.flatMap((file) => {
    if (file.tooBig === true) {
      const revision = big.get(file.path);
      return own(revision) ? [{ file, revision, failure: null }] : [];
    }
    const failure2 = spent.get(file.path);
    return own(failure2?.editedAt) ? [{ file, revision: failure2.editedAt, failure: failure2 }] : [];
  }).sort((a, b) => b.revision - a.revision || compare(a.file.path, b.file.path));
}
function toldOf2(over, threshold) {
  const count2 = over.filter((s) => s.measure === "complexity").length;
  const crap = over.filter((s) => s.measure === "crap");
  const uncovered = over.filter((s) => s.measure === "uncovered").length;
  const [first] = crap;
  return {
    count: count2,
    threshold,
    ...first?.threshold == null ? {} : { crap: { count: crap.length, threshold: first.threshold } },
    ...uncovered === 0 ? {} : { uncovered }
  };
}
function notJudgedOf(changed, limit) {
  return {
    files: changed.slice(0, CODE_NOT_JUDGED_MAX).map(
      ({ file, failure: failure2 }) => failure2 === null ? { path: file.path, reason: "too-big", size: file.size, limit } : { path: file.path, reason: "could-not-count" }
    ),
    more: Math.max(0, changed.length - CODE_NOT_JUDGED_MAX)
  };
}
var sentSummaryKey = (c) => `sentSummary:${c.worktreeId}:${c.sessionId}:${c.agentId}`;
function readSent(meta, consumer) {
  return meta.get(sentSummaryKey(consumer));
}
function writeSent(meta, consumer, signature) {
  if (signature === null) meta.delete(sentSummaryKey(consumer));
  else meta.set(sentSummaryKey(consumer), signature);
}
function standing2(store, consumer, { threshold, maxFileBytes }, since, failing) {
  const { worktreeId } = consumer;
  const measures = ["complexity", ...coverageMeasures(store, worktreeId)];
  const over = toldOver(store, worktreeId, [consumer], measures, failing);
  const changed = changedNotJudged(store, worktreeId, since === null ? [] : [since]);
  if (over.length === 0 && changed.length === 0) return null;
  const told = over.length === 0 ? null : toldOf2(over, threshold);
  const files2 = changed.map(({ file, failure: failure2 }) => [
    file.path,
    failure2 === null ? `over ${maxFileBytes}` : "could not count"
  ]).sort(([a], [b]) => compare(a, b));
  return {
    part: {
      ...told === null ? {} : { toldOver: told },
      ...changed.length === 0 ? {} : { notJudged: notJudgedOf(changed, maxFileBytes) }
    },
    signature: JSON.stringify({ told, files: files2 })
  };
}
function summaryChanged(store, consumer, policy, since, failing) {
  const now = standing2(store, consumer, policy, since, failing);
  return readSent(store.meta, consumer) !== (now?.signature ?? null);
}
function withToldOver(store, consumer, news, policy, since, failing) {
  const now = standing2(store, consumer, policy, since, failing);
  const sent = readSent(store.meta, consumer);
  if (sent === (now?.signature ?? null)) return news;
  writeSent(store.meta, consumer, now?.signature ?? null);
  return now === null ? news : { ...news ?? { v: 1, entries: [], more: 0 }, ...now.part };
}

// src/core/delivery/code-untested.ts
var SAYS_WHY = /* @__PURE__ */ new Set([
  "first-seen-fail",
  "pass-to-fail",
  "edited",
  "edited-after-fail"
]);
var saysWhy = (e) => SAYS_WHY.has(e.kind) && (e.measure === "uncovered" || e.measure === "crap" && e.evidence?.testFiles === 0);
var excludeToldKey = (c) => `excludeTold:${c.worktreeId}:${c.sessionId}:${c.agentId}`;
function noneRan(store, consumer, path) {
  const evidence = readEvidence(store.meta, consumer.worktreeId, path);
  const functions = Object.values(evidence?.functions ?? {});
  return functions.length > 0 && functions.every(([, , testFiles2]) => testFiles2 === 0);
}
function crapOf(store, consumer, entry2) {
  const key = functionKey(entry2.check);
  const state = store.states.list(consumer.worktreeId, { paths: [entry2.check.path], measure: "crap" }).find((s) => functionKey(s.check) === key);
  return (state?.outcome === "pass" || state?.outcome === "fail") && state.value !== null ? state.value : void 0;
}
function withUntested(store, consumer, news, loaders) {
  if (news === null || loaders === void 0 || !news.entries.some(saysWhy)) return news;
  const count2 = loaders();
  const files2 = /* @__PURE__ */ new Map();
  const fileOf3 = (path) => {
    const known = files2.get(path);
    if (known !== void 0) return known;
    const n = count2(path);
    const facts = n > 0 && noneRan(store, consumer, path) ? { count: n, processes: true } : { count: n };
    files2.set(path, facts);
    return facts;
  };
  const entries = news.entries.map((e) => {
    if (!saysWhy(e)) return e;
    const fileLoaders = fileOf3(e.check.path);
    const own = e.measure === "uncovered" && e.evidence !== void 0;
    const crap = own ? crapOf(store, consumer, e) : void 0;
    return {
      ...e,
      fileLoaders,
      ...e.evidence === void 0 || crap === void 0 ? {} : { evidence: { ...e.evidence, crap } }
    };
  });
  const processes = entries.some(
    (e) => e.measure === "uncovered" && e.fileLoaders?.processes === true
  );
  const hint = processes && !toldBefore(store, excludeToldKey(consumer));
  return { ...news, entries, ...hint ? { excludeHint: true } : {} };
}
function toldBefore(store, key) {
  if (store.meta.get(key) !== null) return true;
  store.meta.set(key, JSON.stringify(true));
  return false;
}

// src/core/delivery/code-deliver.ts
var MEASURE = "complexity";
var consumerKey = (kind, c) => `${kind}:${c.worktreeId}:${c.sessionId}:${c.agentId}`;
var seededKey = (consumer) => consumerKey("seeded", consumer);
var tooBigToldKey = (consumer) => consumerKey("tooBigTold", consumer);
var recountKey = (worktreeId) => `recount:${worktreeId}`;
function readJson(store, key) {
  const raw = store.meta.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeJson(store, key, value) {
  store.meta.set(key, JSON.stringify(value));
}
var REASONS = ["first", "threshold", "include", "counter"];
function readRecount(store, worktreeId) {
  const value = readJson(store, recountKey(worktreeId));
  if (!isRecord(value)) return null;
  const { revision, at, reason, threshold } = value;
  if (typeof revision !== "number" || typeof at !== "number" || typeof threshold !== "number") {
    return null;
  }
  const known = REASONS.find((r) => r === reason);
  return known === void 0 ? null : { revision, at, reason: known, threshold };
}
function isTooBig(file) {
  return file.tooBig === true;
}
function countingOf(store, worktreeId) {
  const files2 = store.files.list(worktreeId).filter((f) => !isTooBig(f));
  const spent = uncountableFiles(store, worktreeId, files2);
  const pending = store.files.uncounted(worktreeId).filter((f) => !spent.has(f.path)).length;
  const total = files2.length - spent.size;
  return { done: total - pending, total, uncountable: spent.size };
}
function lastTransition(store, worktreeId, check, measure2 = MEASURE) {
  return store.transitions.history(worktreeId, check).findLast((t) => t.measure === measure2) ?? null;
}
function seed(store, consumer, reads, at) {
  store.views.clear(consumer);
  const covered = coverageMeasures(store, consumer.worktreeId);
  store.views.writeMany(
    consumer,
    reads.failing([MEASURE, ...covered]).map((s) => seedEntry(s, at))
  );
  writeJson(store, seededKey(consumer), at);
}
function registerCode(source, consumer, at) {
  const { worktreeId } = consumer;
  const names3 = source?.notMeasured?.() ?? [];
  const notMeasured = names3.length === 0 ? {} : { notMeasured: names3 };
  const read4 = withCode2(
    source,
    ({ store, complexity }) => store.transaction(() => {
      const reads = codeReads(store, worktreeId);
      const recounted = Math.max(
        readRecount(store, worktreeId)?.at ?? 0,
        readCrapRecount(store.meta, worktreeId)?.at ?? 0
      );
      seed(store, consumer, reads, Math.max(at, recounted));
      const { done, total } = countingOf(store, worktreeId);
      const counted2 = readCursor2(store.meta, worktreeId) !== null;
      if (!counted2) awaitFirstCount(store.meta, worktreeId);
      const counting = counted2 && done === total ? {} : { counting: { done, total } };
      const over = reads.failing([MEASURE]).length;
      return { v: 1, threshold: complexity.threshold, over, ...counting, ...notMeasured };
    })
  );
  if (read4 !== "missing") return read4 ?? void 0;
  const threshold = source?.policy()?.threshold;
  return threshold === void 0 ? void 0 : { v: 1, threshold, over: 0, counting: { done: 0, total: 0 }, ...notMeasured };
}
function toldTooBig(store, consumer) {
  const value = readJson(store, tooBigToldKey(consumer));
  return new Set(Array.isArray(value) ? value.filter((p) => typeof p === "string") : []);
}
function newTooBig(store, consumer, since, limit, write2) {
  if (since === null) return [];
  const edits = readTooBigEdits(store.meta, consumer.worktreeId);
  const own = [...edits].flatMap(([path, revision]) => isOwn(since, revision) ? [path] : []);
  if (own.length === 0) return [];
  const told = toldTooBig(store, consumer);
  const files2 = store.files.list(consumer.worktreeId, own).filter((f) => isTooBig(f) && !told.has(f.path));
  if (files2.length === 0) return [];
  if (write2) writeJson(store, tooBigToldKey(consumer), [...told, ...files2.map((f) => f.path)]);
  return files2.map((f) => ({ path: f.path, size: f.size, limit }));
}
function lineOf2(store, worktreeId, check) {
  const [file] = store.files.list(worktreeId, [check.path]);
  if (file === void 0) return null;
  const count2 = store.counts.get(file.blob, file.language, file.counterVersion);
  const fn = count2?.functions.find(
    (f) => f.qualifiedName === check.qualifiedName && f.occurrence === check.occurrence
  );
  return fn?.range.startLine ?? null;
}
function statesFor(store, worktreeId, failing, view, measures = [MEASURE]) {
  const known = new Set(failing.map(codeKey));
  const paths = [...new Set(view.filter((v) => !known.has(codeKey(v))).map((v) => v.check.path))];
  if (paths.length === 0) return failing;
  const others = store.states.list(worktreeId, { paths }).filter((s) => measures.includes(s.measure) && s.outcome !== "fail");
  return [...failing, ...others];
}
function summaryNews(store, worktreeId, reads, seededAt) {
  const recount = readRecount(store, worktreeId);
  const crap = readCrapRecount(store.meta, worktreeId);
  const change2 = readCoverageChange(store.meta, worktreeId);
  const recounted = recount !== null && recount.at > seededAt;
  const crapRecounted = crap !== null && crap.at > seededAt;
  const changed = change2 !== null && change2.at > seededAt;
  if (!recounted && !crapRecounted && !changed) return null;
  const crapOver = () => reads.failing(["crap"]).length;
  return {
    news: {
      v: 1,
      entries: [],
      more: 0,
      ...recounted ? { recount: { ...recount, over: reads.failing([MEASURE]).length } } : {},
      // Row 015-40: a `crap.threshold` change, as D6's summary for complexity.
      ...crapRecounted ? { crapRecount: { ...crap, over: crapOver() } } : {},
      // Row 015-64: a coverage check switched off or files newly excluded (D1).
      ...changed ? { coverageChange: change2 } : {}
    },
    newest: Math.max(recount?.at ?? 0, crap?.at ?? 0, change2?.at ?? 0)
  };
}
function codeStep(store, consumer, { at, since, limit }, write2, reads) {
  const { worktreeId } = consumer;
  const seeded = readJson(store, seededKey(consumer));
  const seededAt = typeof seeded === "number" ? seeded : 0;
  const tooBig = newTooBig(store, consumer, since, limit, write2);
  const big = tooBig.length === 0 ? {} : { tooBig };
  const summary = summaryNews(store, worktreeId, reads, seededAt);
  if (summary !== null) {
    if (write2) seed(store, consumer, reads, Math.max(at, summary.newest));
    return { news: { ...summary.news, ...big }, writes: true };
  }
  const covered = coverageMeasures(store, worktreeId);
  const measures = [MEASURE, ...covered];
  const edits = new Map(reads.edits(measures).map((e) => [codeKey(e), e]));
  const view = store.views.list(consumer).filter((v) => measures.includes(v.measure));
  const judged2 = reads.failing(measures);
  const plan = planCodeDelta({
    view,
    states: statesFor(store, worktreeId, judged2, view, measures),
    last: (check, measure2) => lastTransition(store, worktreeId, check, measure2),
    edit: (check, measure2) => edits.get(codeKey({ check, measure: measure2 })) ?? null,
    seededAt,
    seenUpTo: since,
    toldAt: at,
    pulled: pulledReader(store.meta, worktreeId)
  });
  const listed2 = plan.entries.slice(0, CODE_LISTED_MAX);
  const more = plan.entries.slice(CODE_LISTED_MAX).filter((e) => !isStillFail(e.kind)).length;
  if (write2) {
    const full = new Set(listed2.map(codeKey));
    store.views.removeMany(consumer, plan.removals);
    store.views.writeMany(
      consumer,
      plan.writes.map((w) => full.has(codeKey(w)) ? w : { ...w, told: "count" })
    );
  }
  const writes = plan.removals.length + plan.writes.length + tooBig.length > 0;
  if (plan.entries.length === 0 && tooBig.length === 0) return { news: null, writes };
  const entries = listed2.map((e) => ({
    ...e,
    line: e.kind === "removed" ? null : lineOf2(store, worktreeId, e.check),
    ...evidenceOf(store, worktreeId, e)
  }));
  const coverage = plan.entries.some(isCoverage) ? { coverage: true } : {};
  return { news: { v: 1, entries, more, ...big, ...coverage }, writes };
}
function tellCode(source, consumer, at, since, { changes = true, toldOver: toldOver2 = false, loaders, holds: holds2 } = {}) {
  if (!changes && !toldOver2) return null;
  const told = withCode2(source, (access) => {
    const { store, complexity } = access;
    const { worktreeId } = consumer;
    const seen = since();
    const judged2 = (reads) => reads.failing([MEASURE, ...coverageMeasures(store, worktreeId)]);
    const over = (news, reads) => toldOver2 ? withToldOver(store, consumer, news, complexity, seen, reads && judged2(reads)) : news;
    const changed = (reads) => summaryChanged(store, consumer, complexity, seen, reads && judged2(reads));
    if (changes) {
      const input = { at, since: seen, limit: complexity.maxFileBytes };
      const first = store.read(() => {
        const reads = codeReads(store, worktreeId);
        if (codeStep(store, consumer, input, false, reads).writes) return "write";
        return toldOver2 && changed(reads) ? "summary" : "none";
      });
      if (first === "write") {
        return heldWrite(
          access,
          () => {
            const reads = codeReads(store, worktreeId);
            const step = codeStep(store, consumer, input, true, reads);
            return over(withUntested(store, consumer, step.news, loaders), reads);
          },
          holds2
        );
      }
      return first === "summary" ? heldWrite(access, () => over(null), holds2) : null;
    }
    return store.read(() => changed()) ? heldWrite(access, () => over(null), holds2) : null;
  });
  return told === "missing" ? null : told;
}

// src/core/delivery/code-since.ts
function seenUpTo(store, worktreeId, r) {
  if (r.scanned !== void 0) return { since: r.since, gaps: r.gaps };
  const scan = (at) => store.revisions.get(worktreeId, at + 1)?.trigger === "start" ? at + 1 : at;
  return { since: scan(r.since), gaps: r.gaps.map(([after, upTo]) => [after, scan(upTo)]) };
}
function codeSeenUpTo(store, consumer) {
  const r = registration(store, consumer);
  return r === null ? null : seenUpTo(store, consumer.worktreeId, r);
}

// src/core/delivery/commit-told.ts
function commitToldMetaKey(worktreeId) {
  return worktreeMetaKey("commitTold", worktreeId);
}
function toldId(store, worktreeId, line) {
  const report = readCommitReport(store.meta, worktreeId, line.commit);
  return report !== null && "updated" in report && report.updated === true ? `${line.commit}+` : line.commit;
}
function commitChanged(store, consumer, line) {
  return line !== void 0 && readSlot(store, commitToldMetaKey(consumer.worktreeId), consumer) !== toldId(store, consumer.worktreeId, line);
}
function tellCommit(store, consumer, line) {
  if (line === void 0) return;
  const id = toldId(store, consumer.worktreeId, line);
  writeSlot(store, commitToldMetaKey(consumer.worktreeId), consumer, id);
}
function commitNews(store, consumer) {
  const line = readCommitLine(store, consumer.worktreeId);
  if (!commitChanged(store, consumer, line)) return void 0;
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  if (root !== void 0 && groupTextsShown(readPolicy(root))) return line;
  tellCommit(store, consumer, line);
  return void 0;
}

// src/core/delivery/counts-owed.ts
function countsOwedMetaKey(worktreeId) {
  return worktreeMetaKey("countsOwed", worktreeId);
}
function oweCounts(store, consumer, header) {
  writeSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer, owed(header) ? true : null);
}
function forgetCounts(store, consumer) {
  writeSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer, null);
}
function owesCounts(store, consumer) {
  return readSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer) === true;
}
function payCounts(store, consumer, header) {
  if (owed(header) || !owesCounts(store, consumer)) return {};
  writeSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer, null);
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  const lookupOnly = root !== void 0 && readPolicy(root).baseline.onStart === "lookup-only";
  return { countsOwed: { lookupOnly } };
}
var owed = (header) => header.testFilesListed === false;

// src/core/delivery/delta.ts
function beforeFailing(history, state) {
  const last = history.at(-1);
  if (state.outcome !== "fail" || last?.to !== "fail" || !sameFingerprint(last.toFingerprint, state.fingerprint)) {
    return null;
  }
  const at = history.findLastIndex((t) => t.kind !== "fail-changed");
  const entered = history[at];
  if (entered?.from == null) return null;
  const passed = entered.from === "unknown" ? passBeforeUnknown(history, at) : null;
  return passed ?? { outcome: entered.from, fingerprint: entered.fromFingerprint };
}
function passBeforeUnknown(history, end) {
  for (let i = end - 1; i >= 0 && history[i]?.to === "unknown"; i--) {
    const from = history[i]?.from;
    if (from === "pass") return { outcome: "pass", fingerprint: null };
    if (from !== "unknown") return null;
  }
  return null;
}
var RANK3 = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-changed": 1,
  "to-unknown": 3,
  "fail-to-pass": 4,
  "fail-retired": 5
};
var rank = (e) => isBaselineEntry(e) ? 2 : RANK3[e.kind];
function isBaselineEntry(e) {
  return e.kind !== "fail-retired" && e.baseline === true;
}
function restrictPlan(plan, keep) {
  const entries = plan.entries.filter(keep);
  const ids = new Set(entries.map((e) => checkIdentity(e.check)));
  return {
    entries,
    writes: plan.writes.filter((w) => ids.has(checkIdentity(w.check))),
    removals: plan.removals.filter((c) => ids.has(checkIdentity(c)))
  };
}
function viewThroughMark(view, states, bornBefore, toldAt) {
  const told = new Set(view.map((v) => checkIdentity(v.check)));
  const passes = states.filter((s) => !told.has(checkIdentity(s.check)) && bornBefore(s)).map((s) => ({ check: s.check, outcome: "pass", fingerprint: null, toldAt }));
  return passes.length === 0 ? view : [...view, ...passes];
}
function toView2(state, toldAt) {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt };
}
function originNames(state, input) {
  const origin = state.origin;
  if (origin?.kind === "inherited") {
    const originRoot = input.rootOf(origin.worktreeId);
    return originRoot === null ? {} : { originRoot };
  }
  if (origin?.kind !== "imported") return {};
  const originSource = input.sourceOf?.(origin.importId) ?? null;
  return originSource === null ? {} : { originSource };
}
function planDelta(input) {
  const told = new Map(input.view.map((v) => [checkIdentity(v.check), v]));
  const entries = [];
  const writes = [];
  for (const state of input.states) {
    const id = checkIdentity(state.check);
    const before = told.get(id) ?? null;
    told.delete(id);
    const prior = (before === null || before.outcome === "unknown") && state.outcome === "fail" && input.history !== void 0 ? beforeFailing(input.history(state.check), state) : null;
    const from = before === null || prior?.outcome === "pass" ? prior : before;
    const kind = transitionKind(from, state);
    if (kind === "to-unknown" && from?.outcome === "pass" && input.ownEdit?.(state) === true) {
      continue;
    }
    if (before === null || kind !== null) writes.push(toView2(state, input.toldAt));
    if (kind === null) continue;
    const baseline = kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    entries.push({
      check: state.check,
      kind,
      from: from?.outcome ?? null,
      to: state.outcome,
      validity: state.validity,
      observedAt: state.observedAt ?? input.revision,
      origin: state.origin ?? { kind: "own" },
      ...originNames(state, input),
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

// src/core/delivery/own-count.ts
function ownCount(own) {
  const count2 = { files: own.files, owed: own.owed.length };
  return own.unknown === 0 ? count2 : { ...count2, unknown: own.unknown };
}
function readOwn(store, consumer, since, states) {
  const { worktreeId } = consumer;
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  if (revision <= since) return null;
  const gaps = registration(store, consumer)?.gaps ?? [];
  if (changedAfter(store, worktreeId, { since, gaps }, revision).changed.size === 0) return null;
  const none3 = { since, revision, files: 0, owed: [], unknown: 0, rekeyed: /* @__PURE__ */ new Set() };
  if (!isRefined(store, worktreeId, revision)) return { ...none3, refined: false };
  const rows = new Map(store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k]));
  const rekeyed = [];
  const owed2 = [];
  for (const [id, entry2] of readRekeyed(store, worktreeId)) {
    const row = rows.get(id);
    if (row === void 0 || row.key === null || entry2.last <= since) continue;
    rekeyed.push(row);
    if (entry2.open !== null)
      owed2.push({ file: row.testFile, from: Math.max(entry2.open, since + 1) });
  }
  return {
    since,
    revision,
    refined: true,
    files: rekeyed.length,
    owed: owed2,
    unknown: unknownFiles(rekeyed, states),
    rekeyed: new Set(rekeyed.map((k) => testFileId(k.testFile)))
  };
}
function carriesEditResult(notes, checks, header) {
  if (notes.sawEdit === void 0) return false;
  const pending = header.counts.pending > 0 || header.testFilesWithoutChecks.pending > 0 || header.runnerPartPending === true;
  return !pending && checks.some((check) => notes.rekeyed.has(testFileKeyOf(check)));
}
function unknownFiles(rekeyed, states) {
  const unknown = new Set(
    states.filter((s) => s.outcome === "unknown").map((s) => testFileKeyOf(s.check))
  );
  return rekeyed.filter((k) => unknown.has(testFileId(k.testFile))).length;
}

// src/core/delivery/edits.ts
function editsMetaKey(worktreeId) {
  return worktreeMetaKey("edits", worktreeId);
}
function readState(store, consumer) {
  const value = readSlot(store, editsMetaKey(consumer.worktreeId), consumer);
  if (!isRecord(value) || typeof value.since !== "number") return null;
  return { since: value.since, said: value.said === true };
}
function writeState(store, consumer, state) {
  writeSlot(store, editsMetaKey(consumer.worktreeId), consumer, state);
}
function startEdits(store, consumer, revision, said) {
  writeState(store, consumer, { since: revision, said });
}
function editsToPark(store, consumer) {
  const state = readState(store, consumer);
  return { said: state?.said === true, editsSince: state?.since ?? null };
}
function forgetEdits(store, consumer) {
  writeState(store, consumer, null);
  forgetLate(store, consumer);
  prune2(store, consumer.worktreeId);
}
function prune2(store, worktreeId) {
  const sinces = Object.values(readAll(store, editsMetaKey(worktreeId))).flatMap(
    (v) => isRecord(v) && typeof v.since === "number" ? [v.since] : []
  );
  sinces.push(...parkedEditsSinces(store, worktreeId));
  pruneRekeyed(
    store,
    worktreeId,
    sinces.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...sinces)
  );
}
function editNotes(store, consumer, states, delivering, { countOnly = false, boundary = null } = {}) {
  const state = readState(store, consumer);
  if (state === null || unread(state, delivering, { countOnly, boundary })) return null;
  const own = readOwn(store, consumer, state.since, states);
  if (own === null) return null;
  const { lateness, lateOpen } = lateOf3(store, consumer, own, boundary);
  const counted2 = own.refined && own.files > 0;
  const sawEdit = state.said || countOnly || !counted2 ? void 0 : { queued: own.files };
  const late = lateParts(lateness);
  const said = sawEdit !== void 0 || Object.keys(late).length > 0;
  if (!said && !(delivering && counted2)) return null;
  const read4 = { state, own, counted: counted2, sawEdit, lateness, lateOpen };
  return {
    ...sawEdit === void 0 ? {} : { sawEdit },
    ...counted2 ? { own: ownCount(own) } : {},
    ...late,
    rekeyed: own.rekeyed,
    tell: (told) => recordNotes(store, consumer, read4, told)
  };
}
function unread(state, delivering, { countOnly, boundary }) {
  return (state.said || countOnly === true) && !delivering && (boundary ?? null) === null;
}
function recordNotes(store, consumer, { state, own, counted: counted2, sawEdit, lateness, lateOpen }, { shown, failed: failed2 }) {
  if (!failed2) lateness?.tell();
  const ended = !lateOpen || lateness?.caughtUp !== void 0 || failed2;
  const move = counted2 && own.owed.length === 0 && shown && ended;
  if (!move && sawEdit === void 0) return;
  writeState(store, consumer, {
    since: move ? own.revision : state.since,
    said: state.said || sawEdit !== void 0
  });
  if (move) prune2(store, consumer.worktreeId);
}
function editTold(notes, entries, alone) {
  const failed2 = entries.some((e) => e.kind !== "fail-retired" && e.to === "fail");
  const late = failed2 ? void 0 : notes?.late;
  const caughtUp = failed2 ? void 0 : notes?.caughtUp;
  return {
    failed: failed2,
    speaks: alone && notes?.sawEdit !== void 0 || late !== void 0 || caughtUp !== void 0,
    parts: (sawEdit) => ({
      ...sawEdit === void 0 ? {} : { sawEdit },
      ...notes?.own === void 0 ? {} : { ownEdits: notes.own },
      ...late === void 0 ? {} : { editsLate: late },
      ...caughtUp === void 0 ? {} : { caughtUp }
    })
  };
}
function tellEdits(store, consumer, notes, told) {
  notes?.tell(told);
  if (told.failed) endLate(store, consumer);
}
function lateOf3(store, consumer, own, boundary) {
  if (boundary === null) return { lateness: null, lateOpen: lateIsOpen(store, consumer) };
  const lateness = lateNotes(store, consumer, own, boundary.at, boundary.header);
  return { lateness, lateOpen: lateness?.open ?? false };
}
function lateParts(lateness) {
  if (lateness === null) return {};
  return {
    ...lateness.late === void 0 ? {} : { late: lateness.late },
    ...lateness.caughtUp === void 0 ? {} : { caughtUp: lateness.caughtUp }
  };
}

// src/core/waiter-lock/waiter-lock.ts
import { DatabaseSync as DatabaseSync8 } from "node:sqlite";

// src/core/delivery/consumer-version.ts
function versionMetaKey(worktreeId) {
  return worktreeMetaKey("consumerVersion", worktreeId);
}
function recordVersion(store, consumer, version) {
  writeSlot(store, versionMetaKey(consumer.worktreeId), consumer, version);
}
function otherSessionVersions(store, consumer) {
  const recorded = readAll(store, versionMetaKey(consumer.worktreeId));
  return store.consumers.list(consumer.worktreeId).filter((r) => r.consumer.sessionId !== consumer.sessionId).map((r) => {
    const version = recorded[slot(r.consumer)];
    return typeof version === "string" ? version : null;
  });
}

// src/core/delivery/hold-told.ts
function holdToldMetaKey(worktreeId) {
  return worktreeMetaKey("holdTold", worktreeId);
}
function endedOf(hold) {
  return hold.cause === "merge" ? { cause: "merge" } : { cause: "command", command: hold.command, pid: hold.pid };
}
function isEnded(value) {
  if (!isRecord(value)) return false;
  if (value.cause === "merge") return true;
  const pid = value.pid;
  return value.cause === "command" && typeof value.command === "string" && (pid === void 0 || pid === null || typeof pid === "number");
}
function toldHolds(store, consumer) {
  const value = readSlot(store, holdToldMetaKey(consumer.worktreeId), consumer);
  if (!Array.isArray(value)) return [];
  return value.flatMap(
    (v) => isRecord(v) && typeof v.id === "string" && isEnded(v.ended) ? [{ id: v.id, ended: v.ended }] : []
  );
}
function heldNow(store, worktreeId, at) {
  const worktree = store.worktrees.get(worktreeId);
  return readKeyedHolds(store, worktree, worktreeLiveness(worktree, at), at);
}
function tellHolds(store, consumer, holds2) {
  const told = (holds2 ?? []).map(({ id, hold }) => ({ id, ended: endedOf(hold) }));
  writeSlot(store, holdToldMetaKey(consumer.worktreeId), consumer, told.length === 0 ? null : told);
}
function holdsChange(store, consumer, at) {
  const worktree = store.worktrees.get(consumer.worktreeId);
  const live = worktreeLiveness(worktree, at);
  if (live.state !== "alive") return null;
  const now = readKeyedHolds(store, worktree, live, at);
  const before = toldHolds(store, consumer);
  const ids = new Set(now.map((k) => k.id));
  const told = new Set(before.map((t) => t.id));
  const ended = before.filter((t) => !ids.has(t.id)).map((t) => t.ended);
  const started = now.filter((k) => !told.has(k.id)).map((k) => k.hold);
  return ended.length === 0 && started.length === 0 ? null : { now, ended, started };
}
function holdChanges(change2, header) {
  const holds2 = change2.now.map((k) => k.hold);
  const last = holds2.length === 0 ? change2.ended.length - 1 : -1;
  const ends = change2.ended.map(
    (ended, i) => i === last ? {
      kind: "resumed",
      ended,
      queued: header.testFilesByPhase?.queued ?? 0,
      running: header.testFilesByPhase?.running ?? 0
    } : { kind: "ended", ended, holds: holds2 }
  );
  return [...ends, ...change2.started.map((hold) => ({ kind: "on-hold", hold }))];
}

// src/core/delivery/leaving.ts
function leavingMetaKey(worktreeId) {
  return worktreeMetaKey("leaving", worktreeId);
}
function markLeaving(store, consumer, at) {
  const key = leavingMetaKey(consumer.worktreeId);
  if (at === null && readSlot(store, key, consumer) === void 0) return;
  writeSlot(store, key, consumer, at === null ? null : { at });
}

// src/core/presence/events.ts
function spawnedAfterRest(store, worktreeId, at) {
  const rest = readRest(store, worktreeId);
  if (rest === null || rest.spawnedAt !== void 0) return;
  store.meta.set(daemonRestMetaKey(worktreeId), JSON.stringify({ ...rest, spawnedAt: at }));
}
function forgetRest(store, worktreeId) {
  store.meta.delete(daemonRestMetaKey(worktreeId));
}
function markStopped(store, worktreeId, at, tree, untilStart = false) {
  const until = untilStart || readStop(store, worktreeId)?.untilStart === true;
  const mark = { at, tree, ...until ? { untilStart: true } : {} };
  store.meta.set(stoppedMetaKey(worktreeId), JSON.stringify(mark));
  return until;
}
function clearStopped(store, worktreeId) {
  store.meta.delete(stoppedMetaKey(worktreeId));
}
function claimHandoff(store, worktreeId, claim) {
  return store.transaction(() => {
    if (liveHandoff(store, worktreeId, claim.from, claim.at) !== null) return null;
    const written2 = { ...claim, boundAt: claim.at + HANDOFF_BOUND_MS };
    store.meta.set(handoffMetaKey(worktreeId), JSON.stringify(written2));
    return written2;
  });
}

// src/core/delivery/liveness.ts
function readLiveHeader(store, worktreeId, now, { commonDir, states, since = null, keys }) {
  const worktree = store.worktrees.get(worktreeId);
  const presence = readPresence(store, worktreeId, now, worktree, commonDir);
  const runs = openRuns(store, worktree, presence.heartbeat);
  const open2 = new Set(runs.flatMap((run2) => run2.testFiles.map(testFileId)));
  const header = readHeader(store, worktreeId, states, keys, void 0, open2);
  const changes = changedSince2(store, worktreeId, header.revision, since);
  const installed2 = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path)
  );
  const ignored = [...changes.values()].filter((c) => c.ignored === true).map((c) => c.path);
  const holds2 = readHolds(store, worktree, presence.heartbeat, now);
  return {
    ...header,
    ...holds2.length === 0 ? {} : { holds: holds2 },
    daemon: headerView(presence),
    changedPaths: [...changes.keys()],
    ...ignored.length === 0 ? {} : { ignoredPaths: ignored },
    ...installed2 === void 0 ? {} : { installedLockfile: installed2.path }
  };
}
function changedSince2(store, worktreeId, revision, since) {
  const after = since === null || since >= revision ? revision - 1 : Math.max(since, 0);
  const changes = /* @__PURE__ */ new Map();
  for (const r of store.revisions.range(worktreeId, after, revision)) {
    for (const change2 of r.changes) changes.set(change2.path, change2);
  }
  return changes;
}
function livenessMetaKey(worktreeId) {
  return worktreeMetaKey("livenessTold", worktreeId);
}
function toldLiveness(store, consumer) {
  return readTold(readSlot(store, livenessMetaKey(consumer.worktreeId), consumer));
}
function tellLiveness(store, consumer, told) {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, told);
}
function withTold(header, told, at) {
  return header.daemon === void 0 ? header : { ...header, daemon: withToldStart(header.daemon, told, at) };
}
function livenessChange(store, consumer, at, commonDir) {
  const presence = readPresence(store, consumer.worktreeId, at, void 0, commonDir);
  const { change: change2, forgetRest: overdue } = newsChange(presence, toldLiveness(store, consumer));
  if (overdue) forgetRest(store, consumer.worktreeId);
  return change2;
}
function revisionMetaKey(worktreeId) {
  return worktreeMetaKey("revisionTold", worktreeId);
}
function toldRevision(store, consumer) {
  const told = readSlot(store, revisionMetaKey(consumer.worktreeId), consumer);
  return typeof told === "number" ? told : null;
}
function tellRevision(store, consumer, revision) {
  writeSlot(store, revisionMetaKey(consumer.worktreeId), consumer, revision);
}

// src/core/store/state-born.ts
var TRIGGERS2 = {
  squeal_born_known_states_insert: `AFTER INSERT ON known_states BEGIN
    INSERT INTO state_born (worktree_id, check_id) SELECT NEW.worktree_id, NEW.check_id
      WHERE NOT EXISTS (SELECT 1 FROM state_born
        WHERE worktree_id = NEW.worktree_id AND check_id = NEW.check_id)
      ON CONFLICT DO NOTHING;
  END`,
  squeal_born_known_states_delete: `AFTER DELETE ON known_states BEGIN
    DELETE FROM state_born WHERE worktree_id = OLD.worktree_id AND check_id = OLD.check_id;
  END`
};
function connectionIn(store) {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}
function armed(conn) {
  const names3 = new Set(
    conn.all(
      `SELECT name FROM sqlite_master WHERE (type = 'table' AND name = 'state_born')
           OR (type = 'trigger' AND name LIKE 'squeal_born_%')`
    ).map((row) => String(row.name))
  );
  return names3.has("state_born") && Object.keys(TRIGGERS2).every((name2) => names3.has(name2));
}
function currentBirthMark(store) {
  const conn = connectionIn(store);
  if (conn === null || !armed(conn)) return null;
  const row = conn.get("SELECT seq FROM sqlite_sequence WHERE name = 'state_born'");
  return row === null ? 0 : num(row, "seq");
}

// src/core/delivery/view-mark.ts
function viewMarkMetaKey(worktreeId) {
  return worktreeMetaKey("viewMark", worktreeId);
}
function viewMarkOf(store, consumer) {
  const value = readSlot(store, viewMarkMetaKey(consumer.worktreeId), consumer);
  if (!isRecord(value) || typeof value.mark !== "number" || typeof value.at !== "number") {
    return null;
  }
  return { mark: value.mark, at: value.at };
}
function registrationSeed(store, seed2) {
  return underMark(store, seed2);
}
function underMark(store, rows) {
  const mark = currentBirthMark(store);
  if (mark === null) return { rows, mark: null };
  return { rows: rows.filter((row) => row.outcome !== "pass"), mark };
}
function markedWrites(store, consumer, {
  view,
  at,
  restricted
}, { writes }) {
  if (restricted) return writes;
  const held = new Set(view.map((v) => checkIdentity(v.check)));
  const untold = writes.filter((w) => !held.has(checkIdentity(w.check)));
  const { rows, mark } = underMark(store, untold);
  if (mark === null || rows.length === untold.length) return writes;
  recordViewMark(store, consumer, { mark, at });
  const seeded = new Set(rows);
  return writes.filter((w) => held.has(checkIdentity(w.check)) || seeded.has(w));
}
function recordViewMark(store, consumer, mark) {
  const key = viewMarkMetaKey(consumer.worktreeId);
  if (mark === null && readSlot(store, key, consumer) === void 0) return;
  writeSlot(store, key, consumer, mark);
}
function trustedMark(store, consumer) {
  const mark = viewMarkOf(store, consumer);
  return mark === null || currentBirthMark(store) === null ? null : mark;
}
function markedView(store, consumer, view, states) {
  const mark = trustedMark(store, consumer);
  if (mark === null) return view;
  const after = checksBornAfter(store, consumer.worktreeId, mark.mark);
  return viewThroughMark(view, states, (s) => !after.has(checkIdentity(s.check)), mark.at);
}
function untoldStates(store, consumer) {
  const mark = trustedMark(store, consumer);
  if (mark === null) return store.knownStates.untold(consumer);
  return untoldBornAfter(store, consumer, mark.mark);
}

// src/core/delivery/turn.ts
function turnMetaKey(worktreeId) {
  return worktreeMetaKey("turn", worktreeId);
}
var START_IDLE = { turn: "idle", testFiles: [], newTestFiles: false };
var IN_TURN = { turn: "in-turn" };
function parse4(value) {
  if (!isRecord(value)) return START_IDLE;
  if (value.turn === "in-turn") return IN_TURN;
  const files2 = Array.isArray(value.testFiles) ? value.testFiles : [];
  const keys = isRecord(value.keys) ? Object.entries(value.keys).filter(
    (e) => typeof e[1] === "string" || e[1] === null
  ) : null;
  return {
    turn: "idle",
    testFiles: files2.filter((f) => typeof f === "string"),
    newTestFiles: value.newTestFiles === true,
    ...keys === null ? {} : { keys: Object.fromEntries(keys) },
    ...typeof value.revision === "number" ? { revision: value.revision } : {},
    ...withHandoff(value.handoff)
  };
}
function withHandoff(value) {
  return isRecord(value) && typeof value.at === "number" ? { handoff: { at: value.at } } : {};
}
function readTurn(store, consumer) {
  return parse4(readSlot(store, turnMetaKey(consumer.worktreeId), consumer));
}
function writeTurn(store, consumer, state) {
  const stopHolds2 = state === null ? 0 : readStopHolds(store, consumer);
  const value = stopHolds2 === 0 ? state : { ...state, stopHolds: stopHolds2 };
  writeSlot(store, turnMetaKey(consumer.worktreeId), consumer, value);
}
function readStopHolds(store, consumer) {
  const value = readSlot(store, turnMetaKey(consumer.worktreeId), consumer);
  const holds2 = isRecord(value) ? value.stopHolds : void 0;
  return typeof holds2 === "number" && Number.isInteger(holds2) && holds2 > 0 ? holds2 : 0;
}
function promptTurn(store, consumer) {
  if (readStopHolds(store, consumer) === 0) return;
  store.transaction(() => {
    if (readStopHolds(store, consumer) === 0) return;
    writeSlot(store, turnMetaKey(consumer.worktreeId), consumer, readTurn(store, consumer));
  });
}
function startTurn(store, consumer) {
  writeTurn(store, consumer, IN_TURN);
}
function currentKeys(keys) {
  return new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
}
function endTurn(store, consumer, states, undelivered, handoffAt = null) {
  const keys = store.testFileKeys.list(consumer.worktreeId);
  const files2 = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") files2.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.key !== null && k.pending !== null) files2.add(testFileId(k.testFile));
  for (const e of undelivered) files2.add(testFileKeyOf(e.check));
  const header = readHeader(store, consumer.worktreeId, states, keys);
  const current2 = currentKeys(keys);
  const testFiles2 = [...files2].sort();
  const owed2 = Object.fromEntries(testFiles2.map((f) => [f, current2.get(f) ?? null]));
  const newTestFiles = header.runnerPartPending === true;
  const { revision } = header;
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles: testFiles2,
    newTestFiles,
    keys: owed2,
    revision,
    ...handoffAt === null ? {} : { handoff: { at: handoffAt } }
  });
}
function atKey(state, file, keys) {
  const recorded = state.keys?.[file];
  return recorded === void 0 || keys.get(file) === recorded;
}
function owedScope(store, consumer) {
  const state = readTurn(store, consumer);
  if (state.turn !== "idle" || state.testFiles.length === 0 && !state.newTestFiles) {
    return "nothing";
  }
  const files2 = state.testFiles.map(fromTestFileId);
  const owed2 = files2.length === 0 ? [] : store.knownStates.list(consumer.worktreeId, files2);
  const untold = state.newTestFiles ? untoldStates(store, consumer) : [];
  const seen = new Set(owed2.map((s) => checkIdentity(s.check)));
  return {
    states: [...owed2, ...untold.filter((s) => !seen.has(checkIdentity(s.check)))],
    view: files2.length === 0 ? [] : store.views.list(consumer, files2),
    keys: files2.length === 0 ? [] : store.testFileKeys.list(consumer.worktreeId, files2)
  };
}
function fromTestFileId(id) {
  const at = id.indexOf("\0");
  return { project: id.slice(0, at), path: id.slice(at + 1) };
}
function waitedFor2(state, entry2, keys) {
  if (state.turn !== "idle") return false;
  const file = testFileKeyOf(entry2.check);
  if (state.testFiles.includes(file)) return atKey(state, file, keys);
  return state.newTestFiles && entry2.kind !== "fail-retired" && entry2.from === null && (state.revision === void 0 || entry2.observedAt <= state.revision);
}
function trimmed(state, states, keys) {
  if (state.turn !== "idle" || state.testFiles.length === 0) return null;
  const current2 = currentKeys(keys);
  const pending = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") pending.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.pending !== null) pending.add(testFileId(k.testFile));
  const owed2 = state.testFiles.filter((f) => pending.has(f) && atKey(state, f, current2));
  if (owed2.length === state.testFiles.length) return null;
  const { keys: recorded, ...rest } = state;
  const kept2 = Object.entries(recorded ?? {}).filter(([f]) => owed2.includes(f));
  return {
    ...rest,
    testFiles: owed2,
    ...recorded === void 0 ? {} : { keys: Object.fromEntries(kept2) }
  };
}

// src/core/delivery/uncovered.ts
function uncoveredMetaKey(worktreeId) {
  return worktreeMetaKey("uncoveredTold", worktreeId);
}
function uncoveredTold(store, consumer) {
  const value = readSlot(store, uncoveredMetaKey(consumer.worktreeId), consumer);
  return Array.isArray(value) ? value.filter((p) => typeof p === "string") : [];
}
function recordUncoveredTold(store, consumer, told) {
  const key = uncoveredMetaKey(consumer.worktreeId);
  if (told.length > 0) writeSlot(store, key, consumer, told);
  else if (readSlot(store, key, consumer) !== void 0) writeSlot(store, key, consumer, null);
}

// src/core/delivery/expiry.ts
function drop(store, consumer, at) {
  park(store, consumer, at, {
    ...editsToPark(store, consumer),
    uncovered: uncoveredTold(store, consumer)
  });
  store.consumers.unregister(consumer);
  forget(store, consumer);
  store.meta.set(departedMetaKey(consumer.worktreeId), String(at));
}
function departedMetaKey(worktreeId) {
  return worktreeMetaKey("departed", worktreeId);
}
function forget(store, consumer) {
  tellLiveness(store, consumer, null);
  tellRevision(store, consumer, null);
  tellSlowTier(store, consumer, void 0);
  forgetCounts(store, consumer);
  tellHolds(store, consumer, null);
  writeTurn(store, consumer, null);
  recordHarness(store, consumer, null);
  recordVersion(store, consumer, null);
  forgetEdits(store, consumer);
  recordUncoveredTold(store, consumer, []);
  markLeaving(store, consumer, null);
}

// src/core/delivery/own-edit.ts
var MOVED_ONLY = /^(?:[\w-]+: )?vitest adapter: the run may have executed bytes no check key names, since (?:(.+) changed on disk after this run loaded (?:it|them) \(task 001-146\)|\d+ files changed on disk after this run loaded them \(task 001-146\): .+; every path: (.+))$/;
function movedPaths(reason) {
  const match = MOVED_ONLY.exec(reason);
  const named2 = match?.[1] ?? match?.[2];
  return named2 === void 0 ? null : named2.split(", ");
}
function ownEditUnknown(store, consumer, revision) {
  let changed;
  const changes = () => {
    if (changed !== void 0) return changed;
    const from = registration(store, consumer);
    changed = from === null ? /* @__PURE__ */ new Set() : changedAfter(store, consumer.worktreeId, from, revision).changed;
    return changed;
  };
  return (state) => {
    if (state.outcome !== "unknown" || state.validity !== "pending" || state.summary === null) {
      return false;
    }
    const paths = movedPaths(state.summary);
    return paths?.every((p) => changes().has(p)) === true;
  };
}

// src/core/delivery/prepared.ts
var PreparedReports = class {
  #reports = [];
  add(report) {
    this.#reports.push(report);
  }
  /** Whether a report waits for its verdict. */
  get pending() {
    return this.#reports.some((report) => report.open);
  }
  /** Commits each in order; when one throws, abandons the rest and rethrows. */
  commit() {
    endInOrder(this.#take(), (report) => report.commit(), abandonAll);
  }
  /** Abandons each, the last first. Never throws: an abandon that fails leaves its rollback to SQLite. */
  abandon() {
    abandonAll(this.#take());
  }
  #take() {
    const reports = this.#reports;
    this.#reports = [];
    return reports;
  }
};
function endInOrder(items, end, undo) {
  for (const [i, item] of items.entries()) {
    try {
      end(item);
    } catch (error) {
      undo(items.slice(i + 1));
      throw error;
    }
  }
}
function abandonAll(reports) {
  for (const report of [...reports].reverse()) {
    try {
      report.abandon();
    } catch {
    }
  }
}
function commitHolds(holds2) {
  endInOrder(holds2, (held) => held.commit(), rollbackHolds);
}
function rollbackHolds(holds2) {
  for (const held of [...holds2].reverse()) {
    try {
      held.rollback();
    } catch {
    }
  }
}
var NO_HOLD = {
  code: void 0,
  settle(report, acknowledge) {
    acknowledge();
    return report;
  }
};
function startHold(prepare2) {
  if (prepare2 === void 0) return NO_HOLD;
  if (!prepare2.connection.db.isTransaction && !holdingAny()) prepare2.beforeHold?.();
  const held = prepare2.connection.hold();
  if (held === null && !prepare2.connection.held) return NO_HOLD;
  const code = [];
  let acknowledge = null;
  let ended = false;
  const abandon = () => {
    if (ended) return;
    ended = true;
    held?.rollback();
    rollbackHolds(code);
  };
  const commit = () => {
    if (ended) return;
    ended = true;
    const settled2 = acknowledge;
    try {
      held?.commit();
    } catch (error) {
      rollbackHolds(code);
      throw error;
    }
    if (settled2 === null) return rollbackHolds(code);
    commitHolds(code);
    settled2();
  };
  prepare2.reports.add({
    commit,
    abandon,
    get open() {
      return !ended;
    }
  });
  return {
    code,
    settle(report, then2) {
      acknowledge = then2;
      if (held !== null && report === null) commit();
      return report;
    }
  };
}

// src/core/delivery/registration-owed.ts
function registrationOwedMetaKey(worktreeId) {
  return worktreeMetaKey("registrationOwed", worktreeId);
}
function oweRegistration(store, consumer, owed2) {
  const key = registrationOwedMetaKey(consumer.worktreeId);
  if (owed2 === null && readSlot(store, key, consumer) === void 0) return;
  writeSlot(store, key, consumer, owed2 === null ? null : { primer: owed2.primer });
}
function owedRegistration(store, consumer) {
  if (store.consumers.get(consumer) === null) return null;
  const value = readSlot(store, registrationOwedMetaKey(consumer.worktreeId), consumer);
  return isRecord(value) && typeof value.primer === "boolean" ? { primer: value.primer } : null;
}

// src/core/delivery/register.ts
function registerNow(store, options, now, consumer, { inTurn = false, atStart = false, startingSince, owesText }) {
  return store.transaction(() => {
    const at = now();
    const registered = store.consumers.get(consumer) !== null;
    const toldView = registered ? store.views.list(consumer) : null;
    store.consumers.register(consumer, at);
    oweRegistration(store, consumer, owesText ?? null);
    forgetStopWait(store, consumer);
    markLeaving(store, consumer, null);
    const { states, seed: seed2 } = statesToSeed(store, consumer.worktreeId);
    if (toldView !== null && reportsNewFailure(toldView, states)) endLate(store, consumer);
    const { rows, mark } = registrationSeed(store, seed2);
    seedView(store, consumer, rows, at);
    recordViewMark(store, consumer, mark === null ? null : { mark, at });
    const told = startingSince === void 0 ? null : { startingSince };
    const read4 = readLiveHeader(store, consumer.worktreeId, at, {
      commonDir: options.commonDir,
      states
    });
    const live = told === null ? read4 : withTold(read4, told, at);
    const knownFailures = withRecorded(store, consumer.worktreeId, states, live.revision);
    const header = withDependencies(
      store,
      consumer.worktreeId,
      live,
      knownFailures.map((f) => f.check)
    );
    tellAtRegistration(store, consumer, header, told, at);
    if (!registered) seedRegistered(store, consumer, header, { at, atStart, root: options.root });
    if (inTurn) startTurn(store, consumer);
    else writeTurn(store, consumer, null);
    recordHarness(store, consumer, options.harnessProcess?.() ?? null);
    recordVersion(store, consumer, options.squealVersion ?? null);
    const code = registerCode(options.code, consumer, at);
    const lint2 = registerLint(options.lint, consumer, at);
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      consumer,
      header,
      // 011-18: a resumed session's failures name the closure paths changed since it started.
      knownFailures: withClosureChanges(store, consumer, knownFailures, header.revision),
      ...code === void 0 ? {} : { code },
      ...lint2 === void 0 ? {} : { lint: lint2 },
      // Row 011-275 (gh-120): the session's first notice names the keys a runtime here leaves out.
      ...ignoredConfigAt(store.worktrees.get(consumer.worktreeId), header.daemon)
    };
  });
}
function tellAtRegistration(store, consumer, header, told, at) {
  const starting = header.daemon?.state === "down" && header.daemon.startingSince !== void 0;
  const daemon = header.daemon === void 0 ? null : toldAtRegistration(header.daemon);
  const slow = header.daemon?.state === "down" && (header.daemon.startSlow === true || header.daemon.startStopped === true);
  tellLiveness(store, consumer, starting && !slow ? told : daemon);
  tellRevision(store, consumer, header.revision);
  tellSlowTier(store, consumer, header.slowTier);
  tellGroupTiers(store, consumer, header.groupTiers);
  tellCommit(store, consumer, header.commitLine);
  oweCounts(store, consumer, header);
  tellHolds(store, consumer, heldNow(store, consumer.worktreeId, at));
}
function seedRegistered(store, consumer, header, {
  at,
  atStart,
  root
}) {
  const alive = atStart && header.daemon?.state === "alive";
  const resumed = tellRegistered(store, consumer, header.revision, {
    at,
    scanned: scannedDaemon(store, consumer.worktreeId, alive),
    head: root === void 0 ? null : registrationHead(root)
  });
  startEdits(store, consumer, resumed?.editsSince ?? header.revision, resumed?.said === true);
  if (resumed !== null) recordUncoveredTold(store, consumer, resumed.uncovered);
}
function reportsNewFailure(view, states) {
  const failing = new Set(
    view.filter((v) => v.outcome === "fail").map((v) => checkIdentity(v.check))
  );
  return states.some((s) => s.outcome === "fail" && !failing.has(checkIdentity(s.check)));
}

// src/core/delivery/stop-news.ts
function actsAtStop(live) {
  if (live.stopping !== void 0) return live.stopping.overdue || live.stopping.to === void 0;
  return live.state === "down" || live.short !== void 0;
}
function holdActsAtStop(change2) {
  return change2.started.some((hold) => hold.cause === "merge");
}
function toldAtStop({ stop, transitions }, changes) {
  if (!stop || transitions) return changes;
  const { live, held } = changes;
  const acts = live !== null && actsAtStop(live) || held !== null && holdActsAtStop(held);
  return acts ? changes : { live: null, held: null };
}

// src/core/delivery/delivery.ts
var DEFAULT_POLL_INTERVAL_MS = 250;
var sameMarker = (a, b) => a.others === b.others && a.own === b.own;
var currentFailures = (states) => splitByValidity(states.filter((s) => s.outcome === "fail")).current.length;
function sideParts(code, lint2, states) {
  if (code === null && lint2 === null) return {};
  return {
    ...code === null ? {} : { code },
    ...lint2 === null ? {} : { lint: lint2 },
    knownFailures: currentFailures(states)
  };
}
function acknowledged(source, consumer, read4) {
  if (read4?.ack != null) acknowledgeLint(source, consumer, read4.ack);
}
function deliveryStates(store, consumer, idle) {
  const all = once(() => store.knownStates.list(consumer.worktreeId));
  const mark = idle ? null : trustedMark(store, consumer);
  return { states: mark === null ? all() : relevantStates(store, consumer, mark.mark), all };
}
var isEmpty = (plan) => plan.entries.length === 0 && plan.writes.length === 0 && plan.removals.length === 0;
function createDelivery(store, options) {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  function plan(consumer, states, toldAt, keep, view = store.views.list(consumer)) {
    const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
    const full = planDelta({
      // Row 005-106: a state with no entry born before the registration's mark was a told pass.
      view: markedView(store, consumer, view, states),
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
      sourceOf: importSourceOf(store),
      revision,
      history: (check) => store.transitions.history(consumer.worktreeId, check),
      ownEdit: ownEditUnknown(store, consumer, revision)
    });
    return keep === null ? full : restrictPlan(full, keep);
  }
  function deliver(consumer, {
    heardFrom,
    keep = null,
    liveness = false,
    idle = false,
    stop = false,
    atRevision,
    boundary = false
  }) {
    const select = (states, keys = null) => {
      if (!idle) return { only: keep, trim: null };
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle") return "silent";
      keys ??= store.testFileKeys.list(consumer.worktreeId);
      const current2 = currentKeys(keys);
      return {
        only: (entry2) => waitedFor2(turn, entry2, current2),
        trim: trimmed(turn, states, keys)
      };
    };
    if (!heardFrom) {
      if (store.consumers.get(consumer) === null) return null;
      const scope = idle ? owedScope(store, consumer) : null;
      if (scope === "nothing") return null;
      const states = scope?.states ?? store.knownStates.list(consumer.worktreeId);
      const selection = select(states, scope?.keys);
      if (selection === "silent") return null;
      const quiet = !liveness || livenessChange(store, consumer, now(), options.commonDir) === null && holdsChange(store, consumer, now()) === null;
      const empty = isEmpty(plan(consumer, states, now(), selection.only, scope?.view));
      if (quiet && empty && selection.trim === null) return null;
    }
    const lintRead = { read: null };
    const hold = startHold(options.prepare);
    const delta = store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (!atLatest(consumer, atRevision)) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      if (heardFrom && !stop) markLeaving(store, consumer, null);
      const at = now();
      const { states, all } = deliveryStates(store, consumer, idle);
      const selection = select(states);
      if (selection === "silent") return null;
      const view = store.views.list(consumer);
      const delta2 = plan(consumer, states, at, selection.only, view);
      store.views.removeMany(consumer, delta2.removals);
      store.views.writeMany(
        consumer,
        markedWrites(store, consumer, { view, at, restricted: selection.only !== null }, delta2)
      );
      const { live: changed, held: holds2 } = toldAtStop(
        { stop, transitions: delta2.entries.length > 0 },
        {
          live: liveness ? livenessChange(store, consumer, at, options.commonDir) : null,
          held: liveness ? holdsChange(store, consumer, at) : null
        }
      );
      if (changed !== null) tellLiveness(store, consumer, toldOf(changed));
      if (holds2 !== null) tellHolds(store, consumer, holds2.now);
      const tests2 = delta2.entries.length > 0 || changed !== null || holds2 !== null;
      const seen = () => codeSeenUpTo(store, consumer);
      lintRead.read = liveness ? readLintNews(options.lint, consumer, at, seen) : null;
      const lint2 = lintRead.read?.news ?? null;
      const changes = liveness && (tests2 || lint2 !== null || !stop);
      const code = tellCode(options.code, consumer, at, seen, {
        changes,
        toldOver: delta2.entries.length > 0,
        // Row 015-65: an `untested` line's loaders, read from the closures only when one is told.
        loaders: () => loaderCounts(store, consumer.worktreeId),
        holds: hold.code
      });
      const commit = liveness ? commitNews(store, consumer) : void 0;
      const news = tests2 || code !== null || lint2 !== null || commit !== void 0;
      const live = once(
        () => withTold(
          readLiveHeader(store, consumer.worktreeId, at, {
            commonDir: options.commonDir,
            states: all(),
            since: toldRevision(store, consumer)
          }),
          toldLiveness(store, consumer),
          at
        )
      );
      const notes = ownNotes(store, consumer, states, {
        liveness,
        idle,
        news,
        boundary: boundary ? { at, header: live } : null
      });
      const told = editTold(notes, delta2.entries, liveness && !stop);
      const delivered = news || told.speaks;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) {
        if (selection.trim !== null) writeTurn(store, consumer, selection.trim);
        return null;
      }
      if (idle) startTurn(store, consumer);
      tellRevision(store, consumer, live().revision);
      const { entries, header, stillFailing } = annotate(
        store,
        consumer,
        delta2.entries,
        live(),
        all()
      );
      const slowChanged = slowTierChanged(store, consumer, header.slowTier);
      if (stop || slowChanged) tellSlowTier(store, consumer, header.slowTier);
      const groupsChanged = changedGroups(store, consumer, header.groupTiers);
      if (stop || groupsChanged.length > 0) tellGroupTiers(store, consumer, header.groupTiers);
      if (commit !== void 0) tellCommit(store, consumer, commit);
      const countsOwed = payCounts(store, consumer, header);
      tellEdits(store, consumer, notes, {
        shown: showsOwnCount(header, stop ? "full" : "news", countsOwed),
        failed: told.failed
      });
      const sawEdit = notes === null || carriesEditResult(
        notes,
        entries.map((e) => e.check),
        header
      ) ? void 0 : notes.sawEdit;
      const label = delta2.entries.length > 0 && delta2.entries.every(isBaselineEntry) ? "baseline" : "transitions";
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        label,
        entries,
        stillFailing,
        ...changed === null ? {} : { liveness: changed },
        ...holds2 === null ? {} : { holds: holdChanges(holds2, header) },
        ...slowChanged ? { slowTierChanged: true } : {},
        ...groupsChanged.length > 0 ? { groupTiersChanged: groupsChanged } : {},
        ...commit === void 0 ? {} : { commitChanged: true },
        ...countsOwed,
        // Row 005-93 (c): the news header counts the consumer's own test files; row 005-97: late.
        ...told.parts(sawEdit),
        ...sideParts(code, lint2, states)
      };
    });
    return hold.settle(delta, () => acknowledged(options.lint, consumer, lintRead.read));
  }
  const quietAt = /* @__PURE__ */ new Map();
  function atLatest(consumer, atRevision) {
    if (atRevision === void 0) return true;
    return (store.revisions.latest(consumer.worktreeId)?.number ?? 0) === atRevision;
  }
  function deliverIdle(consumer) {
    const key = JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId]);
    const before = changeMarker(store);
    const last = quietAt.get(key);
    if (before !== null && last !== void 0 && sameMarker(before, last)) return null;
    const delta = deliver(consumer, { heardFrom: false, idle: true });
    quietAt.delete(key);
    if (delta !== null || before === null) return delta;
    const after = changeMarker(store);
    quietAt.set(key, after !== null && after.others === before.others ? after : before);
    return null;
  }
  const free = () => holdFree(options.prepare?.connection, HOOK_TIMEOUT_MS);
  const unit = (work) => {
    const freed = () => {
      const wait = free();
      return wait === null ? work() : wait.then(work);
    };
    if (options.prepare?.unit !== void 0) return options.prepare.unit(freed);
    try {
      return Promise.resolve(freed());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    register: (consumer, registerOptions = {}) => unit(() => registerNow(store, options, now, consumer, registerOptions)),
    registrationSent: (consumer) => unit(() => {
      const hold = startHold(options.prepare);
      store.transaction(() => oweRegistration(store, consumer, null));
      hold.settle(consumer, () => {
      });
    }),
    unregister: (consumer) => unit(() => store.transaction(() => drop(store, consumer, now()))),
    onToolBoundary: (consumer, { stop = false, atRevision } = {}) => unit(
      () => deliver(consumer, {
        heardFrom: true,
        liveness: true,
        stop,
        boundary: !stop,
        ...atRevision === void 0 ? {} : { atRevision }
      })
    ),
    peek: (consumer, { kinds }) => {
      const only = new Set(kinds);
      return unit(() => deliver(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) }));
    },
    startTurn: (consumer) => unit(() => {
      promptTurn(store, consumer);
      return deliver(consumer, { heardFrom: true, liveness: true });
    }),
    endTurn: (consumer, { atRevision, handoff = false } = {}) => unit(
      () => store.transaction(() => {
        if (store.consumers.get(consumer) === null) return true;
        if (!atLatest(consumer, atRevision)) return false;
        const states = store.knownStates.list(consumer.worktreeId);
        const at = now();
        endTurn(
          store,
          consumer,
          states,
          plan(consumer, states, at, null).entries,
          handoff ? at : null
        );
        return true;
      })
    ),
    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (; ; ) {
        if (signal?.aborted) return null;
        const delta = await unit(() => deliverIdle(consumer));
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
function ownNotes(store, consumer, states, {
  liveness,
  idle,
  news,
  boundary
}) {
  if (!liveness && !news) return null;
  return editNotes(store, consumer, states, news, { countOnly: !liveness && !idle, boundary });
}

// src/core/delivery/daemon-writer.ts
import { setTimeout as sleep2 } from "node:timers/promises";

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
var REQUEST_TIMEOUT_MS = 1e3;
var SMALL_REQUEST_TIMEOUT_MS = 250;
var LEASE_PAUSES_MS = [2, 5, 10, 20, 40, 50];
var STATUS_PAUSES_MS = [1, 2, 5, 10, 20, 25];
var DaemonWriter = class {
  #options;
  #socket;
  #token = null;
  #process;
  /** No daemon takes writes: every later call says so at once. */
  #off = false;
  constructor(options) {
    this.#options = options;
  }
  get leased() {
    return this.#token !== null;
  }
  /**
   * Takes the worktree's write lease; `false` when no daemon takes writes.
   * Another holder is waited for until the bound, then a busy error is
   * thrown, as SQLite's busy timeout throws one (`isBusy` reads it).
   */
  async acquire() {
    if (this.#token !== null) return true;
    const socket = this.#socketPath();
    if (socket === null) return false;
    const deadline = Date.now() + this.#options.boundMs;
    for (let attempt = 0; ; attempt++) {
      const { worktreeId, holder } = this.#options;
      this.#process ??= leaseProcess();
      const process2 = this.#process;
      const answer = await this.#ask(socket, { type: "lease", worktreeId, holder, process: process2 });
      if (!isLease(answer)) return this.#notTaken(false);
      if (answer.token !== null) {
        this.#token = answer.token;
        return true;
      }
      const pause = pauseOf(LEASE_PAUSES_MS, attempt);
      if (Date.now() + pause >= deadline) throw leaseBusy(answer.holder);
      await sleep2(pause);
    }
  }
  async send(batch, release2) {
    const socket = this.#socketPath();
    if (socket === null) return "not-taken";
    const token2 = this.#token;
    if (release2) this.#token = null;
    const request = {
      type: "write",
      worktreeId: this.#options.worktreeId,
      storeSchema: this.#options.storeSchema,
      token: token2,
      release: release2,
      batch: encodeBatch(batch)
    };
    const answer = await this.#ask(socket, request);
    if (!isWrite(answer)) return this.#notTaken("not-taken", socket, token2);
    const deadline = Date.now() + this.#options.boundMs;
    let state = answer;
    for (let attempt = 0; state.written === null; attempt++) {
      const pause = pauseOf(STATUS_PAUSES_MS, attempt);
      if (Date.now() + pause >= deadline) throw writeBusy();
      await sleep2(pause);
      const next = await requestDaemon(
        socket,
        { type: "write-status", requestId: answer.requestId },
        SMALL_REQUEST_TIMEOUT_MS
      );
      if (!isWrite(next)) throw new Error(`squeal: ${errorOf2(next)}`);
      state = next;
    }
    if (state.written) return "written";
    return this.#notTaken("not-taken", socket, release2 ? null : token2);
  }
  async release() {
    const token2 = this.#token;
    const socket = this.#socket;
    this.#token = null;
    if (token2 === null || socket === null || socket === void 0) return;
    const { worktreeId } = this.#options;
    await this.#ask(socket, { type: "release", worktreeId, token: token2 });
  }
  #socketPath() {
    if (this.#off) return null;
    if (this.#socket === void 0) this.#socket = this.#options.socketPath();
    return this.#socket;
  }
  /**
   * The daemon's answer; `null` when it took nothing: nothing listens
   * there, or, for any request but a write, it gave no answer (a hung
   * socket, or one that is not a daemon's): a lease or a release changes
   * no row, so the client writes the store itself. A write left unanswered
   * may have been taken, so it throws: never written twice.
   */
  async #ask(socket, request) {
    try {
      const timeout = request.type === "write" ? this.#timeout() : SMALL_REQUEST_TIMEOUT_MS;
      return await requestDaemon(socket, request, timeout);
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ESTALE") return null;
      if (request.type !== "write") return null;
      throw error;
    }
  }
  /**
   * No daemon takes this client's writes from now on. A lease it still
   * holds there (`token`) is ended first: its process lives on, and would
   * keep it (review 0.1.442 B3).
   */
  async #notTaken(answer, socket, token2) {
    this.#off = true;
    this.#token = null;
    if (socket !== void 0 && token2 !== void 0 && token2 !== null) {
      const { worktreeId } = this.#options;
      await this.#ask(socket, { type: "release", worktreeId, token: token2 }).catch(() => null);
    }
    return answer;
  }
  #timeout() {
    return this.#options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }
};
function isLease(answer) {
  if (answer === null || !answer.ok || answer.type !== "lease") return false;
  const { token: token2, holder } = answer;
  return (token2 === null || typeof token2 === "string") && holder !== void 0;
}
function isWrite(answer) {
  if (answer === null || !answer.ok || answer.type !== "write") return false;
  const { requestId, written: written2 } = answer;
  return typeof requestId === "string" && (written2 === null || typeof written2 === "boolean");
}
function pauseOf(pauses2, attempt) {
  return pauses2[Math.min(attempt, pauses2.length - 1)] ?? 0;
}
function errorOf2(response) {
  return response.ok ? `unexpected answer ${response.type}` : response.error;
}
function busy(message) {
  return Object.assign(new Error(`database is locked: ${message}`), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5
  });
}
function leaseBusy(holder) {
  const error = busy(`the worktree's write lease is held${holder === null ? "" : ` by ${holder}`}`);
  return Object.assign(error, { leaseHolder: holder });
}
function writeBusy() {
  return busy("the daemon has not written this batch yet");
}

// src/core/delivery/sent-store.ts
function openSentStore(commonDir, options) {
  const { worktreeId, boundMs, holder } = options;
  let opened = null;
  let made = null;
  let sender = null;
  const writer = options.writer ?? ((target) => new DaemonWriter({ ...target, holder }));
  const store = openStore(commonDir, {
    create: options.create ?? false,
    busyTimeoutMs: options.busyTimeoutMs,
    connection: (db) => {
      sender = writer({
        worktreeId,
        boundMs,
        storeSchema: Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0]),
        socketPath: () => opened?.worktrees.get(worktreeId)?.daemon?.socketPath ?? null
      });
      made = new SendingConnection(db, sender);
      return made;
    }
  });
  if (isStoreOpenFailure(store)) return store;
  opened = store;
  const connection = made;
  try {
    if (connection === null) throw new Error("squeal: the store opened without its connection");
    const record = store.worktrees.get(worktreeId)?.daemon ?? null;
    const now = (options.now ?? Date.now)();
    if (daemonLiveness(record, now).state !== "alive") connection.writeDirectly();
  } catch (error) {
    store.close();
    throw error;
  }
  const acquire = () => sender?.acquire() ?? Promise.resolve(false);
  return { store, connection, write: (work) => connection.unit(work, acquire) };
}

// src/core/status/open.ts
import { DatabaseSync as DatabaseSync9 } from "node:sqlite";
var STATUS_BUSY_TIMEOUT_MS = 1e3;
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/types/delivery.ts
var MAIN_AGENT = "main";

// src/harness/shared/context.ts
function locate(cwd) {
  const root = findWorktreeRoot(cwd);
  if (root === null) return null;
  const commonDir = resolveCommonDir(root);
  return commonDir === null ? null : { root, commonDir };
}
function usesSqueal(location2) {
  return existsSync10(storePaths(location2.commonDir).database) || existsSync10(join27(location2.root, "squeal.config.json"));
}
var NO_STATUS = {
  build() {
    throw new Error("a hook context builds no status; squeal status reads it (row 025-17)");
  }
};
function openContext(input, location2, options = {}) {
  const worktreeId = worktreeIdFor(location2.root);
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const file = storeFileOrNull(location2.commonDir);
  const faulted = (error) => {
    if (isCorruption(error)) markHookFault(location2.commonDir, file, String(error), now);
  };
  let opened;
  try {
    opened = open(location2, worktreeId, options, busyTimeoutMs, now);
  } catch (error) {
    faulted(error);
    throw error;
  }
  if (opened === "corrupt") markHookFault(location2.commonDir, file, OPEN_CORRUPT, now);
  if (opened === null || opened === "corrupt") return null;
  const { store, connection, write: write2 } = opened;
  try {
    const consumer = {
      worktreeId,
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT
    };
    const sent = () => connection?.sent() ?? Promise.resolve();
    const code = codeSource(location2.commonDir, location2.root, {
      busyTimeoutMs,
      holding: connection !== null
    });
    const prepare2 = connection === null ? void 0 : {
      connection,
      reports: new PreparedReports(),
      beforeHold: () => codeLockFree(code),
      unit: write2
    };
    const lint2 = lintStoreSource(location2.commonDir, location2.root, { busyTimeoutMs });
    const delivery = createDelivery(store, {
      status: NO_STATUS,
      now,
      ...options.pollIntervalMs === void 0 ? {} : { pollIntervalMs: options.pollIntervalMs },
      ...options.harnessProcess === void 0 ? {} : { harnessProcess: options.harnessProcess },
      ...options.squealVersion === void 0 ? {} : { squealVersion: options.squealVersion },
      code,
      lint: lint2,
      ...prepare2 === void 0 ? {} : { prepare: prepare2 },
      // Row 011-312: a registration records the commit `HEAD` names here.
      root: location2.root,
      // Row 005-108: a worktree with no row yet reads its daemon's start by this lock.
      commonDir: location2.commonDir
    });
    const close = () => store.close();
    const prepared = prepare2 === void 0 ? {} : { prepared: prepare2.reports };
    const parts = { write: write2, sent, faulted, close };
    return { ...location2, store, delivery, consumer, code, lint: lint2, ...prepared, ...parts };
  } catch (error) {
    store.close();
    throw error;
  }
}
function open(location2, worktreeId, options, busyTimeoutMs, now) {
  if (options.prepare !== true) {
    const store = openStore(location2.commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return store.reason === "corrupt" ? "corrupt" : null;
    const write2 = (work) => Promise.resolve().then(work);
    return { store, connection: null, write: write2 };
  }
  const sent = openSentStore(location2.commonDir, {
    worktreeId,
    busyTimeoutMs,
    boundMs: busyTimeoutMs,
    holder: `${process.pid} ${process.argv[1] ?? "hook"}`,
    now,
    ...options.writer === void 0 ? {} : { writer: options.writer }
  });
  if (!("reason" in sent)) return sent;
  return sent.reason === "corrupt" ? "corrupt" : null;
}

// src/harness/shared/harness-process.ts
var SKIPPED = /* @__PURE__ */ new Set([
  "run",
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
  const read4 = lookup.read ?? readProcStat;
  const namespace = (lookup.namespace ?? pidNamespace)();
  if (namespace === null) return null;
  let pid = lookup.ppid ?? process.ppid;
  try {
    for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
      const stat = read4(pid);
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

// src/harness/shared/hook.ts
async function withContext(input, location2, deps, fn, overrides = {}) {
  const options = {
    ...deps.now === void 0 ? {} : { now: deps.now },
    ...deps.pollIntervalMs === void 0 ? {} : { pollIntervalMs: deps.pollIntervalMs },
    harnessProcess: deps.harnessProcess ?? (() => findHarnessProcess()),
    squealVersion: deps.squealVersion ?? squealVersion(),
    prepare: true,
    ...deps.writer === void 0 ? {} : { writer: deps.writer },
    ...overrides
  };
  const context = openContext(input, location2, options);
  if (context === null) return null;
  let handed = false;
  try {
    const result = await (async () => fn(context))().catch((error) => {
      context.faulted?.(error);
      throw error;
    });
    if (deps.handOff !== void 0 && context.prepared?.pending === true) {
      deps.handOff.take(context.prepared, context.close, context.sent);
      handed = true;
    } else {
      context.prepared?.commit();
      await context.sent();
    }
    return result;
  } catch (error) {
    if (process.env.SQUEAL_DEBUG_CONTEXT) console.error("DEBUG withContext", error);
    context.prepared?.abandon();
    await context.sent().catch(() => {
    });
    throw error;
  } finally {
    if (!handed) context.close();
  }
}
function isRegistered(context) {
  return context.store.consumers.get(context.consumer) !== null;
}

// src/harness/shared/ensure.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/core/daemon/ensure.ts
import { spawn as spawn2 } from "node:child_process";
import { closeSync as closeSync2, existsSync as existsSync11, mkdirSync as mkdirSync9 } from "node:fs";

// src/core/node-pin.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync18, realpathSync as realpathSync5, statSync as statSync7 } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname as dirname10, isAbsolute as isAbsolute10, join as join28 } from "node:path";

// src/harness/opencode/host.ts
var floor;
function minimumNode() {
  floor ??= true ? "22.19" : manifestFloor();
  return floor;
}
function meetsMinimum(version) {
  const [major, minor] = version.trim().split(".").map(Number);
  if (major === void 0 || minor === void 0 || Number.isNaN(major) || Number.isNaN(minor))
    return false;
  const [leastMajor = 0, leastMinor = 0] = minimumNode().split(".").map(Number);
  return major > leastMajor || major === leastMajor && minor >= leastMinor;
}

// src/core/node-pin.ts
var PIN_FILES = [".node-version", ".nvmrc"];
var EXACT = /^v?(\d+\.\d+\.\d+)$/;
var PROBE_TIMEOUT_MS = 2e3;
var SELF = 'process.version + "\\n" + process.execPath';
function pinnedNode(root, env = process.env) {
  const wanted = readPin(root);
  if (nodeSetting(root) === "session") {
    return wanted === null ? { reason: "session" } : { reason: "session", wanted };
  }
  if (wanted === null) return { reason: "none" };
  const version = EXACT.exec(wanted)?.[1];
  if (version === void 0) return { reason: "range", wanted };
  if (!runsSqueal(version)) return { reason: "too-old", wanted };
  if (process.versions.node === version) return { binary: process.execPath, version };
  const binary = lookUp(version, root, env);
  return binary === null ? { reason: "missing", wanted } : { binary, version };
}
function lookUp(version, root, env) {
  try {
    return installed(version, env) ?? onPath(version, root, env);
  } catch {
    return null;
  }
}
function runsSqueal(version) {
  try {
    return meetsMinimum(version);
  } catch {
    return true;
  }
}
function pathFirst(binary, path) {
  const dir = dirname10(binary);
  return path === void 0 || path === "" ? dir : `${dir}${delimiter}${path}`;
}
function readPin(root) {
  for (const name2 of PIN_FILES) {
    let text2;
    try {
      text2 = readFileSync18(join28(root, name2), "utf8");
    } catch {
      continue;
    }
    for (const line of text2.split(/\r?\n/)) {
      const value = line.replace(/#.*$/, "").trim();
      if (value !== "") return value;
    }
  }
  return null;
}
function nodeSetting(root) {
  return loadConfigFile(join28(root, "squeal.config.json"), NODE_SHAPE, {
    node: "project"
  }).value.node;
}
function managerCandidates(version, env) {
  const home = env.HOME ?? homedir();
  const data = env.XDG_DATA_HOME ?? join28(home, ".local", "share");
  const fnm = env.FNM_DIR === void 0 ? [join28(data, "fnm"), join28(home, ".fnm"), join28(home, "Library", "Application Support", "fnm")] : [env.FNM_DIR];
  return [
    join28(env.NVM_DIR ?? join28(home, ".nvm"), "versions", "node", `v${version}`, "bin", "node"),
    ...fnm.map((dir) => join28(dir, "node-versions", `v${version}`, "installation", "bin", "node")),
    join28(env.VOLTA_HOME ?? join28(home, ".volta"), "tools", "image", "node", version, "bin", "node"),
    join28(env.ASDF_DATA_DIR ?? join28(home, ".asdf"), "installs", "nodejs", version, "bin", "node"),
    join28(env.MISE_DATA_DIR ?? join28(data, "mise"), "installs", "node", version, "bin", "node"),
    join28(env.N_PREFIX ?? "/usr/local", "n", "versions", "node", version, "bin", "node")
  ];
}
function installed(version, env) {
  for (const binary of managerCandidates(version, env)) {
    const said = probe(binary, ["--version"], { env });
    if (said !== null && said.trim() === `v${version}`) return binary;
  }
  return null;
}
function onPath(version, root, env) {
  const own = real(process.execPath);
  const seen = /* @__PURE__ */ new Set();
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute10(dir)) continue;
    const candidate = join28(dir, "node");
    const resolved = real(candidate);
    if (resolved === null || resolved === own || seen.has(resolved)) continue;
    seen.add(resolved);
    const said = probe(candidate, ["-p", SELF], { env, cwd: root })?.split("\n");
    const binary = said?.[1]?.trim();
    if (said?.[0]?.trim() === `v${version}` && binary !== void 0 && isAbsolute10(binary)) {
      return binary;
    }
  }
  return null;
}
function real(path) {
  try {
    return realpathSync5(path);
  } catch {
    return null;
  }
}
function fileStat(path) {
  try {
    return statSync7(path);
  } catch {
    return null;
  }
}
var answers = /* @__PURE__ */ new Map();
function probe(binary, args, options) {
  const stat = fileStat(binary);
  if (stat === null || !stat.isFile() || (stat.mode & 73) === 0) return null;
  const key = [binary, ...args, stat.ino, stat.size, stat.mtimeMs, options.cwd ?? ""].join("\0");
  const known = answers.get(key);
  if (known !== void 0) return known;
  let said;
  try {
    said = execFileSync(binary, args, {
      encoding: "utf8",
      env: options.env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROBE_TIMEOUT_MS,
      // SIGTERM can be ignored, and then the call never returns (review 018-30-0.1.436 B1).
      killSignal: "SIGKILL",
      ...options.cwd === void 0 ? {} : { cwd: options.cwd }
    });
  } catch {
    said = null;
  }
  answers.set(key, said);
  return said;
}

// src/core/process-label.ts
import { basename as basename5, delimiter as delimiter2, dirname as dirname11, resolve as resolve7 } from "node:path";
var PROJECT_MAX = 32;
function argv0For(label, platform = process.platform) {
  return label !== null && platform === "linux" ? label : void 0;
}
function worktreeLabel(role, root, commonDir, id) {
  const project = projectComponent(projectOf(commonDir) ?? basename5(root));
  return id === null ? `squeal ${project} ${role}` : `squeal ${project} ${role} @${id.slice(0, 8)}`;
}
function displayId(root) {
  try {
    return worktreeIdFor(root);
  } catch {
    return null;
  }
}
function projectOf(commonDir) {
  return commonDir !== null && basename5(commonDir) === ".git" ? basename5(dirname11(commonDir)) : null;
}
function projectComponent(name2) {
  const safe = name2.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, PROJECT_MAX).replace(/-+$/, "") || "project";
}

// src/core/daemon/log-file.ts
import {
  closeSync,
  copyFileSync,
  fstatSync,
  ftruncateSync,
  mkdirSync as mkdirSync8,
  openSync,
  statSync as statSync8,
  writeSync
} from "node:fs";
import { dirname as dirname12 } from "node:path";
var DAEMON_LOG_MAX_BYTES = 4 * 1024 * 1024;
function rotateDaemonLog(path, maxBytes = DAEMON_LOG_MAX_BYTES) {
  try {
    if (statSync8(path).size < maxBytes) return;
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
    mkdirSync8(dirname12(path), { recursive: true });
    rotateDaemonLog(path, maxBytes);
    return openSync(path, "a", 384);
  } catch {
    return null;
  }
}

// src/core/daemon/ensure.ts
async function probeDaemon(root, timeoutMs, options = {}) {
  try {
    return (await locateDaemon(root, timeoutMs, options)).probe;
  } catch (error) {
    return { state: "unresponsive", reason: `no worktree at ${root}: ${String(error)}` };
  }
}
async function locateDaemon(root, timeoutMs, options = {}) {
  const socketPath = socketPathFor(worktreeIdFor(root), options.env);
  const record = options.record === void 0 ? recordedDaemon(root) : options.record;
  const now = options.now ?? Date.now;
  if (record !== null && record.socketPath !== socketPath && daemonLiveness(record, now()).state === "alive") {
    const probe2 = await ping(record.socketPath, timeoutMs, options.signal);
    if (probe2.state !== "absent") return { socketPath: record.socketPath, probe: probe2 };
  }
  return { socketPath, probe: await ping(socketPath, timeoutMs, options.signal) };
}
async function ping(socketPath, timeoutMs, signal) {
  try {
    const response = await requestDaemon(
      socketPath,
      { type: "ping" },
      timeoutMs,
      void 0,
      signal
    );
    if (response.ok && response.type === "ping") return { state: "alive", ping: response };
    return { state: "unresponsive", reason: `unexpected answer: ${JSON.stringify(response)}` };
  } catch (error) {
    const code = noDaemonCode(error);
    if (code !== null) return { state: "absent", code };
    return { state: "unresponsive", reason: error.message };
  }
}
function noDaemonCode(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" ? code : null;
}
function recordedDaemon(root, busyTimeoutMs = 100) {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return null;
    try {
      return store.worktrees.get(worktreeIdFor(root))?.daemon ?? null;
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}
var none2 = () => true;
var UNAVAILABLE = { result: "unavailable", pid: null, ended: none2 };
async function ensureDaemon(root, options = {}) {
  return (await ensureDaemonProcess(root, options)).result;
}
async function ensureDaemonProcess(root, options = {}) {
  if (options.awaitLockMs === void 0) {
    const timeoutMs = options.socketTimeoutMs ?? DAEMON_SOCKET_TIMEOUT_MS;
    const probe2 = await probeDaemon(root, timeoutMs, options);
    if (probe2.state === "alive") return { result: "alive", pid: null, ended: none2 };
    if (probe2.state === "unresponsive") return UNAVAILABLE;
  }
  const lockWait = options.awaitLockMs === void 0 ? [] : ["--await-lock", String(options.awaitLockMs)];
  const cli = daemonCliEntry(options.cli, options.env);
  if (cli === null || !existsSync11(cli)) return UNAVAILABLE;
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return UNAVAILABLE;
    const cwd = storePaths(commonDir).dir;
    mkdirSync9(cwd, { recursive: true });
    const node2 = pinnedNode(root);
    const pinned = "binary" in node2;
    const log = openDaemonLog(daemonLogFor(commonDir, worktreeIdFor(root)));
    const child = spawnLogging(
      log,
      () => spawn2(pinned ? node2.binary : process.execPath, [cli, "daemon", root, ...lockWait], {
        argv0: argv0For(worktreeLabel("daemon", root, commonDir, displayId(root))),
        cwd,
        detached: true,
        stdio: log === null ? "ignore" : ["ignore", log, log],
        env: pinned ? { ...process.env, PATH: pathFirst(node2.binary, process.env.PATH) } : process.env
      })
    );
    let ended = child.pid === void 0;
    const end = () => {
      ended = true;
    };
    child.on("error", end);
    child.on("exit", end);
    child.unref();
    return { result: "spawned", pid: child.pid ?? null, ended: () => ended };
  } catch {
    return UNAVAILABLE;
  }
}
function spawnLogging(log, start) {
  try {
    return start();
  } finally {
    if (log !== null) {
      try {
        closeSync2(log);
      } catch {
      }
    }
  }
}
function daemonCliEntry(cli, env = process.env) {
  const override = env.SQUEAL_CLI;
  if (override !== void 0 && override !== "") return override;
  return cli ?? null;
}

// src/core/delivery/stopped.ts
import { createHash as createHash9 } from "node:crypto";
import { existsSync as existsSync12 } from "node:fs";
import { dirname as dirname14, join as join29 } from "node:path";

// src/core/presence/lock-events.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { mkdirSync as mkdirSync10, renameSync as renameSync4, rmSync as rmSync5, unlinkSync as unlinkSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname13 } from "node:path";
import { DatabaseSync as DatabaseSync10 } from "node:sqlite";
function markSpawn(lockFile, at, heartbeatAt) {
  const first = spawnedAt(lockFile);
  if (first !== null && first <= at && (heartbeatAt === null || heartbeatAt < first)) return;
  try {
    mkdirSync10(dirname13(lockFile), { recursive: true });
  } catch {
  }
  writeMark3(spawnMarkFor(lockFile), { at });
}
function writeStopFile(lockFile, mark) {
  mkdirSync10(dirname13(lockFile), { recursive: true });
  const path = stopMarkFor(lockFile);
  const temp = `${path}.${process.pid}.${randomBytes2(4).toString("hex")}`;
  try {
    writeFileSync3(temp, JSON.stringify(mark));
    renameSync4(temp, path);
  } catch (error) {
    rmSync5(temp, { force: true });
    throw error;
  }
}
var STOP_LOCK_BUSY_MS = 2e3;
function withStopFileLock(lockFile, fn, busyTimeoutMs = STOP_LOCK_BUSY_MS) {
  mkdirSync10(dirname13(lockFile), { recursive: true });
  const db = new DatabaseSync10(stopLockFor(lockFile));
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    try {
      return fn();
    } finally {
      db.exec("ROLLBACK");
    }
  } finally {
    db.close();
  }
}
function removeStopFile(lockFile) {
  try {
    unlinkSync2(stopMarkFor(lockFile));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function writeMark3(path, mark) {
  try {
    const temp = `${path}.${process.pid}`;
    writeFileSync3(temp, JSON.stringify(mark));
    renameSync4(temp, path);
  } catch {
  }
}

// src/core/delivery/stopped.ts
var TREE_PRINT_TIMEOUT_MS = 1e3;
async function stopHolds(store, at, mark, write2 = async (work) => work()) {
  if (mark === null) return false;
  if (mark.untilStart === true) return true;
  const tree = await treePrint(at.root, TREE_PRINT_TIMEOUT_MS);
  if (tree === null || tree === mark.tree) return true;
  const lockFile = markLockFile(store, at);
  if (lockFile !== null && existsSync12(dirname14(lockFile))) {
    let outcome;
    try {
      outcome = withStopFileLock(lockFile, () => fileOutcome(lockFile, mark, tree));
    } catch {
      return true;
    }
    if (outcome === "holds") return true;
    if (outcome === "cleared") {
      if (store.meta.get(stoppedMetaKey(at.id)) !== null)
        await write2(() => store.transaction(() => clearStopped(store, at.id)));
      return false;
    }
  }
  if (store.meta.get(stoppedMetaKey(at.id)) === null) return false;
  return write2(
    () => store.transaction(() => {
      const now = readStop(store, at.id);
      if (now === null) return false;
      if (now.at !== mark.at || now.tree !== mark.tree || now.untilStart === true) return true;
      if (mark.tree === null) {
        markStopped(store, at.id, mark.at, tree);
        return true;
      }
      clearStopped(store, at.id);
      return false;
    })
  );
}
function fileOutcome(lockFile, mark, tree) {
  const now = readStopFile(lockFile);
  if (now === null) return "none";
  if (now.at !== mark.at || now.tree !== mark.tree || now.untilStart === true) return "holds";
  if (mark.tree === null) {
    try {
      writeStopFile(lockFile, { at: mark.at, tree });
    } catch {
    }
    return "holds";
  }
  try {
    removeStopFile(lockFile);
  } catch {
  }
  return "cleared";
}
function markLockFile(store, at) {
  const byStore = stopLockFile(store, at.id);
  if (byStore !== null) return byStore;
  const commonDir = resolveCommonDir(at.root);
  return commonDir === null ? null : lockFileFor(commonDir, at.id);
}
async function treePrint(root, timeoutMs) {
  const options = timeoutMs === void 0 ? {} : { timeoutMs };
  try {
    const [head, status] = await Promise.all([
      gitHead(root, options),
      runGit(
        root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"],
        options
      )
    ]);
    const hash3 = createHash9("sha1").update(head ?? "").update("\0").update(status);
    for (const path of listedPaths(status)) {
      const stat = lstatOrNull(join29(root, path));
      hash3.update(stat === null ? "-\0" : `${stat.size} ${stat.mtimeMs} ${stat.ino}\0`);
    }
    return hash3.digest("hex");
  } catch {
    return null;
  }
}
function listedPaths(status) {
  const fields = splitNul(status);
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    paths.push(field.slice(3));
    if (field[0] === "R" || field[0] === "C") i++;
  }
  return paths;
}

// src/core/presence/narrow.ts
function readHookStop(store, worktreeId, row, at) {
  return stopHeld(readPresenceFacts(store, worktreeId, at, row), at);
}
function readHookHandoff(store, worktreeId, row, from, at) {
  const facts = readPresenceFacts(store, worktreeId, at, row);
  const record = row.daemon;
  if (record === null || facts.short()?.of === from) return null;
  const alive = heartbeatFresh(record, at);
  const claim = facts.claim();
  const joined2 = claim !== null && claim.from === from && at < claim.boundAt;
  const stepping = !alive && (facts.shutDown() || claim?.from === from);
  return { alive, joined: joined2, stepping };
}

// src/harness/shared/ensure.ts
var SOCKET_TIMEOUT_MS = 100;
async function ensure(location2, deps, context, { stopRead = false } = {}) {
  const worktree = context?.store.worktrees.get(context.consumer.worktreeId);
  const record = context === void 0 ? void 0 : worktree?.daemon ?? null;
  if (context !== void 0 && !stopRead && await stopHeld2(location2, deps, context)) {
    return "stopped";
  }
  const handoff = context === void 0 ? "none" : await handOver(context, deps);
  if (handoff === "claimed") return successor(location2, deps);
  if (handoff === "joined") return "alive";
  const at = (deps.now ?? Date.now)();
  if (startCurrent(location2, worktree, at)) return "spawned";
  const ensured = spawnMarked(
    location2,
    { at, heartbeat: lastHeartbeat(worktree) },
    await (deps.ensureDaemon ?? ensureDaemon)(location2.root, {
      socketTimeoutMs: SOCKET_TIMEOUT_MS,
      ...deps.cli === void 0 ? {} : { cli: deps.cli },
      ...record === void 0 ? {} : { record }
    })
  );
  if (ensured === "spawned" && context !== void 0) {
    await context.write(() => spawnedAfterRest(context.store, context.consumer.worktreeId, at));
  }
  return ensured;
}
async function stopHeld2(location2, deps, context) {
  const id = context.consumer.worktreeId;
  const worktree = context.store.worktrees.get(id);
  const stop = readHookStop(context.store, id, worktree ?? null, (deps.now ?? Date.now)());
  return stopHolds(context.store, { id, root: location2.root }, stop, context.write);
}
function spawnMarked(location2, spawn3, ensured) {
  if (ensured === "spawned") markSpawn(lockFileOf2(location2), spawn3.at, spawn3.heartbeat);
  return ensured;
}
function startCurrent(location2, worktree, at) {
  const rowless = worktree === null || worktree === void 0 ? lockFileOf2(location2) : void 0;
  return spawnStartCurrent(worktree, at, rowless);
}
function lockFileOf2(location2) {
  return lockFileFor(location2.commonDir, worktreeIdFor(location2.root));
}
async function handOver(context, deps) {
  const now = deps.now ?? Date.now;
  const version = deps.squealVersion ?? squealVersion();
  const { store, consumer } = context;
  const id = consumer.worktreeId;
  const at = now();
  const read4 = readTransaction(store, () => {
    const row = store.worktrees.get(id);
    const record = row?.daemon ?? null;
    if (row === null || record === null) return null;
    if (!succeeds(record, version, otherSessionVersions(store, consumer))) return null;
    const from = handoffFrom(record);
    const reading = readHookHandoff(store, id, row, from, at);
    return reading === null ? null : { record, from, ...reading };
  });
  if (read4 === null) return "none";
  if (read4.joined) return "joined";
  if (read4.alive) {
    if (!await requestStepDown(read4.record, version)) return "none";
  } else if (!read4.stepping) {
    return "none";
  }
  const attempt = randomUUID2();
  let ran = null;
  try {
    return await context.write(
      () => store.transaction(() => {
        const claim = stillRecorded(store, id, read4.from) ? claimHandoff(store, id, { from: read4.from, to: version, at: now(), attempt }) : void 0;
        const result = claim === void 0 ? "none" : claim === null ? "joined" : "claimed";
        ran = result;
        return result;
      })
    );
  } catch {
    return thrown(ran, store, id, attempt);
  }
}
function thrown(ran, store, worktreeId, attempt) {
  if (ran === "joined" || ran === "none") return ran;
  try {
    return readHandoff(store, worktreeId)?.attempt === attempt ? "claimed" : "none";
  } catch {
    return "none";
  }
}
function stillRecorded(store, worktreeId, from) {
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  return record === null || handoffFrom(record) === from;
}
async function successor(location2, deps) {
  const at = (deps.now ?? Date.now)();
  return spawnMarked(
    location2,
    { at, heartbeat: at },
    await (deps.ensureDaemon ?? ensureDaemon)(location2.root, {
      socketTimeoutMs: SOCKET_TIMEOUT_MS,
      awaitLockMs: SUCCESSOR_LOCK_WAIT_MS,
      ...deps.cli === void 0 ? {} : { cli: deps.cli }
    })
  );
}
function succeeds(record, version, others) {
  if (!isNewerVersion(version, record.squealVersion)) return false;
  return others.every((other) => other === version || isNewerVersion(other ?? "", version));
}
async function requestStepDown(record, version) {
  try {
    const pinned = await pinDaemon(record, SOCKET_TIMEOUT_MS);
    if (pinned === null) return false;
    const ask = (request) => requestDaemon(record.socketPath, request, SOCKET_TIMEOUT_MS, pinned.endpoint);
    const answer = await ask({ type: "step-down", version });
    if (answer.ok) {
      if (answer.type !== "step-down" || !answer.steppingDown) return false;
      await ask({ type: "stop" }).catch(() => null);
      return true;
    }
    if (!answer.error.startsWith("unknown request type")) return false;
    return (await ask({ type: "stop" })).ok;
  } catch {
    return false;
  }
}
async function registerFirst(location2, deps, context) {
  const at = (deps.now ?? Date.now)();
  if (await stopHeld2(location2, deps, context)) {
    return { startingSince: void 0, ensure: async () => "stopped" };
  }
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  return {
    startingSince: record !== null && heartbeatFresh(record, at) ? void 0 : at,
    ensure: () => ensure(location2, deps, context, { stopRead: true })
  };
}

// src/harness/shared/primer-forms.ts
var PRIMER_FIRST = "checks in the background and tells you with your next tool call when one changes; a pass is silent.";
var FORM_TEXTS = {
  // For a harness that ships the squeal skill (Claude Code, Codex, Pi).
  skill: ({ cli, Cli }) => [
    "Read the squeal skill before you run or judge tests: it says what to do instead of a hand run, and with a failure you did not cause.",
    `${Cli("checks")} lists this repository's checks and when each runs; ${cli("status")} gives the current results.`
  ],
  // For a harness with no squeal skill (OpenCode): the skill's rules in words.
  "no-skill": ({ cli, Cli }) => [
    "Do not run the tests yourself to learn whether an edit broke something.",
    `A check that does not run after an edit: ${cli("run <check> --wait 60000")}.`,
    `A failure you did not cause, from load or a stopped service: ${cli("retry <file> --reason load|environment")}, then claim from that result.`,
    `Before you say you are done: ${cli("status --wait 60000")}.`,
    `${Cli("checks")} lists this repository's checks and when each runs.`
  ]
};
var UNNAMED_CLI = "These are commands of the CLI SQUEAL messages name.";

// src/harness/shared/primer.ts
var PRIMER_CAP_CHARS = 1500;
var PRIMER_OPENING = "Squeal runs this repository's ";
function primer(command = SQUEAL_COMMAND, options = {}) {
  const form = options.skill ?? true ? "skill" : "no-skill";
  const render = (naming) => {
    let named2 = false;
    const cli = (sub) => {
      if (naming === "none") return `\`${sub}\``;
      const full = naming === "every" || !named2;
      named2 = true;
      return full ? `\`${command} ${sub}\`` : `the CLI's \`${sub}\``;
    };
    const Cli = (sub) => {
      const text3 = cli(sub);
      return text3.startsWith("the ") ? `T${text3.slice(1)}` : text3;
    };
    return [
      `${PRIMER_OPENING}${PRIMER_FIRST}`,
      ...FORM_TEXTS[form]({ cli, Cli }),
      ...naming === "none" ? [UNNAMED_CLI] : []
    ].join(" ");
  };
  const namings = command === SQUEAL_COMMAND ? ["every"] : ["first", "none"];
  let text2 = "";
  for (const naming of namings) {
    text2 = render(naming);
    if (text2.length <= PRIMER_CAP_CHARS) return text2;
  }
  return text2;
}
var PRIMER = primer();
function withPrimer(registration2, command = SQUEAL_COMMAND, options = {}) {
  const tail = primer(command, options);
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration2, max, command)}

${tail}`;
}

// src/harness/shared/owed.ts
function owedOf(deps, resumed = false) {
  return { primer: deps.registrationPrimer !== false && !resumed };
}
async function registerOwing(context, deps, owed2, options) {
  const registration2 = await context.delivery.register(context.consumer, {
    ...options,
    owesText: owed2
  });
  return owed2.primer ? withPrimer(registration2, deps.command, { skill: deps.skill }) : formatRegistration(registration2, MESSAGE_CAP_CHARS, deps.command);
}
async function sayOwed(context, deps, options) {
  const owed2 = owedRegistration(context.store, context.consumer);
  if (owed2 === null) return null;
  const text2 = await registerOwing(context, deps, owed2, options);
  await context.delivery.registrationSent(context.consumer);
  return text2;
}
async function registerAndHandOver(context, location2, deps, options) {
  const now = (deps.now ?? Date.now)();
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  const alive = options.whenDown === true && daemonLiveness(record, now).state === "alive";
  const first = alive ? null : await registerFirst(location2, deps, context);
  const say = options.say ?? (async (startingSince) => ({
    text: await registerOwing(context, deps, owedOf(deps), {
      ...options.register,
      ...startingSince === void 0 ? {} : { startingSince }
    }),
    owes: true
  }));
  const said = await registerThenEnsure(first, () => say(first?.startingSince));
  if (said === null) return null;
  if (said.owes) await context.delivery.registrationSent(context.consumer);
  return said.text;
}
async function registerThenEnsure(first, register) {
  let registered;
  try {
    registered = await register();
  } catch (error) {
    await first?.ensure().catch(() => void 0);
    throw error;
  }
  await first?.ensure();
  return registered;
}

// src/harness/shared/prompt.ts
function submitPrompt(input, location2, deps, options) {
  if (!usesSqueal(location2)) return Promise.resolve(null);
  return withContext(
    input,
    location2,
    deps,
    (context) => turnNews(context, location2, deps, options)
  );
}
async function turnNews(context, location2, deps, options) {
  if (isRegistered(context)) {
    const owed2 = await sayOwed(context, deps, { inTurn: true });
    if (owed2 !== null) return owed2;
    const delta = await context.delivery.startTurn(context.consumer);
    return delta === null ? null : formatDelta(delta, deps.command);
  }
  if (!options.register) return null;
  return registerAndHandOver(context, location2, deps, {
    whenDown: true,
    register: { inTurn: true }
  });
}

// src/harness/claude-code/hook.ts
function additionalContext(input, text2) {
  return {
    output: {
      hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: text2 }
    }
  };
}

// src/harness/claude-code/hooks/waiter.ts
var WAITER_HOOK_TIMEOUT_S = 3600;
var WAITER_TIMEOUT_MS = (WAITER_HOOK_TIMEOUT_S - 60) * 1e3;
function isInteractive(env) {
  return env.CLAUDE_CODE_SESSION_ATTENDED === "1" && env.CLAUDE_CODE_ENTRYPOINT !== "sdk-cli";
}

// src/harness/claude-code/hooks/user-prompt-submit.ts
var userPromptSubmit = async (input, location2, deps) => {
  const text2 = await submitPrompt(input, location2, deps, { register: isInteractive(deps.env) });
  return text2 === null ? null : additionalContext(input, text2);
};

// src/harness/claude-code/main.ts
import { readFileSync as readFileSync20 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/harness/shared/hand-off.ts
var HandOff = class {
  #taken = [];
  #sending = [];
  /**
   * Takes `reports`, which wait for the verdict, the `close` of the store
   * they hold open, and with a daemon serving, what waits for their sent
   * writes (spec 021 D15).
   */
  take(reports, close, sent) {
    this.#taken.push({ reports, close, ...sent === void 0 ? {} : { sent } });
  }
  /**
   * Resolves once every write the verdicts sent to the daemon is written, or
   * failed: a failed one leaves its report owed. Never rejects.
   */
  async sent() {
    const sending = this.#sending;
    this.#sending = [];
    await Promise.allSettled(sending);
  }
  /** Whether a report waits for the verdict. */
  get pending() {
    return this.#taken.some((t) => t.reports.pending);
  }
  /** Commits every report taken, in order, and closes their stores; a failed commit abandons the rest. */
  commit() {
    this.#end((reports) => reports.commit());
  }
  /** Abandons every report taken and closes their stores. Never throws. */
  abandon() {
    this.#end((reports) => reports.abandon());
  }
  /**
   * Commits every report taken when `commit`, else abandons them. Never
   * throws: a failed commit rolled back, so its report stays owed and the
   * next eligible boundary tells it.
   */
  settle(commit) {
    if (!commit) {
      this.abandon();
      return;
    }
    try {
      this.commit();
    } catch {
    }
  }
  #end(verdict) {
    const taken = this.#taken;
    this.#taken = [];
    try {
      endInOrder(
        taken,
        (t) => endThenClose(t, verdict),
        (rest) => {
          for (const t of rest) endThenClose(t, (reports) => reports.abandon());
        }
      );
    } finally {
      for (const t of taken) if (t.sent !== void 0) this.#sending.push(t.sent());
    }
  }
};
function endThenClose(taken, end) {
  try {
    end(taken.reports);
  } finally {
    taken.close();
  }
}
var HAND_OFF_BOUND_MS = HOOK_TIMEOUT_MS;
function written(stream, text2, boundMs) {
  return new Promise((resolve8, reject) => {
    const timer = setTimeout(() => reject(new Error("output not written in time")), boundMs);
    try {
      stream.write(text2, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve8();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
async function writeThenCommit(handOff, outputs, boundMs = HAND_OFF_BOUND_MS) {
  const texts = outputs.filter(([, text2]) => text2 !== "");
  if (!handOff.pending) {
    for (const [stream, text2] of texts) stream.write(text2, () => {
    });
    handOff.commit();
  } else {
    try {
      await Promise.all(texts.map(([stream, text2]) => written(stream, text2, boundMs)));
      handOff.settle(true);
    } catch {
      handOff.abandon();
    }
  }
  await handOff.sent();
}

// src/harness/shared/session-root.ts
import { createHash as createHash10 } from "node:crypto";
import {
  existsSync as existsSync13,
  lstatSync as lstatSync6,
  readdirSync as readdirSync10,
  readFileSync as readFileSync19,
  renameSync as renameSync5,
  rmSync as rmSync6,
  writeFileSync as writeFileSync4
} from "node:fs";
import { join as join30 } from "node:path";
var AGENT_SEPARATOR = "\0";
function rootKey(input) {
  return input.agent_id === void 0 ? input.session_id : `${input.session_id}${AGENT_SEPARATOR}${input.agent_id}`;
}
var RESTART_SOURCES = /* @__PURE__ */ new Set(["startup", "resume"]);
function sessionLocation(input, start, roots) {
  if (roots === void 0) return locate(input.cwd);
  if (input.agent_id !== void 0) {
    const key = rootKey(input);
    const own = start ? locate(input.cwd) : roots.get(key);
    if (own !== null) {
      if (start) roots.set(key, own);
      return own;
    }
  }
  const restart = start && input.agent_id === void 0 && (input.source === void 0 || RESTART_SOURCES.has(input.source));
  if (!restart) {
    const kept2 = roots.get(input.session_id);
    if (kept2 !== null) return kept2;
  }
  const located = locate(input.cwd);
  if (located !== null) roots.set(input.session_id, located);
  else if (restart) roots.delete(input.session_id);
  return located;
}
function forgetRoot(input, roots) {
  roots?.delete(rootKey(input));
}
function sessionRootFiles(env) {
  const dir = join30(runtimeDir(env), "squeal-sessions");
  const path = (key) => join30(dir, keyFile(key));
  return {
    get: (key) => {
      try {
        return readKept(path(key));
      } catch {
        return null;
      }
    },
    set: (key, location2) => {
      try {
        preparePrivateDir(dir, currentUid(), "session root directory");
        const file = path(key);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync4(temp, JSON.stringify({ root: location2.root, commonDir: location2.commonDir }));
        renameSync5(temp, file);
      } catch {
      }
    },
    delete: (key) => {
      try {
        rmSync6(path(key), { force: true });
        if (key.includes(AGENT_SEPARATOR)) return;
        const agents = `${keyFile(key)}-`;
        for (const name2 of readdirSync10(dir)) {
          if (name2.startsWith(agents)) rmSync6(join30(dir, name2), { force: true });
        }
      } catch {
      }
    }
  };
}
function keyFile(key) {
  const [session = "", ...agent] = key.split(AGENT_SEPARATOR);
  const own = hash2(session);
  return agent.length === 0 ? own : `${own}-${hash2(agent.join(AGENT_SEPARATOR))}`;
}
function hash2(text2) {
  return createHash10("sha256").update(text2).digest("hex").slice(0, 32);
}
function readKept(file) {
  const stat = lstatSync6(file, { throwIfNoEntry: false });
  if (stat === void 0 || !stat.isFile() || stat.uid !== currentUid()) return null;
  const kept2 = JSON.parse(readFileSync19(file, "utf8"));
  if (!isRecord(kept2) || typeof kept2.root !== "string" || typeof kept2.commonDir !== "string") {
    return null;
  }
  return existsSync13(kept2.root) ? { root: kept2.root, commonDir: kept2.commonDir } : null;
}

// src/harness/shared/test-command.ts
function bashCommand(input) {
  const toolInput = input.tool_input;
  if (input.tool_name !== "Bash" || typeof toolInput !== "object" || toolInput === null) return {};
  const { command } = toolInput;
  return typeof command === "string" ? { command } : {};
}

// src/harness/claude-code/input.ts
function parseHookInput(text2) {
  let value;
  try {
    value = JSON.parse(text2);
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
    ...typeof v.agent_type === "string" ? { agent_type: v.agent_type } : {},
    ...typeof v.tool_name === "string" ? { tool_name: v.tool_name } : {},
    ...bashCommand(v),
    ...toolNames(v.tool_calls),
    ...typeof v.stop_hook_active === "boolean" ? { stop_hook_active: v.stop_hook_active } : {},
    ...typeof v.source === "string" ? { source: v.source } : {}
  };
}
function toolNames(calls) {
  if (!Array.isArray(calls)) return {};
  const names3 = calls.map(
    (c) => typeof c === "object" && c !== null ? c.tool_name : void 0
  );
  return names3.every((n) => typeof n === "string") ? { tool_names: names3 } : {};
}

// src/harness/claude-code/run.ts
var SILENT = { stdout: "", stderr: "", exitCode: 0 };
var PROJECT_DIR_FALLBACK = /* @__PURE__ */ new Set(["session-end"]);
async function runHandler(name2, handler, stdin, deps) {
  try {
    const input = parseHookInput(stdin);
    if (input === null) return SILENT;
    const location2 = sessionLocation(input, name2 === "session-start", deps.sessionRoots) ?? projectDir2(name2, deps);
    if (location2 === null) return SILENT;
    if (name2 === "session-end") forgetRoot(input, deps.sessionRoots);
    const outcome = await handler(input, location2, deps);
    if (input.hook_event_name === "SubagentStop" && !blocks(outcome?.output)) {
      forgetRoot(input, deps.sessionRoots);
    }
    if (outcome === null) return SILENT;
    return {
      stdout: outcome.output === void 0 ? "" : JSON.stringify(outcome.output),
      stderr: outcome.stderr ?? "",
      exitCode: outcome.exitCode ?? 0
    };
  } catch (error) {
    deps.handOff?.abandon();
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal ${name2} hook: ${String(error)}
` };
    }
    return SILENT;
  }
}
function blocks(output) {
  return output !== void 0 && "decision" in output && output.decision === "block";
}
function projectDir2(name2, deps) {
  const dir = deps.env.CLAUDE_PROJECT_DIR;
  return PROJECT_DIR_FALLBACK.has(name2) && dir !== void 0 && dir !== "" ? locate(dir) : null;
}

// src/harness/claude-code/main.ts
async function runMain(name2, handler, overrides = {}) {
  let stdin = "";
  try {
    stdin = readFileSync20(0, "utf8");
  } catch {
  }
  const handOff = new HandOff();
  const result = await runHandler(name2, handler, stdin, {
    env: process.env,
    handOff,
    sessionRoots: sessionRootFiles(process.env),
    // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs (review wave 3, B1).
    cli: fileURLToPath2(new URL("./cli/squeal.mjs", import.meta.url)),
    ...waiterTimeout(process.env.SQUEAL_WAITER_TIMEOUT_MS),
    ...overrides
  });
  process.exitCode = result.exitCode;
  await writeThenCommit(handOff, [
    [process.stdout, result.stdout],
    [process.stderr, result.stderr]
  ]);
}
function waiterTimeout(value) {
  const ms = Number(value);
  return value !== void 0 && Number.isInteger(ms) && ms > 0 ? { waiterTimeoutMs: ms } : {};
}

// src/harness/claude-code/entries/user-prompt-submit.ts
await runMain("user-prompt-submit", userPromptSubmit);
