#!/usr/bin/env node
import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/cli/ps.ts
import { homedir as homedir2 } from "node:os";
import { isAbsolute as isAbsolute6, resolve as resolve3 } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// src/core/daemon/paths.ts
function currentUid() {
  return process.getuid?.() ?? 0;
}

// src/core/daemon/user-config.ts
import { availableParallelism, homedir } from "node:os";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "node:path";

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/fs/git-layout.ts
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
var GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
function findWorktreeRoot(path) {
  let dir = resolve(path);
  if (existsSync(dir)) dir = realpathSync(dir);
  for (; ; ) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function worktreeIdFor(root) {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}
function linkedWorktreeDir(root) {
  const entry = dotGit(root);
  return entry?.isFile ? entry.gitDir : null;
}
function resolveCommonDir(root) {
  const entry = dotGit(root);
  if (entry === null) return null;
  if (!entry.isFile) return realpathSync(entry.gitDir);
  const { gitDir } = entry;
  if (lstatOrNull(gitDir) === null) return null;
  const commondirFile = join(gitDir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync(gitDir);
  const commondir = readFileSync(commondirFile, "utf8").trim();
  const common = isAbsolute(commondir) ? commondir : resolve(gitDir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync(common);
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
  const path = join(root, ".git");
  const stat = lstatOrNull(path);
  if (stat === null) return null;
  if (stat.isDirectory()) return { gitDir: path, isFile: false };
  if (!stat.isFile()) return null;
  const match = GITDIR_LINE.exec(readFileSync(path, "utf8"));
  return match?.[1] ? { gitDir: resolve(root, match[1]), isFile: true } : null;
}

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/daemon/config-file.ts
import { readFileSync as readFileSync2 } from "node:fs";
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
function loadConfigFile(path, shape, defaults) {
  let text2;
  try {
    text2 = readFileSync2(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { value: defaults, problems: [] };
    return { value: defaults, problems: [`could not be read: ${String(error)}`] };
  }
  let parsed2;
  try {
    parsed2 = JSON.parse(text2);
  } catch (error) {
    return { value: defaults, problems: [`not valid JSON (${error.message})`] };
  }
  if (!isRecord(parsed2)) {
    const got = Array.isArray(parsed2) ? "an array" : JSON.stringify(parsed2);
    return { value: defaults, problems: [`must be a JSON object, got ${got}`] };
  }
  const problems = [];
  const merged = merge(shape, defaults, parsed2, "", problems);
  return { value: merged, problems };
}
function merge(shape, defaults, given, prefix, problems) {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    const path = `${prefix}${key}`;
    const rule = Object.hasOwn(shape, key) ? shape[key] : void 0;
    if (rule === void 0) {
      problems.push(`unknown key "${path}"`);
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
      result[key] = merge(rule, nested, value, `${path}.`, problems);
    }
  }
  return result;
}

// src/core/daemon/user-config.ts
function userConfigPath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== void 0 && xdg !== "" && isAbsolute2(xdg) ? xdg : join2(env.HOME !== void 0 && env.HOME !== "" ? env.HOME : homedir(), ".config");
  return join2(base, "squeal", "config.json");
}
function defaultHostSlots(cpus3 = availableParallelism()) {
  return Math.max(1, cpus3 - 1);
}

// src/core/ps/darwin.ts
import { availableParallelism as availableParallelism2, cpus, loadavg, totalmem, uptime } from "node:os";
import { basename } from "node:path";

// src/core/ps/source.ts
import { execFileSync } from "node:child_process";
function ticksToMs(ticks, clockTicks) {
  return ticks * 1e3 / clockTicks;
}
var runCommand = (command2, args) => {
  try {
    return execFileSync(command2, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2e3,
      maxBuffer: 16 * 1024 * 1024
    });
  } catch {
    return null;
  }
};

// src/core/ps/darwin.ts
var CLOCK_TICKS = 100;
var PS = [
  "-u",
  "LC_ALL",
  "LC_TIME=C",
  "ps",
  "-axww",
  "-o",
  "pid=,ppid=,pgid=,uid=,nice=,time=,rss=,lstart=,command="
];
var ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+(.*))?$/;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var TIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2})(?:\.(\d+))?$/;
function createDarwinSource(options = {}) {
  return new DarwinSource(options);
}
var DarwinSource = class {
  platform = "darwin";
  memoryKind = "rss";
  readsMarks = false;
  #run;
  #os;
  /** Read once, so a process's start ticks are the same in every read: with its pid, its identity. */
  #boot;
  #last = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#run = options.run ?? runCommand;
    this.#os = options.os ?? { loadavg, totalmem, cpus, availableParallelism: availableParallelism2, uptime };
    const boot = (options.now ?? Date.now)() - this.#os.uptime() * 1e3;
    this.#boot = Number.isFinite(boot) ? Math.floor(boot / 1e3) * 1e3 : null;
  }
  clockTicks() {
    return CLOCK_TICKS;
  }
  bootTime() {
    return this.#boot;
  }
  processTable(pids3, since) {
    if (pids3?.length === 0 && since === void 0) return /* @__PURE__ */ new Map();
    this.#last = this.#read();
    const wanted = pids3 === void 0 ? null : new Set(pids3);
    const table = /* @__PURE__ */ new Map();
    for (const [pid, line] of this.#last)
      if ((wanted?.has(pid) ?? true) || since !== void 0 && !since.has(pid))
        table.set(pid, line.row);
    return table;
  }
  cmdline(pid) {
    return this.#last.get(pid)?.args ?? null;
  }
  markOf() {
    return null;
  }
  memory(pid) {
    const line = this.#last.get(pid);
    return line === void 0 ? null : { bytes: line.rssBytes, swapBytes: null };
  }
  fds() {
    return null;
  }
  /** `lsof -F pn` prints a `p<pid>` line, then each file's `f<fd>` and `n<name>` lines. */
  cwds(pids3) {
    if (pids3.length === 0) return /* @__PURE__ */ new Map();
    const text2 = this.#run("lsof", ["-d", "cwd", "-F", "pn"]);
    if (text2 === null) return null;
    const wanted = new Set(pids3);
    const cwds = /* @__PURE__ */ new Map();
    let pid = null;
    let fd = null;
    for (const line of text2.split("\n")) {
      const value = line.slice(1);
      if (line.startsWith("p")) {
        pid = /^\d+$/.test(value) ? Number(value) : null;
        fd = null;
      } else if (line.startsWith("f")) fd = value;
      else if (line.startsWith("n") && pid !== null && (fd ?? "cwd") === "cwd" && wanted.has(pid))
        cwds.set(pid, value);
    }
    return cwds;
  }
  locks() {
    return null;
  }
  fileKey() {
    return null;
  }
  unixListeners() {
    return null;
  }
  unixSockets() {
    return null;
  }
  pidNamespace() {
    return null;
  }
  host() {
    const load = this.#os.loadavg();
    const memTotal = this.#os.totalmem();
    const used = usedMemory(this.#run("vm_stat", []));
    const swap = swapUsage(this.#run("sysctl", ["-n", "vm.swapusage"]));
    return {
      load: load.length === 3 && load.every(Number.isFinite) ? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0] : null,
      cpuPressure: null,
      memoryPressure: null,
      memTotal,
      memAvailable: used === null ? null : Math.max(0, memTotal - used),
      swapTotal: swap?.total ?? null,
      swapUsed: swap?.used ?? null,
      cpuTime: cpuTime(this.#os.cpus()),
      cpus: this.#os.availableParallelism()
    };
  }
  /**
   * Rows by pid; a line that does not parse (a header, a cut line, a `-`
   * value) is left out. A `ps` that failed throws: no table is no snapshot
   * (D1's exit 3), never a host without daemons (`reviews/wave-2.md` B4).
   */
  #read() {
    const output = this.#run("env", PS);
    if (output === null)
      throw new Error("the process table cannot be read: ps failed, is missing or timed out");
    const lines = /* @__PURE__ */ new Map();
    for (const text2 of output.split("\n")) {
      const line = this.#line(text2);
      if (line !== null) lines.set(line.row.pid, line);
    }
    return lines;
  }
  #line(text2) {
    const m = ROW.exec(text2);
    if (m === null) return null;
    const [
      ,
      pid,
      ppid,
      pgid,
      uid,
      nice,
      time = "",
      rss,
      month = "",
      day,
      h,
      min,
      s,
      year,
      command2 = ""
    ] = m;
    const cpuTicks = ticksOf(time);
    const start = localTime(Number(year), month, Number(day), [h, min, s].map(Number));
    if (cpuTicks === null || start === null) return null;
    const args = command2 === "" ? null : command2.split(" ");
    return {
      row: {
        pid: Number(pid),
        ppid: Number(ppid),
        pgid: Number(pgid),
        comm: basename(args?.[0] ?? ""),
        state: null,
        startTicks: Math.round((start - (this.#boot ?? 0)) * CLOCK_TICKS / 1e3),
        cpuTicks,
        // `time=` is the process's own; `-S`, which adds the children's, would hide it.
        childTicks: null,
        nice: Number(nice),
        uid: Number(uid)
      },
      args,
      rssBytes: Number(rss) * 1024
    };
  }
};
function ticksOf(time) {
  const m = TIME.exec(time);
  if (m === null) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0", fraction = "0"] = m;
  const total = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return total * CLOCK_TICKS + Math.round(Number(`0.${fraction}`) * CLOCK_TICKS);
}
function localTime(year, month, day, time) {
  const index = MONTHS.indexOf(month);
  const [hours = 0, minutes = 0, seconds = 0] = time;
  const date = new Date(year, index, day, hours, minutes, seconds);
  return index < 0 || date.getDate() !== day || date.getMonth() !== index ? null : date.getTime();
}
function usedMemory(text2) {
  const pageSize = /page size of (\d+) bytes/.exec(text2 ?? "")?.[1];
  const pages = /* @__PURE__ */ new Map();
  for (const m of (text2 ?? "").matchAll(/^([^:\n]+):\s+(\d+)\.$/gm))
    pages.set(m[1] ?? "", Number(m[2]));
  const counts = [
    "Anonymous pages",
    "Pages purgeable",
    "Pages wired down",
    "Pages occupied by compressor"
  ].map((name) => pages.get(name));
  const [anonymous, purgeable, wired, compressed] = counts;
  if (pageSize === void 0 || counts.some((n) => n === void 0)) return null;
  return ((anonymous ?? 0) - (purgeable ?? 0) + (wired ?? 0) + (compressed ?? 0)) * Number(pageSize);
}
function swapUsage(text2) {
  const bytes2 = (name) => {
    const m = new RegExp(`\\b${name} = ([\\d.]+)([KMG])`).exec(text2 ?? "");
    if (m === null) return null;
    return Number(m[1]) * 1024 ** ("KMG".indexOf(m[2] ?? "") + 1);
  };
  const total = bytes2("total");
  const used = bytes2("used");
  return total === null || used === null ? null : { total, used };
}
function cpuTime(cpus3) {
  if (cpus3.length === 0) return null;
  let busy = 0;
  let total = 0;
  for (const { times } of cpus3) {
    busy += times.user + times.nice + times.sys + times.irq;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { busy: busy * CLOCK_TICKS / 1e3, total: total * CLOCK_TICKS / 1e3 };
}

// src/core/ps/flags.ts
import { existsSync as existsSync2, readdirSync as readdirSync4, readFileSync as readFileSync5 } from "node:fs";
import { join as join9 } from "node:path";

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

// src/core/types/store.ts
var WORKTREE_META_ROWS = {
  turn: { prefix: "turn:", owner: "delivery/turn" },
  edits: { prefix: "edits:", owner: "delivery/edits" },
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
  leaving: { prefix: "leaving:", owner: "delivery/leaving" },
  notes: { prefix: "notes.", owner: "types/scheduler" },
  refined: { prefix: "refined.", owner: "types/scheduler" },
  awaitingInstall: { prefix: "awaiting-install.", owner: "types/scheduler" },
  installCommand: { prefix: "install-command.", owner: "types/scheduler" },
  checkpoint: { prefix: "checkpoint.", owner: "types/scheduler" },
  checkpointLanes: { prefix: "checkpoint-lanes.", owner: "store/repos/runs" },
  headMove: { prefix: "head-move.", owner: "types/scheduler" },
  daemonBootstrapped: { prefix: "daemon-bootstrapped:", owner: "types/daemon" },
  daemonToken: { prefix: "daemon-token:", owner: "store/repos/worktrees" },
  daemonExit: { prefix: "daemon-exit:", owner: "types/daemon" },
  daemonRest: { prefix: "daemon-rest:", owner: "types/daemon" },
  daemonUsed: { prefix: "daemon-used:", owner: "daemon/last-use" },
  daemonStopped: { prefix: "daemon-stopped:", owner: "delivery/stopped" },
  daemonHandoff: { prefix: "daemon-handoff:", owner: "delivery/handoff" },
  slowTier: { prefix: "slow-tier:", owner: "slow/state" },
  slowEvidence: { prefix: "slow-evidence:", owner: "slow/rank-store" },
  failureKeys: { prefix: "failure-keys:", owner: "slow/state" },
  failureProducers: { prefix: "failure-producers:", owner: "state/producers" },
  reruns: { prefix: "reruns:", owner: "scheduler/rerun-memory" },
  heldFiles: { prefix: "held-files:", owner: "scheduler/held" },
  promotions: { prefix: "promotions:", owner: "scheduler/promotions" },
  yields: { prefix: "yields:", owner: "scheduler/yields" },
  quiet: { prefix: "quiet:", owner: "scheduler/quiet" },
  rekeyed: { prefix: "rekeyed.", owner: "scheduler/rekeyed-record" },
  rekeyedMoves: { prefix: "rekeyed-moves.", owner: "scheduler/rekeyed-moves" },
  optimizerOff: { prefix: "optimizer-off.", owner: "state/optimizer-note" },
  baselineFindings: { prefix: "state.baseline-findings.", owner: "state/baseline" },
  stopWait: { prefix: "stop-wait:", owner: "slow/stop-wait" },
  testCommandDenied: { prefix: "test-command-denied:", owner: "delivery/test-command-denied" },
  ignoredReads: { prefix: "ignored-reads:", owner: "scheduler/ignored-reads" },
  omittedTestFiles: { prefix: "omitted-test-files:", owner: "scheduler/omitted-test-files" },
  unknownFiles: { prefix: "unknown-files:", owner: "scheduler/unknown-files" }
};
function worktreeMetaKey(row2, worktreeId) {
  return `${WORKTREE_META_ROWS[row2].prefix}${worktreeId}`;
}

// src/core/types/policy.ts
var DEFAULT_POLICY = {
  interrupt: { onRegression: true },
  stop: {
    blockOnKnownFailures: false,
    requireFullSuite: false,
    waitMs: 0,
    requireSlowSuite: false,
    slowWaitMs: 12e4
  },
  testCommand: { denyWhenCurrent: false },
  baseline: { onStart: "lookup-then-run-missing" },
  inputs: [],
  observe: { runtimeInputs: true },
  env: { allowlist: [] },
  runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 6e5 },
  nodeTest: [],
  pytest: [],
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
  store: { retentionDays: 7, maxSizeMb: null }
};

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

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

// src/core/daemon/policy.ts
import { join as join3 } from "node:path";

// src/core/daemon/policy-node-test.ts
import { isAbsolute as isAbsolute3, posix } from "node:path";
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
  return isAbsolute3(v) || normal === ".." || normal.startsWith("../") ? "a path inside the worktree, relative to its root" : null;
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
  const named = nonEmptyString(entry.name) === null ? entry.name : null;
  const skipped = named === null ? "it is skipped" : `project ${JSON.stringify(named)} is skipped`;
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
  if (kept.some((project) => project.name === named)) {
    return `"${at}.name" repeats ${JSON.stringify(named)} of an earlier project; it is skipped`;
  }
  return null;
}

// src/core/daemon/policy-pytest.ts
import { isAbsolute as isAbsolute4, posix as posix2 } from "node:path";
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
  if (python === void 0 || isAbsolute4(python)) return null;
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
var POLICY_FILE = "squeal.config.json";
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
function loadPolicy(root) {
  const { value, problems } = loadConfigFile(join3(root, POLICY_FILE), SHAPE, DEFAULT_POLICY);
  return { policy: value, problems };
}
function readPolicy(root) {
  return loadPolicy(root).policy;
}
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/daemon/lock.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// src/core/store/connection.ts
import { AsyncLocalStorage } from "node:async_hooks";
var slices = new AsyncLocalStorage();

// src/core/store/open.ts
import { DatabaseSync } from "node:sqlite";

// src/core/store/paths.ts
import { join as join4 } from "node:path";
function storePaths(commonDir) {
  const dir = join4(commonDir, "squeal");
  return {
    dir,
    database: join4(dir, "store.sqlite"),
    runsDir: join4(dir, "runs"),
    locksDir: join4(dir, "locks")
  };
}
function lockFileFor(commonDir, worktreeId) {
  return join4(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
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

// src/core/daemon/test-pause.ts
import { channel } from "node:diagnostics_channel";
var TEST_PAUSE_CHANNEL = "squeal:test-pause";
var pauses = channel(TEST_PAUSE_CHANNEL);

// src/core/slow/slot.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/delivery/handoff.ts
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;

// src/core/status/stopping.ts
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);

// src/core/status/open.ts
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/ps/measure.ts
var takeSample = (source, pids3, since) => {
  const before = performance.now();
  const table = source.processTable(pids3, since);
  const cpuTime4 = source.host().cpuTime;
  return { atMs: (before + performance.now()) / 2, table, cpuTime: cpuTime4 };
};
function below(table, pids3) {
  const children = /* @__PURE__ */ new Map();
  for (const row2 of table.values())
    children.set(row2.ppid, [...children.get(row2.ppid) ?? [], row2.pid]);
  const all2 = /* @__PURE__ */ new Set();
  const next = [...pids3];
  for (let pid = next.pop(); pid !== void 0; pid = next.pop()) {
    if (all2.has(pid)) continue;
    all2.add(pid);
    next.push(...children.get(pid) ?? []);
  }
  return [...all2];
}
var measure = (source, first, second, pids3) => {
  const windowMs = second.atMs - first.atMs;
  const clockTicks = source.clockTicks();
  const rows = new Set(pids3);
  const tree = below(first.table, pids3);
  const inTree = new Set(tree);
  const lived = (pid) => {
    const before = first.table.get(pid);
    return before !== void 0 && second.table.get(pid)?.startTicks === before.startTicks;
  };
  const steps = inTree.size + second.table.size;
  const homeOf = (pid) => {
    let p = pid;
    for (let n = 0; p !== void 0 && inTree.has(p) && n <= steps; n++) {
      if (rows.has(p) && lived(p)) return p;
      p = first.table.get(p)?.ppid;
    }
    return null;
  };
  const homeAfter = (pid) => {
    let p = pid;
    for (let n = 0; p !== void 0 && n <= steps; n++) {
      if (lived(p)) return homeOf(p);
      const row2 = second.table.get(p);
      if (row2 === void 0) return null;
      if (rows.has(p) && !first.table.has(p)) return p;
      p = row2.ppid;
    }
    return null;
  };
  const counted2 = /* @__PURE__ */ new Map();
  const count2 = (home, ticks) => {
    if (home !== null) counted2.set(home, (counted2.get(home) ?? 0) + ticks);
  };
  const endedUnder = /* @__PURE__ */ new Map();
  for (const pid of tree) {
    const before = first.table.get(pid);
    if (before === void 0) continue;
    const after = second.table.get(pid);
    if (after !== void 0 && after.startTicks === before.startTicks) {
      const home = homeOf(pid);
      if (!rows.has(pid)) count2(home, after.cpuTicks - before.cpuTicks);
      count2(home, (after.childTicks ?? 0) - (before.childTicks ?? 0));
      continue;
    }
    endedUnder.set(before.ppid, [...endedUnder.get(before.ppid) ?? [], before]);
  }
  const reapedBy = /* @__PURE__ */ new Map();
  const unsure = /* @__PURE__ */ new Set();
  for (const [ppid, ended] of endedUnder) {
    const parent = first.table.get(ppid);
    const home = homeOf(ppid);
    if (parent === void 0 || parent.childTicks === null || home === null) continue;
    const had = ended.reduce((n, p) => n + p.cpuTicks + (p.childTicks ?? 0), 0);
    count2(home, -had);
    const later = second.table.get(ppid);
    const grew = later === void 0 || later.childTicks === null ? null : later.childTicks - parent.childTicks;
    const waited = lived(ppid) && later?.state !== "Z" && grew !== null && grew >= had;
    for (const p of ended) {
      if (waited) reapedBy.set(p.pid, home);
      else unsure.add(rows.has(p.pid) ? p.pid : home);
    }
  }
  for (const [pid, after] of second.table) {
    if (first.table.get(pid)?.startTicks === after.startTicks) continue;
    count2(homeAfter(pid), after.cpuTicks + (after.childTicks ?? 0));
  }
  const costs = /* @__PURE__ */ new Map();
  for (const pid of pids3) {
    const before = first.table.get(pid);
    const after = second.table.get(pid);
    const now = before === void 0 || after?.startTicks === before.startTicks ? after : void 0;
    const last = now ?? before;
    if (last === void 0) continue;
    const own = now === void 0 ? null : now.cpuTicks - (before?.cpuTicks ?? now.cpuTicks);
    const ticks = own === null || own < 0 ? null : own + Math.max(0, counted2.get(pid) ?? 0);
    const ended = now === void 0 || now.state === "Z";
    const memory = ended ? null : source.memory(pid);
    costs.set(pid, {
      cpuPct: ticks === null || windowMs <= 0 ? null : ticksToMs(ticks, clockTicks) / windowMs * 100,
      cpuMs: ticksToMs(last.cpuTicks, clockTicks),
      privateBytes: memory?.bytes ?? null,
      swapBytes: memory?.swapBytes ?? null,
      reapedBy: reapedBy.get(pid) ?? null,
      reaperUnknown: unsure.has(pid),
      left: ended,
      childCpuUnread: ticks !== null && now?.childTicks === null
    });
  }
  return costs;
};
function sumCosts(costs) {
  const sum = (value, out) => {
    const known = costs.flatMap((c) => value(c) ?? []);
    const skipped = costs.filter(out).length;
    const total = known.length === 0 && skipped > 0 ? null : known.reduce((a, b) => a + b, 0);
    return { total, skipped };
  };
  const cpu = sum(
    (c) => c.cpuPct,
    (c) => c.cpuPct === null ? c.reapedBy === null : c.reaperUnknown || c.childCpuUnread
  );
  const memory = sum(
    (c) => c.privateBytes,
    (c) => c.privateBytes === null && !c.left
  );
  const swap = sum(
    (c) => c.swapBytes,
    (c) => c.swapBytes === null && !c.left
  );
  return {
    cpuPct: cpu.total,
    cpuMs: costs.reduce((a, c) => a + c.cpuMs, 0),
    privateBytes: memory.total,
    swapBytes: swap.total,
    skipped: { cpuPct: cpu.skipped, privateBytes: memory.skipped, swapBytes: swap.skipped }
  };
}

// src/core/ps/proc.ts
import { readdirSync, readFileSync as readFileSync3, readlinkSync, statSync } from "node:fs";
import { availableParallelism as availableParallelism3 } from "node:os";
import { join as join5 } from "node:path";
var CLOCK_TICKS2 = 100;
var MARK = Buffer.from("SQUEAL_DAEMON_CHILD=");
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
    this.#proc = join5(options.root ?? "/", "proc");
    this.#cpus = options.availableParallelism ?? availableParallelism3;
    this.#run = options.run ?? runCommand;
  }
  clockTicks() {
    return CLOCK_TICKS2;
  }
  bootTime() {
    const seconds = /^btime (\d+)$/m.exec(this.#read("stat") ?? "")?.[1];
    return seconds === void 0 ? null : Number(seconds) * 1e3;
  }
  processTable(pids3, since) {
    const table = /* @__PURE__ */ new Map();
    const born = since === void 0 ? [] : this.#pids().filter((pid) => !since.has(pid));
    for (const pid of pids3 === void 0 ? this.#pids() : /* @__PURE__ */ new Set([...pids3, ...born])) {
      const row2 = this.#row(pid);
      if (row2 !== null) table.set(pid, row2);
    }
    return table;
  }
  cmdline(pid) {
    const text2 = this.#read(`${pid}/cmdline`);
    if (text2 === null) return null;
    const args = text2.split("\0");
    if (args.at(-1) === "") args.pop();
    return args;
  }
  markOf(pid) {
    const bytes2 = this.#bytes(`${pid}/environ`);
    if (bytes2 === null) return null;
    for (let at = bytes2.indexOf(MARK); at >= 0; at = bytes2.indexOf(MARK, at + 1)) {
      if (at > 0 && bytes2[at - 1] !== 0) continue;
      const start = at + MARK.length;
      const end = bytes2.indexOf(0, start);
      return bytes2.toString("utf8", start, end < 0 ? bytes2.length : end);
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
    const dir = join5(this.#proc, String(pid), "fd");
    let names3;
    try {
      names3 = readdirSync(dir);
    } catch {
      return null;
    }
    const targets = [];
    for (const fd of names3.filter(isPid).map(Number).sort((a, b) => a - b)) {
      const target = this.#link(`${pid}/fd/${fd}`);
      if (target !== null) targets.push(target);
    }
    return targets;
  }
  cwds(pids3) {
    const cwds = /* @__PURE__ */ new Map();
    for (const pid of pids3) {
      const cwd = this.#link(`${pid}/cwd`);
      if (cwd !== null) cwds.set(pid, cwd);
    }
    return cwds;
  }
  locks() {
    const text2 = this.#read("locks");
    if (text2 === null) return null;
    const locks = [];
    for (const line of text2.split("\n")) {
      const m = /^\s*\d+:\s+((?:->\s*)+)?(\S+)\s+\S+\s+(READ|WRITE)\s+(-?\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(
        line
      );
      if (m === null) continue;
      const [, arrow, kind = "", access = "", pid = "", major = "", minor = "", inode = ""] = m;
      locks.push({
        kind,
        access: access.toUpperCase() === "WRITE" ? "write" : "read",
        pid: Number(pid) > 0 ? Number(pid) : null,
        file: `${hex(BigInt(`0x${major}`))}:${hex(BigInt(`0x${minor}`))}:${inode}`,
        blocked: arrow !== void 0
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
    const text2 = this.#run("ss", ["-xle"]);
    if (text2 === null) return null;
    const listeners = [];
    for (const line of text2.split("\n")) {
      const m = /^u_\w+\s+LISTEN\s+\d+\s+\d+\s+(.+?)\s+(\d+)\s+\*\s+\d+\b.*?\bino:(\d+)\b/.exec(
        line
      );
      if (m === null) continue;
      const [, path = "", socketInode, fileInode] = m;
      listeners.push({ path, socketInode: Number(socketInode), fileInode: Number(fileInode) });
    }
    return listeners;
  }
  unixSockets() {
    const text2 = this.#read("net/unix");
    if (text2 === null) return null;
    return text2.split("\n").flatMap((line) => /^\s*[0-9a-f]+:(?:\s+[0-9A-F]+){5}\s+\d+ (.+)$/.exec(line)?.[1] ?? []);
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
      cpuTime: cpuTime2(this.#read("stat")),
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
    const text2 = this.#read(`${pid}/stat`);
    if (text2 === null) return null;
    const open = text2.indexOf("(");
    const close = text2.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const f = text2.slice(close + 2).split(" ");
    const [ppid, pgid, utime, stime, cutime, cstime, nice, startTicks] = [
      f[1],
      f[2],
      f[11],
      f[12],
      f[13],
      f[14],
      f[16],
      f[19]
    ].map(Number);
    const numbers = [ppid, pgid, utime, stime, cutime, cstime, nice, startTicks];
    if (!numbers.every(Number.isInteger)) return null;
    return {
      pid,
      ppid: ppid ?? 0,
      pgid: pgid ?? 0,
      comm: text2.slice(open + 1, close),
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
      return statSync(join5(this.#proc, String(pid))).uid;
    } catch {
      return null;
    }
  }
  #read(path) {
    try {
      return readFileSync3(join5(this.#proc, path), "utf8");
    } catch {
      return null;
    }
  }
  #bytes(path) {
    try {
      return readFileSync3(join5(this.#proc, path));
    } catch {
      return null;
    }
  }
  #link(path) {
    try {
      return readlinkSync(join5(this.#proc, path));
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
function kilobytes(text2) {
  const values = /* @__PURE__ */ new Map();
  for (const m of (text2 ?? "").matchAll(/^(\w+):\s+(\d+) kB$/gm))
    values.set(m[1] ?? "", Number(m[2]) * 1024);
  return values;
}
function pressure(text2) {
  const values = /* @__PURE__ */ new Map();
  for (const m of (text2 ?? "").matchAll(/^(\w+) avg10=([\d.]+)/gm))
    values.set(m[1] ?? "", Number(m[2]));
  return values;
}
function cpuTime2(text2) {
  const line = /^cpu\s+(.*)$/m.exec(text2 ?? "")?.[1];
  if (line === void 0) return null;
  const ticks = line.trim().split(/\s+/).slice(0, 8).map(Number);
  if (ticks.length < 5 || !ticks.every(Number.isFinite)) return null;
  const total = ticks.reduce((a, b) => a + b, 0);
  return { busy: total - (ticks[3] ?? 0) - (ticks[4] ?? 0), total };
}

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

// src/core/status/snapshot.ts
var HEARTBEAT_GRACE_INTERVALS = 2;

// src/core/ps/discover.ts
import { readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute5, join as join6 } from "node:path";
var START_MARGIN_MS = 1e3;
var NODE_COMMS = /* @__PURE__ */ new Set(["MainThread", "node"]);
var SCRIPT = /(?:^|\/)(?:squeal|squeal\.mjs|squeal\/dist\/cli\/index\.js)$/;
var LOCK_FILE = /^(.+)\/squeal\/locks\/([0-9a-f]{16})\.sqlite$/;
var SOCKET_FILE = /^squeal-([0-9a-f]{16})\.sock$/;
var HOLDERS = "daemon lock holders";
var CACHE_INSTALL = /\/\.(claude|codex)\/plugins\/cache\/[^/]+\/squeal\/([^/]+)\//;
var PACKAGE_INSTALL = /\/squeal-(pi|opencode)\/dist\/cli\/squeal\.mjs$/;
var discover = (source, table, places, locks = source.locks()) => {
  const unknown = [];
  if (locks === null) {
    const why = "they cannot be read: a phase is serving by its heartbeat, or unknown (D10)";
    unknown.push({ what: HOLDERS, why });
  }
  const daemons = [];
  for (const row2 of table.values()) {
    if (!NODE_COMMS.has(row2.comm)) continue;
    if (row2.uid !== null && row2.uid !== places.uid) continue;
    const args = source.cmdline(row2.pid);
    const at = args === null ? -1 : daemonVerbAt(args);
    if (args === null || at < 0) continue;
    const daemon = found(source, row2, args, at, locks);
    if (daemon.worktreeId === null) {
      const why = daemon.root === null ? "no lock file is open and the root in its arguments is relative" : `no lock file is open and its root ${daemon.root} cannot be read`;
      unknown.push({ what: `daemon ${row2.pid} worktreeId`, why });
    }
    daemons.push(daemon);
  }
  return { daemons, sockets: socketFiles(source, places, daemons), unknown };
};
function lockedAgain(source, discovery, [first, second]) {
  const both = first !== null && second !== null;
  if (first === null && second === null) return discovery;
  if (both && discovery.daemons.every((d) => d.holdsLock !== false)) return discovery;
  const daemons = discovery.daemons.map((d) => {
    const shown = d.holdsLock === true || second !== null && holds(source, d.row.pid, d.lockPath, second) === true;
    const held = shown ? true : both && d.holdsLock === false ? false : null;
    return held === d.holdsLock ? d : { ...d, holdsLock: held };
  });
  const sockets = discovery.sockets.map(
    (s) => s.daemonPid === null ? { ...s, daemonPid: holderOf(daemons, s.worktreeId) } : s
  );
  if (both) return { ...discovery, daemons, sockets };
  const [lost, read] = first === null ? ["first", "second"] : ["second", "first"];
  const why = `the window's ${lost} /proc/locks reading cannot be read, so a lock the ${read} misses is unknown, not absent: a phase is serving by its heartbeat, or unknown`;
  const unknown = discovery.unknown.filter((u) => u.what !== HOLDERS);
  return { daemons, sockets, unknown: [...unknown, { what: HOLDERS, why }] };
}
function ownStartOn(source) {
  const boot = source.bootTime();
  const ticks = source.clockTicks();
  return (daemon, startedAt) => boot === null ? null : startedAt >= boot + ticksToMs(daemon.row.startTicks, ticks) - START_MARGIN_MS;
}
function phaseOn(source) {
  const ownStart = ownStartOn(source);
  return (daemon, work, now) => {
    if (daemon.holdsLock === false) return "waiting";
    if (work === null) return "unknown";
    const own = (startedAt) => ownStart(daemon, startedAt);
    const record = work.record;
    if (daemon.holdsLock === null) {
      const fresh = record !== null && record.heartbeatAt >= now - HEARTBEAT_GRACE_INTERVALS * record.heartbeatIntervalMs;
      return fresh && own(record.startedAt) === true ? "serving" : "unknown";
    }
    const recorded = work.recordedStartedAt;
    if (recorded === null) return "starting";
    const mine = own(recorded);
    if (mine === null) return "unknown";
    if (!mine) return "starting";
    return record === null ? "stopping" : "serving";
  };
}
function daemonVerbAt(args) {
  for (let k = 1; k < args.length; k++) {
    if (args[k] === "daemon" && SCRIPT.test(args[k - 1] ?? "")) return k;
  }
  return -1;
}
function found(source, row2, args, at, locks) {
  const script = args[at - 1] ?? "";
  const given = args[at + 1];
  const root = given !== void 0 && isAbsolute5(given) ? given : null;
  const fromFd = lockFd(source.fds(row2.pid));
  const lock = fromFd ?? (root === null ? null : lockOfRoot(root));
  const commonDir = lock?.commonDir ?? null;
  const lockPath = lock?.lockPath ?? null;
  return {
    row: row2,
    script,
    root,
    awaitLock: args.slice(at + 2).includes("--await-lock"),
    ...installOf(script),
    worktreeId: lock?.worktreeId ?? null,
    idFrom: lock === null ? null : fromFd === null ? "root-hash" : "lock-fd",
    lockPath,
    commonDir,
    storePath: commonDir === null ? null : storePaths(commonDir).database,
    holdsLock: holds(source, row2.pid, lockPath, locks)
  };
}
function lockFd(fds) {
  for (const target of fds ?? []) {
    const m = LOCK_FILE.exec(target);
    if (m !== null) return { worktreeId: m[2] ?? "", commonDir: m[1] ?? "", lockPath: target };
  }
  return null;
}
function lockOfRoot(root) {
  try {
    const worktreeId = worktreeIdFor(root);
    const commonDir = resolveCommonDir(root);
    return {
      worktreeId,
      commonDir,
      lockPath: commonDir === null ? null : lockFileFor(commonDir, worktreeId)
    };
  } catch {
    return null;
  }
}
function holds(source, pid, lockPath, locks) {
  if (locks === null || lockPath === null) return null;
  const file = source.fileKey(lockPath);
  return locks.some((l) => l.pid === pid && l.file === file && l.access === "write" && !l.blocked);
}
function installOf(script) {
  const cache = CACHE_INSTALL.exec(script);
  if (cache !== null) return { harness: cache[1] ?? null, version: cache[2] ?? null };
  return { harness: PACKAGE_INSTALL.exec(script)?.[1] ?? null, version: null };
}
function socketFiles(source, places, daemons) {
  const listeners = source.unixListeners();
  const dirs = /* @__PURE__ */ new Set([places.runtimeDir, join6(places.tempDir, `squeal-${places.uid}`)]);
  const sockets = [];
  for (const dir of dirs) {
    if (dir === null) continue;
    for (const name of names(dir)) {
      const worktreeId = SOCKET_FILE.exec(name)?.[1];
      if (worktreeId === void 0) continue;
      const path = join6(dir, name);
      let stat;
      try {
        stat = statSync2(path);
      } catch {
        continue;
      }
      sockets.push({
        path,
        worktreeId,
        mtimeMs: stat.mtimeMs,
        daemonPid: holderOf(daemons, worktreeId),
        listening: listeners === null ? null : listeners.some((l) => l.fileInode === stat.ino)
      });
    }
  }
  return sockets;
}
function holderOf(daemons, worktreeId) {
  return daemons.find((d) => d.worktreeId === worktreeId && (d.holdsLock ?? true))?.row.pid ?? null;
}
function names(dir) {
  try {
    return readdirSync2(dir).sort();
  } catch {
    return [];
  }
}

// src/core/ps/flags-files.ts
import { join as join8 } from "node:path";

// src/core/ps/flags-leftovers.ts
import { createHash as createHash2 } from "node:crypto";
import {
  lstatSync as lstatSync2,
  readdirSync as readdirSync3,
  readFileSync as readFileSync4,
  realpathSync as realpathSync2
} from "node:fs";
import { join as join7 } from "node:path";

// src/core/ps/flags-text.ts
var SAFE_WORD = /^[\w@%+=:,./-]+$/;
var NO_BOOT = "the boot time cannot be read, so no process has an age";
function shellQuote(word) {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
function dateOf(ms) {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function duration(ms) {
  const s = Math.floor(ms / 1e3);
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// src/core/ps/render-units.ts
var KIB = 1024;
var MIB = KIB * 1024;
var GIB = MIB * 1024;
var UNKNOWN = "?";
function count(n, one, many = `${one}s`) {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}
function thousands(n) {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ",");
}
function share(value) {
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}
function percent(value) {
  return value === null ? UNKNOWN : `${Math.round(value)}%`;
}
function cpus2(value) {
  return (value / 100).toFixed(1);
}
function bytes(n, column = false) {
  if (n === null) return column ? UNKNOWN : "unknown";
  if (n === 0) return "0";
  const [value, unit] = n >= GIB ? [(n / GIB).toFixed(1), "G"] : n >= MIB ? [String(Math.round(n / MIB)), "M"] : [String(Math.round(n / KIB)), "K"];
  return column ? `${value}${unit}` : `${value} ${unit}iB`;
}
function ofGib(part, whole) {
  return `${(part / GIB).toFixed(1)} of ${(whole / GIB).toFixed(1)} GiB`;
}
function age(since, at) {
  return since === null ? UNKNOWN : duration2(at - since);
}
function duration2(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  if (s < 60) return `${s}s`;
  if (s < 100 * 60) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function cpuTime3(ms) {
  if (ms === null) return UNKNOWN;
  const s = Math.floor(ms / 1e3);
  const two = (n) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${two(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${two(Math.floor(s / 60) % 60)}m`;
}

// src/core/ps/flags-leftovers.ts
var LEFTOVER_AGE_MS = 60 * 6e4;
var SIZE_WALK_ENTRIES = 1e4;
var DU = "`squeal ps --leftovers | xargs -d '\\n' du -sch --` sums them";
var KEY_DIR = /^([0-9a-f]{16})(?:\.old-[0-9a-f]{8})?$/;
var MADE = /^squeal-(?:e2e-(?:oc-|pi-)?|update-)[A-Za-z0-9]{6}$/;
function leftoverTemp(model, options, unknown) {
  const none = { flag: null, paths: [] };
  const keys = liveKeys(model);
  if (typeof keys === "string") {
    unknown.push({ what: "flag leftover-temp", why: keys });
    return none;
  }
  const { places } = model;
  const userDir = join7(places.tempDir, `squeal-${places.uid}`);
  const keyDirs = join7(userDir, "tmp");
  const fallback = new RegExp(`^squeal-${places.uid}-([0-9a-f]{16})-[A-Za-z0-9]{6}$`);
  const unkeyed = (pattern, name) => {
    const key = pattern.exec(name)?.[1];
    return key !== void 0 && !keys.has(key);
  };
  const candidates = [
    ...names2(keyDirs).filter((name) => unkeyed(KEY_DIR, name)).map((name) => join7(keyDirs, name)),
    ...names2(places.tempDir).filter((name) => MADE.test(name) || unkeyed(fallback, name)).map((name) => join7(places.tempDir, name))
  ];
  const old = /* @__PURE__ */ new Map();
  for (const path of candidates) {
    const stat = lstatOrNull2(path);
    if (stat === null || !stat.isDirectory() || stat.uid !== places.uid) continue;
    if (model.now - stat.mtimeMs > LEFTOVER_AGE_MS) old.set(path, stat);
  }
  if (old.size === 0) return none;
  const use = unusedPaths(model, keyDirs, [...old.keys()]);
  if (use === null) {
    const why = "the working directories of processes cannot be read (D10)";
    unknown.push({ what: "flag leftover-temp", why });
    return none;
  }
  const paths = use.unused;
  if (paths.length === 0) return none;
  const limit = options.sizeEntries ?? SIZE_WALK_ENTRIES;
  const bytes2 = options.full === true ? sizeOf(paths, old, limit) : null;
  const count2 = paths.length === 1 ? "1 directory" : `${paths.length} directories`;
  if (use.unread.length > 0) {
    const size = bytes2 === null ? "" : `, ${bytes(bytes2)},`;
    const why = `${count2} under ${places.tempDir} that no readable process uses${size} ${paths.length === 1 ? "is" : "are"} not listed, since ${use.unread.join(" and ")}`;
    unknown.push({ what: "flag leftover-temp", why, paths });
    return none;
  }
  if (bytes2 === null) {
    const why = options.full === true ? `the size walk stops at ${limit} entries; ${DU}` : `the size walk runs with --full only; ${DU}`;
    unknown.push({ what: "files leftover-temp bytes", why });
  }
  const oldest = Math.min(...paths.map((path) => old.get(path)?.mtimeMs ?? model.now));
  return {
    flag: {
      flag: "leftover-temp",
      reason: `${count2} under ${places.tempDir} that no live daemon's key names and no process uses, unchanged for over 1 h; the oldest since ${dateOf(oldest)}`,
      path: null,
      count: paths.length,
      bytes: bytes2,
      command: "squeal ps --leftovers | xargs -d '\\n' rm -rf --"
    },
    paths
  };
}
function liveKeys(model) {
  const keys = /* @__PURE__ */ new Set();
  for (const d of model.discovery.daemons) {
    if (d.root === null || d.commonDir === null)
      return `the temp key of daemon ${d.row.pid} is unknown: its root or repository cannot be read`;
    let id;
    try {
      id = readFileSync4(join7(storePaths(d.commonDir).dir, "repository-id"), "utf8").trim();
    } catch {
      continue;
    }
    const key = createHash2("sha256").update(`${id}\0${realOr(d.root)}`).digest("hex");
    keys.add(key.slice(0, 16));
  }
  return keys;
}
function unusedPaths(model, keyDirs, candidates) {
  const { places, source } = model;
  const pids3 = [...model.first.sample.table.values()].filter((row2) => row2.uid === null || row2.uid === places.uid).map((row2) => row2.pid);
  const cwds = source.cwds(pids3);
  if (cwds === null) return null;
  const at = `${places.tempDir}/squeal-`;
  const real = realOr(places.tempDir);
  const named = (text2) => text2.startsWith(`${real}/`) ? `${places.tempDir}${text2.slice(real.length)}` : text2;
  const unused = new Set(candidates);
  const use = (path) => {
    if (!path.startsWith(at)) return;
    const [top = "", sub, key] = path.slice(places.tempDir.length + 1).split("/", 3);
    unused.delete(join7(places.tempDir, top));
    if (top === `squeal-${places.uid}` && sub === "tmp" && key !== void 0 && key !== "")
      unused.delete(join7(keyDirs, key));
  };
  const unread = /* @__PURE__ */ new Set();
  for (const cwd of cwds.values()) use(named(cwd));
  for (const pid of pids3) {
    if (unused.size === 0) break;
    const args = source.cmdline(pid);
    if (args === null) unread.add(pid);
    for (const arg of args ?? []) {
      const path = named(arg);
      use(path.startsWith(at) ? path : named(arg.slice(arg.indexOf("=") + 1)));
    }
  }
  const sockets = unused.size === 0 ? [] : source.unixSockets();
  for (const path of sockets ?? []) use(named(path));
  for (const pid of pids3) {
    if (unused.size === 0) break;
    const fds = source.fds(pid);
    if (fds === null) unread.add(pid);
    for (const target of fds ?? []) use(named(target));
  }
  if (unused.size === 0) return { unused: [], unread: [] };
  return { unused: [...unused].sort(), unread: failedReads(model, sockets === null, unread) };
}
var NAMED = 5;
function failedReads(model, socketsUnread, pids3) {
  const reasons = socketsUnread ? ["the bound unix sockets cannot be read (D10)"] : [];
  const first = model.first.sample.table;
  const now = pids3.size === 0 ? /* @__PURE__ */ new Map() : model.source.processTable([...pids3]);
  const there = [...pids3].filter((pid) => {
    const row2 = now.get(pid);
    return row2 !== void 0 && row2.state !== "Z" && row2.startTicks === first.get(pid)?.startTicks;
  });
  if (there.length > 0) {
    const names3 = there.slice(0, NAMED).map((pid) => `${pid} ${first.get(pid)?.comm ?? "?"}`);
    const more = there.length > NAMED ? ` and ${there.length - NAMED} more` : "";
    const n = there.length === 1 ? "1 process cannot" : `${there.length} processes cannot`;
    reasons.push(`${n} be read: ${names3.join(", ")}${more}`);
  }
  return reasons;
}
function sizeOf(dirs, stats, limit) {
  let entries = 0;
  for (const dir of dirs) entries += Math.max(0, (stats.get(dir)?.nlink ?? 2) - 2);
  if (entries > limit) return null;
  const stack = [...dirs];
  entries = 0;
  let bytes2 = 0;
  for (let dir = stack.pop(); dir !== void 0; dir = stack.pop()) {
    let dirents;
    try {
      dirents = readdirSync3(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (++entries > limit) return null;
      const path = join7(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(path);
      else bytes2 += lstatOrNull2(path)?.size ?? 0;
    }
  }
  return bytes2;
}
function names2(dir) {
  try {
    return readdirSync3(dir).sort();
  } catch {
    return [];
  }
}
function lstatOrNull2(path) {
  try {
    return lstatSync2(path);
  } catch {
    return null;
  }
}
function realOr(path) {
  try {
    return realpathSync2(path);
  } catch {
    return path;
  }
}

// src/core/ps/flags-files.ts
var LOCK_FILE2 = /^[0-9a-f]{16}\.sqlite$/;
var WAITER_LOCK = /^waiter-.+\.sqlite$/;
var PERMIT = /^pool\.(\d+)\.lock$/;
var MARK2 = /^pool\.mark\.[^.]+$/;
function fileFlags(model, options = {}) {
  const unknown = [];
  const left = leftoverTemp(model, options, unknown);
  return {
    files: [
      ...staleSockets(model, unknown),
      ...stalePoolMarks(model),
      ...left.flag === null ? [] : [left.flag]
    ],
    unflagged: unflagged(model),
    leftovers: left.paths,
    unknown
  };
}
function staleSockets(model, unknown) {
  const flags = [];
  for (const socket of model.discovery.sockets) {
    if (socket.daemonPid !== null) continue;
    if (socket.listening === true) {
      const why = `a process listens at it, but no daemon of worktree ${socket.worktreeId} was found`;
      unknown.push({ what: `socket ${socket.path}`, why });
      continue;
    }
    flags.push({
      flag: "stale-socket",
      reason: `no live daemon of worktree ${socket.worktreeId} holds its lock; changed ${dateOf(socket.mtimeMs)}`,
      path: socket.path,
      count: 1,
      bytes: 0,
      command: `rm ${shellQuote(socket.path)}`
    });
  }
  return flags;
}
function stalePoolMarks(model) {
  const flags = [];
  for (const dir of poolDirs(model.places)) {
    for (const name of names2(dir)) {
      if (!MARK2.test(name)) continue;
      const path = join8(dir, name);
      const stat = lstatOrNull2(path);
      if (stat === null || !stat.isFile() || model.now - stat.mtimeMs <= SLOT_WAITER_FRESH_MS)
        continue;
      flags.push({
        flag: "stale-pool-mark",
        reason: `unchanged since ${dateOf(stat.mtimeMs)}; readers skip a mark older than ${SLOT_WAITER_FRESH_MS / 1e3} s`,
        path,
        count: 1,
        bytes: stat.size,
        command: `rm ${shellQuote(path)}`
      });
    }
  }
  return flags;
}
function unflagged(model) {
  const counts = /* @__PURE__ */ new Map();
  const count2 = (kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const commonDirs = new Set(
    [...model.discovery.daemons.map((d) => d.commonDir), model.places.commonDir].filter(
      (dir) => dir !== null
    )
  );
  for (const dir of commonDirs) {
    for (const name of names2(storePaths(dir).locksDir)) {
      if (LOCK_FILE2.test(name)) count2("lock");
      else if (WAITER_LOCK.test(name)) count2("waiter-lock");
    }
  }
  for (const dir of poolDirs(model.places)) {
    for (const name of names2(dir)) {
      const i = PERMIT.exec(name)?.[1];
      if (i !== void 0 && Number(i) >= model.pool.pool.slots) count2("surplus-permit");
    }
  }
  for (const dir of poolDirs(model.places, "squeal-sessions")) {
    for (const _ of names2(dir)) count2("session-root");
  }
  const kinds = [
    "lock",
    "waiter-lock",
    "surplus-permit",
    "session-root"
  ];
  return kinds.flatMap((kind) => {
    const n = counts.get(kind) ?? 0;
    return n === 0 ? [] : [{ kind, count: n }];
  });
}
function poolDirs(places, sub = "squeal") {
  const userDir = join8(places.tempDir, `squeal-${places.uid}`);
  const dirs = [sub === "squeal" ? userDir : join8(userDir, sub)];
  if (places.runtimeDir !== null) dirs.push(join8(places.runtimeDir, sub));
  return dirs;
}

// src/core/ps/flags-processes.ts
var ORPHAN_WINDOW_MS = 1e3;
var ORPHAN_AGE_MS = 6e4;
var OVERDUE_MS = 6e4;
var NODE_COMMS2 = /* @__PURE__ */ new Set(["MainThread", "node"]);
var WAITER = /\/dist\/waiter\.mjs$/;
function overdue(c) {
  const { model } = c;
  const out = /* @__PURE__ */ new Map();
  if (!model.source.readsMarks) return out;
  const table = model.second.sample.table;
  for (const p of model.second.attribution.processes) {
    const work = model.second.work.get(p.daemonPid) ?? model.first.work.get(p.daemonPid);
    if (work === void 0 || !Number.isFinite(work.settings.timeoutMs)) continue;
    const bound = work.settings.timeoutMs + OVERDUE_MS;
    for (const pid of [p.pid, ...p.descendants]) {
      const row2 = table.get(pid);
      if (row2 === void 0 || row2.ppid === p.daemonPid) continue;
      const age2 = c.ageOf(row2);
      if (age2 === null) c.name("flag overdue-test-process", NO_BOOT);
      if (age2 === null || age2 <= bound) continue;
      if (pid !== p.pid && model.source.markOf(pid) === null) continue;
      const who = pid === p.pid ? "it is" : `its descendant ${pid} (${row2.comm}) carries its mark, is not its daemon's child, and is`;
      const reason = `${who} ${duration(age2)} old, past runner.timeoutMs plus ${OVERDUE_MS / 1e3} s`;
      out.set(p.pid, [
        ...out.get(p.pid) ?? [],
        { flag: "overdue-test-process", reason, command: `kill ${pid}` }
      ]);
    }
  }
  return out;
}
function orphans(c) {
  const { model } = c;
  const table = model.second.sample.table;
  const byPid = /* @__PURE__ */ new Map();
  const add = (pid, flag3, reason) => byPid.set(pid, [...byPid.get(pid) ?? [], { flag: flag3, reason, command: `kill ${pid}` }]);
  for (const { pid, reason } of orphanTestProcesses(c)) add(pid, "orphan-test-process", reason);
  const host = model.first.sample.table;
  for (const row2 of host.values()) {
    if (!NODE_COMMS2.has(row2.comm) || row2.uid !== null && row2.uid !== model.places.uid) continue;
    if (!(model.source.cmdline(row2.pid) ?? []).some((a) => WAITER.test(a))) continue;
    const parent = host.get(row2.ppid);
    if (parent === void 0) add(row2.pid, "orphan-waiter", `its parent ${row2.ppid} is gone`);
    else if (row2.ppid === 1 || parent.comm === "systemd")
      add(
        row2.pid,
        "orphan-waiter",
        `its parent is ${parent.comm} ${row2.ppid}: its session is gone`
      );
  }
  for (const { pid, path } of model.pool.foreign)
    if (table.has(pid) || host.has(pid))
      add(pid, "foreign-permit", `it holds the pool permit ${path} and is no daemon`);
  return [...byPid].map(([pid, flags]) => {
    const row2 = table.get(pid) ?? host.get(pid);
    return {
      pid,
      comm: row2?.comm ?? "",
      startedAt: row2 === void 0 ? null : c.startOf(row2),
      flags
    };
  });
}
function orphanTestProcesses(c) {
  const { model } = c;
  if (!model.source.readsMarks) return [];
  for (const d of model.discovery.daemons) {
    const pid = d.row.pid;
    if ([model.first, model.second].some((r) => (r.work.get(pid)?.token ?? null) === null)) {
      c.name(
        "flag orphan-test-process",
        `the token of daemon ${pid} is unread, so a mark may be its`
      );
      return [];
    }
  }
  const windowMs = model.second.sample.atMs - model.first.sample.atMs;
  if (windowMs < ORPHAN_WINDOW_MS) {
    c.name(
      "flag orphan-test-process",
      `the samples are ${Math.round(windowMs)} ms apart, under 1 s`
    );
    return [];
  }
  const before = new Map(model.first.attribution.unowned.map((u) => [u.pid, u.mark]));
  const found2 = [];
  for (const { pid, mark } of model.second.attribution.unowned) {
    const a = model.first.sample.table.get(pid);
    const b = model.second.sample.table.get(pid);
    if (before.get(pid) !== mark || a === void 0 || a.startTicks !== b?.startTicks) continue;
    const age2 = c.ageOf(a);
    if (age2 === null || age2 < ORPHAN_AGE_MS) {
      const why = age2 === null ? NO_BOOT : `process ${pid}'s mark names no live daemon, but it is ${duration(age2)} old, under ${ORPHAN_AGE_MS / 1e3} s`;
      c.name("flag orphan-test-process", why);
      continue;
    }
    const token = mark.split(":")[0];
    found2.push({ pid, reason: `its mark's token ${token} names no live daemon, on both samples` });
  }
  return found2;
}

// src/core/ps/flags.ts
var NO_LOCK_MS = 4e4;
var AWAIT_LOCK_MS = 13e4;
var DEPARTURE_MS = 6e4;
var NOT_INSTALLED_MS = 60 * 6e4;
var CACHE = /^(.*\/\.(claude|codex)\/plugins)\/cache\/([^/]+)\/squeal\/[^/]+\//;
var NO_LOCKS = "the source has no lock state (D10)";
var ONE_READING = "one of the window's two /proc/locks readings cannot be read, so a lock the other misses is unknown, not absent";
var NO_MARKS = "the source reads no marks (D10)";
var flag2 = (model, options = {}) => {
  const unknown = [];
  const named = /* @__PURE__ */ new Set();
  const name = (what, why) => {
    if (named.has(`${what}
${why}`)) return;
    named.add(`${what}
${why}`);
    unknown.push({ what, why });
  };
  const { source } = model;
  if (model.locksRead !== "both")
    for (const what of ["flag no-lock", "flag hung", "flag foreign-permit", "phase stopping"])
      name(what, model.locksRead === "none" ? NO_LOCKS : ONE_READING);
  if (!source.readsMarks)
    for (const what of ["flag orphan-test-process", "flag overdue-test-process"])
      name(what, NO_MARKS);
  const boot = source.bootTime();
  const ticks = source.clockTicks();
  const startOf = (row2) => boot === null ? null : boot + ticksToMs(row2.startTicks, ticks);
  const ageOf = (row2) => {
    const start = startOf(row2);
    return start === null ? null : model.now - start;
  };
  const c = { model, phase: phaseOn(source), ageOf, startOf, name };
  const daemons = /* @__PURE__ */ new Map();
  const states = /* @__PURE__ */ new Map();
  const add = (pid, flags) => daemons.set(pid, [...daemons.get(pid) ?? [], ...flags]);
  for (const d of model.discovery.daemons) {
    const { flags, state } = daemonFlags(c, d);
    add(d.row.pid, flags);
    if (state !== null) states.set(d.row.pid, state);
  }
  for (const [pid, flags] of duplicates(c)) add(pid, flags);
  const files = fileFlags(model, options);
  return {
    daemons,
    states,
    processes: overdue(c),
    orphans: orphans(c),
    files: files.files,
    unflagged: files.unflagged,
    leftovers: files.leftovers,
    unknown: [...unknown, ...files.unknown]
  };
};
function drainLeftMs(work, now) {
  const departed = ownDeparture(work);
  if (work === null || departed === null) return null;
  if (work.slowWaiting !== true && work.checkpoints.length === 0) return null;
  const left = departed + work.settings.idleExitMinutes * 6e4 - now;
  return left > 0 ? left : null;
}
function ownDeparture(work) {
  if (work?.record == null || work.consumers.length > 0 || work.departedAt === null) return null;
  return work.departedAt >= work.record.startedAt ? work.departedAt : null;
}
function daemonFlags(c, d) {
  const { model } = c;
  const pid = d.row.pid;
  const work = model.second.work.get(pid) ?? model.first.work.get(pid) ?? null;
  const phase = c.phase(d, work, model.now);
  const flags = [];
  const add = (flag3, reason, command2) => flags.push({ flag: flag3, reason, command: command2 });
  const kill = `kill ${pid}`;
  const stop = d.root === null ? kill : `squeal stop ${shellQuote(d.root)}`;
  if (d.root === null) c.name(`daemon ${pid} flag root-gone`, "its root argument is relative");
  else {
    const gone = rootGone(d.root);
    if (gone !== null) add("root-gone", gone, kill);
  }
  const bundle = bundleOf(d.script);
  if (!existsSync2(bundle)) add("install-gone", `its bundle ${bundle} is missing`, stop);
  const older = olderOf(c, d, work);
  const life = phase === "serving" && work?.record != null ? lifeOf(c, pid, work, work.record.heartbeatIntervalMs) : null;
  let state = life?.state ?? null;
  if (typeof older === "string") state ??= older;
  else if (older !== null) {
    if (state === null) add("older", older.reason, stop);
    else state = `${state}, older`;
  }
  const age2 = c.ageOf(d.row);
  if (phase === "waiting") {
    const bound = d.awaitLock ? AWAIT_LOCK_MS : NO_LOCK_MS;
    if (age2 === null) c.name(`daemon ${pid} flag no-lock`, NO_BOOT);
    else if (age2 > bound)
      add("no-lock", `it has waited ${duration(age2)} for its lock, past ${bound / 1e3} s`, kill);
  }
  const hung = hungOf(c, d);
  if (hung !== null) add("hung", hung, `kill ${pid}; sleep 5; kill -9 ${pid}`);
  if (life?.flag != null) add(life.flag.flag, life.flag.reason, stop);
  for (const reason of deadConsumers(c, pid)) add("dead-consumer", reason, null);
  const home = model.places.home;
  const installed = d.harness !== null && within(d.script, home) || within(d.script, join9(home, ".local"));
  if (!installed && d.root !== null && within(d.root, model.places.tempDir)) {
    if (age2 === null) c.name(`daemon ${pid} flag not-installed`, NO_BOOT);
    else if (age2 > NOT_INSTALLED_MS)
      add(
        "not-installed",
        `its bundle is in no plugin cache, its root is under ${model.places.tempDir}, and it has run ${duration(age2)}`,
        kill
      );
  }
  return { flags, state };
}
function rootGone(root) {
  if (!existsSync2(root)) return `its root ${root} is missing`;
  let linked;
  try {
    linked = linkedWorktreeDir(root);
  } catch {
    return null;
  }
  return linked !== null && !existsSync2(linked) ? `the gitdir ${linked} its .git names is missing` : null;
}
function bundleOf(script) {
  const at = script.lastIndexOf("/dist/");
  return at < 0 ? script : script.slice(0, at + "/dist".length);
}
function olderOf(c, d, work) {
  const m = CACHE.exec(d.script);
  if (m === null || d.version === null) return null;
  const [, plugins = "", harness = "", marketplace = ""] = m;
  const newest = harness === "claude" ? claudeInstalled(plugins, marketplace, d.root) : codexNewest(plugins, marketplace);
  if (newest === null) {
    c.name(
      `daemon ${d.row.pid} flag older`,
      `no installed ${harness} version can be read under ${plugins}`
    );
    return null;
  }
  if (!isNewerVersion(newest, d.version)) return null;
  const old = (work?.consumers ?? []).filter(
    (x) => x.version === null || isNewerVersion(newest, x.version)
  );
  const holder = old.find((x) => x.alive === true);
  if (holder?.harness != null) return `older (session ${holder.harness.pid} holds it)`;
  if (old.some((x) => x.alive === null && x.harness !== null)) {
    const why = "a consumer of an older version has a harness process this PID namespace cannot see";
    c.name(`daemon ${d.row.pid} flag older`, why);
    return null;
  }
  return { reason: `version ${d.version}; ${harness} installs ${newest}` };
}
function claudeInstalled(plugins, marketplace, root) {
  let file;
  try {
    file = JSON.parse(readFileSync5(join9(plugins, "installed_plugins.json"), "utf8"));
  } catch {
    return null;
  }
  const entries = isRecord(file) && isRecord(file.plugins) ? file.plugins[`squeal@${marketplace}`] : null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry) || typeof entry.version !== "string") continue;
    if (entry.scope === "user" || entry.scope === "project" && entry.projectPath === root)
      return entry.version;
  }
  return null;
}
function codexNewest(plugins, marketplace) {
  let versions;
  try {
    versions = readdirSync4(join9(plugins, "cache", marketplace, "squeal"));
  } catch {
    return null;
  }
  let newest = null;
  for (const v of versions) if (newest === null || isNewerVersion(v, newest)) newest = v;
  return newest !== null && /^\d+\.\d+\.\d+$/.test(newest) ? newest : null;
}
function hungOf(c, d) {
  const { model } = c;
  let age2 = 0;
  for (const reading of [model.first, model.second]) {
    const work = reading.work.get(d.row.pid) ?? null;
    const record = work?.record;
    if (record == null || c.phase(d, work, model.now) !== "serving") return null;
    const bound = HEARTBEAT_GRACE_INTERVALS * record.heartbeatIntervalMs;
    age2 = model.now - record.heartbeatAt;
    if (age2 <= bound) return null;
  }
  return `its heartbeat is ${duration(age2)} old on both samples, past two intervals`;
}
function lifeOf(c, pid, work, intervalMs) {
  const now = c.model.now;
  const grace = HEARTBEAT_GRACE_INTERVALS * intervalMs;
  const idleMs = work.settings.idleExitMinutes * 6e4;
  const unusedMs = work.settings.unusedExitMinutes * 6e4;
  const none = { flag: null, state: null };
  const departed = ownDeparture(work);
  if (departed !== null) {
    const since = now - departed;
    const left = drainLeftMs(work, now);
    if (left !== null) return { flag: null, state: `draining ${Math.ceil(left / 6e4)}m left` };
    const drains = work.slowWaiting === true || work.checkpoints.length > 0;
    if (!drains && work.slowWaiting === null) {
      c.name(`daemon ${pid} flag past-departure`, "its slow-tier row cannot be read");
      return none;
    }
    if (drains && since > idleMs + grace) {
      const reason2 = `its last session left ${duration(since)} ago, and its drain is past daemon.idleExitMinutes (${work.settings.idleExitMinutes})`;
      return { flag: { flag: "past-departure", reason: reason2 }, state: null };
    }
    if (!drains && since > DEPARTURE_MS) {
      const reason2 = `its last session left ${duration(since)} ago, and no slow work is left`;
      return { flag: { flag: "past-departure", reason: reason2 }, state: null };
    }
    return none;
  }
  const consumers = work.consumers.length;
  const rule = consumers === 0 ? "past-idle" : "past-unused";
  if (work.lastUse === null) {
    c.name(
      `daemon ${pid} flag ${rule}`,
      "its daemon records no last use: a release before D9 (D9)"
    );
    return none;
  }
  if (consumers === 0) {
    const quiet2 = now - work.lastUse.activeAt;
    if (quiet2 <= idleMs + grace) return none;
    const reason2 = `no consumer, and no request for ${duration(quiet2)}, past daemon.idleExitMinutes (${work.settings.idleExitMinutes})`;
    return { flag: { flag: "past-idle", reason: reason2 }, state: null };
  }
  const quiet = now - work.lastUse.usedAt;
  if (quiet <= unusedMs + grace) return none;
  const reason = `${consumers === 1 ? "1 consumer" : `${consumers} consumers`}, and no edit, run, wait or request for ${duration(quiet)}, past daemon.unusedExitMinutes (${work.settings.unusedExitMinutes})`;
  return { flag: { flag: "past-unused", reason }, state: null };
}
function deadConsumers(c, pid) {
  const first = c.model.first.work.get(pid) ?? null;
  const second = c.model.second.work.get(pid) ?? null;
  if (first?.record == null || second?.record == null) return [];
  const beat = second.record.heartbeatAt > first.record.heartbeatAt;
  const reasons = [];
  for (const x of second.consumers) {
    if (x.harness === null) continue;
    if (x.alive === null) {
      const why = `consumer ${x.sessionId}: its harness process ${x.harness.pid} is in another PID namespace`;
      c.name(`daemon ${pid} flag dead-consumer`, why);
      continue;
    }
    const before = first.consumers.find(
      (y) => y.sessionId === x.sessionId && y.agentId === x.agentId
    );
    if (x.alive || before?.alive !== false || !beat) continue;
    reasons.push(
      `consumer ${x.sessionId}: its harness process ${x.harness.pid} is gone, and the heartbeat between the samples kept it`
    );
  }
  return reasons;
}
function duplicates(c) {
  const byRoot = /* @__PURE__ */ new Map();
  for (const d of c.model.discovery.daemons)
    if (d.root !== null) byRoot.set(d.root, [...byRoot.get(d.root) ?? [], d]);
  const out = /* @__PURE__ */ new Map();
  const add = (d, reason, command2) => out.set(d.row.pid, [{ flag: "duplicate", reason, command: command2 }]);
  for (const [root, group] of byRoot) {
    if (group.length < 2) continue;
    const waited = (d) => {
      const age2 = c.ageOf(d.row);
      if (age2 === null) c.name(`daemon ${d.row.pid} flag duplicate`, NO_BOOT);
      return age2 !== null && age2 > (d.awaitLock ? AWAIT_LOCK_MS : NO_LOCK_MS);
    };
    if (c.model.locksRead === "none") {
      if (!group.every(waited)) continue;
      for (const d of group) {
        const others = pids(group.filter((o) => o !== d));
        add(
          d,
          `daemon ${others} has its root ${root} too; which holds the lock is unknown`,
          `kill ${d.row.pid}  # or ${others}: whichever holds no lock`
        );
      }
      continue;
    }
    const byLock = /* @__PURE__ */ new Map();
    for (const d of group)
      if (d.holdsLock === true) byLock.set(d.lockPath, [...byLock.get(d.lockPath) ?? [], d]);
    for (const d of group) {
      if (d.holdsLock === null)
        c.name(
          `daemon ${d.row.pid} flag duplicate`,
          `whether it holds a lock of its root ${root} is unknown`
        );
      else if (d.holdsLock) {
        const others = [...byLock].flatMap(([lock, ds]) => lock === d.lockPath ? [] : ds);
        if (others.length > 0)
          add(
            d,
            `${heldBy(others)} a lock of its root ${root} too`,
            `kill ${d.row.pid}  # or ${pids(others)}: keep one`
          );
      } else if (byLock.size > 0 && waited(d)) {
        const mine = byLock.get(d.lockPath);
        const by = mine ?? [...byLock.values()].flat();
        const turn = (mine?.length ?? 0) > 1 ? " in turn" : "";
        add(d, `${heldBy(by)} the lock of its root ${root}${turn}`, `kill ${d.row.pid}`);
      }
    }
  }
  return out;
}
function pids(daemons) {
  return daemons.map((d) => d.row.pid).join(", ");
}
function heldBy(daemons) {
  return daemons.length === 1 ? `daemon ${pids(daemons)} holds` : `daemons ${pids(daemons)} held`;
}
function within(path, dir) {
  return path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

// src/core/ps/render.ts
var STATE_WIDTH = 19;
var DETAIL = "      ";
var render = (snapshot, { full }) => {
  const lines = [firstLine(snapshot), hostLine(snapshot.host), squealLine(snapshot)];
  if (snapshot.repositories.length === 0) lines.push("", "No Squeal daemon runs.");
  for (const repository of snapshot.repositories)
    lines.push("", ...repositoryBlock(repository, snapshot, full));
  if (snapshot.orphans.length > 0) {
    lines.push("", "Processes no live daemon owns");
    for (const orphan of snapshot.orphans) lines.push(...orphanLines(orphan, snapshot.at));
  }
  if (snapshot.files.length > 0) {
    lines.push("", "Files no live process uses");
    for (const file of snapshot.files) lines.push(...fileLines(file));
  }
  if (snapshot.unflaggedFiles !== null) {
    const counts = snapshot.unflaggedFiles.map((f) => `${f.kind} ${thousands(f.count)}`);
    lines.push(
      "",
      `Files that never get a flag: ${counts.length === 0 ? "none" : counts.join(", ")}`
    );
  }
  if (snapshot.unknown.length > 0 && !full)
    lines.push("", `Unknown: ${count(snapshot.unknown.length, "value")}; --full names each`);
  if (snapshot.unknown.length > 0 && full) {
    lines.push("", "Unknown");
    for (const u of snapshot.unknown) lines.push(`  ${u.what}: ${u.why}`);
  }
  return `${lines.join("\n")}
`;
};
function firstLine(s) {
  const names3 = /* @__PURE__ */ new Map();
  const daemons = s.repositories.flatMap((r) => r.daemons);
  const all2 = [
    ...daemons.flatMap((d) => [...d.flags, ...d.processes.flatMap((p) => p.flags)]),
    ...s.orphans.flatMap((o) => o.flags),
    ...s.files
  ];
  for (const f of all2) names3.set(f.flag, (names3.get(f.flag) ?? 0) + 1);
  const listed = [...names3].map(([name, n]) => n === 1 ? name : `${name} \xD7${n}`).join(", ");
  const flags = s.flags === 0 ? "no flags" : `${count(s.flags, "flag")}: ${listed}`;
  const processes = count(s.squeal.testProcesses, "test process", "test processes");
  return `squeal ps \xB7 ${count(s.squeal.daemons, "daemon")}, ${processes} \xB7 ${flags}`;
}
function hostLine(h) {
  const load = h.load === null ? "load unknown" : `load ${h.load.map((l) => l.toFixed(1)).join(" ")}`;
  const pressure2 = h.memoryPressure === null ? "memory pressure unknown" : `memory pressure ${share(h.memoryPressure.some)} (${share(h.memoryPressure.full)} full)`;
  const used = h.memTotal === null || h.memAvailable === null ? null : h.memTotal - h.memAvailable;
  const swap = h.swapUsed === null || h.swapTotal === null ? "swap unknown" : `swap ${ofGib(h.swapUsed, h.swapTotal)}`;
  return [
    `Host    ${load} on ${count(h.cpus, "CPU")}`,
    `CPU pressure ${h.cpuPressure === null ? "unknown" : share(h.cpuPressure)}`,
    pressure2,
    `${used === null || h.memTotal === null ? "memory unknown" : `memory ${ofGib(used, h.memTotal)} used`}, ${swap}`
  ].join(" \xB7 ");
}
function squealLine(s) {
  const q = s.squeal;
  const out = q.skipped;
  const ofBusy = lower(q.cpuShare, out.cpuPct, (v) => `${share(v)} of busy`);
  const cpu = lower(q.cpuPct, out.cpuPct, (v) => `${cpus2(v)} CPUs`);
  const used = lower(q.memoryShare, out.privateBytes, (v) => `${share(v)} of used`);
  const kind = s.memory === "rss" ? "RSS" : "memory";
  const rss = s.memory === "rss" ? ", shared pages counted more than once" : "";
  const amount = lower(q.privateBytes, out.privateBytes, (v) => bytes(v)) ?? "unknown";
  const memory = `${kind} ${amount} (${used ?? "share of used unknown"})${rss}`;
  const swap = lower(q.swapBytes, out.swapBytes, (v) => `${bytes(v)} swap`) ?? "swap unknown";
  const pool = q.pool.held === null ? `pool ${q.pool.slots} permits, held unknown` : `pool ${q.pool.held} of ${count(q.pool.slots, "permit")}`;
  const busy = ofBusy ?? "share of busy unknown";
  return `Squeal  ${cpu === null ? "CPU unknown" : `CPU ${cpu} (${busy})`} \xB7 ${memory} + ${swap} \xB7 ${pool}`;
}
function repositoryBlock(r, s, full) {
  const name = r.commonDir === null ? "repository unknown" : r.commonDir.replace(/\/\.git$/, "");
  const cpu = lower(r.cpuPct, r.skipped.cpuPct, cpus2) ?? "unknown";
  const memory = lower(r.privateBytes, r.skipped.privateBytes, (v) => bytes(v)) ?? "unknown";
  const lines = [
    [
      `${name}${r.current ? " (this repository)" : ""}`,
      count(r.daemons.length, "daemon"),
      `CPU ${cpu}`,
      `${s.memory === "rss" ? "RSS" : "memory"} ${memory}`
    ].join(" \xB7 "),
    row("  ", {
      state: "STATE",
      pid: "PID",
      worktree: "WORKTREE",
      version: "VERSION",
      up: "UP",
      cpu: "CPU",
      time: "CPU TIME",
      memory: s.memory === "rss" ? "RSS" : "MEMORY",
      swap: "SWAP",
      work: "WORK"
    })
  ];
  for (const d of r.daemons) {
    lines.push(...daemonLines(d, s.at));
    for (const p of d.processes) lines.push(...processLines(p, s.at, full));
  }
  return lines;
}
function daemonLines(d, at) {
  const margin = d.flags.length > 0 ? "! " : "  ";
  const own = d.state.length < STATE_WIDTH;
  const version = [d.version ?? UNKNOWN, d.harness].filter((v) => v !== null).join(" ");
  return [
    ...own ? [] : [`${margin}${d.state}`],
    row(own ? margin : "  ", {
      state: own ? d.state : "",
      pid: String(d.pid),
      worktree: d.worktreeId?.slice(0, 8) ?? UNKNOWN,
      version,
      up: age(d.startedAt, at),
      cpu: percent(d.cpuPct),
      time: cpuTime3(d.cpuMs),
      memory: bytes(d.privateBytes, true),
      swap: bytes(d.swapBytes, true),
      work: workOf(d, at)
    }),
    ...flagLines(d.flags)
  ];
}
function processLines(p, at, full) {
  const d = p.descendants;
  const and = (own, sum) => d.count === 0 ? own : own === null || sum === null ? null : own + sum;
  const plus = (text2, out) => out > 0 && text2 !== UNKNOWN ? `${text2}+` : text2;
  const children = d.count === 0 ? [] : [`+${count(d.count, "child", "children")}`];
  const lines = [
    row(p.flags.length > 0 ? "! " : "  ", {
      state: `  ${p.lane ?? p.runner ?? "test"}`,
      pid: String(p.pid),
      detail: detailOf(p),
      up: age(p.startedAt, at),
      cpu: plus(percent(and(p.cpuPct, d.cpuPct)), d.skipped.cpuPct),
      time: cpuTime3(and(p.cpuMs, d.cpuMs)),
      memory: plus(bytes(and(p.privateBytes, d.privateBytes), true), d.skipped.privateBytes),
      swap: plus(bytes(and(p.swapBytes, d.swapBytes), true), d.skipped.swapBytes),
      work: [...p.escaped ? ["escaped"] : [], `nice ${p.nice}`, ...children].join(", ")
    }),
    ...flagLines(p.flags)
  ];
  if (!full) return lines;
  for (const c of d.list ?? [])
    lines.push(
      row("  ", {
        state: `    ${c.comm}`,
        pid: String(c.pid),
        detail: "",
        up: "",
        cpu: percent(c.cpuPct),
        time: cpuTime3(c.cpuMs),
        memory: bytes(c.privateBytes, true),
        swap: bytes(c.swapBytes, true),
        work: ""
      })
    );
  return lines;
}
function orphanLines(o, at) {
  return o.flags.flatMap((f) => [
    `  ! ${f.flag}  pid ${o.pid} ${o.comm}, up ${age(o.startedAt, at)} (${f.reason})`,
    `${DETAIL}ends it: ${f.command ?? "none"}`
  ]);
}
function fileLines(f) {
  const what = f.path ?? `${thousands(f.count)} ${f.count === 1 ? "directory" : "directories"}, ${f.bytes === null ? "size unknown" : bytes(f.bytes)}`;
  return [`  ! ${f.flag}  ${what} (${f.reason})`, `${DETAIL}ends it: ${f.command}`];
}
function flagLines(flags) {
  return flags.flatMap((f) => [
    `${DETAIL}${f.flag}: ${f.reason}`,
    `${DETAIL}ends it: ${f.command ?? "none"}`
  ]);
}
function workOf(d, at) {
  if (d.phase === "waiting") return "waits for its lock";
  const w = d.work;
  const parts = w.tiers.map(
    (t) => `${t.lane === null ? "" : `${t.lane} `}tier, ${count(t.files, "file")}`
  );
  if (w.tiers.length === 0)
    for (const c of w.checkpoints) parts.push(`checkpoint, ${count(c.files, "file")}`);
  if (w.pending === null) parts.push("work unknown");
  else if (w.pending > 0) parts.push(`${w.pending} pending`);
  if (d.consumers.length > 0) parts.push(count(d.consumers.length, "session"));
  if (ownDeparture2(d)) parts.push(`session left ${age(w.departedAt, at)} ago`);
  return parts.length === 0 ? "idle" : parts.join("; ");
}
function ownDeparture2(d) {
  const left = d.work.departedAt;
  return left !== null && d.consumers.length === 0 && d.startedAt !== null && left >= d.startedAt;
}
function lower(value, out, text2) {
  return value === null ? null : `${out > 0 ? "at least " : ""}${text2(value)}`;
}
function detailOf(p) {
  if (p.runner === "vitest" && p.files === null) return "fork worker";
  if (p.files === null) return p.runner ?? "";
  const [only2] = p.files;
  return p.files.length === 1 && only2 !== void 0 ? only2 : `${p.runner ?? "test"}, ${count(p.files.length, "file")}`;
}
function row(margin, r) {
  const left = r.detail === void 0 ? (r.worktree ?? "").padEnd(10) + (r.version ?? "").padEnd(15) : clip(r.detail, 24).padEnd(25);
  const line = margin + r.state.padEnd(STATE_WIDTH) + r.pid.padEnd(9) + left + r.up.padStart(4) + r.cpu.padStart(6) + r.time.padStart(10) + "  " + r.memory.padEnd(8) + r.swap.padEnd(6) + r.work;
  return line.trimEnd();
}
function clip(text2, width) {
  return text2.length <= width ? text2 : `\u2026${text2.slice(text2.length - width + 1)}`;
}

// src/core/ps/host.ts
import { readdirSync as readdirSync5 } from "node:fs";
import { join as join10 } from "node:path";
var hostTotals = (first, second) => {
  const a = first.cpuTime;
  const b = second.cpuTime;
  const total = a === null || b === null ? 0 : b.total - a.total;
  return {
    load: second.load,
    cpus: second.cpus,
    cpuPressure: second.cpuPressure,
    memoryPressure: second.memoryPressure,
    memTotal: second.memTotal,
    memAvailable: second.memAvailable,
    swapTotal: second.swapTotal,
    swapUsed: second.swapUsed,
    busyCpuPct: a === null || b === null || total <= 0 ? null : (b.busy - a.busy) / total * 100
  };
};
function cpuShare(cpuPct, first, second, clockTicks) {
  const windowMs = second.atMs - first.atMs;
  if (cpuPct === null || first.cpuTime === null || second.cpuTime === null || windowMs <= 0)
    return null;
  const busyPct = ticksToMs(second.cpuTime.busy - first.cpuTime.busy, clockTicks) / windowMs * 100;
  return busyPct <= 0 ? null : cpuPct / busyPct * 100;
}
function memoryShare(privateBytes, host) {
  if (privateBytes === null || host.memTotal === null || host.memAvailable === null) return null;
  const used = host.memTotal - host.memAvailable;
  return used <= 0 ? null : privateBytes / used * 100;
}
var PERMIT2 = /^(pool\.\d+|slow(\.\d+)?)\.lock$/;
var readPool = (source, places, daemons, readings = [source.locks()]) => {
  const slots = hostSlotsOf(places.userConfig, source.host().cpus);
  const holders = /* @__PURE__ */ new Map();
  for (const locks of readings)
    for (const [file, pids3] of holdersOf(locks ?? [])) holders.set(file, pids3);
  let held = 0;
  const permits = /* @__PURE__ */ new Map();
  const foreign = [];
  for (const path of permitFiles(places)) {
    const key = source.fileKey(path);
    const pids3 = key === null ? void 0 : holders.get(key);
    if (pids3 === void 0) continue;
    held++;
    for (const pid of pids3) {
      if (daemons.has(pid)) permits.set(pid, (permits.get(pid) ?? 0) + 1);
      else foreign.push({ pid, path });
    }
  }
  if (readings.some((locks) => locks === null))
    return { pool: { slots, held: null }, permits: /* @__PURE__ */ new Map(), foreign };
  return { pool: { slots, held }, permits, foreign };
};
function holdersOf(locks) {
  const holders = /* @__PURE__ */ new Map();
  for (const lock of locks) {
    if (lock.blocked || lock.access !== "write" || lock.pid === null) continue;
    const pids3 = holders.get(lock.file) ?? /* @__PURE__ */ new Set();
    holders.set(lock.file, pids3.add(lock.pid));
  }
  return holders;
}
function hostSlotsOf(path, cpus3) {
  const shape = { capacity: { hostSlots: positiveInteger, projects: () => null } };
  const defaults = { capacity: { hostSlots: defaultHostSlots(cpus3) } };
  return loadConfigFile(path, shape, defaults).value.capacity.hostSlots;
}
function permitFiles(places) {
  const dirs = /* @__PURE__ */ new Set([join10(places.tempDir, `squeal-${places.uid}`)]);
  if (places.runtimeDir !== null) dirs.add(join10(places.runtimeDir, "squeal"));
  const files = [];
  for (const dir of dirs) {
    let names3;
    try {
      names3 = readdirSync5(dir);
    } catch {
      continue;
    }
    for (const name of names3.sort()) if (PERMIT2.test(name)) files.push(join10(dir, name));
  }
  return files;
}

// src/core/ps/processes.ts
function parseMark(mark) {
  const colon = mark.indexOf(":");
  if (colon < 0) return { token: mark, lane: null, runId: null };
  const rest2 = mark.slice(colon + 1);
  const hash = rest2.indexOf("#");
  const lane = hash < 0 ? rest2 : rest2.slice(0, hash);
  return {
    token: mark.slice(0, colon),
    lane: lane === "" ? null : lane,
    runId: hash < 0 ? null : rest2.slice(hash + 1)
  };
}
var attribute = (source, table, owners) => {
  const owner = new Map(owners.map((o) => [o.pid, o]));
  const marks = /* @__PURE__ */ new Map();
  if (source.readsMarks) {
    for (const pid of table.keys()) {
      if (owner.has(pid)) continue;
      const mark = source.markOf(pid);
      if (mark !== null) marks.set(pid, mark);
    }
  }
  const isHead = (pid) => {
    if (owner.has(pid)) return false;
    const parent = table.get(pid)?.ppid;
    if (!source.readsMarks) return parent !== void 0 && owner.has(parent);
    if (!marks.has(pid)) return false;
    const above = nearest(table, parent, (p) => owner.has(p) || marks.has(p));
    return above === null || owner.has(above);
  };
  const pids3 = [...table.keys()].sort((a, b) => a - b);
  const heads = new Set(pids3.filter(isHead));
  const descendants = new Map([...heads].map((h) => [h, []]));
  for (const pid of pids3) {
    if (owner.has(pid) || heads.has(pid)) continue;
    const head = nearest(table, table.get(pid)?.ppid, (p) => owner.has(p) || heads.has(p));
    if (head !== null) descendants.get(head)?.push(pid);
  }
  const byToken = /* @__PURE__ */ new Map();
  for (const o of owners) if (o.token !== null && !byToken.has(o.token)) byToken.set(o.token, o);
  const tokensKnown = owners.every((o) => o.token !== null);
  const processes = [];
  const unowned = [];
  for (const head of heads) {
    const mark = marks.get(head);
    const parsed2 = mark === void 0 ? null : parseMark(mark);
    const ancestor = nearest(table, table.get(head)?.ppid, (p) => owner.has(p));
    const by = ancestor !== null ? owner.get(ancestor) : parsed2 === null ? void 0 : byToken.get(parsed2.token);
    if (by === void 0) {
      if (mark === void 0 || !tokensKnown) continue;
      for (const pid of [head, ...descendants.get(head) ?? []]) {
        const carried = marks.get(pid);
        if (carried !== void 0) unowned.push({ pid, mark: carried });
      }
      continue;
    }
    const args = source.cmdline(head);
    processes.push({
      pid: head,
      daemonPid: by.pid,
      escaped: ancestor === null,
      lane: parsed2?.lane ?? null,
      runId: parsed2 === null ? null : runOf(parsed2, by),
      runner: args === null ? null : runnerOf(args),
      files: args === null ? null : filesOf(args),
      descendants: descendants.get(head) ?? []
    });
  }
  return { processes, unowned };
};
function nearest(table, pid, is) {
  for (let at = pid, steps = 0; at !== void 0 && steps <= table.size; steps++) {
    if (is(at)) return at;
    const row2 = table.get(at);
    if (row2 === void 0 || row2.ppid === at) return null;
    at = row2.ppid;
  }
  return null;
}
function runOf(mark, owner) {
  if (mark.runId !== null) return mark.runId;
  const lane = mark.lane?.startsWith("slow:") === true ? "slow" : "fast";
  const ofLane = owner.tiers.filter((t) => t.lane === lane);
  if (ofLane.length > 0) return ofLane.length === 1 ? ofLane[0]?.runId ?? null : null;
  const [only2] = owner.tiers;
  return owner.tiers.length === 1 && only2?.lane === null ? only2.runId : null;
}
var VITEST_WORKER = /\/vitest\/dist\/workers\/[^/]+\.js$/;
function runnerOf(args) {
  if (args.some((a) => VITEST_WORKER.test(a))) return "vitest";
  if (args.some((a) => a.startsWith("--basetemp=")) && isPytest(args)) return "pytest";
  if (args.includes("--test")) return "node-test";
  return null;
}
function isPytest(args) {
  return args.some((a, i) => a === "-m" && args[i + 1] === "pytest" || /(^|\/)pytest$/.test(a));
}
function filesOf(args) {
  const runner = runnerOf(args);
  if (runner === "pytest")
    return args.slice(args.findLastIndex((a) => a.startsWith("--basetemp=")) + 1);
  if (runner === "node-test")
    return args.slice(args.indexOf("--test") + 1).filter((a) => !a.startsWith("-"));
  return null;
}

// src/core/ps/snapshot-shape.ts
import { readdirSync as readdirSync6 } from "node:fs";
import { basename as basename2 } from "node:path";

// src/core/ps/shape.ts
var PS_SHAPE_VERSION = 1;

// src/core/ps/snapshot-unknown.ts
var LISTED = 10;
function unknownOf({ shape, named, costs }) {
  const all2 = /* @__PURE__ */ new Map();
  const name = (what, why) => {
    if (!all2.has(what)) all2.set(what, named.find((u) => u.what === what) ?? { what, why });
  };
  for (const u of named) name(u.what, u.why);
  const { host, squeal } = shape;
  if (host.load === null) name("host load", "the source cannot read it on this host");
  if (host.cpuPressure === null || host.memoryPressure === null)
    name("host pressure", "the source cannot read it on this host");
  if (host.memTotal === null || host.memAvailable === null)
    name("host memory", "the source cannot read it on this host");
  if (host.swapTotal === null || host.swapUsed === null)
    name("host swap", "the source cannot read it on this host");
  if (host.busyCpuPct === null)
    name(
      "host busyCpuPct",
      "the host's CPU times cannot be read, or did not change over the window"
    );
  if (squeal.cpuShare === null && squeal.cpuPct !== null && host.busyCpuPct !== null)
    name("squeal cpuShare", "the host's busy CPU over the window was none");
  if (squeal.memoryShare === null && squeal.privateBytes !== null && host.memTotal !== null)
    name("squeal memoryShare", "the host's used memory reads none");
  if (squeal.pool.held === null)
    name("pool permits", "the lock holders cannot be read, so no daemon's permits are known");
  const entries = [...costs];
  const seenOnce = entries.filter(([, c]) => c === null || c.cpuPct === null);
  const reaped = seenOnce.filter(([, c]) => (c?.reapedBy ?? null) !== null);
  if (seenOnce.length > 0)
    name(
      "processes cpuPct",
      `${were(seenOnce)} in one sample of the window only: ${pids2(seenOnce)}${waitedFor(reaped.length, seenOnce.length)}`
    );
  const lost = seenOnce.filter(([, c]) => (c?.reapedBy ?? null) === null);
  const unsure = entries.filter(([, c]) => c?.reaperUnknown === true);
  const outside = lost.filter(([, c]) => c?.reaperUnknown !== true);
  const ended = unsure.filter(([, c]) => c?.cpuPct === null);
  const holding = unsure.filter(([, c]) => c?.cpuPct !== null);
  const parts = [
    ...outside.length === 0 ? [] : [
      `${counted(outside)} in one sample only, which no process ps measures waited for: ${pids2(outside)}`
    ],
    ...ended.length === 0 ? [] : [`${counted(ended)} that ended ${afterParent(ended.length)}: ${pids2(ended)}`],
    ...holding.length === 0 ? [] : [`processes below ${counted(holding)} that ended ${afterParent(2)}: ${pids2(holding)}`]
  ];
  if (parts.length > 0)
    name(
      "squeal cpuPct",
      `a lower bound: it leaves out the CPU in the window of ${parts.join("; and of ")}`
    );
  const noMemory = entries.filter(([, c]) => c === null || c.privateBytes === null);
  const left = noMemory.filter(([, c]) => c?.left === true);
  if (left.length > 0)
    name(
      "processes privateBytes",
      `${counted(left)} ended in the window, so ${left.length === 1 ? "it holds" : "they hold"} none: ${pids2(left)}`
    );
  const unread = noMemory.filter(([, c]) => c?.left !== true);
  if (unread.length > 0)
    name(
      "squeal privateBytes",
      `a lower bound: it leaves out the memory of ${counted(unread)} whose status could not be read: ${pids2(unread)}`
    );
  const noSwap = entries.filter(
    ([, c]) => c !== null && c.privateBytes !== null && c.swapBytes === null
  );
  if (noSwap.length > 0)
    name(
      "processes swapBytes",
      shape.memory === "rss" ? "the source reads no swap per process on this platform (D10)" : `${counted(noSwap)} show no swap: ${pids2(noSwap)}`
    );
  const daemons = shape.repositories.flatMap((r) => r.daemons);
  const starts = [...daemons, ...daemons.flatMap((d) => d.processes)];
  if (starts.some((p) => p.startedAt === null))
    name("processes startedAt", "the boot time cannot be read");
  for (const d of daemons) daemonOf(d, all2, name);
  const elsewhere = daemons.flatMap((d) => d.consumers).filter((c) => c.harnessPid !== null && c.alive === null);
  if (elsewhere.length > 0)
    name(
      "consumers alive",
      `${elsewhere.length === 1 ? "1 consumer's harness process is" : `${elsewhere.length} consumers' harness processes are`} in another PID namespace`
    );
  return [...all2.values()];
}
function daemonOf(d, all2, name) {
  const of = `daemon ${d.pid}`;
  if (d.worktreeId === null)
    name(`${of} worktreeId`, "its lock file is not open and its root cannot be read");
  if (d.root === null) name(`${of} root`, "its arguments name a relative root");
  if (d.version === null)
    name(`${of} version`, "its script path names none, and its store records no daemon of its own");
  if (d.work.pending === null)
    name(
      `${of} work`,
      d.phase === "waiting" ? "it waits for its lock, and its worktree's row is the holder's" : "its store cannot be found"
    );
  else if (d.work.lastUsedAt === null && !all2.has(`${of} work`))
    name(`${of} lastUsedAt`, "its store records no last use of its own (D9)");
}
function waitedFor(reaped, once2) {
  if (reaped === 0) return "";
  const whom = reaped < once2 ? `${reaped} of them` : once2 === 1 ? "it" : "them";
  return `; the ancestor that waited for ${whom} counts ${once2 === 1 ? "its" : "their"} CPU`;
}
function afterParent(n) {
  return n === 1 ? "after its parent did, or under one whose children's times grew too little, so no sample shows which process waited for it" : "after their parents did, or under ones whose children's times grew too little, so no sample shows which processes waited for them";
}
function counted(entries) {
  return entries.length === 1 ? "1 process" : `${entries.length} processes`;
}
function were(entries) {
  return `${counted(entries)} ${entries.length === 1 ? "was" : "were"}`;
}
function pids2(entries) {
  const listed = entries.slice(0, LISTED).map(([pid]) => pid);
  const more = entries.length - listed.length;
  return `pid ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

// src/core/ps/snapshot-shape.ts
function shapeOf(r, findings, o) {
  const { model, costs } = r;
  const { first, second } = model;
  const ticks = model.source.clockTicks();
  const startOf = (startTicks) => r.bootTime === null ? null : r.bootTime + ticksToMs(startTicks, ticks);
  const phase = phaseOn(model.source);
  const table = first.sample.table;
  const processOf = (p) => {
    const row2 = table.get(p.pid);
    const sum = sumCosts(p.descendants.flatMap((pid) => costs.get(pid) ?? []));
    return {
      pid: p.pid,
      lane: p.lane,
      runner: p.runner,
      runId: p.runId,
      files: p.files,
      escaped: p.escaped,
      ...costOf(costs.get(p.pid)),
      // `attribute` takes its processes from this table.
      nice: row2?.nice ?? 0,
      startedAt: row2 === void 0 ? null : startOf(row2.startTicks),
      descendants: {
        count: p.descendants.length,
        ...sum,
        list: !o.full ? null : p.descendants.map((pid) => ({
          pid,
          comm: table.get(pid)?.comm ?? "",
          ...costOf(costs.get(pid))
        }))
      },
      flags: findings.processes.get(p.pid) ?? []
    };
  };
  const daemonOf2 = (d) => {
    const pid = d.row.pid;
    const work = first.work.get(pid) ?? second.work.get(pid) ?? null;
    const own = phase(d, work, model.now);
    const state = findings.states.get(pid) ?? own;
    return {
      pid,
      phase: own,
      state,
      worktreeId: d.worktreeId,
      root: d.root,
      // A checkout's `dist` names no version; its store row's own record does (D2).
      version: d.version ?? work?.record?.squealVersion ?? null,
      harness: d.harness,
      startedAt: startOf(d.row.startTicks),
      ...costOf(costs.get(pid)),
      permits: model.pool.pool.held === null ? null : model.pool.permits.get(pid) ?? 0,
      work: workOf2(work, model.now, state.startsWith("draining")),
      consumers: (work?.consumers ?? []).map((c) => ({
        harnessPid: c.harness?.pid ?? null,
        alive: c.alive,
        version: c.version
      })),
      processes: first.attribution.processes.filter((p) => p.daemonPid === pid).map(processOf),
      flags: findings.daemons.get(pid) ?? []
    };
  };
  const below2 = new Map(first.attribution.processes.map((p) => [p.pid, p.descendants]));
  const pidsOf = (daemons2) => [
    ...daemons2.map((d) => d.pid),
    ...daemons2.flatMap((d) => d.processes).flatMap((p) => [p.pid, ...below2.get(p.pid) ?? []])
  ];
  const totalOf = (daemons2) => sumCosts(pidsOf(daemons2).flatMap((pid) => costs.get(pid) ?? []));
  const current = model.places.commonDir;
  const blocks = /* @__PURE__ */ new Map();
  for (const d of model.discovery.daemons) {
    const group = blocks.get(d.commonDir) ?? [];
    blocks.set(d.commonDir, [...group, daemonOf2(d)]);
  }
  const repositories = [...blocks].map(([commonDir, daemons2]) => {
    const { cpuPct, privateBytes, swapBytes, skipped } = totalOf(daemons2);
    return {
      commonDir,
      current: commonDir !== null && commonDir === current,
      cpuPct,
      privateBytes,
      swapBytes,
      skipped,
      daemons: daemons2.sort((a, b) => cpuOf(b) - cpuOf(a) || a.pid - b.pid)
    };
  }).filter((repository) => !o.repo || repository.current).sort((a, b) => Number(b.current) - Number(a.current) || (b.cpuPct ?? 0) - (a.cpuPct ?? 0));
  const daemons = repositories.flatMap((repository) => repository.daemons);
  const processes = daemons.flatMap((d) => d.processes);
  const pids3 = pidsOf(daemons);
  const total = totalOf(daemons);
  const ids = !o.repo ? null : current === null ? /* @__PURE__ */ new Set() : worktreeIdsOf(current);
  const files = ids === null ? findings.files : findings.files.filter((f) => f.path !== null && ids.has(socketIdOf(f.path)));
  const orphans2 = o.repo ? [] : findings.orphans;
  const kept = new Set(daemons.flatMap((d) => [d.pid, ...d.processes.map((p) => p.pid)]));
  const shape = {
    v: PS_SHAPE_VERSION,
    at: model.now,
    sampleMs: Math.round(second.sample.atMs - first.sample.atMs),
    platform: model.source.platform,
    memory: model.source.memoryKind,
    host: r.host,
    squeal: {
      daemons: daemons.length,
      testProcesses: processes.length,
      cpuPct: total.cpuPct,
      cpuShare: cpuShare(total.cpuPct, first.sample, second.sample, ticks),
      privateBytes: total.privateBytes,
      memoryShare: memoryShare(total.privateBytes, r.host),
      swapBytes: total.swapBytes,
      skipped: total.skipped,
      pool: model.pool.pool
    },
    repositories,
    orphans: orphans2,
    files,
    unflaggedFiles: o.full ? findings.unflagged : null,
    flags: daemons.reduce((n, d) => n + d.flags.length, 0) + processes.reduce((n, p) => n + p.flags.length, 0) + orphans2.reduce((n, p) => n + p.flags.length, 0) + files.length
  };
  const named = [...r.unknown, ...findings.unknown].filter((u) => !o.repo || ofKept(u.what, kept));
  const covered = new Map(pids3.map((pid) => [pid, costs.get(pid) ?? null]));
  return { ...shape, unknown: unknownOf({ shape, named, costs: covered }) };
}
function costOf(cost) {
  if (cost === void 0) return { cpuPct: null, cpuMs: null, privateBytes: null, swapBytes: null };
  const { cpuPct, cpuMs, privateBytes, swapBytes } = cost;
  return { cpuPct, cpuMs, privateBytes, swapBytes };
}
function workOf2(work, now, draining) {
  const departedAt = work?.departedAt ?? null;
  return {
    pending: work?.pending ?? null,
    running: work?.running ?? null,
    tiers: work?.tiers ?? [],
    checkpoints: work?.checkpoints ?? [],
    departedAt,
    // The flags name the drain (D7); its time left is `daemon.idleExitMinutes` after the departure.
    drainLeftMs: !draining || work === null || departedAt === null ? null : Math.max(0, departedAt + work.settings.idleExitMinutes * 6e4 - now),
    lastUsedAt: work?.lastUse?.usedAt ?? null
  };
}
function cpuOf(d) {
  let cpu = d.cpuPct ?? 0;
  for (const p of d.processes) cpu += (p.cpuPct ?? 0) + (p.descendants.cpuPct ?? 0);
  return cpu;
}
function worktreeIdsOf(commonDir) {
  try {
    const names3 = readdirSync6(storePaths(commonDir).locksDir);
    return new Set(names3.flatMap((n) => /^([0-9a-f]{16})\.sqlite$/.exec(n)?.[1] ?? []));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function socketIdOf(path) {
  return /^squeal-([0-9a-f]{16})\.sock$/.exec(basename2(path))?.[1] ?? "";
}
function ofKept(what, kept) {
  const pid = /^(?:daemon|process) (\d+)\b/.exec(what)?.[1];
  return pid === void 0 || kept.has(Number(pid));
}

// src/core/ps/work.ts
import { existsSync as existsSync3, statSync as statSync3 } from "node:fs";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";
import { pathToFileURL } from "node:url";

// src/core/daemon/last-use.ts
function daemonUsedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonUsed", worktreeId);
}
function readDaemonUsed(value, startedAt) {
  if (value === null) return null;
  let parsed2;
  try {
    parsed2 = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed2) || parsed2.v !== 1) return null;
  const { usedAt, activeAt } = parsed2;
  if (!isEpochMs(usedAt) || !isEpochMs(activeAt) || usedAt < startedAt) return null;
  return { usedAt, activeAt };
}
function isEpochMs(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// src/core/ps/work.ts
var BUSY_TIMEOUT_MS = 100;
var READS_SCHEMA = 1;
var readWork = (source, table, daemons) => {
  const work = /* @__PURE__ */ new Map();
  const unknown = [];
  const namespace = source.pidNamespace();
  const ownStart = ownStartOn(source);
  for (const [path, group] of byStore(daemons)) {
    const store = openReadOnly(path);
    if (typeof store === "string") {
      for (const d of group) unknown.push({ what: `daemon ${d.row.pid} work`, why: store });
      continue;
    }
    const { db, file } = store;
    const read = /* @__PURE__ */ new Map();
    const named = [];
    let runs;
    const runsOf = (id) => {
      runs ??= openRuns2(db);
      return runs.get(id) ?? [];
    };
    try {
      db.exec("BEGIN");
      for (const d of group) {
        try {
          read.set(d.row.pid, readOne(db, d, runsOf, table, namespace, ownStart, named));
        } catch (error) {
          const why = `its store ${path} cannot be read: ${message(error)}`;
          named.push({ what: `daemon ${d.row.pid} work`, why });
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    if (file !== null && changed(path, file)) {
      const why = `its store ${path} changed while it was read without its WAL`;
      for (const d of group) unknown.push({ what: `daemon ${d.row.pid} work`, why });
      continue;
    }
    for (const [pid, w] of read) work.set(pid, w);
    unknown.push(...named);
  }
  return { work, unknown };
};
function byStore(daemons) {
  const stores = /* @__PURE__ */ new Map();
  for (const d of daemons) {
    if (d.storePath === null || d.worktreeId === null || d.holdsLock === false) continue;
    stores.set(d.storePath, [...stores.get(d.storePath) ?? [], d]);
  }
  return stores;
}
function openReadOnly(path) {
  let db;
  try {
    const file = statSync3(path, { bigint: true });
    const wal = statSync3(`${path}-wal`, { throwIfNoEntry: false });
    const held = wal !== void 0 && existsSync3(`${path}-shm`);
    if (!held && (wal?.size ?? 0) > 0)
      return `its store ${path} has a WAL whose commits cannot be read without creating its -shm`;
    db = new DatabaseSync4(held ? path : immutable(path), { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version >= READS_SCHEMA) return { db, file: held ? null : file };
    db.close();
    return `its store ${path} is at schema ${version}, which has no tables yet`;
  } catch (error) {
    db?.close();
    return `its store ${path} cannot be read: ${message(error)}`;
  }
}
function immutable(path) {
  const url = pathToFileURL(path);
  url.search = "immutable=1";
  return url;
}
function changed(path, before) {
  try {
    const after = statSync3(path, { bigint: true });
    return after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs;
  } catch {
    return true;
  }
}
function openRuns2(db) {
  const byWorktree = /* @__PURE__ */ new Map();
  for (const r of all(db, OPEN_RUNS)) {
    const rows = byWorktree.get(str2(r, "worktree_id"));
    if (rows === void 0) byWorktree.set(str2(r, "worktree_id"), [r]);
    else rows.push(r);
  }
  return byWorktree;
}
function readOne(db, d, runsOf, table, namespace, ownStart, unknown) {
  const id = d.worktreeId;
  const name = (what, why) => unknown.push({ what: `daemon ${d.row.pid} ${what}`, why });
  const meta = (row3, what, decode, absent) => {
    const key = worktreeMetaKey(row3, id);
    const text2 = get(db, "SELECT value FROM meta WHERE key = ?", key)?.value;
    if (typeof text2 !== "string") return absent;
    const value = decode(parsed(text2));
    if (value !== void 0) return value;
    name(what, `its ${key} ${UNKNOWN2}`);
    return null;
  };
  const row2 = get(db, "SELECT * FROM worktrees WHERE id = ?", id);
  const startedAt = row2 === null ? null : numOrNull2(row2, "daemon_started_at");
  const version = row2 === null ? null : strOrNull2(row2, "daemon_version");
  const theirs = startedAt !== null && ownStart(d, startedAt) === false;
  if (theirs)
    name(
      "work",
      `its row is a predecessor's: its record, token and last use are ${UNKNOWN2} until it registers`
    );
  const token = startedAt === null || theirs ? null : meta("daemonToken", "token", tokenOf(startedAt, version), null);
  const record = row2 === null || theirs ? null : recordOf(row2, token);
  const counts = new Map(
    all(db, PENDING, id).map((r) => [str2(r, "pending"), num2(r, "n")])
  );
  const slow = meta("slowTier", "slowWaiting", slowOf, { waits: false, running: [] });
  let lanes;
  const laneOf2 = (checkpointId) => {
    if (lanes === void 0) lanes = meta("checkpointLanes", "checkpoint lanes", lanesOf, {});
    return lanes?.[checkpointId] ?? null;
  };
  const since = theirs ? Number.POSITIVE_INFINITY : startedAt ?? Number.POSITIVE_INFINITY;
  const tiers = runsOf(id).filter((r) => num2(r, "started_at") >= since).map((r) => {
    const checkpointId = strOrNull2(r, "checkpoint_id");
    const paths = testFiles(r).map((f) => isRecord(f) ? f.path : void 0);
    const slowRun = paths.some((p) => typeof p === "string" && slow?.running.includes(p));
    const lane = slow === null ? null : slowRun ? "slow" : "fast";
    return {
      runId: str2(r, "id"),
      lane: (checkpointId === null ? null : laneOf2(checkpointId)) ?? lane,
      files: paths.length,
      startedAt: num2(r, "started_at"),
      checkpointId
    };
  });
  const checkpoints = all(db, OPEN_CHECKPOINTS, id, since).map(
    (r) => ({
      id: str2(r, "id"),
      startedAt: num2(r, "started_at"),
      lane: laneOf2(str2(r, "id")),
      files: testFiles(r).length
    })
  );
  const harnesses = meta("harnessProcess", "consumer harnesses", slotsOf, {});
  const versions = meta("consumerVersion", "consumer versions", slotsOf, {});
  const slot2 = (slots, of, what, decode) => {
    const value = slots?.[of];
    const decoded = value === void 0 ? null : decode(value);
    if (decoded === void 0) name(what, `its slot ${UNKNOWN2}`);
    return decoded ?? null;
  };
  const consumers = all(db, CONSUMERS, id).map((r) => {
    const sessionId = str2(r, "session_id");
    const agentId = str2(r, "agent_id");
    const of = `${sessionId}
${agentId}`;
    const harness = slot2(harnesses, of, `consumer ${sessionId} harness`, harnessOf);
    return {
      sessionId,
      agentId,
      lastSeenAt: num2(r, "last_seen_at"),
      harness,
      alive: aliveOf(harness, table, namespace),
      version: slot2(versions, of, `consumer ${sessionId} version`, text)
    };
  });
  const usedText = get(db, "SELECT value FROM meta WHERE key = ?", daemonUsedMetaKey(id))?.value;
  const lastUse = startedAt === null || theirs ? null : readDaemonUsed(typeof usedText === "string" ? usedText : null, startedAt);
  if (lastUse === null && record !== null)
    name(
      "lastUsedAt",
      typeof usedText === "string" ? `its ${daemonUsedMetaKey(id)} is a predecessor's or ${UNKNOWN2} (D9)` : "its daemon records no last use: a release before D9 (D9)"
    );
  const root = d.root ?? (row2 === null ? null : strOrNull2(row2, "root"));
  if (root === null) name("settings", "its root is unknown: the defaults stand in");
  return {
    record,
    recordedStartedAt: startedAt,
    token,
    pending: counts.get("queued") ?? 0,
    running: counts.get("running") ?? 0,
    tiers,
    checkpoints,
    consumers,
    departedAt: meta("departed", "departedAt", finiteNumber, null),
    slowWaiting: slow === null ? null : slow.waits,
    lastUse,
    settings: settingsOf(root)
  };
}
var PENDING = `SELECT pending, count(*) AS n FROM test_file_keys
  WHERE worktree_id = ? AND pending IS NOT NULL GROUP BY pending`;
var OPEN_RUNS = `SELECT worktree_id, id, test_files, checkpoint_id, started_at FROM runs
  WHERE end_state IS NULL ORDER BY started_at, rowid`;
var OPEN_CHECKPOINTS = `SELECT id, test_files, started_at FROM checkpoints
  WHERE worktree_id = ? AND completed_at IS NULL AND started_at >= ? ORDER BY started_at, rowid`;
var CONSUMERS = `SELECT session_id, agent_id, last_seen_at FROM consumers
  WHERE worktree_id = ? ORDER BY session_id, agent_id`;
var UNKNOWN2 = "has a format this release does not know";
var tokenOf = (startedAt, version) => (v) => {
  if (!isRecord(v) || typeof v.token !== "string") return void 0;
  return v.startedAt === startedAt && v.squealVersion === version ? v.token : null;
};
function recordOf(row2, token) {
  const socketPath = strOrNull2(row2, "daemon_socket");
  if (socketPath === null) return null;
  return {
    socketPath,
    startedAt: num2(row2, "daemon_started_at"),
    heartbeatAt: num2(row2, "daemon_heartbeat_at"),
    heartbeatIntervalMs: num2(row2, "daemon_heartbeat_interval_ms"),
    squealVersion: str2(row2, "daemon_version"),
    ...token === null ? {} : { token }
  };
}
var slowOf = (v) => {
  if (v === null) return { waits: false, running: [] };
  if (!isRecord(v)) return void 0;
  if (v.kind === "waiting") return { waits: true, running: [] };
  if (v.kind !== "running" || typeof v.path !== "string") return void 0;
  return { waits: true, running: Array.isArray(v.paths) ? v.paths : [v.path] };
};
var lanesOf = (v) => {
  if (!isRecord(v)) return void 0;
  const lanes = {};
  for (const [id, lane] of Object.entries(v))
    if (lane === "fast" || lane === "slow") lanes[id] = lane;
  return lanes;
};
var slotsOf = (v) => isRecord(v) ? v : void 0;
var text = (v) => typeof v === "string" ? v : void 0;
var harnessOf = (v) => isRecord(v) && typeof v.pid === "number" && typeof v.startTime === "number" && typeof v.pidNamespace === "string" ? { pid: v.pid, startTime: v.startTime, pidNamespace: v.pidNamespace } : void 0;
var finiteNumber = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function aliveOf(harness, table, namespace) {
  if (harness === null || namespace === null || harness.pidNamespace !== namespace) return null;
  const row2 = table.get(harness.pid);
  return row2 !== void 0 && row2.startTicks === harness.startTime && row2.state !== "Z";
}
function settingsOf(root) {
  const { daemon, runner } = root === null ? DEFAULT_POLICY : readPolicy(root);
  return {
    idleExitMinutes: daemon.idleExitMinutes,
    unusedExitMinutes: daemon.unusedExitMinutes,
    // `null` is no limit, which no process outlives.
    timeoutMs: runner.timeoutMs ?? Number.POSITIVE_INFINITY
  };
}
function get(db, sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}
function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}
function testFiles(row2) {
  const files = JSON.parse(str2(row2, "test_files"));
  if (!Array.isArray(files)) throw new TypeError("test_files is not a list");
  return files;
}
function parsed(text2) {
  try {
    return JSON.parse(text2);
  } catch {
    return void 0;
  }
}
function num2(row2, column) {
  if (typeof row2[column] === "number") return row2[column];
  throw new TypeError(`${column} is not a number`);
}
function str2(row2, column) {
  if (typeof row2[column] === "string") return row2[column];
  throw new TypeError(`${column} is not text`);
}
var orNull2 = (read) => (row2, column) => row2[column] === null ? null : read(row2, column);
var numOrNull2 = orNull2(num2);
var strOrNull2 = orNull2(str2);
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/core/ps/snapshot.ts
var SAMPLE_MS = 2e3;
async function takeSnapshot(options) {
  const read = await readWindow(options);
  const findings = options.flag(read.model);
  return { shape: shapeOf(read, findings, options), leftovers: findings.leftovers };
}
async function readWindow(o) {
  const { source, places } = o;
  const first = takeSample(source);
  const now = o.now();
  const locks = source.locks();
  const found2 = discover(source, first.table, places, locks);
  const work = readWork(source, first.table, found2.daemons);
  const attribution = attribute(source, first.table, ownersOf(found2.daemons, work.work));
  const reading = source.host();
  const bootTime = source.bootTime();
  await o.wait(Math.max(0, o.sampleMs - (performance.now() - first.atMs)));
  const pids3 = followed(found2, work.work, attribution);
  const tree = below(first.table, measured(found2, attribution));
  const read = takeSample(
    source,
    [.../* @__PURE__ */ new Set([...pids3, ...tree])],
    tree.length > 0 ? first.table : void 0
  );
  const costs = measure(source, first, read, measured(found2, attribution));
  const locksAgain = source.locks();
  const discovery = lockedAgain(source, found2, [locks, locksAgain]);
  const readable = [locks, locksAgain].filter((l) => l !== null).length;
  const daemonPids = new Set(discovery.daemons.map((d) => d.row.pid));
  const pool = readPool(source, places, daemonPids, [locks, locksAgain]);
  const second = { ...read, table: only(read.table, pids3) };
  const live = discovery.daemons.filter(
    (d) => second.table.get(d.row.pid)?.startTicks === d.row.startTicks
  );
  const again = readWork(source, second.table, live);
  const model = {
    now,
    places,
    source,
    locksRead: readable === 2 ? "both" : readable === 1 ? "one" : "none",
    discovery,
    first: { sample: first, work: work.work, attribution },
    second: {
      sample: second,
      work: again.work,
      attribution: attribute(source, second.table, ownersOf(live, again.work))
    },
    pool
  };
  return {
    model,
    // The host files of one read, the busy CPU over the window's two.
    host: hostTotals(
      { ...reading, cpuTime: first.cpuTime },
      { ...reading, cpuTime: second.cpuTime }
    ),
    costs,
    bootTime,
    unknown: [...discovery.unknown, ...work.unknown, ...again.unknown, ...blind(first.table, tree)]
  };
}
function blind(table, pids3) {
  if (!pids3.some((pid) => table.get(pid)?.childTicks === null)) return [];
  const why = "a lower bound: the source reads no children's CPU on this platform (D10), so a process that ends in the window adds none";
  return [{ what: "squeal cpuPct", why }];
}
function ownersOf(daemons, work) {
  return daemons.map((d) => {
    const own = work.get(d.row.pid);
    return { pid: d.row.pid, token: own?.token ?? null, tiers: own?.tiers ?? [] };
  });
}
function measured(discovery, attribution) {
  return [
    ...discovery.daemons.map((d) => d.row.pid),
    ...attribution.processes.flatMap((p) => [p.pid, ...p.descendants])
  ];
}
function followed(discovery, work, attribution) {
  const pids3 = new Set(measured(discovery, attribution));
  for (const u of attribution.unowned) pids3.add(u.pid);
  for (const w of work.values())
    for (const c of w.consumers) if (c.harness !== null) pids3.add(c.harness.pid);
  return [...pids3].sort((a, b) => a - b);
}
function only(table, pids3) {
  const kept = /* @__PURE__ */ new Map();
  for (const pid of pids3) {
    const row2 = table.get(pid);
    if (row2 !== void 0) kept.set(pid, row2);
  }
  return kept;
}

// src/cli/ps.ts
var USAGE = "usage: squeal ps [--repo] [--full] [--json]\n       squeal ps --leftovers\n";
var SOURCES = {
  linux: () => createProcSource(),
  // Built untested: nobody has run it on a Mac (the human, 2026-10-21).
  darwin: () => createDarwinSource()
};
async function psCommand(args, io, options = {}) {
  const parsed2 = parseArgs(args);
  if (typeof parsed2 === "string") {
    io.stderr(`squeal ps: ${parsed2}

${USAGE}`);
    return 2;
  }
  const platform = options.platform ?? process.platform;
  const source = (options.sourceFor ?? ((p) => SOURCES[p]?.() ?? null))(platform);
  if (source === null) {
    io.stderr(`squeal ps: ${platform} is not covered; squeal ps runs on Linux and macOS
`);
    return 3;
  }
  const cwd = io.cwd ?? process.cwd();
  const commonDir = commonDirOf(cwd);
  if (parsed2.repo && commonDir === null) {
    io.stderr(`squeal ps --repo: ${resolve3(cwd)} is not inside a git repository

${USAGE}`);
    return 2;
  }
  let snapshot;
  try {
    snapshot = await takeSnapshot({
      source,
      places: placesOf(io.env ?? process.env, commonDir, options),
      flag: options.flag ?? ((model) => flag2(model, { full: parsed2.full })),
      full: parsed2.full,
      repo: parsed2.repo,
      // The leftover walk needs no CPU window.
      sampleMs: parsed2.leftovers ? 0 : SAMPLE_MS,
      now: io.now ?? Date.now,
      wait: options.wait ?? ((ms) => sleep(ms))
    });
  } catch (error) {
    io.stderr(
      `squeal ps: no snapshot: ${error instanceof Error ? error.message : String(error)}
`
    );
    return 3;
  }
  const { shape, leftovers } = snapshot;
  if (parsed2.leftovers) {
    io.stdout(leftovers.map((path) => `${path}
`).join(""));
    for (const u of shape.unknown.filter((u2) => u2.what === "flag leftover-temp"))
      io.stderr(`squeal ps --leftovers: ${u.why}
`);
    return 0;
  }
  io.stdout(parsed2.json ? `${JSON.stringify(shape)}
` : render(shape, { full: parsed2.full }));
  return shape.flags === 0 ? 0 : 1;
}
function parseArgs(args) {
  const known = /* @__PURE__ */ new Set(["--repo", "--full", "--json", "--leftovers"]);
  const unknown = args.find((a) => !known.has(a));
  if (unknown !== void 0) return `unknown option "${unknown}"`;
  const leftovers = args.includes("--leftovers");
  if (leftovers && args.some((a) => a !== "--leftovers"))
    return "--leftovers prints the leftover paths and nothing else; it takes no other option";
  return {
    repo: args.includes("--repo"),
    full: args.includes("--full"),
    json: args.includes("--json"),
    leftovers
  };
}
function commonDirOf(cwd) {
  try {
    const root = findWorktreeRoot(resolve3(cwd));
    return root === null ? null : resolveCommonDir(root);
  } catch {
    return null;
  }
}
function placesOf(env, commonDir, options) {
  const xdg = env.XDG_RUNTIME_DIR;
  return {
    uid: options.uid ?? currentUid(),
    home: env.HOME !== void 0 && env.HOME !== "" ? env.HOME : homedir2(),
    userConfig: userConfigPath(env),
    runtimeDir: xdg !== void 0 && xdg !== "" && isAbsolute6(xdg) ? xdg : null,
    tempDir: options.tempDir ?? "/tmp",
    commonDir
  };
}

// src/cli/ps-index.ts
var [command, ...rest] = process.argv.slice(2);
if (command !== "ps" || rest.includes("--help") || rest.includes("-h")) {
  await import(new URL("squeal.mjs", import.meta.url).href);
} else {
  process.stdout.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });
  process.exitCode = await psCommand(rest, {
    stdout: (text2) => process.stdout.write(text2),
    stderr: (text2) => process.stderr.write(text2),
    cwd: process.cwd()
  });
}
