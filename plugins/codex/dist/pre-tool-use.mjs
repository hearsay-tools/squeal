import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/daemon/policy.ts
import { join as join3 } from "node:path";

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
function gitDirOf(root) {
  return dotGit(root)?.gitDir ?? null;
}
function resolveCommonDir(root) {
  const entry3 = dotGit(root);
  if (entry3 === null) return null;
  if (!entry3.isFile) return realpathSync(entry3.gitDir);
  const { gitDir } = entry3;
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

// src/core/fs/paths.ts
import { isAbsolute as isAbsolute2, join as join2, relative, sep } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute2(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
function toAbsolute(root, rel) {
  return join2(root, ...rel.split("/"));
}

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

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
  holdTold: { prefix: "hold-told:", owner: "delivery/hold-told" },
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
  daemonHandoffShort: { prefix: "daemon-handoff-short:", owner: "delivery/handoff" },
  slowTier: { prefix: "slow-tier:", owner: "slow/state" },
  slowEvidence: { prefix: "slow-evidence:", owner: "slow/rank-store" },
  failureKeys: { prefix: "failure-keys:", owner: "slow/state" },
  failureProducers: { prefix: "failure-producers:", owner: "state/producers" },
  reruns: { prefix: "reruns:", owner: "scheduler/rerun-memory" },
  interrupted: { prefix: "interrupted:", owner: "scheduler/interrupted" },
  heldFiles: { prefix: "held-files:", owner: "scheduler/held" },
  promotions: { prefix: "promotions:", owner: "scheduler/promotions" },
  yields: { prefix: "yields:", owner: "scheduler/yields" },
  quiet: { prefix: "quiet:", owner: "scheduler/quiet" },
  mergeHold: { prefix: "merge-hold:", owner: "scheduler/hold-rows" },
  commandHold: { prefix: "command-hold:", owner: "scheduler/hold-rows" },
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
function worktreeMetaKey(row, worktreeId) {
  return `${WORKTREE_META_ROWS[row].prefix}${worktreeId}`;
}

// src/core/types/daemon.ts
var DAEMON_SOCKET_TIMEOUT_MS = 100;
function daemonIncarnation(daemon) {
  if (daemon?.token === void 0) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}
function bootstrappedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonBootstrapped", worktreeId);
}
function daemonExitMetaKey(worktreeId) {
  return worktreeMetaKey("daemonExit", worktreeId);
}
function daemonRestMetaKey(worktreeId) {
  return worktreeMetaKey("daemonRest", worktreeId);
}

// src/core/types/delivery.ts
var MAIN_AGENT = "main";

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

// src/core/types/runner.ts
var SLOW_LANE_PREFIX = "slow:";
function isSlowLane(lane) {
  return lane.startsWith(SLOW_LANE_PREFIX);
}

// src/core/types/scheduler.ts
var MAX_PERSISTED_NOTES = 20;
function notesMetaKey(worktreeId) {
  return worktreeMetaKey("notes", worktreeId);
}
function refinedMetaKey(worktreeId) {
  return worktreeMetaKey("refined", worktreeId);
}
function awaitingInstallMetaKey(worktreeId) {
  return worktreeMetaKey("awaitingInstall", worktreeId);
}
function headMoveMetaKey(worktreeId) {
  return worktreeMetaKey("headMove", worktreeId);
}
function parseHeadMove(raw) {
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
function installCommandMetaKey(worktreeId) {
  return worktreeMetaKey("installCommand", worktreeId);
}
function parseAwaitingInstall(raw) {
  if (raw === "true") return [];
  if (raw === null || !raw.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : null;
  } catch {
    return null;
  }
}
function checkpointMetaKey(worktreeId) {
  return worktreeMetaKey("checkpoint", worktreeId);
}
function parseCheckpointProgress(raw) {
  if (raw === null || !raw.startsWith("{")) return null;
  try {
    const value = JSON.parse(raw);
    const numbers = [value.revision, value.startedAt, value.done, value.total];
    if (typeof value.id !== "string" || numbers.some((n) => typeof n !== "number")) return null;
    if (value.kind !== "run-all" && value.kind !== "baseline") return null;
    const owed = value.owed;
    const lists = owed === void 0 ? [] : [owed.ids, owed.remaining, owed.strict];
    if (!lists.every(Array.isArray)) return null;
    return value;
  } catch {
    return null;
  }
}

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/notes.ts
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
  const { at, revision, text } = item;
  if (typeof at !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  const { stopped: rawStopped, exitOf, topic } = item;
  const stopped = stoppedOf(rawStopped);
  return [
    {
      at,
      revision,
      text,
      ...stopped === void 0 ? {} : { stopped },
      ...typeof exitOf === "string" ? { exitOf } : {},
      ...typeof topic === "string" ? { topic } : {}
    }
  ];
}
function stoppedOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const { what, commands } = value;
  if (typeof what !== "string" || !Array.isArray(commands)) return void 0;
  return commands.every((c) => typeof c === "string") ? { what, commands } : void 0;
}

// src/core/daemon/config-file.ts
import { readFileSync as readFileSync2 } from "node:fs";
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
function loadConfigFile(path, shape, defaults) {
  let text;
  try {
    text = readFileSync2(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { value: defaults, problems: [] };
    return { value: defaults, problems: [`could not be read: ${String(error)}`], unparsed: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const problem = `not valid JSON (${error.message})`;
    return { value: defaults, problems: [problem], unparsed: true };
  }
  if (!isRecord(parsed)) {
    const got = Array.isArray(parsed) ? "an array" : JSON.stringify(parsed);
    return { value: defaults, problems: [`must be a JSON object, got ${got}`], unparsed: true };
  }
  const problems = [];
  const merged = merge(shape, defaults, parsed, "", problems);
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

// src/core/daemon/policy-node-test.ts
import { isAbsolute as isAbsolute3, posix } from "node:path";

// src/core/keys/glob.ts
function globToRegExp(glob) {
  if (glob.startsWith("!")) throw new Error(`squeal: negated input glob is not supported: ${glob}`);
  if (glob.startsWith("/")) throw new Error(`squeal: input glob must be relative: ${glob}`);
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  return new RegExp(`^${compile(source, glob)}$`, "s");
}
function createInputMatcher(globs2) {
  if (globs2.length === 0) return () => false;
  const patterns = globs2.map(globToRegExp);
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
function withDefaults(entry3) {
  return { ...entry3, argv: entry3.argv ?? [], env: entry3.env ?? {} };
}
function projectEntries(value, path, fields, required, withDefaults3, check) {
  if (!Array.isArray(value)) return "an array of projects";
  const kept2 = [];
  const problems = [];
  value.forEach((entry3, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry3, at, kept2, fields, required, check);
    if (problem === null) kept2.push(withDefaults3(entry3));
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function entryProblem(entry3, at, kept2, fields, required, check) {
  if (!isRecord(entry3))
    return `"${at}" must be an object, got ${JSON.stringify(entry3)}; it is skipped`;
  const named2 = nonEmptyString(entry3.name) === null ? entry3.name : null;
  const skipped = named2 === null ? "it is skipped" : `project ${JSON.stringify(named2)} is skipped`;
  for (const key of Object.keys(entry3)) {
    if (!Object.hasOwn(fields, key)) return `unknown key "${at}.${key}"; ${skipped}`;
  }
  for (const [key, field] of Object.entries(fields)) {
    const given = entry3[key];
    if (given === void 0 && !required.has(key)) continue;
    const expected = field(given);
    if (expected === null) continue;
    const why = typeof expected === "object" ? expected.problem : `must be ${expected}, got ${given === void 0 ? "undefined" : JSON.stringify(given)}`;
    return `"${at}.${key}" ${why}; ${skipped}`;
  }
  const across = check?.(entry3) ?? null;
  if (across !== null) return `"${at}.${across.key}" ${across.problem}; ${skipped}`;
  if (kept2.some((project) => project.name === named2)) {
    return `"${at}.name" repeats ${JSON.stringify(named2)} of an earlier project; it is skipped`;
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
function withDefaults2(entry3) {
  return { ...entry3, args: entry3.args ?? [], env: entry3.env ?? {} };
}
var pythonInsideRoot = (entry3) => {
  const python = entry3.python;
  if (python === void 0 || isAbsolute4(python)) return null;
  const path = posix2.join(entry3.cwd ?? ".", python.replaceAll("\\", "/"));
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
  const loaded = loadConfigFile(join3(root, POLICY_FILE), SHAPE, DEFAULT_POLICY);
  return {
    policy: loaded.value,
    problems: loaded.problems,
    ...loaded.unparsed === true ? { unparsed: true } : {}
  };
}
function readPolicy(root) {
  return loadPolicy(root).policy;
}
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/keys/closure.ts
var CLOSURE_METHOD = "static imports plus declared inputs";

// src/core/keys/hidden-lockfile.ts
var HIDDEN_LOCKFILE = "node_modules/.package-lock.json";

// src/core/keys/pnpm-lockfile.ts
var PNPM_LOCKFILE = "node_modules/.pnpm/lock.yaml";

// src/core/keys/environment.ts
var LOCKFILES = [
  { path: HIDDEN_LOCKFILE, patches: "patches" },
  { path: "node_modules/.yarn-state.yml", patches: null },
  { path: ".pnp.cjs", patches: ".yarn/patches" },
  { path: ".pnp.js", patches: ".yarn/patches" },
  { path: "node_modules/.yarn-integrity", patches: "patches" },
  { path: PNPM_LOCKFILE, patches: null },
  { path: ".rush/temp/shrinkwrap-deps.json", patches: null },
  { path: "bun.lock", patches: "patches" },
  { path: "bun.lockb", patches: "patches" }
];
function isInstalledLockfile(path) {
  return LOCKFILES.some((format) => path === format.path || path.endsWith(`/${format.path}`));
}

// src/core/keys/reverse-index.ts
function testFileId(ref) {
  return `${ref.project}\0${ref.path}`;
}

// src/core/state/fingerprint.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";

// src/core/text.ts
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
function cap(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
function timeText(at) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
var SAFE_WORD = /^[\w@%+=:,./-]+$/;
function shellWord(word) {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
function excludedProjectsText(entries) {
  const quoted = (list, join19) => {
    const all = list.map((entry3) => JSON.stringify(entry3));
    const last = all.pop();
    return all.length === 0 ? last : `${all.join(", ")} ${join19} ${last}`;
  };
  const names = entries.filter((entry3) => !entry3.includes("*"));
  const patterns = entries.filter((entry3) => entry3.includes("*"));
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

// src/core/state/fingerprint.ts
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
  let real = dir;
  try {
    real = realpathSync2(dir);
  } catch {
  }
  const roots = [.../* @__PURE__ */ new Set([dir, real, "/tmp"])].filter((p) => p !== "").sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\w.-])(?:<tmp>|${roots.map(escapeRegExp).join("|")})(?:/[^\\s/'"\`):,]+)+`,
    "g"
  );
  cachedRoots = { dir, roots, pattern };
  return cachedRoots;
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function firstLine(text) {
  const line = stripVTControlCharacters(text).split(/\r?\n/).find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}
function normalize(line) {
  return VOLATILE.reduce((text, [rule, replacement2]) => {
    const pattern = typeof rule === "function" ? rule() : rule;
    return typeof replacement2 === "string" ? text.replace(pattern, replacement2) : text.replace(pattern, replacement2);
  }, line);
}
function where(location2) {
  return location2 === null ? "?" : `${location2.path}:${location2.line}:${location2.column}`;
}
var PHASE_PREFIX = {
  load: "",
  "after-tests": "error after its tests ran: ",
  setup: "setup failed: "
};
function describeFailure(errors, fallback) {
  const first = errors[0];
  if (first === void 0) {
    return { fingerprint: `fail @ ${where(fallback)}`, summary: "failed without an error message" };
  }
  const line = firstLine(first.message);
  const location2 = first.location ?? fallback;
  const more = errors.length - 1;
  const text = withCauses(
    `${PHASE_PREFIX[first.phase ?? "load"]}${withCode(line === "" ? first.name : line, first.code)}`,
    first.causes ?? []
  );
  const summary = more > 0 ? `${text} (${more} more error${more === 1 ? "" : "s"})` : text;
  const recorder = errors.find((e) => e.recorder !== void 0)?.recorder;
  return {
    fingerprint: `${first.name}: ${normalize(line)} @ ${where(location2)}`,
    summary: withRecorder(
      withDiff(summary, first.diff === null ? null : diffText(first.diff)),
      recorder
    )
  };
}
function renormalizeFingerprint(fingerprint) {
  const at = fingerprint.lastIndexOf(" @ ");
  if (at < 0) return fingerprint;
  let text = fingerprint.slice(0, at);
  for (let next = normalize(text); next !== text; next = normalize(text)) text = next;
  return `${text}${fingerprint.slice(at)}`;
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
function withCode(text, code) {
  return code === void 0 || text.includes(code) ? text : `${text} (${code})`;
}
function withCauses(text, causes) {
  if (causes.length === 0) return text;
  const chain = causes.map((c) => `; cause: ${causeText(c)}`).join("");
  const shown = cap(chain, SUMMARY_MAX_CHARS - Math.min(text.length, LINE_MIN_CHARS));
  return `${cap(text, SUMMARY_MAX_CHARS - shown.length)}${shown}`;
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
function read(store, worktreeId) {
  const raw = store.meta.get(baselineMetaKey(worktreeId));
  return raw === null ? null : JSON.parse(raw);
}
function baselineFindings(store, worktreeId) {
  const entries = new Set(read(store, worktreeId)?.entries.map(current));
  return (check, fingerprint) => entries.has(current(entry(check, fingerprint)));
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
function read2(store, worktreeId) {
  const raw = store.meta.get(registeredKeysMetaKey(worktreeId));
  if (raw === null) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.snapshots) || !isRecord(value.slots)) return EMPTY;
    const snapshots = value.snapshots.map(toKeys);
    const slots = {};
    for (const [slot2, at] of Object.entries(value.slots)) {
      if (typeof at === "number" && snapshots[at] !== void 0) slots[slot2] = at;
    }
    return { snapshots, slots };
  } catch {
    return EMPTY;
  }
}
var identity = (keys) => JSON.stringify(Object.entries(keys).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
function recordRegisteredKeys(store, worktreeId, slot2, { resumed, kept: kept2 }) {
  const recorded = read2(store, worktreeId);
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
  const slots = {};
  for (const [at, keys] of named2) {
    const id = identity(keys);
    let index = indexOf.get(id);
    if (index === void 0) {
      index = snapshots.push(keys) - 1;
      indexOf.set(id, index);
    }
    slots[at] = index;
  }
  store.meta.set(registeredKeysMetaKey(worktreeId), JSON.stringify({ snapshots, slots }));
}
function beforeEditsFor(store, worktreeId, slot2, since) {
  let keys;
  const results = /* @__PURE__ */ new Map();
  let none2;
  const noneAt = () => {
    none2 ??= { outcome: "none", commit: store.revisions.get(worktreeId, since)?.head ?? null };
    return none2;
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
      const recorded = read2(store, worktreeId);
      const index = recorded.slots[slot2];
      keys = (index === void 0 ? void 0 : recorded.snapshots[index]) ?? {};
    }
    const key = keys[testFileId(testFileOf(check))];
    return (key === void 0 ? void 0 : atKey2(key).get(checkIdentity(check))) ?? noneAt();
  };
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

// src/core/state/file-class.ts
function fileClassOf(row, own) {
  const has = (validity) => own.some((s) => s.validity === validity);
  const queued = row !== void 0 && row.key !== null && row.pending !== null;
  const unkeyed = row === void 0 || row.key === null;
  if (queued || has("pending")) return "pending";
  if (unkeyed || own.length === 0 || has("unknown")) return "unknown";
  return has("stale") ? "stale" : "current";
}
function countNotCurrent(states, keys, openFiles2 = /* @__PURE__ */ new Set()) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === void 0) checks.set(id, [state]);
    else own.push(state);
  }
  const testFileCounts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const testFilesByPhase = { running: 0, queued: 0 };
  const testsByPhase = { running: 0, queued: 0 };
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const fileClass = fileClassOf(row, own);
    testFileCounts[fileClass]++;
    if (fileClass !== "pending") continue;
    const running = openFiles2.has(id) || row.pending === "running" || own.some(isRunning);
    testFilesByPhase[running ? "running" : "queued"]++;
  }
  const filePhase = new Map(keys.map((row) => [testFileId(row.testFile), row.pending]));
  for (const state of states) {
    if (state.check.kind !== "test" || state.validity !== "pending") continue;
    const id = testFileKeyOf(state.check);
    const phase = openFiles2.has(id) ? "running" : state.pendingPhase ?? filePhase.get(id) ?? "queued";
    testsByPhase[phase]++;
  }
  return { testFileCounts, testFilesByPhase, testsByPhase };
}
var isRunning = (state) => state.pendingPhase === "running";

// src/core/state/flaky.ts
var FLAKY_META_KEY = "flaky-checks";
function readFlakyNotes(store) {
  const raw = store.meta.get(FLAKY_META_KEY);
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter((entry3) => isNote(entry3[1]))
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
var OUTCOMES = /* @__PURE__ */ new Set(["pass", "fail"]);
function isNote(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.key === "string" && OUTCOMES.has(v.from) && OUTCOMES.has(v.to) && typeof v.fromWorktreeId === "string" && typeof v.toWorktreeId === "string" && typeof v.at === "number" && (v.failure === void 0 || typeof v.failure === "string");
}
function flakyText(note) {
  return `flaky: ${note.from.toUpperCase()} -> ${note.to.toUpperCase()} under the same inputs`;
}

// src/core/state/optimizer-note.ts
function optimizerOffMetaKey(worktreeId) {
  return worktreeMetaKey("optimizerOff", worktreeId);
}
function readOptimizerOff(store, worktreeId) {
  const text = store.meta.get(optimizerOffMetaKey(worktreeId));
  return text === null || text === "" ? void 0 : text;
}

// src/core/state/revision-commit.ts
function readRevisionCommit(store, worktreeId, latest = store.revisions.latest(worktreeId)) {
  const moved = parseHeadMove(store.meta.get(headMoveMetaKey(worktreeId)));
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
function revisionText(revision, commit) {
  if (commit === void 0 || commit.head === null) return String(revision);
  const dirty = commit.dirty ? ", dirty" : "";
  return `${revision} \xB7 ${commit.head.slice(0, 8)} + ${commit.sinceHead}${dirty}`;
}

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

// src/core/slow/classify.ts
import { posix as posix3 } from "node:path";
function slowFiles(policy, projects) {
  const matches2 = createInputMatcher(policy.slow.include);
  const slowProjects = new Set(
    projects.filter((project) => project.slow === true).map((project) => project.name)
  );
  return (testFile) => slowProjects.has(testFile.project) || matches2(testFile.path);
}
function slowGlobs(policy, projects) {
  const globs2 = [...policy.slow.include];
  for (const project of projects) {
    if (project.slow !== true) continue;
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs2.push(posix3.join(cwd, glob));
  }
  return globs2;
}

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
var WAITS = /* @__PURE__ */ new Set(["fast", "idle", "slot", "load"]);
function toSlowActivity(value) {
  if (value === null) return null;
  if (typeof value !== "object") return void 0;
  const v = value;
  if (v.kind === "waiting" && WAITS.has(v.for)) {
    return { kind: "waiting", for: v.for };
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
        (entry3) => typeof entry3[1] === "string"
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}

// src/core/slow/stop-wait.ts
var STOP_SLOW_WAIT_CAP_MS = 6e5;
function stopSlowWaitMs(policy) {
  if (!policy.stop.requireSlowSuite) return null;
  return Math.max(0, Math.min(policy.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
}
function stopWaitMetaKey(worktreeId) {
  return worktreeMetaKey("stopWait", worktreeId);
}
function forgetStopWait(store, consumer) {
  writeSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer, null);
}

// src/core/state/slow.ts
function slowPolicyView(policy) {
  const globs2 = slowGlobs(policy, policy.nodeTest);
  if (globs2.length === 0) return null;
  return {
    isSlow: slowFiles(policy, policy.nodeTest),
    slowGlobs: globs2,
    stopWaitMs: stopSlowWaitMs(policy),
    pausesOnly: policy.slow.trigger === "idle"
  };
}
function worktreeSlowView(store, worktreeId) {
  const root = store.worktrees.get(worktreeId)?.root;
  return root === void 0 ? null : slowPolicyView(readPolicy(root));
}
function classifySlowFiles(states, keys, isSlow) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    const ref = testFileOf(state.check);
    if (!isSlow(ref)) continue;
    const id = testFileId(ref);
    checks.set(id, [...checks.get(id) ?? [], state]);
  }
  const files2 = /* @__PURE__ */ new Map();
  for (const row of keys) {
    if (!isSlow(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const cls = own.length === 0 ? row.key !== null && row.pending !== null ? "pending" : "notRun" : own.some((s) => s.validity === "pending") ? "pending" : own.every((s) => s.validity === "current") ? "current" : "notRun";
    files2.set(id, { ref: row.testFile, class: cls });
  }
  return files2;
}
function readSlowTier(store, worktreeId, states, keys, view) {
  const files2 = classifySlowFiles(states, keys, view.isSlow);
  const counts = { current: 0, pending: 0, notRun: 0 };
  for (const { class: cls } of files2.values()) counts[cls]++;
  let currentAt = null;
  let currentUpTo = null;
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    if (files2.get(id)?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
    currentUpTo = Math.max(currentUpTo ?? state.observedAt, state.observedAt);
  }
  return {
    testFiles: files2.size,
    ...counts,
    currentAt,
    ...currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {},
    activity: liveActivity(store, worktreeId, keys, view.isSlow),
    ...view.stopWaitMs === null ? {} : { stopWaitMs: view.stopWaitMs },
    ...view.pausesOnly ? { pausesOnly: true } : {}
  };
}
function liveActivity(store, worktreeId, keys, isSlow) {
  const activity = readSlowActivity(store, worktreeId);
  if (activity?.kind === "waiting") {
    if (activity.for !== "idle" || consumerInTurn(store, worktreeId)) return activity;
    const fast = keys.some((row) => row.pending !== null && !isSlow(row.testFile));
    return fast ? { kind: "waiting", for: "fast" } : null;
  }
  if (activity === null) return null;
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon !== null && activity.since < daemon.startedAt) return null;
  const running = new Set(
    keys.filter((row) => row.pending === "running" && isSlow(row.testFile)).map((row) => row.testFile.path)
  );
  const [path, ...rest] = (activity.paths ?? [activity.path]).filter((p) => running.has(p));
  if (path === void 0) return null;
  const { since, lastDurationMs } = activity;
  const paths = rest.length === 0 ? {} : { paths: [path, ...rest] };
  return { kind: "running", path, ...paths, since, lastDurationMs };
}
function consumerInTurn(store, worktreeId) {
  const turns = readAll(store, worktreeMetaKey("turn", worktreeId));
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
}

// src/core/state/header.ts
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId), isSlow, openFiles2) {
  const latest = store.revisions.latest(worktreeId);
  const revision = latest?.number ?? 0;
  const commit = readRevisionCommit(store, worktreeId, latest);
  const counts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const fileLevelCounts = {
    current: 0,
    pending: 0,
    stale: 0,
    unknown: 0
  };
  let inheritedCount = 0;
  let inheritedFileLevelCount = 0;
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    counts[state.validity]++;
    if (state.check.kind === "file") fileLevelCounts[state.validity]++;
    if (state.validity === "current" && state.origin?.kind === "inherited") {
      inheritedCount++;
      if (state.check.kind === "file") inheritedFileLevelCount++;
    }
  }
  const refinedRevision = readRefined(store, worktreeId);
  const missing = parseAwaitingInstall(store.meta.get(awaitingInstallMetaKey(worktreeId)));
  const awaiting = missing !== null;
  const last = store.checkpoints.lastCompletedFull(worktreeId);
  const lane = awaiting ? null : laneAfter(store.checkpoints.lastCompleted(worktreeId), last);
  const view = worktreeSlowView(store, worktreeId);
  const slow = isSlow ?? view?.isSlow;
  const optimizerOff = readOptimizerOff(store, worktreeId);
  return {
    revision,
    ...commit === void 0 ? {} : { commit },
    counts,
    fileLevelCounts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    ...countNotCurrent(states, keys, openFiles2),
    fullSuite: {
      atCurrentRevision: !awaiting && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
      ...lane === null ? {} : { lane }
    },
    testFilesListed: keys.length > 0 || !awaiting && last !== null,
    inheritedCount,
    inheritedFileLevelCount,
    refinedRevision,
    runnerPartPending: refinedRevision !== null && refinedRevision < revision,
    ...slow === void 0 ? {} : { slowPending: countSlowPending(states, keys, slow) },
    ...view === null ? {} : { slowTier: readSlowTier(store, worktreeId, states, keys, view) },
    ...awaiting ? { awaitingInstall: true } : {},
    ...missing !== null && missing.length > 0 ? { missingInstalls: missing } : {},
    ...awaiting ? installCommandField(store, worktreeId) : {},
    ...optimizerOff === void 0 ? {} : { optimizerOff }
  };
}
function installCommandField(store, worktreeId) {
  const command = store.meta.get(installCommandMetaKey(worktreeId));
  return command === null || command === "" ? {} : { installCommand: command };
}
function laneAfter(latest, full) {
  if (latest?.lane === void 0 || latest.id === full?.id) return null;
  return { lane: latest.lane, revision: latest.revision };
}
function readRefined(store, worktreeId) {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}
function runnerPartText(revision) {
  return `the runner part of revision ${revision}`;
}
function fullSuiteText({ revision, fullSuite }, command) {
  if (fullSuite.atCurrentRevision) return `completed at revision ${revision}`;
  const none2 = fullSuite.lastCompletedRevision === null ? "none completed at any revision" : `none completed since revision ${fullSuite.lastCompletedRevision}`;
  const lane = fullSuite.lane === void 0 ? "" : `; only the ${fullSuite.lane.lane} lane completed, at revision ${fullSuite.lane.revision}`;
  return `${none2}${lane} (the counts are for revision ${revision}; \`${command} run --all\` requests one)`;
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
var SLOW_FILES_NAMED = 3;
function countSlowPending(states, keys, isSlow) {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const files2 = /* @__PURE__ */ new Map();
  let checks = 0;
  for (const state of states) {
    const ref = testFileOf(state.check);
    if (state.validity !== "pending" || !isSlow(ref)) continue;
    checks++;
    files2.set(testFileKeyOf(state.check), ref);
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
    (r) => r.provenance.runId === producer.runId && r.provenance.recordedAt === producer.recordedAt && r.key === failureKey && r.outcome === state.outcome && sameFingerprint(fingerprintOf(r), state.fingerprint) && r.provenance.commit === state.commit && (origin.kind === "inherited" ? r.provenance.worktreeId === origin.worktreeId : r.provenance.worktreeId === worktreeId && r.provenance.revision === state.observedAt)
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

// src/core/state/slow-text.ts
var WAITING_FOR = {
  fast: "fast test files",
  idle: "the agent to pause",
  slot: "the slow slot another worktree's slow tier holds",
  load: "host load to drop"
};
function durationText(ms) {
  const seconds = Math.max(0, Math.round(ms / 1e3));
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest === 0 ? "" : ` ${rest} s`}`;
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
function pendingText(pending, activity, late) {
  if (activity === null) return `${pending} pending`;
  const reported = late ? "last reported " : "";
  if (activity.kind === "waiting") {
    return `${pending} pending, ${reported}waiting for ${WAITING_FOR[activity.for]}`;
  }
  const paths = activity.paths ?? [activity.path];
  const several = paths.length > 1;
  const since = clockText(activity.since);
  const last = activity.lastDurationMs === null ? "no earlier run" : `${several ? "longest " : ""}last run ${durationText(activity.lastDurationMs)}`;
  const what = several ? `${paths.length} slow files since ${since}: ${filesText(paths)}` : `${activity.path} since ${since}`;
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
    parts.push(pendingText(tier.pending, tier.activity, header.daemon?.state === "down"));
  }
  if (tier.notRun > 0) parts.push(`${tier.notRun} not run at revision ${header.revision}`);
  const open = tier.testFiles - tier.current;
  const runs = open <= 0 ? "" : `; ${slowWaitText(command, open)}`;
  return `Slow tier: ${plural(tier.testFiles, "test file")}; ${parts.join("; ")}. ${capitalized(stopText(tier))}${runs}.`;
}
function slowWaitText(command, open) {
  return `\`${command} run --slow --wait 60000\` waits for ${open === 1 ? "its result" : "their results"}`;
}
function stopText(tier) {
  if (tier.stopWaitMs !== void 0) {
    return `Stop waits up to ${durationText(tier.stopWaitMs)} for them or holds the agent once`;
  }
  const when = slowRunsWhen(tier);
  if (tier.notRun === 0) return `Squeal runs them ${when}`;
  if (tier.pending === 0) return "Squeal has not queued them";
  return `Squeal runs the pending ones ${when} and has not queued the rest`;
}
function slowRunsWhen(tier) {
  return tier.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
}
function capitalized(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// src/core/status/checks.ts
function countChecks(checks) {
  const testFiles = checks.filter((check) => check.kind === "file").length;
  const setups = checks.filter((check) => check.kind === "setup").length;
  return {
    tests: checks.length - testFiles - setups,
    testFiles,
    ...setups > 0 ? { setups } : {}
  };
}
function checkPartsText({ tests, testFiles, setups = 0 }, fileLevel = "loaded") {
  return [
    ...tests > 0 ? [plural(tests, "test")] : [],
    ...testFiles > 0 ? [`${plural(testFiles, "test file")} ${fileLevel}`] : [],
    ...setups > 0 ? [plural(setups, "global setup")] : []
  ].join(", ");
}
function partsSuffix(count, fileLevel, fileLevelWord2) {
  if (count === 0 || fileLevel === void 0) return "";
  return ` (${checkPartsText({ tests: count - fileLevel, testFiles: fileLevel }, fileLevelWord2)})`;
}
function countedText(count, label, fileLevel) {
  return `${count} ${label}${partsSuffix(count, fileLevel)}`;
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

// src/core/delivery/consumer-version.ts
function versionMetaKey(worktreeId) {
  return worktreeMetaKey("consumerVersion", worktreeId);
}
function recordVersion(store, consumer, version) {
  writeSlot(store, versionMetaKey(consumer.worktreeId), consumer, version);
}

// src/core/delivery/delivery.ts
import { setTimeout as sleep } from "node:timers/promises";

// src/core/retry/load.ts
import { availableParallelism, loadavg } from "node:os";
function hostLoad() {
  return {
    oneMinute: process.platform === "win32" ? null : loadavg()[0] ?? null,
    cpus: availableParallelism()
  };
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
  const ref = v.testFile;
  return typeof v.id === "string" && typeof ref === "object" && ref !== null && typeof ref.project === "string" && typeof ref.path === "string" && typeof v.key === "string" && typeof v.session === "string" && RETRY_REASONS.includes(v.reason) && typeof v.askedAt === "number" && typeof v.askedIn === "string" && (v.claim === null || typeof v.claim === "object") && (v.end === null || typeof v.end === "object");
}

// src/core/retry/pending.ts
function pendingRetriesOf(store, keys, load = hostLoad, runs = []) {
  const current2 = new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
  const byFile2 = /* @__PURE__ */ new Map();
  for (const r of readRetries(store)) {
    const id = testFileId(r.testFile);
    if (r.end !== null || current2.get(id) !== r.key) continue;
    byFile2.set(id, [...byFile2.get(id) ?? [], r]);
  }
  if (byFile2.size === 0) return {};
  const running = new Map(
    keys.filter((k) => k.pending === "running").map((k) => [testFileId(k.testFile), k])
  );
  const retries = [...byFile2.values()].map((records) => {
    const id = testFileId(records[0].testFile);
    const run = running.has(id) ? runs.find((r) => r.testFiles.some((f) => testFileId(f) === id)) : void 0;
    return { ...entry2(records), ...run === void 0 ? {} : { runningSince: run.startedAt } };
  });
  const { oneMinute, cpus } = load();
  return { pendingRetries: { retries, loadAverage: oneMinute, cpus } };
}
function entry2(records) {
  const first = records[0];
  const testFile = first.testFile;
  return {
    testFile,
    reason: records.some((r) => r.reason === "environment") ? "environment" : "load",
    // A run asked for a file with no result starts at once whatever its reason (011 C5, gh-36).
    ...records.some((r) => r.noResult === true) ? { noResult: true } : {},
    askedAt: first.askedAt,
    claimedBy: records.find((r) => r.claim !== null)?.claim?.worktreeId ?? null,
    requests: records.length
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
  return failing.map(({ state, failure: failure2 }) => {
    if (failure2.check.kind === "setup") return failure2;
    const testFile = testFileOf(failure2.check);
    const results = store.results.listForCheck(failure2.check, Number.MAX_SAFE_INTEGER);
    const id = checkIdentity(state.check);
    const row = producingResult(worktreeId, state, producers.get(id), failureKeys.get(id), results);
    if (row === null) return { ...failure2, recordedUnknown: true };
    const { provenance } = row;
    const retry = retryFactOf(retriesAt(retries, testFile, row.key));
    const recorded = {
      worktreeId: provenance.worktreeId,
      worktreeRoot: store.worktrees.get(provenance.worktreeId)?.root ?? null,
      revision: provenance.revision,
      recordedAt: provenance.recordedAt,
      loadPerCpu: loads.get(provenance.runId) ?? null,
      ...retry === void 0 ? {} : { retry }
    };
    return { ...failure2, recorded };
  });
}

// src/core/retry/text.ts
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
   * busy timeout instead of failing to upgrade a read snapshot.
   */
  transaction(fn) {
    const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
    if (savepoint === null) this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
    else this.db.exec(`SAVEPOINT ${savepoint}`);
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
var slices = new AsyncLocalStorage();
function rollback(db) {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/.test(String(error))) throw error;
  }
}
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/store/open.ts
import { existsSync as existsSync3, mkdirSync, renameSync, rmSync as rmSync2 } from "node:fs";
import { join as join6 } from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/core/store/paths.ts
import { basename, dirname as dirname2, join as join4 } from "node:path";
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
function oneOf2(row, column, values) {
  const value = str(row, column);
  if (!values.includes(value)) {
    throw new TypeError(`squeal store: ${column} has unexpected value ${value}`);
  }
  return value;
}
function oneOfOrNull(row, column, values) {
  return row[column] === null ? null : oneOf2(row, column, values);
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
  const kind = oneOf2(row, "check_kind", ["test", "file", "setup"]);
  if (kind !== "test") return { kind, project, testPath };
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}
var OUTCOMES2 = ["pass", "fail", "skip"];
function toResult(row) {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf2(row, "outcome", OUTCOMES2),
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
import { join as join5, resolve as resolve2, sep as sep2 } from "node:path";

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
    records.filter((r) => r.outcome === "pass").map((r) => [identity2(r.check), r])
  );
  const added = [];
  for (const { result, failureId } of failing) {
    const pass = passes.get(identity2(result.check));
    if (pass === void 0 || pass.key !== result.key) continue;
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
        runId: pass.provenance.runId,
        worktreeId: pass.provenance.worktreeId,
        recordedAt: pass.provenance.recordedAt
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
    const entry3 = entries[i];
    const check = identity2(entry3.check);
    const id = JSON.stringify([check, entry3.key, entry3.provenance.runId]);
    const count = perCheck.get(check) ?? 0;
    if (seen.has(id) || count >= REPLACED_PER_CHECK) continue;
    seen.add(id);
    perCheck.set(check, count + 1);
    kept2.push(entry3);
  }
  return kept2.reverse();
}
function identity2(check) {
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
function recordUnknownRuns(conn, worktreeId, revision, marked, at) {
  const added = marked.flatMap(
    ({ testFiles, reason, runId }) => testFiles.map((testFile) => ({ worktreeId, testFile, runId, revision, reason, at }))
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

// src/core/store/prune.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var EVICTION_BATCH = 32;
var DELETE_BATCH = 256;
var VACUUM_PAGES = 512;
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
    if (existsSync2(join5(worktree.root, ".git"))) continue;
    worktrees.remove(worktree.id);
    worktreesRemoved++;
  }
  conn.transaction(() => expireReplaced(conn, cutoff));
  conn.transaction(() => dropFallenUnknownRuns(conn));
  let resultsRemoved = dropPrunable(conn, cutoff);
  if (options.maxSizeMb !== null) {
    resultsRemoved += evictToCap(conn, options.maxSizeMb * 1024 * 1024);
  }
  const droppedRuns = conn.transaction(
    () => conn.all(
      `DELETE FROM runs
       WHERE NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
         AND id NOT IN (SELECT value FROM json_each(?))
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))
       RETURNING log_dir`,
      JSON.stringify([...keptByReplaced(conn).runs, ...keptByUnknownRuns(conn)]),
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
  vacuum(conn);
  return {
    resultsRemoved,
    runsRemoved: droppedRuns.length,
    checkpointsRemoved,
    checksRemoved,
    worktreesRemoved,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size")
  };
}
function dropPrunable(conn, cutoff) {
  const ids = conn.read(() => conn.all(`SELECT rowid AS id FROM results WHERE ${PRUNABLE}`, cutoff)).map((row) => num(row, "id"));
  let removed = 0;
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    removed += conn.transaction(
      () => conn.run(
        `DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND ${PRUNABLE}`,
        batch,
        cutoff
      )
    );
  }
  conn.transaction(() => dropOrphanFailureTexts(conn));
  return removed;
}
function vacuum(conn) {
  let free = pragmaNumber(conn, "freelist_count");
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
    const left = pragmaNumber(conn, "freelist_count");
    if (left >= free) return;
    free = left;
  }
}
function evictToCap(conn, capBytes) {
  const tiers = [UNPROTECTED, `key NOT IN (${LIVE_KEYS})`];
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
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)
       AND id NOT IN (SELECT value FROM json_each(?))`,
    JSON.stringify(keptByReplaced(conn).texts)
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
  if (target.startsWith(runsDir + sep2)) rmSync(target, { recursive: true, force: true });
}

// src/core/store/repos/consumers.ts
var OUTCOMES3 = ["pass", "fail", "skip", "unknown"];
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
    outcome: oneOf2(row, "outcome", OUTCOMES3),
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
function where2(selection) {
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
    const w = where2(selection);
    return {
      sql: `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM ${FAILING_ROWS}
        LEFT JOIN failure_texts f ON f.id = r.failure_id
        WHERE ${w.sql} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
      params: [...w.params, limit]
    };
  },
  count: (selection) => {
    const w = where2(selection);
    return { sql: `SELECT COUNT(*) AS n FROM ${FAILING_ROWS} WHERE ${w.sql}`, params: w.params };
  },
  failingChecks: (selection) => {
    const w = where2(selection);
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
    recordUnknownRuns: (worktreeId, revision, marked, at) => recordUnknownRuns(conn, worktreeId, revision, marked, at),
    unknownRuns: (worktreeId) => readUnknownRuns(conn).filter((r) => r.worktreeId === worktreeId)
  };
}

// src/core/store/repos/results.ts
import { createHash as createHash2 } from "node:crypto";
var SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
var KEYS_SINCE = `
  SELECT key, MAX(recorded_at) AS recorded_at FROM results INDEXED BY results_by_time
  WHERE recorded_at > ? GROUP BY key`;
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
function createResultRepo(conn) {
  return {
    byKey: (key, usedAt = Date.now()) => {
      if (usedAt > 0) {
        conn.run(
          "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
          usedAt,
          key,
          usedAt
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
    latestForCheck: (check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_RESULTS} WHERE r.check_id = ? ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1`,
        id
      );
      return row === null ? null : toResult(row);
    },
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
    // Unused since 011-75, as are countFailures, FAILURE_WHERE and failureParams. They go with the
    // next key-format raise: removing them changes lines no case runs (011-64 design 4, 011-101).
    listFailures: (filter, limit) => conn.all(
      `${SELECT_RESULTS} WHERE ${FAILURE_WHERE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
      ...failureParams(filter),
      limit
    ).map(toResult),
    countFailures: (filter) => num(
      conn.get(
        `SELECT COUNT(*) AS n FROM results r WHERE ${FAILURE_WHERE}`,
        ...failureParams(filter)
      ) ?? { n: 0 },
      "n"
    ),
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
var FAILURE_WHERE = `r.outcome = 'fail' AND (? IS NULL OR r.worktree_id = ?) AND (? IS NULL OR r.recorded_at >= ?)`;
function failureParams({ worktreeId, since }) {
  return [worktreeId, worktreeId, since, since];
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
    kind: oneOf2(row, "kind", CHECKPOINT_KINDS),
    testFiles: json(row, "test_files"),
    startedAt: num(row, "started_at"),
    completedAt: numOrNull(row, "completed_at"),
    end: oneOfOrNull(row, "end_state", CHECKPOINT_ENDS)
  };
}

// src/core/store/repos/states.ts
var OUTCOMES4 = ["pass", "fail", "skip", "unknown"];
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
    outcome: oneOf2(row, "outcome", OUTCOMES4),
    validity: oneOf2(row, "validity", VALIDITIES),
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
    kind: oneOf2(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES4),
    to: oneOf2(row, "to_outcome", OUTCOMES4),
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
      method: oneOf2(row, "method", METHODS)
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
    remove: (worktreeId, testFiles) => conn.transaction(() => {
      for (const t of testFiles) {
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
      const stored2 = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
      conn.run(
        `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        stored2.worktreeId,
        stored2.number,
        stored2.createdAt,
        stored2.head,
        flag(stored2.dirty),
        stored2.trigger,
        JSON.stringify(stored2.changes)
      );
      return stored2;
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
    trigger: oneOf2(row, "trigger", TRIGGERS),
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
      const token = toDaemonToken(value, startedAt, version);
      if (token === null || token === void 0) return void 0;
      const executable = isRecord(value) ? value.executable : void 0;
      return typeof executable === "string" ? { token, executable } : { token };
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
  const toRecord = (row) => {
    const record = fromRow(row);
    const d = record.daemon;
    const token = d === null ? void 0 : tokenRowOf(record.id, d.startedAt, d.squealVersion);
    return token === void 0 || d === null ? record : { ...record, daemon: { ...d, ...token } };
  };
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
      const token = tokenOf(id, startedAt, squealVersion2);
      return { startedAt, squealVersion: squealVersion2, ...token === void 0 ? {} : { token } };
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

// src/core/store/store.ts
var connections = /* @__PURE__ */ new WeakMap();
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

// src/core/store/open.ts
var DEFAULT_BUSY_TIMEOUT_MS = 1e3;
var META_STORE_RECOVERED = "store.recovered";
function isStoreOpenFailure(value) {
  return "reason" in value;
}
function openStore(commonDir, options = {}) {
  const paths = storePaths(commonDir);
  if (!existsSync3(paths.database)) {
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
    const found2 = userVersion(db);
    if (found2 > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found: found2, supported: SCHEMA_VERSION };
    }
    if (options.checkIntegrity === true) {
      const problem = integrityProblem(db);
      if (problem !== null) {
        db.close();
        return { corrupt: problem };
      }
    }
    if (pragmaNumber2(db, "page_count") === 0) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    switchToWal(db, busyTimeout(options));
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
function pragmaNumber2(db, name) {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]);
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
  const lock = new DatabaseSync(join6(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: true });
    if (!("corrupt" in again)) return again;
    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh2 = connect(paths, { ...options, checkIntegrity: false });
    if ("corrupt" in fresh2) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh2)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt });
      fresh2.transaction(() => fresh2.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh2;
  } finally {
    rollback(lock);
    lock.close();
  }
}
function moveAside(database, at) {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync3(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  if (existsSync3(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync2(`${database}-shm`, { force: true });
  return movedTo;
}

// src/core/status/test-frame.ts
var V8_FRAME = /^\s*at (.+?)\s*$/;
var V8_POSITION = /^(.+):(\d+):(\d+)$/;
var PYTEST_ENTRY = /^(\S[^:]*):(\d+):(?: |$)/;
var NATIVE_ENTRY = /^\s*File "(.+)", line (\d+)/;
function v8Position(frame) {
  const open = frame.indexOf(" (");
  const where3 = open !== -1 && frame.endsWith(")") ? frame.slice(open + 2, -1) : frame;
  const match = V8_POSITION.exec(where3);
  if (match === null) return null;
  return { path: match[1], line: Number(match[2]), column: Number(match[3]) };
}
function positions(stack) {
  return stack.split("\n").flatMap((text) => {
    const v8 = V8_FRAME.exec(text);
    const position = v8 === null ? null : v8Position(v8[1]);
    if (position !== null) return [position];
    const entry3 = PYTEST_ENTRY.exec(text) ?? NATIVE_ENTRY.exec(text);
    return entry3 === null ? [] : [{ path: entry3[1], line: Number(entry3[2]) }];
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

// src/core/delivery/closure.ts
function closureFor(store, worktreeId) {
  const keys = /* @__PURE__ */ new Map();
  const keyOf = (id, ref) => {
    let byFile2 = keys.get(id);
    if (byFile2 === void 0) {
      byFile2 = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile2);
    }
    return byFile2.get(testFileId(ref)) ?? null;
  };
  return (ref) => {
    const record = store.testFiles.get(ref);
    if (record === null) return void 0;
    if (record.updatedBy === worktreeId) return record.closure.paths;
    const key = keyOf(worktreeId, ref);
    return key !== null && key === keyOf(record.updatedBy, ref) ? record.closure.paths : void 0;
  };
}

// src/core/delivery/registered.ts
function registeredMetaKey(worktreeId) {
  return worktreeMetaKey("registered", worktreeId);
}
function parkedMetaKey(worktreeId) {
  return worktreeMetaKey("registeredLeft", worktreeId);
}
var isNumber2 = (value) => typeof value === "number";
var isGap = (value) => Array.isArray(value) && value.length === 2 && value.every(isNumber2);
function toRegistration(value) {
  if (isNumber2(value)) return { since: value, gaps: [] };
  if (!isRecord(value) || !isNumber2(value.since) || !Array.isArray(value.gaps)) return null;
  if (!value.gaps.every(isGap)) return null;
  const r = { since: value.since, gaps: value.gaps };
  return isNumber2(value.scanned) ? { ...r, scanned: value.scanned } : r;
}
var stored = (r) => r.gaps.length === 0 && r.scanned === void 0 ? r.since : r;
function registration(store, consumer) {
  return toRegistration(readSlot(store, registeredMetaKey(consumer.worktreeId), consumer));
}
function scannedDaemon(store, worktreeId, alive2) {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (!alive2 || daemon === null) return null;
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  return marker !== null && Number(marker) === daemon.startedAt ? daemon.startedAt : null;
}
function seesEveryChange(store, worktreeId, r) {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  return r.scanned !== void 0 && daemon?.startedAt === r.scanned;
}
function tellRegistered(store, consumer, revision, { at, scanned }) {
  const parked = unpark(store, consumer, at);
  const next = parked === null ? fresh(revision, scanned) : back(parked, revision, scanned);
  writeSlot(store, registeredMetaKey(consumer.worktreeId), consumer, stored(next));
  recordRegisteredKeys(store, consumer.worktreeId, slot(consumer), {
    resumed: parked !== null,
    kept: registeredSlots(store, consumer.worktreeId, at)
  });
  return parked === null ? null : { said: parked.said === true, uncovered: parked.uncovered ?? [] };
}
function registeredSlots(store, worktreeId, at) {
  const slots = new Set(Object.keys(readAll(store, registeredMetaKey(worktreeId))));
  for (const [k, v] of Object.entries(readAll(store, parkedMetaKey(worktreeId)))) {
    if (isRecord(v) && isNumber2(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) slots.add(k);
  }
  return slots;
}
function fresh(since, scanned) {
  return scanned === null ? { since, gaps: [] } : { since, gaps: [], scanned };
}
function back(parked, revision, scanned) {
  const away = [parked.leftAt, revision];
  const r = {
    since: parked.since,
    gaps: revision > parked.leftAt ? [...parked.gaps, away] : parked.gaps
  };
  return scanned !== null && parked.scanned === scanned ? { ...r, scanned } : r;
}
function park(store, consumer, at, { said, uncovered } = { said: false, uncovered: [] }) {
  const key = registeredMetaKey(consumer.worktreeId);
  const current2 = registration(store, consumer);
  if (readSlot(store, key, consumer) !== void 0) writeSlot(store, key, consumer, null);
  if (current2 === null) return;
  const leftAt = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  const told = {
    ...said ? { said: true } : {},
    ...uncovered.length > 0 ? { uncovered } : {}
  };
  writeParked(store, consumer, at, { ...current2, leftAt, leftTime: at, ...told });
}
function unpark(store, consumer, at) {
  const value = readAll(store, parkedMetaKey(consumer.worktreeId))[slot(consumer)];
  if (value === void 0) return null;
  writeParked(store, consumer, at, null);
  const r = toRegistration(value);
  if (r === null || !isRecord(value) || !isNumber2(value.leftAt) || !isNumber2(value.leftTime)) {
    return null;
  }
  if (value.leftTime < at - CONSUMER_EXPIRY_MS) return null;
  const told = {
    ...value.said === true ? { said: true } : {},
    ...Array.isArray(value.uncovered) ? { uncovered: value.uncovered.filter((p) => typeof p === "string") } : {}
  };
  return { ...r, leftAt: value.leftAt, leftTime: value.leftTime, ...told };
}
function writeParked(store, consumer, at, value) {
  const key = parkedMetaKey(consumer.worktreeId);
  const all = readAll(store, key);
  const next = {};
  for (const [k, v] of Object.entries(all)) {
    if (isRecord(v) && isNumber2(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) next[k] = v;
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
function loadOf(store, worktreeId, entry3) {
  if (entry3.summary === null || !TIMED_OUT.test(entry3.summary)) return void 0;
  const from = entry3.origin.kind === "inherited" ? entry3.origin.worktreeId : worktreeId;
  const result = store.results.listForCheck(entry3.check, LOAD_RESULTS_READ).find((r) => r.outcome === "fail" && r.provenance.worktreeId === from);
  return result?.errors.find((e) => e.loadAverage !== void 0)?.loadAverage;
}
function attribute(store, consumer, entries, revision) {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const from = registration(store, consumer);
  const changesOf = closureChanges(store, consumer, revision);
  const before = from === null ? null : beforeEditsFor(store, consumer.worktreeId, slot(consumer), from.since);
  const frameOf = testFileFrames(store, consumer.worktreeId);
  return entries.map((entry3) => {
    if (entry3.kind === "fail-retired" || entry3.to !== "fail") return entry3;
    const load = loadOf(store, consumer.worktreeId, entry3);
    const firstSeen = entry3.kind === "first-seen-fail" && entry3.from === null && before !== null;
    const frame = frameOf(entry3.check, entry3.location);
    const facts = {
      ...load === void 0 ? {} : { loadAverage: load },
      ...firstSeen ? { beforeEdits: before(entry3.check) } : {},
      ...frame === void 0 ? {} : { testFileFrame: frame }
    };
    const told = changesOf(entry3.check);
    return { ...entry3, ...told === void 0 ? {} : { changesInClosure: told }, ...facts };
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
    const thrown = row?.errors[0]?.location ?? null;
    if (row === void 0 || thrown === null || !samePosition(thrown, location2)) return void 0;
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
  const runOf2 = (check, key) => {
    if (!rows.has(key)) rows.set(key, store.results.byKey(key));
    const identity3 = checkIdentity(check);
    return rows.get(key)?.find((r) => checkIdentity(r.check) === identity3)?.provenance.runId;
  };
  return entries.map((entry3) => {
    if (entry3.kind === "fail-retired") return entry3;
    const note = notes.get(checkIdentity(entry3.check));
    const key = keys.get(testFileId(testFileOf(entry3.check)));
    if (note === void 0 || note.key !== key) return entry3;
    const runId = entry3.kind === "fail-to-pass" && key !== null ? runOf2(entry3.check, key) : void 0;
    const retry = runId !== void 0 && key !== null ? passedRetry(store, testFileOf(entry3.check), key, runId) : void 0;
    return { ...entry3, flaky: note, ...retry === void 0 ? {} : { retry } };
  });
}
function withDependencies(store, worktreeId, header, failing) {
  const installed = nodeFailing(store, worktreeId, failing) ? dependenciesInstalled(store, worktreeId) : void 0;
  return installed === void 0 ? header : { ...header, dependenciesInstalled: installed };
}
var NODE_TEST_FILE = /\.[cm]?[jt]sx?$/;
function nodeFailing(store, worktreeId, failing) {
  if (failing.length === 0) return false;
  const root = store.worktrees.get(worktreeId)?.root;
  if (root === void 0) return false;
  const { policy, problems } = loadPolicy(root);
  if (problems.length > 0) return false;
  const pytest = new Set(policy.pytest.map((p) => p.name));
  return failing.some((check) => !pytest.has(check.project) && NODE_TEST_FILE.test(check.testPath));
}

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
function restrictPlan(plan, keep) {
  const entries = plan.entries.filter(keep);
  const ids = new Set(entries.map((e) => checkIdentity(e.check)));
  return {
    entries,
    writes: plan.writes.filter((w) => ids.has(checkIdentity(w.check))),
    removals: plan.removals.filter((c) => ids.has(checkIdentity(c)))
  };
}
function toView2(state, toldAt) {
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
    const prior = (before === null || before.outcome === "unknown") && state.outcome === "fail" && input.history !== void 0 ? beforeFailing(input.history(state.check), state) : null;
    const from = before === null || prior?.outcome === "pass" ? prior : before;
    const kind = transitionKind(from, state);
    if (kind === "to-unknown" && from?.outcome === "pass" && input.ownEdit?.(state) === true) {
      continue;
    }
    if (before === null || kind !== null) writes.push(toView2(state, input.toldAt));
    if (kind === null) continue;
    const baseline = kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    const originRoot = state.origin?.kind === "inherited" ? input.rootOf(state.origin.worktreeId) : null;
    entries.push({
      check: state.check,
      kind,
      from: from?.outcome ?? null,
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
  const sorted = entries.map((entry3, i) => ({ entry: entry3, i })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i).map(({ entry: entry3 }) => entry3);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}

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
  for (const [id, entry3] of Object.entries(value)) {
    if (!Array.isArray(entry3) || !isRevision(entry3[1])) continue;
    entries.set(id, { open: isRevision(entry3[0]) ? entry3[0] : null, last: entry3[1] });
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
  for (const [id, entry3] of entries) {
    if (entry3.open === null && entry3.last <= upTo) entries.delete(id);
  }
  if (entries.size !== before) write(store, worktreeId, entries);
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
function editsSaid(store, consumer) {
  return readState(store, consumer)?.said === true;
}
function forgetEdits(store, consumer) {
  writeState(store, consumer, null);
  prune2(store, consumer.worktreeId);
}
function prune2(store, worktreeId) {
  const sinces = Object.values(readAll(store, editsMetaKey(worktreeId))).flatMap(
    (v) => isRecord(v) && typeof v.since === "number" ? [v.since] : []
  );
  pruneRekeyed(
    store,
    worktreeId,
    sinces.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...sinces)
  );
}
function refined(store, worktreeId) {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : Number.POSITIVE_INFINITY;
}
function editNotes(store, consumer, states, delivering) {
  const state = readState(store, consumer);
  if (state === null || state.said && !delivering) return null;
  const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  if (revision <= state.since || refined(store, consumer.worktreeId) < revision) return null;
  const gaps = registration(store, consumer)?.gaps ?? [];
  const { changed } = changedAfter(
    store,
    consumer.worktreeId,
    { since: state.since, gaps },
    revision
  );
  if (changed.size === 0) return null;
  const rows = new Map(
    store.testFileKeys.list(consumer.worktreeId).map((k) => [testFileId(k.testFile), k])
  );
  const rekeyed = [];
  let owed = false;
  for (const [id, entry3] of readRekeyed(store, consumer.worktreeId)) {
    const row = rows.get(id);
    if (row === void 0 || row.key === null || entry3.last <= state.since) continue;
    rekeyed.push(row);
    owed ||= row.pending !== null;
  }
  const sawEdit = state.said || rekeyed.length === 0 ? void 0 : { queued: rekeyed.length };
  const editsSettled = owed ? void 0 : settled(state.since, rekeyed, states);
  if (sawEdit === void 0 && editsSettled === void 0) return null;
  return {
    ...sawEdit === void 0 ? {} : { sawEdit },
    ...editsSettled === void 0 ? {} : { editsSettled },
    rekeyed: new Set(rekeyed.map((k) => testFileId(k.testFile))),
    tell: () => {
      writeState(store, consumer, {
        since: editsSettled === void 0 ? state.since : revision,
        said: true
      });
      if (editsSettled !== void 0) prune2(store, consumer.worktreeId);
    }
  };
}
function carriesEditResult(notes, checks, header) {
  if (notes.sawEdit === void 0 || notes.editsSettled !== void 0) return false;
  const pending = header.counts.pending > 0 || header.testFilesWithoutChecks.pending > 0 || header.runnerPartPending === true;
  return !pending && checks.some((check) => notes.rekeyed.has(testFileKeyOf(check)));
}
function settled(since, rekeyed, states) {
  if (rekeyed.length === 0) return void 0;
  const unknown = new Set(
    states.filter((s) => s.outcome === "unknown").map((s) => testFileKeyOf(s.check))
  );
  return {
    since,
    files: rekeyed.length,
    unknown: rekeyed.filter((k) => unknown.has(testFileId(k.testFile))).length
  };
}

// src/core/waiter-lock/waiter-lock.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// src/core/delivery/harness-process.ts
import { readFileSync as readFileSync3, readlinkSync } from "node:fs";
function readProcStat(pid) {
  let text;
  try {
    text = readFileSync3(`/proc/${pid}/stat`, "utf8");
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
function isCommandHold(entry3) {
  if (!isRecord(entry3)) return false;
  const { token, since, until, command, wrapper, child } = entry3;
  return typeof token === "string" && typeof since === "number" && typeof until === "number" && typeof command === "string" && (wrapper === null || toHarness(wrapper) !== void 0) && (child === null || toHarness(child) !== void 0);
}

// src/core/daemon/runner.ts
import { readdirSync, readFileSync as readFileSync4 } from "node:fs";
import { join as join7, posix as posix4 } from "node:path";
var VITEST_CONFIG = /^(vitest\.(config|workspace|projects)|vite\.config)\.[cm]?[jt]s$/;
function vitestDetected(root) {
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return false;
  }
  if (names.some((name) => VITEST_CONFIG.test(name))) return true;
  return listsVitest(readManifest(join7(root, "package.json")));
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
    return JSON.parse(readFileSync4(path, "utf8"));
  } catch {
    return null;
  }
}

// src/core/delivery/stopped.ts
function stoppedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonStopped", worktreeId);
}
function heldStop(store, worktreeId, worktree, live) {
  if (live.state === "alive") return null;
  const mark = readMark(store, worktreeId);
  if (mark === null) return null;
  const heartbeat = worktree?.daemon?.heartbeatAt ?? worktree?.lastHeartbeatAt;
  return heartbeat !== void 0 && heartbeat > mark.at ? null : mark;
}
function asStopped(store, worktreeId, worktree, live) {
  if (live.state !== "down" || live.startingSince !== void 0) return live;
  if (heldStop(store, worktreeId, worktree, live) === null) return live;
  return { ...live, stopped: true };
}
function readMark(store, worktreeId) {
  const text = store.meta.get(stoppedMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark = JSON.parse(text);
    if (!isRecord(mark) || typeof mark.at !== "number") return null;
    return { at: mark.at, tree: typeof mark.tree === "string" ? mark.tree : null };
  } catch {
    return null;
  }
}

// src/core/status/config-problems.ts
function configProblemsOf(root) {
  const { problems } = loadPolicy(root);
  return problems.length === 0 ? {} : { configProblems: problems };
}

// src/core/status/died.ts
import { existsSync as existsSync4 } from "node:fs";

// src/core/daemon/lock.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname3 } from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

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
  mkdirSync2(dirname3(path), { recursive: true });
  const db = new DatabaseSync3(path);
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

// src/core/run-log.ts
function testFileLabel(project, path) {
  return project ? `[${project}] ${path}` : path;
}

// src/core/status/died.ts
var DIED_FILES_SHOWN = 5;
function withDeath(store, worktree, live) {
  const record = worktree?.daemon ?? null;
  if (live.state !== "down" || worktree === null || record === null) return live;
  const { id } = worktree;
  const self = daemonIncarnation(record);
  if (self !== null && shutDown(store, id, self)) return live;
  if (!daemonGone(worktree)) return live;
  const runs = store.runs.inFlight(id, record.startedAt).map((run) => ({ id: run.id, revision: run.revision, testFiles: run.testFiles }));
  return { ...live, died: { runs } };
}
function shutDown(store, worktreeId, self) {
  if (store.meta.get(daemonExitMetaKey(worktreeId)) === self) return true;
  return readDaemonNotes(store, worktreeId).some((note) => note.exitOf === self);
}
function daemonGone(worktree) {
  const path = lockFileFor(worktree.commonDir, worktree.id);
  if (!existsSync4(path)) return false;
  try {
    const lock = acquireDaemonLock(path);
    lock?.release();
    return lock !== null;
  } catch {
    return false;
  }
}
function deathText(died) {
  const during = died.runs.length === 0 ? "between runs" : `during ${died.runs.map((run) => `run ${run.id} (revision ${run.revision}) of ${files(run.testFiles)}`).join("; ")}`;
  return `died without shutting down, ${during}`;
}
var DEATH_CAUSE = "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";
function files(refs) {
  const shown = refs.slice(0, DIED_FILES_SHOWN).map((ref) => testFileLabel(ref.project, ref.path));
  const more = refs.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

// src/core/status/git-head.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join8 } from "node:path";
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = gitDirOf(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read3(join8(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === void 0) return null;
    value = read3(join8(gitDir, ref)) ?? read3(join8(commonDir, ref)) ?? packed(commonDir, ref);
  }
  return null;
}
function packed(commonDir, ref) {
  for (const line of (read3(join8(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read3(path) {
  try {
    return readFileSync5(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// src/core/status/identity.ts
function statusIdentity(root, latest, commit, daemon) {
  const live = readGitHead(root);
  if (latest === null) return { head: live, dirty: null, dirtyObservedAt: null };
  const recorded = commit?.head ?? latest.head;
  if (live !== null && live !== recorded) {
    return { head: live, dirty: null, dirtyObservedAt: null, headMovedSince: latest.number };
  }
  if (daemon.state !== "alive") return { head: recorded, dirty: null, dirtyObservedAt: null };
  return { head: recorded, dirty: commit?.dirty ?? latest.dirty, dirtyObservedAt: latest.number };
}
function shortCommit(commit) {
  return commit === null ? "no commit" : commit.slice(0, 7);
}

// src/core/status/open.ts
var STATUS_BUSY_TIMEOUT_MS = 1e3;
function unavailable(reason, detail) {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: false,
    reason,
    message: `status unavailable, ${detail}`
  };
}
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/scheduler/claims.ts
var CLAIM_GRACE_MS = 6e3;
var CLAIM_UNBOUNDED_MS = 6e5;
function claimBoundMs(timeoutMs) {
  return timeoutMs === null ? CLAIM_UNBOUNDED_MS : timeoutMs + CLAIM_GRACE_MS;
}

// src/core/scheduler/runner-work-bound.ts
var RUNNER_PART_MARGIN_MS = 6e4;
function runnerPartBoundMs(timeoutMs) {
  return (timeoutMs ?? CLAIM_UNBOUNDED_MS) + CLAIM_GRACE_MS + RUNNER_PART_MARGIN_MS;
}

// src/core/slow/slot.ts
import { existsSync as existsSync5, readdirSync as readdirSync2, rmSync as rmSync3, statSync, writeFileSync } from "node:fs";
import { isAbsolute as isAbsolute6, join as join10 } from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";
import { pathToFileURL } from "node:url";

// src/core/daemon/paths.ts
import { chmodSync, lstatSync as lstatSync2, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute5, join as join9 } from "node:path";
function runtimeDir(env = process.env) {
  return xdgRuntimeDir(env) ?? userTmpDir();
}
var MAX_SOCKET_PATH_BYTES = 103;
function socketPathFor(worktreeId, env = process.env) {
  const name = socketNameFor(worktreeId);
  const path = join9(runtimeDir(env), name);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join9(userTmpDir(), name);
}
function socketNameFor(worktreeId) {
  return `squeal-${worktreeId}.sock`;
}
function preparePrivateDir(dir, uid = currentUid(), role = "socket directory") {
  mkdirSync3(dirname4(dir), { recursive: true });
  try {
    mkdirSync3(dir, { mode: 448 });
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
  return join9("/tmp", `squeal-${uid}`);
}
function xdgRuntimeDir(env) {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== void 0 && xdg !== "" && isAbsolute5(xdg) ? xdg : null;
}
function currentUid() {
  return process.getuid?.() ?? 0;
}

// src/core/slow/slot.ts
var SLOW_LOCK_FILE = "slow.lock";
function slowSlotDir(env = process.env, userDir = userTmpDir()) {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== void 0 && xdg !== "" && isAbsolute6(xdg) ? join10(xdg, "squeal") : userDir;
}
function heldPermits(request) {
  const { dir } = request;
  if (!existsSync5(dir)) return [];
  checkPrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const held = [];
  for (let i = 0; i < Math.max(1, request.permits ?? 1); i++) {
    const file = permitFile(i);
    const path = join10(dir, file);
    if (!existsSync5(path)) continue;
    let free;
    try {
      free = permitFree(path);
    } catch {
      held.push({ file, record: { kind: "unreadable" } });
      continue;
    }
    if (!free) held.push({ file, record: permitRecord(path) });
  }
  return held;
}
function permitRecord(path) {
  let db;
  try {
    db = new DatabaseSync4(immutableUrl(path), { readOnly: true });
  } catch {
    return { kind: "unreadable" };
  }
  try {
    const row = db.prepare("SELECT pid, worktree_id, since FROM holder LIMIT 1").get();
    if (row === void 0) return { kind: "missing" };
    const { pid, worktree_id: worktreeId, since } = row;
    if (!Number.isSafeInteger(pid) || typeof worktreeId !== "string") return { kind: "unreadable" };
    if (!Number.isSafeInteger(since)) return { kind: "unreadable" };
    return {
      kind: "holder",
      pid,
      worktreeId,
      since
    };
  } catch (error) {
    return { kind: String(error).includes("no such table") ? "missing" : "unreadable" };
  } finally {
    db.close();
  }
}
function immutableUrl(path) {
  const url = pathToFileURL(path);
  url.search = "immutable=1";
  return url;
}
function permitFree(path) {
  const db = new DatabaseSync4(path);
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
function permitFile(i) {
  return i === 0 ? SLOW_LOCK_FILE : `slow.${i}.lock`;
}
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/scheduler/slow.ts
var views = /* @__PURE__ */ new WeakMap();
function slowView(policy) {
  let view = views.get(policy);
  if (view === void 0) {
    const globs2 = slowGlobs(policy, policy.nodeTest);
    view = { isSlow: slowFiles(policy, policy.nodeTest), globs: globs2, declared: globs2.length > 0 };
    views.set(policy, view);
  }
  return view;
}
function laneFor(policy, ref, runnerLane) {
  return slowView(policy).isSlow(ref) ? SLOW_LANE_PREFIX + runnerLane : runnerLane;
}

// src/core/scheduler/promotions.ts
function promotionsMetaKey(worktreeId) {
  return worktreeMetaKey("promotions", worktreeId);
}
function promotedIds(store, worktreeId, daemonStartedAt, now) {
  const raw = store.meta.get(promotionsMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Set();
  try {
    const { at, promotions } = JSON.parse(raw);
    if (typeof at !== "number" || at < daemonStartedAt || !Array.isArray(promotions)) {
      return /* @__PURE__ */ new Set();
    }
    const live = promotions.filter(
      (p) => typeof p === "object" && p !== null && typeof p.until === "number" && p.until > now && Array.isArray(p.files)
    );
    return new Set(live.flatMap((p) => p.files.filter((f) => typeof f === "string")));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}

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

// src/core/daemon/version.ts
import { readdirSync as readdirSync3, readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname5, join as join11 } from "node:path";
import { fileURLToPath } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var PACKAGE_NAME = "squeal";
function squealVersion() {
  if (true) return "0.1.279";
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}
function manifestVersion(module) {
  let dir = dirname5(fileURLToPath(module));
  for (; ; ) {
    const version = readVersion(join11(dir, "package.json"));
    if (version !== null) return version;
    const parent = dirname5(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync6(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { name, version } = parsed;
    return name === PACKAGE_NAME && typeof version === "string" ? version : null;
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

// src/core/delivery/handoff.ts
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;
function handoffMetaKey(worktreeId) {
  return worktreeMetaKey("daemonHandoff", worktreeId);
}
function handoffFrom(record) {
  return daemonIncarnation(record) ?? `${record.squealVersion}@${record.startedAt}`;
}
function readHandoff(store, worktreeId) {
  const text = store.meta.get(handoffMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const claim = JSON.parse(text);
    if (!isRecord(claim)) return null;
    const { from, to, at, boundAt } = claim;
    if (typeof from !== "string" || typeof to !== "string") return null;
    if (typeof at !== "number" || typeof boundAt !== "number") return null;
    return { from, to, at, boundAt };
  } catch {
    return null;
  }
}
function shortHandoffMetaKey(worktreeId) {
  return worktreeMetaKey("daemonHandoffShort", worktreeId);
}
function readShortHandoff(store, worktreeId) {
  const text = store.meta.get(shortHandoffMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark = JSON.parse(text);
    if (!isRecord(mark)) return null;
    const { of, version, claimed: claimed2, at } = mark;
    if (typeof of !== "string" || typeof version !== "string") return null;
    if (typeof claimed2 !== "string" || typeof at !== "number") return null;
    return { of, version, claimed: claimed2, at };
  } catch {
    return null;
  }
}

// src/core/status/stopping.ts
function withStopping(store, worktree, live, now) {
  if (worktree === null) return live;
  const record = worktree.daemon;
  if (record === null) return claimed(store, worktree, live, now);
  const self = daemonIncarnation(record);
  if (self === null || !shutDown(store, worktree.id, self)) {
    return withShort(store, worktree, record, live);
  }
  if (live.state === "down" && daemonGone(worktree)) return live;
  const note = readDaemonNotes(store, worktree.id).find((n) => n.exitOf === self);
  const since = note?.at ?? record.heartbeatAt;
  const claim = readHandoff(store, worktree.id);
  const handoff = claim !== null && claim.from === self ? claim : null;
  const boundAt = handoff?.boundAt ?? since + HANDOFF_BOUND_MS;
  const stopping = {
    from: record.squealVersion,
    since,
    ...handoff === null ? {} : { to: handoff.to, boundAt: handoff.boundAt },
    overdue: now >= boundAt
  };
  return { ...live, stopping };
}
function claimed(store, worktree, live, now) {
  const claim = readHandoff(store, worktree.id);
  if (claim === null || now >= claim.boundAt) return live;
  const from = claim.from.slice(0, Math.max(0, claim.from.indexOf("@"))) || claim.from;
  const { to, at: since, boundAt } = claim;
  return { ...live, stopping: { from, since, to, boundAt, overdue: false } };
}
function withShort(store, worktree, record, live) {
  if (live.state !== "alive") return live;
  const mark = readShortHandoff(store, worktree.id);
  if (mark === null || mark.of !== handoffFrom(record)) return live;
  const { of, version, claimed: claimed2, at: since } = mark;
  return { ...live, short: { of, version, claimed: claimed2, since } };
}
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

// src/core/delivery/liveness.ts
function daemonLiveness(record, now, lastHeartbeatAt = null) {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (now - record.heartbeatAt <= record.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  }
  return { state: "down", since: record.heartbeatAt };
}
function worktreeLiveness(worktree, now) {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
}
function readLiveHeader(store, worktreeId, now, states, since = null, keys) {
  const worktree = store.worktrees.get(worktreeId);
  const runs = openRuns(store, worktree, worktreeLiveness(worktree, now));
  const open = new Set(runs.flatMap((run) => run.testFiles.map(testFileId)));
  const header = readHeader(store, worktreeId, states, keys, void 0, open);
  const changes = changedSince(store, worktreeId, header.revision, since);
  const installed = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path)
  );
  const holds = readHolds(store, worktree, worktreeLiveness(worktree, now), now);
  return {
    ...header,
    ...holds.length === 0 ? {} : { holds },
    // Task 001-263: a daemon that died without its stop note is named, as status names it.
    // Row 011-34: so is a daemon stopping.
    daemon: withStopping(
      store,
      worktree,
      withDeath(
        store,
        worktree,
        asRested(
          store,
          worktree,
          asStopped(store, worktreeId, worktree, worktreeLiveness(worktree, now)),
          now
        )
      ),
      now
    ),
    changedPaths: [...changes.keys()],
    ...installed === void 0 ? {} : { installedLockfile: installed.path }
  };
}
function asRested(store, worktree, live, at) {
  if (live.state !== "down" || live.startingSince !== void 0 || worktree === null) return live;
  if (live.stopped === true) return live;
  if (restState(store, worktree, at) !== "quiet") return live;
  const spawnedAt = readRest(store, worktree.id)?.spawnedAt;
  return spawnedAt === void 0 ? { ...live, resting: true } : { ...live, startingSince: spawnedAt };
}
function changedSince(store, worktreeId, revision, since) {
  const after = since === null || since >= revision ? revision - 1 : Math.max(since, 0);
  const changes = /* @__PURE__ */ new Map();
  for (const r of store.revisions.range(worktreeId, after, revision)) {
    for (const change2 of r.changes) changes.set(change2.path, change2);
  }
  return changes;
}
var DAEMON_START_GRACE_MS = 1e4;
function livenessMetaKey(worktreeId) {
  return worktreeMetaKey("livenessTold", worktreeId);
}
function toldLiveness(store, consumer) {
  const told = readSlot(store, livenessMetaKey(consumer.worktreeId), consumer);
  if (told === "down") return "down";
  if (isRecord(told) && typeof told.short === "string") return { short: told.short };
  const since = isRecord(told) ? told.startingSince : void 0;
  return typeof since === "number" ? { startingSince: since } : "alive";
}
function toldOf(live) {
  return live.state === "alive" && live.short !== void 0 ? { short: live.short.of } : live.state;
}
function tellLiveness(store, consumer, told) {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, told);
}
function asTold(live, told, at) {
  if (live.state === "alive" || typeof told !== "object" || !("startingSince" in told)) return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  const { stopped: _void, ...starting } = live;
  return { ...starting, startingSince };
}
function withTold(header, told, at) {
  return header.daemon === void 0 ? header : { ...header, daemon: asTold(header.daemon, told, at) };
}
function livenessChange(store, consumer, at) {
  const told = toldLiveness(store, consumer);
  const worktree = store.worktrees.get(consumer.worktreeId);
  const live = withStopping(
    store,
    worktree,
    asStopped(
      store,
      consumer.worktreeId,
      worktree,
      asTold(worktreeLiveness(worktree, at), told, at)
    ),
    at
  );
  if (live.state === "down" && live.stopped !== true) {
    if (live.startingSince !== void 0) return null;
    const rest = restState(store, worktree, at);
    if (rest === "quiet") return null;
    if (rest === "overdue") store.meta.delete(daemonRestMetaKey(consumer.worktreeId));
  }
  if (live.state === "alive" && live.short !== void 0) {
    return typeof told === "object" && "short" in told && told.short === live.short.of ? null : live;
  }
  return live.state === (typeof told === "object" ? "alive" : told) ? null : live;
}
function restState(store, worktree, at) {
  if (worktree === null || worktree.daemon !== null) return null;
  const rest = restAfterHeartbeats(store, worktree);
  if (rest === null) return null;
  if (rest.spawnedAt === void 0 || at - rest.spawnedAt <= DAEMON_START_GRACE_MS) return "quiet";
  return "overdue";
}
function restAfterHeartbeats(store, worktree) {
  const rest = readRest(store, worktree.id);
  const heartbeat = worktree.daemon?.heartbeatAt ?? worktree.lastHeartbeatAt ?? Number.POSITIVE_INFINITY;
  return rest === null || rest.at < heartbeat ? null : rest;
}
function readRest(store, worktreeId) {
  const text = store.meta.get(daemonRestMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const rest = JSON.parse(text);
    if (!isRecord(rest) || typeof rest.at !== "number") return null;
    const spawnedAt = typeof rest.spawnedAt === "number" ? { spawnedAt: rest.spawnedAt } : {};
    return { at: rest.at, ...spawnedAt };
  } catch {
    return null;
  }
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

// src/core/scheduler/unknown-files.ts
function unknownFilesMetaKey(worktreeId) {
  return worktreeMetaKey("unknownFiles", worktreeId);
}
function readUnknownFiles(store, worktreeId) {
  const raw = store.meta.get(unknownFilesMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Map();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return /* @__PURE__ */ new Map();
  }
  if (!Array.isArray(value)) return /* @__PURE__ */ new Map();
  const entries = value.filter(isEntry3).map(knownCause);
  return new Map(entries.map((e) => [testFileId(e.testFile), e]));
}
var CAUSES = ["timeout", "install", "runner", "setup"];
function isEntry3(value) {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return typeof value.testFile.path === "string" && typeof value.testFile.project === "string" && (value.key === null || typeof value.key === "string") && typeof value.reason === "string" && typeof value.ran === "boolean" && Array.isArray(value.samples) && value.samples.every((p) => typeof p === "string") && typeof value.revision === "number" && typeof value.at === "number";
}
function knownCause(entry3) {
  if (entry3.cause === void 0 || CAUSES.includes(entry3.cause)) return entry3;
  const { cause: _cause, ...rest } = entry3;
  return rest;
}

// src/core/hash/blob.ts
import { constants } from "node:fs";
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/scheduler/omitted-test-files.ts
function omittedTestFilesMetaKey(worktreeId) {
  return worktreeMetaKey("omittedTestFiles", worktreeId);
}
function readOmittedTestFiles(store, worktreeId) {
  const raw = store.meta.get(omittedTestFilesMetaKey(worktreeId));
  const count = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

// src/core/scheduler/quiet.ts
function quietMetaKey(worktreeId) {
  return worktreeMetaKey("quiet", worktreeId);
}
var NO_ENDS = /* @__PURE__ */ new Map();
function publishedWaits(store, worktreeId, daemonStartedAt, now) {
  const none2 = { backlog: NO_ENDS, catchUp: NO_ENDS };
  const raw = store.meta.get(quietMetaKey(worktreeId));
  if (raw === null) return none2;
  try {
    const { at, lanes, catchUp } = JSON.parse(raw);
    if (typeof at !== "number" || at < daemonStartedAt) return none2;
    return { backlog: endsAfter(lanes, now), catchUp: endsAfter(catchUp, now) };
  } catch {
    return none2;
  }
}
function endsAfter(lanes, now) {
  if (typeof lanes !== "object" || lanes === null) return NO_ENDS;
  return new Map(
    Object.entries(lanes).filter(
      (entry3) => typeof entry3[1] === "number" && entry3[1] > now
    )
  );
}

// src/core/scheduler/yields.ts
function yieldsMetaKey(worktreeId) {
  return worktreeMetaKey("yields", worktreeId);
}
function publishedYields(store, worktreeId, daemonStartedAt) {
  const raw = store.meta.get(yieldsMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const { at, tiers } = JSON.parse(raw);
    if (typeof at !== "number" || at < daemonStartedAt) return /* @__PURE__ */ new Map();
    if (typeof tiers !== "object" || tiers === null) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(tiers).filter((entry3) => isYield(entry3[1]))
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function isYield(value) {
  if (typeof value !== "object" || value === null) return false;
  const { kind, remainderMs, yieldsAt } = value;
  if (kind === "remainder") return typeof remainderMs === "number";
  if (kind === "overrun") return typeof yieldsAt === "number";
  return kind === "yields" || kind === "cut" || kind === "turn" || kind === "runner";
}

// src/core/status/slot-holders.ts
function pidRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function slowSlotOf(store, worktreeId, root, header, alive2, now) {
  const tier = header.slowTier;
  if (!alive2 || tier === void 0 || tier.pending === 0) return void 0;
  if (tier.activity?.kind !== "waiting" || tier.activity.for !== "slot") return void 0;
  const permits = readPolicy(root).slow.maxParallel;
  let held;
  try {
    held = heldPermits({ dir: slowSlotDir(), permits });
  } catch {
    return void 0;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const { record } of held) {
    const id = record.kind === "holder" ? `${record.pid}\0${record.worktreeId}` : `\0${record.kind}`;
    const group = groups.get(id);
    if (group === void 0) groups.set(id, { record, permits: 1 });
    else {
      group.permits++;
      if (record.kind === "holder" && group.record.kind === "holder") {
        if (record.since < group.record.since) group.record = record;
      }
    }
  }
  const holders = [...groups.values()].map(
    ({ record, permits: n }) => holderOf(store, worktreeId, record, n, now)
  );
  return { permits, holders: holders.sort(longestFirst) };
}
function holderOf(store, own, record, permits, now) {
  if (record.kind !== "holder") return { kind: record.kind, permits };
  const live = pidRuns(record.pid);
  const root = store.worktrees.get(record.worktreeId)?.root ?? null;
  return {
    kind: live ? "live" : "stale",
    permits,
    pid: record.pid,
    worktreeId: record.worktreeId,
    root,
    ...record.worktreeId === own ? { self: true } : {},
    since: record.since,
    heldMs: Math.max(0, now - record.since),
    ...live && root !== null && record.worktreeId !== own ? slowWork(store, record.worktreeId) : {}
  };
}
function slowWork(store, worktreeId) {
  const view = worktreeSlowView(store, worktreeId);
  if (view === null) return {};
  const keys = store.testFileKeys.list(worktreeId).filter((row) => view.isSlow(row.testFile));
  const states = store.knownStates.list(
    worktreeId,
    keys.map((row) => row.testFile)
  );
  const tier = readSlowTier(store, worktreeId, states, keys, view);
  const activity = tier.activity;
  const running = activity?.kind === "running" ? { running: activity.paths ?? [activity.path] } : {};
  return { ...running, pending: tier.pending };
}
function longestFirst(a, b) {
  const since = (h) => h.kind === "live" || h.kind === "stale" ? h.since : Infinity;
  return since(a) - since(b);
}

// src/core/status/standing-facts.ts
function unknownStanding(unknown, facts) {
  const reason = unknown.reason ?? "no reason was kept";
  switch (unknown.cause) {
    case "timeout":
      return { kind: "timed-out", reason, load: facts.load(), notCurrent: facts.notCurrent() };
    case "install":
      return { kind: "no-install", command: facts.installCommand };
    case "runner":
      return { kind: "runner", reason };
    case "setup":
      return { kind: "setup-failed" };
    case "never-run":
      return { kind: "never-run", lookupOnly: facts.lookupOnly, notCurrent: facts.notCurrent() };
    default:
      return {
        kind: "no-result",
        reason: `${unknown.ran ? "ran, nothing recorded" : "no result"}: ${reason}`,
        notCurrent: facts.notCurrent()
      };
  }
}
function setupsOf(states) {
  const setups = /* @__PURE__ */ new Map();
  for (const s of states) {
    if (s.check.kind === "setup") setups.set(s.check.project, { file: s.check.testPath });
  }
  return setups;
}
function once(read4) {
  let value;
  return () => {
    value ??= { v: read4() };
    return value.v;
  };
}

// src/core/status/unknown-files.ts
var UNKNOWN_FILES_LISTED = 20;
function unknownTestFilesOf(store, worktreeId, states, keys, root, now = Date.now()) {
  const checks = checksByFile(states);
  const unknown = keys.filter((row) => {
    const own = checks.get(testFileId(row.testFile)) ?? [];
    if (row.key !== null && row.pending !== null || own.some((s) => s.validity === "pending")) {
      return false;
    }
    return row.key === null || own.length === 0 || own.some((s) => s.validity === "unknown");
  });
  if (unknown.length === 0) return {};
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  const files2 = unknown.sort((a, b) => testFileId(a.testFile).localeCompare(testFileId(b.testFile))).slice(0, UNKNOWN_FILES_LISTED).map((row) => reasons.of(row, checks.get(testFileId(row.testFile)) ?? []));
  return { unknownTestFiles: { total: unknown.length, files: files2 } };
}
function checksByFile(states) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    const id = testFileKeyOf(state.check);
    checks.set(id, [...checks.get(id) ?? [], state]);
  }
  return checks;
}
function unknownReasons(store, worktreeId, states, root, now) {
  const recorded = readUnknownFiles(store, worktreeId);
  const setups = new Set(
    states.filter((s) => s.check.kind === "setup" && s.outcome === "fail").map((s) => s.check.project)
  );
  let lookupOnly;
  const isLookupOnly = () => {
    lookupOnly ??= root !== void 0 && readPolicy(root).baseline.onStart === "lookup-only";
    return lookupOnly;
  };
  const reason = (row, own) => {
    const summary = own.find((s) => s.validity === "unknown")?.summary ?? null;
    if (summary !== null) return { reason: summary };
    if (row.key === null) {
      return {
        reason: "no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked",
        cause: "runner"
      };
    }
    if (setups.has(row.testFile.project)) {
      return { reason: "its project's global setup failed", cause: "setup" };
    }
    const claimant = claimantOf(store, worktreeId, row.testFile, row.key, now);
    if (claimant !== null)
      return { reason: `${claimant.worktree.root}'s daemon is running its key` };
    if (own.length > 0) return { reason: null };
    return {
      reason: isLookupOnly() ? "never run at this key: the baseline is lookup-only, so nothing queued it" : "never run at this key, and nothing queued it",
      cause: "never-run"
    };
  };
  return {
    of(row, own) {
      const entry3 = recorded.get(testFileId(row.testFile));
      if (entry3 !== void 0 && entry3.key === row.key) {
        const { ran, reason: reason2, samples, cause } = entry3;
        return {
          testFile: row.testFile,
          ran,
          reason: reason2,
          samples,
          ...cause === void 0 ? {} : { cause }
        };
      }
      return { testFile: row.testFile, ran: false, samples: [], ...reason(row, own) };
    }
  };
}

// src/core/status/standing.ts
function standingsOf(store, worktreeId, root, daemon, now, load = hostLoad, reads) {
  const states = reads?.states ?? store.knownStates.list(worktreeId);
  const keys = reads?.keys ?? store.testFileKeys.list(worktreeId);
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const checks = checksByFile(states);
  const policy = readPolicy(root);
  const worktree = store.worktrees.get(worktreeId);
  const startedAt = liveStartedAt(worktree, daemon);
  const runs = reads?.runs ?? openRuns(store, worktree, daemon);
  const promoted = startedAt === null ? /* @__PURE__ */ new Set() : promotedIds(store, worktreeId, startedAt, now);
  const yields = startedAt === null ? /* @__PURE__ */ new Map() : publishedYields(store, worktreeId, startedAt);
  const quiet = startedAt === null ? null : publishedWaits(store, worktreeId, startedAt, now);
  const header = reads?.header ?? readHeader(store, worktreeId, states, keys);
  const unlisted2 = unlistedReason(header, policy);
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  const setups = setupsOf(states);
  const alive2 = daemon.state === "alive";
  const hold = (reads?.holds ?? readHolds(store, worktree, daemon, now))[0];
  const slot2 = once(
    () => reads?.slowSlot === void 0 ? slowSlotOf(store, worktreeId, root, header, alive2, now) : reads.slowSlot ?? void 0
  );
  const facts = {
    lookupOnly: policy.baseline.onStart === "lookup-only",
    installCommand: header.installCommand ?? null,
    load: once(load),
    // What `run --all --wait` runs, from the rows and states read above: no further read.
    notCurrent: once(
      () => keys.filter(
        (row) => fileClassOf(row, checks.get(testFileId(row.testFile)) ?? []) !== "current"
      ).length
    )
  };
  return (files2) => files2.map((ref) => {
    const row = rows.get(testFileId(ref));
    const own = checks.get(testFileId(ref)) ?? [];
    const state = fileClassOf(row, own);
    if (state === "current") return { testFile: ref, state, ...verdictOf(own) };
    const key = row?.key ?? null;
    const claimant = state === "pending" || key === null ? null : claimantOf(store, worktreeId, ref, key, now);
    const claim = claimant === null ? null : { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
    if (state === "stale") {
      const verdict = verdictOf(own);
      const standing2 = claim ?? {
        kind: "stale",
        verdict: verdict.verdict ?? null,
        lookupOnly: facts.lookupOnly,
        notCurrent: facts.notCurrent()
      };
      return { testFile: ref, state, ...verdict, standing: standing2 };
    }
    if (state === "unknown") {
      if (row === void 0) return { testFile: ref, state };
      const unknown = reasons.of(row, own);
      return {
        testFile: ref,
        state,
        unknown,
        standing: claim ?? unknownStanding(unknown, facts)
      };
    }
    const running = row?.pending === "running" || own.some((s) => s.pendingPhase === "running");
    const lane = laneFor(policy, ref, runnerLaneOf(policy, ref.project));
    const run = running ? runOf(runs, ref) : void 0;
    const setup = isSlowLane(lane) ? setups.get(ref.project) : void 0;
    const pending = running ? {
      kind: "running",
      lane,
      since: run?.startedAt ?? null,
      ...run === void 0 ? {} : { files: run.testFiles.length },
      ...setup === void 0 ? {} : { setup }
    } : unlisted2 ?? queuedReason(store, worktreeId, ref, key, lane, runs, policy, now);
    if (hold !== void 0 && (pending.kind === "queued" || pending.kind === "slow")) {
      const held = { kind: "on-hold", hold };
      return { testFile: ref, state, pending: held, standing: held };
    }
    const wait = pending.kind === "queued" ? quietWait(quiet, pending.lane) : void 0;
    if (pending.kind === "queued" && pending.behind === null && wait !== void 0) {
      if (!promoted.has(testFileId(ref))) {
        const held = { ...pending, ...wait };
        return { testFile: ref, state, pending: held, standing: held };
      }
    }
    if (pending.kind === "queued" && promoted.has(testFileId(ref))) {
      const tier = pending.behind === null ? void 0 : yieldIn(runs, lane, policy, yields);
      const promotedReason = {
        ...pending,
        promoted: true,
        ...tier === void 0 ? {} : { yields: tier }
      };
      return { testFile: ref, state, pending: promotedReason, standing: promotedReason };
    }
    if (pending.kind === "slow") {
      const held = slot2();
      if (held !== void 0) {
        const waiting = { ...pending, slot: held };
        return { testFile: ref, state, pending: waiting, standing: waiting };
      }
    }
    if (pending.kind === "unlisted" && promoted.has(testFileId(ref))) {
      const run2 = yieldIn(runs, lane, policy, yields);
      if (run2?.kind === "yields") {
        const yielding = { ...pending, yields: run2 };
        return { testFile: ref, state, pending: yielding, standing: yielding };
      }
    }
    return { testFile: ref, state, pending, standing: pending };
  });
}
function quietWait(quiet, lane) {
  const backlog = quiet?.backlog.get(lane);
  const catchUp = quiet?.catchUp.get(lane);
  if (catchUp !== void 0 && (backlog === void 0 || catchUp > backlog))
    return { quietUntil: catchUp, quietCatchUp: true };
  return backlog === void 0 ? void 0 : { quietUntil: backlog };
}
function claimBound(policy, now) {
  return now + claimBoundMs(policy.runner.timeoutMs);
}
function yieldIn(runs, lane, policy, yields) {
  const run = runIn(runs, lane, policy);
  return run === void 0 ? void 0 : yields.get(run.id);
}
function runIn(runs, lane, policy) {
  return runs.find(
    (run) => run.testFiles.some((f) => laneFor(policy, f, runnerLaneOf(policy, f.project)) === lane)
  );
}
function runnerLaneOf(policy, project) {
  if (policy.nodeTest.some((p) => p.name === project)) return "node-test";
  if (policy.pytest.some((p) => p.name === project)) return "pytest";
  return "vitest";
}
function queuedReason(store, worktreeId, ref, key, lane, runs, policy, now) {
  const claimant = key === null ? null : claimantOf(store, worktreeId, ref, key, now);
  if (claimant !== null && store.results.byKey(key, 0).length === 0) {
    return { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
  }
  const tier = runIn(runs, lane, policy);
  if (tier !== void 0) {
    return { kind: "queued", lane, behind: tier.startedAt, files: tier.testFiles.length };
  }
  if (slowView(policy).isSlow(ref)) {
    return policy.slow.trigger === "idle" ? { kind: "slow", pausesOnly: true } : { kind: "slow" };
  }
  return { kind: "queued", lane, behind: null };
}
function unlistedReason(header, policy) {
  const refined2 = header.refinedRevision;
  if (header.runnerPartPending !== true || refined2 === null || refined2 === void 0) return null;
  const callBoundMs = runnerPartBoundMs(policy.runner.timeoutMs);
  return { kind: "unlisted", revision: header.revision, callBoundMs };
}
function runOf(runs, ref) {
  const id = testFileId(ref);
  return runs.find((run) => run.testFiles.some((f) => testFileId(f) === id));
}
function verdictOf(own) {
  for (const verdict of ["fail", "pass", "skip"]) {
    if (own.some((s) => s.outcome === verdict)) return { verdict };
  }
  return {};
}

// src/core/status/next-step.ts
function remainderSeconds(remainderMs) {
  return Math.max(0, Math.round(remainderMs / 1e3));
}

// src/core/status/standing-groups.ts
function groupId(s) {
  switch (s.kind) {
    case "running":
      return `running ${s.lane} ${(s.files ?? 1) > 1} ${s.setup?.file ?? ""}`;
    case "queued":
      return `queued ${s.lane} ${s.behind === null} ${s.promoted === true} ${yieldId(s.yields)} ${s.quietUntil ?? "-"} ${s.quietCatchUp === true}`;
    case "unlisted":
      return `unlisted ${yieldId(s.yields)}`;
    case "claim":
      return `claim ${s.worktree}`;
    case "stale":
      return `stale ${s.verdict} ${s.lookupOnly}`;
    case "timed-out":
    case "no-result":
    case "runner":
      return `${s.kind} ${s.reason}`;
    case "retry":
      return `retry ${s.reason} ${s.noResult} ${s.runningSince} ${s.elsewhere}`;
    default:
      return s.kind;
  }
}
function yieldId(tier) {
  if (tier === void 0) return "-";
  if (tier.kind === "remainder") return `remainder ${remainderSeconds(tier.remainderMs)}`;
  return tier.kind === "overrun" ? `overrun ${timeText(tier.yieldsAt)}` : tier.kind;
}
function widest(a, b) {
  if (a.kind === "running" && b.kind === "running") {
    return a.since === null || b.since !== null && b.since < a.since ? b : a;
  }
  if (a.kind === "queued" && b.kind === "queued" && a.behind !== null && b.behind !== null) {
    return b.behind < a.behind ? b : a;
  }
  if (a.kind === "claim" && b.kind === "claim") {
    return a.until === null || b.until !== null && b.until > a.until ? b : a;
  }
  return a;
}

// src/core/status/outstanding.ts
var ORDER = [
  "no-daemon",
  "listing",
  "unlisted",
  "on-hold",
  "checkpoint",
  "retry",
  "no-install",
  "setup-failed",
  "runner",
  "timed-out",
  "no-result",
  "stale",
  "never-run",
  "claim",
  "running",
  "queued",
  "slow"
];
function outstandingOf(store, worktreeId, root, reads, now, load) {
  const { daemon, header } = reads;
  if (daemon.state !== "alive" || daemon.stopping !== void 0) {
    const since = daemon.stopping?.since ?? (daemon.state === "alive" ? null : daemon.since);
    return [{ standing: { kind: "no-daemon", since, revision: header.revision }, files: [] }];
  }
  if (header.testFilesListed === false) return [{ standing: { kind: "listing" }, files: [] }];
  const policy = readPolicy(root);
  const slow = slowView(policy);
  const retries = retryStandings(reads.pendingRetries, worktreeId);
  const refs = reads.keys.map((row) => row.testFile).sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  const files2 = standingsOf(store, worktreeId, root, daemon, now, load, reads)(refs);
  const groups = /* @__PURE__ */ new Map();
  const add = (standing2, ref) => {
    const id = groupId(standing2);
    const group = groups.get(id);
    if (group === void 0) {
      groups.set(id, { standing: standing2, files: ref === null ? [] : [ref] });
      return;
    }
    if (ref !== null) group.files.push(ref);
    group.standing = widest(group.standing, standing2);
  };
  for (const file of files2) {
    const retry = retries.get(testFileId(file.testFile));
    if (retry !== void 0) {
      add(retry, file.testFile);
      continue;
    }
    const standing2 = file.state === "current" ? void 0 : file.standing ?? file.pending;
    if (standing2 === void 0) continue;
    const held = standing2.kind === "running" && standing2.setup !== void 0;
    if (slow.isSlow(file.testFile) && !held) continue;
    add(standing2, file.testFile);
  }
  const said = [...groups.values()].some((g) => g.standing.kind === "unlisted");
  if (header.runnerPartPending === true && !said) add(unlisted(header, policy), null);
  if (reads.checkpoint !== void 0 && !reads.checkpoint.owed) {
    add({ kind: "checkpoint" }, null);
  }
  return [...groups.values()].sort(
    (a, b) => ORDER.indexOf(a.standing.kind) - ORDER.indexOf(b.standing.kind)
  );
}
function unlisted(header, policy) {
  return {
    kind: "unlisted",
    revision: header.revision,
    callBoundMs: runnerPartBoundMs(policy.runner.timeoutMs)
  };
}
function retryStandings(pending, worktreeId) {
  const retries = /* @__PURE__ */ new Map();
  for (const r of pending?.retries ?? []) {
    retries.set(testFileId(r.testFile), {
      kind: "retry",
      reason: r.reason,
      noResult: r.noResult === true,
      runningSince: r.runningSince ?? null,
      elsewhere: r.claimedBy !== null && r.claimedBy !== worktreeId
    });
  }
  return retries;
}

// src/core/status/phase-files.ts
var PHASE_FILES_LISTED = 100;
function pendingTestFilesOf(states, keys, openFiles2) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === void 0) checks.set(id, [state]);
    else own.push(state);
  }
  const running = [];
  const queued = [];
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    if (fileClassOf(row, own) !== "pending") continue;
    const runs = openFiles2.has(id) || row.pending === "running" || own.some((s) => s.pendingPhase === "running");
    (runs ? running : queued).push(row.testFile);
  }
  return { running: listed(running), queued: listed(queued) };
}
function listed(files2) {
  const sorted = files2.sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  return {
    files: sorted.slice(0, PHASE_FILES_LISTED),
    omitted: Math.max(0, sorted.length - PHASE_FILES_LISTED)
  };
}

// src/core/status/snapshot.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
function createStatusBuilder(store, options = {}) {
  const now = options.now ?? Date.now;
  return {
    build(worktreeId) {
      return readTransaction(store, () => {
        const worktree = store.worktrees.get(worktreeId);
        if (worktree === null) {
          return unavailable(
            "not-registered",
            `worktree ${worktreeId} is not registered in the store`
          );
        }
        return snapshot(store, worktreeId, worktree.root, now());
      });
    }
  };
}
function snapshot(store, worktreeId, root, now, hostLoadNow = hostLoad) {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const notes = [];
  if (worktree === null) {
    notes.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes.push(recovered);
  const daemon = withStopping(
    store,
    worktree,
    withDeath(
      store,
      worktree,
      asStopped(
        store,
        worktreeId,
        worktree,
        liveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null)
      )
    ),
    now
  );
  const runs = openRuns(store, worktree, daemon);
  const held = openFiles(runs);
  const holds = readHolds(store, worktree, daemon, now);
  const header = readHeader(store, worktreeId, states, keys, void 0, held);
  const knownFailures = withTestFileFrames(
    store,
    worktreeId,
    withRecorded(store, worktreeId, states, header.revision)
  );
  const load = once(hostLoadNow);
  const retries = pendingRetriesOf(store, keys, load, runs);
  const checkpoint = openCheckpoint(store, worktreeId, daemon);
  const at = worktree?.root ?? root;
  const slowSlot = slowSlotOf(store, worktreeId, at, header, daemon.state === "alive", now);
  const outstanding = outstandingOf(
    store,
    worktreeId,
    at,
    {
      states,
      keys,
      header,
      runs,
      daemon,
      holds,
      slowSlot: slowSlot ?? null,
      ...retries,
      ...checkpoint
    },
    now,
    load
  );
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    worktreeId,
    worktreeRoot: worktree?.root ?? root,
    ...header,
    ...statusIdentity(root, revision, header.commit, daemon),
    daemon,
    ...holds.length === 0 ? {} : { holds },
    knownFailures,
    knownFailureCounts: knownFailureCounts(knownFailures),
    inherited: inheritedSources(store, states),
    breakdown: breakdown(states, keys, held),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes,
    daemonNotes: readDaemonNotes(store, worktreeId),
    ...checkpoint,
    ...vitestExcluded(at),
    ...configProblemsOf(at),
    ...retries,
    ...unknownTestFilesOf(store, worktreeId, states, keys, at, now),
    ...daemon.state === "alive" ? { runsOpen: runs.length } : {},
    outstanding,
    pendingTestFiles: pendingTestFilesOf(states, keys, held),
    ...slowSlot === void 0 ? {} : { slowSlot }
  };
}
function vitestExcluded(root) {
  const policy = readPolicy(root);
  const { excludeProjects: names, exclude: globs2 } = policy.vitest;
  if (names.length + globs2.length === 0) return {};
  if (policy.nodeTest.length > 0 && !vitestDetected(root)) return {};
  return {
    ...names.length === 0 ? {} : { vitestExcluded: names },
    ...globs2.length === 0 ? {} : { vitestExcludedFiles: globs2 }
  };
}
function openCheckpoint(store, worktreeId, daemon) {
  const progress = parseCheckpointProgress(store.meta.get(checkpointMetaKey(worktreeId)));
  if (progress === null) return {};
  const { owed, ...rest } = progress;
  if (owed !== void 0) {
    if (daemon.state === "alive") return {};
    return { checkpoint: { ...rest, owed: true } };
  }
  if (daemon.state !== "alive" || store.checkpoints.get(progress.id)?.end !== null) return {};
  return { checkpoint: { ...rest, owed: false } };
}
function liveness(daemon, now, lastHeartbeatAt) {
  if (daemon === null) return { state: "down", since: lastHeartbeatAt };
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
      count: 0,
      fileLevelCount: 0
    };
    group.count++;
    if (s.check.kind === "file") group.fileLevelCount++;
    groups.set(id, group);
  }
  const sources = [...groups.values()].map((g) => ({ ...g, worktreeRoot: store.worktrees.get(g.worktreeId)?.root ?? null })).sort(
    (a, b) => b.count - a.count || a.worktreeId.localeCompare(b.worktreeId) || String(a.commit).localeCompare(String(b.commit))
  ).map(({ worktreeId, worktreeRoot, commit, count: count2, fileLevelCount }) => ({
    worktreeId,
    worktreeRoot,
    commit,
    count: count2,
    fileLevelCount
  }));
  return { count, sources };
}
function openFiles(runs) {
  return new Set(runs.flatMap((run) => run.testFiles.map(testFileId)));
}
function breakdown(states, keys, running) {
  const filePhase = new Map(keys.map((k) => [testFileId(k.testFile), k.pending]));
  const currentByOutcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  const pendingByPhase = { queued: 0, running: 0 };
  const fileLevelByOutcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  const fileLevelByPhase = { queued: 0, running: 0 };
  const filesWithChecks = /* @__PURE__ */ new Set();
  for (const s of states) {
    if (s.check.kind === "setup") continue;
    const file = testFileKeyOf(s.check);
    filesWithChecks.add(file);
    const fileLevel = s.check.kind === "file";
    if (s.validity === "current") {
      currentByOutcome[s.outcome]++;
      if (fileLevel) fileLevelByOutcome[s.outcome]++;
    }
    if (s.validity === "pending") {
      const phase = running.has(file) ? "running" : s.pendingPhase ?? filePhase.get(file) ?? "queued";
      pendingByPhase[phase]++;
      if (fileLevel) fileLevelByPhase[phase]++;
    }
  }
  const without = keys.filter((k) => !filesWithChecks.has(testFileId(k.testFile)));
  return {
    currentByOutcome,
    pendingByPhase,
    fileLevelByOutcome,
    fileLevelByPhase,
    testFiles: keys.length,
    testFilesWithoutChecks: without.length,
    testFilesWithoutChecksRunning: without.filter(
      (k) => k.pending === "running" || k.pending !== null && running.has(testFileId(k.testFile))
    ).length
  };
}
function recoveryNote(raw) {
  if (raw === null) return null;
  try {
    const { at, movedTo } = JSON.parse(raw);
    const when = typeof at === "number" ? ` at ${new Date(at).toISOString()}` : "";
    const where3 = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}; the baseline was lost${where3}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
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
function claimantOf(store, worktreeId, ref, key, now) {
  if (!store.testFileKeys.claimed(worktreeId, key, { now, graceIntervals: HEARTBEAT_GRACE_INTERVALS })) {
    return null;
  }
  const id = testFileId(ref);
  for (const worktree of store.worktrees.list()) {
    if (worktree.id === worktreeId || worktree.daemon === null) continue;
    const { heartbeatAt, heartbeatIntervalMs } = worktree.daemon;
    if (heartbeatAt < now - HEARTBEAT_GRACE_INTERVALS * heartbeatIntervalMs) continue;
    const row = store.testFileKeys.list(worktree.id, [ref])[0];
    if (row?.key !== key || row.pending !== "running") continue;
    const runs = store.runs.inFlight(worktree.id, worktree.daemon.startedAt);
    const run = runs.find((r) => r.testFiles.some((f) => testFileId(f) === id)) ?? null;
    return { worktree, run };
  }
  return null;
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
  const commands = readCommandHolds(store, worktree.id).sort((a, b) => a.since - b.since).map((entry3) => {
    const recorded = [entry3.wrapper, entry3.child].filter((p) => p !== null);
    const gone = recorded.length > 0 && recorded.every((p) => harnessGone(p, namespace));
    const hold = {
      cause: "command",
      since: entry3.since,
      command: entry3.command,
      pid: entry3.child?.pid ?? entry3.wrapper?.pid ?? null,
      until: entry3.until,
      ...gone ? { gone: true } : {},
      ...entry3.until <= now ? { expired: true } : {}
    };
    return { id: `command:${entry3.token}`, hold };
  });
  return [...merge2, ...commands];
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
  const name = first.cause === "merge" ? "for the unresolved merge" : commandText(first);
  const more = change2.holds.length - 1;
  return `${endedText(change2.ended)}; still on hold ${name}${more > 0 ? ` and ${plural(more, "more hold")}` : ""}.`;
}
function holdEndText(change2) {
  const running = change2.running === 0 ? "" : `, ${change2.running} running`;
  return `${endedText(change2.ended)}; ${plural(change2.queued, "test file")} queued${running}.`;
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
function tellHolds(store, consumer, holds) {
  const told = (holds ?? []).map(({ id, hold }) => ({ id, ended: endedOf(hold) }));
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
  const holds = change2.now.map((k) => k.hold);
  const last = holds.length === 0 ? change2.ended.length - 1 : -1;
  const ends = change2.ended.map(
    (ended, i) => i === last ? {
      kind: "resumed",
      ended,
      queued: header.testFilesByPhase?.queued ?? 0,
      running: header.testFilesByPhase?.running ?? 0
    } : { kind: "ended", ended, holds }
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
function isLeaving(store, consumer) {
  return readSlot(store, leavingMetaKey(consumer.worktreeId), consumer) !== void 0;
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

// src/core/delivery/turn.ts
function turnMetaKey(worktreeId) {
  return worktreeMetaKey("turn", worktreeId);
}
var START_IDLE = { turn: "idle", testFiles: [], newTestFiles: false };
var IN_TURN = { turn: "in-turn" };
function parse(value) {
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
  return parse(readSlot(store, turnMetaKey(consumer.worktreeId), consumer));
}
function writeTurn(store, consumer, state) {
  writeSlot(store, turnMetaKey(consumer.worktreeId), consumer, state);
}
function startTurn(store, consumer) {
  writeTurn(store, consumer, IN_TURN);
}
function resumeTurn(store, consumer) {
  if (readTurn(store, consumer).turn !== "idle" && !isLeaving(store, consumer)) return;
  store.transaction(() => {
    if (store.consumers.get(consumer) === null) return;
    if (readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
    markLeaving(store, consumer, null);
  });
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
  const testFiles = [...files2].sort();
  const owed = Object.fromEntries(testFiles.map((f) => [f, current2.get(f) ?? null]));
  const newTestFiles = header.runnerPartPending === true;
  const { revision } = header;
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles,
    newTestFiles,
    keys: owed,
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
  const owed = files2.length === 0 ? [] : store.knownStates.list(consumer.worktreeId, files2);
  const untold = state.newTestFiles ? store.knownStates.untold(consumer) : [];
  const seen = new Set(owed.map((s) => checkIdentity(s.check)));
  return {
    states: [...owed, ...untold.filter((s) => !seen.has(checkIdentity(s.check)))],
    view: files2.length === 0 ? [] : store.views.list(consumer, files2),
    keys: files2.length === 0 ? [] : store.testFileKeys.list(consumer.worktreeId, files2)
  };
}
function fromTestFileId(id) {
  const at = id.indexOf("\0");
  return { project: id.slice(0, at), path: id.slice(at + 1) };
}
function waitedFor(state, entry3, keys) {
  if (state.turn !== "idle") return false;
  const file = testFileKeyOf(entry3.check);
  if (state.testFiles.includes(file)) return atKey(state, file, keys);
  return state.newTestFiles && entry3.kind !== "fail-retired" && entry3.from === null && (state.revision === void 0 || entry3.observedAt <= state.revision);
}
function trimmed(state, states, keys) {
  if (state.turn !== "idle" || state.testFiles.length === 0) return null;
  const current2 = currentKeys(keys);
  const pending = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") pending.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.pending !== null) pending.add(testFileId(k.testFile));
  const owed = state.testFiles.filter((f) => pending.has(f) && atKey(state, f, current2));
  if (owed.length === state.testFiles.length) return null;
  const { keys: recorded, ...rest } = state;
  const kept2 = Object.entries(recorded ?? {}).filter(([f]) => owed.includes(f));
  return {
    ...rest,
    testFiles: owed,
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
    said: editsSaid(store, consumer),
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

// src/core/delivery/delivery.ts
var DEFAULT_POLL_INTERVAL_MS = 250;
var sameMarker = (a, b) => a.others === b.others && a.own === b.own;
var isEmpty = (plan) => plan.entries.length === 0 && plan.writes.length === 0 && plan.removals.length === 0;
function createDelivery(store, options) {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  function plan(consumer, states, toldAt, keep, view = store.views.list(consumer)) {
    const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
    const full = planDelta({
      view,
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
      revision,
      history: (check) => store.transitions.history(consumer.worktreeId, check),
      ownEdit: ownEditUnknown(store, consumer, revision)
    });
    return keep === null ? full : restrictPlan(full, keep);
  }
  function deliver2(consumer, {
    heardFrom,
    keep = null,
    liveness: liveness2 = false,
    idle = false,
    stop = false,
    atRevision
  }) {
    const select = (states, keys = null) => {
      if (!idle) return { only: keep, trim: null };
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle") return "silent";
      keys ??= store.testFileKeys.list(consumer.worktreeId);
      const current2 = currentKeys(keys);
      return {
        only: (entry3) => waitedFor(turn, entry3, current2),
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
      const quiet = !liveness2 || livenessChange(store, consumer, now()) === null && holdsChange(store, consumer, now()) === null;
      const empty = isEmpty(plan(consumer, states, now(), selection.only, scope?.view));
      if (quiet && empty && selection.trim === null) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (!atLatest(consumer, atRevision)) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      if (heardFrom && !stop) markLeaving(store, consumer, null);
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const delta = plan(consumer, states, at, selection.only);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const changed = liveness2 ? livenessChange(store, consumer, at) : null;
      if (changed !== null) tellLiveness(store, consumer, toldOf(changed));
      const holds = liveness2 ? holdsChange(store, consumer, at) : null;
      if (holds !== null) tellHolds(store, consumer, holds.now);
      const news = delta.entries.length > 0 || changed !== null || holds !== null;
      const notes = liveness2 || idle && news ? editNotes(store, consumer, states, news) : null;
      const delivered = news || liveness2 && !stop && notes?.sawEdit !== void 0;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) {
        if (selection.trim !== null) writeTurn(store, consumer, selection.trim);
        return null;
      }
      if (idle) startTurn(store, consumer);
      const told = toldRevision(store, consumer);
      const read4 = readLiveHeader(store, consumer.worktreeId, at, states, told);
      const live = withTold(read4, toldLiveness(store, consumer), at);
      tellRevision(store, consumer, live.revision);
      const { entries, header, stillFailing } = annotate(
        store,
        consumer,
        delta.entries,
        live,
        states
      );
      notes?.tell();
      const slowChanged = slowTierChanged(store, consumer, header.slowTier);
      if (stop || slowChanged) tellSlowTier(store, consumer, header.slowTier);
      const sawEdit = notes === null || carriesEditResult(
        notes,
        entries.map((e) => e.check),
        header
      ) ? void 0 : notes.sawEdit;
      const label = delta.entries.length > 0 && delta.entries.every(isBaselineEntry) ? "baseline" : "transitions";
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        label,
        entries,
        stillFailing,
        ...changed === null ? {} : { liveness: changed },
        ...holds === null ? {} : { holds: holdChanges(holds, header) },
        ...slowChanged ? { slowTierChanged: true } : {},
        ...sawEdit === void 0 ? {} : { sawEdit },
        ...notes?.editsSettled === void 0 ? {} : { editsSettled: notes.editsSettled }
      };
    });
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
    const delta = deliver2(consumer, { heardFrom: false, idle: true });
    quietAt.delete(key);
    if (delta !== null || before === null) return delta;
    const after = changeMarker(store);
    quietAt.set(key, after !== null && after.others === before.others ? after : before);
    return null;
  }
  return {
    register: async (consumer, { inTurn = false, atStart = false, startingSince } = {}) => store.transaction(() => {
      const at = now();
      const registered = store.consumers.get(consumer) !== null;
      store.consumers.register(consumer, at);
      forgetStopWait(store, consumer);
      markLeaving(store, consumer, null);
      const states = store.knownStates.list(consumer.worktreeId);
      store.views.writeMany(
        consumer,
        states.map((s) => toView2(s, at))
      );
      const told = startingSince === void 0 ? null : { startingSince };
      const read4 = readLiveHeader(store, consumer.worktreeId, at, states);
      const live = told === null ? read4 : withTold(read4, told, at);
      const knownFailures = withRecorded(store, consumer.worktreeId, states, live.revision);
      const header = withDependencies(
        store,
        consumer.worktreeId,
        live,
        knownFailures.map((f) => f.check)
      );
      const starting = header.daemon?.state === "down" && header.daemon.startingSince !== void 0;
      const daemon = header.daemon === void 0 ? null : toldOf(header.daemon);
      tellLiveness(store, consumer, starting ? told : daemon);
      tellRevision(store, consumer, header.revision);
      tellSlowTier(store, consumer, header.slowTier);
      tellHolds(store, consumer, heldNow(store, consumer.worktreeId, at));
      if (!registered) {
        const alive2 = atStart && header.daemon?.state === "alive";
        const resumed = tellRegistered(store, consumer, header.revision, {
          at,
          scanned: scannedDaemon(store, consumer.worktreeId, alive2)
        });
        startEdits(store, consumer, header.revision, resumed?.said === true);
        if (resumed !== null) recordUncoveredTold(store, consumer, resumed.uncovered);
      }
      if (inTurn) startTurn(store, consumer);
      else writeTurn(store, consumer, null);
      recordHarness(store, consumer, options.harnessProcess?.() ?? null);
      recordVersion(store, consumer, options.squealVersion ?? null);
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        // 011-18: a resumed session's failures name the closure paths changed since it started.
        knownFailures: withClosureChanges(store, consumer, knownFailures, header.revision)
      };
    }),
    unregister: async (consumer) => {
      store.transaction(() => drop(store, consumer, now()));
    },
    onToolBoundary: async (consumer, { stop = false, atRevision } = {}) => deliver2(consumer, {
      heardFrom: true,
      liveness: true,
      stop,
      ...atRevision === void 0 ? {} : { atRevision }
    }),
    peek: async (consumer, { kinds }) => {
      const only = new Set(kinds);
      return deliver2(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) });
    },
    startTurn: async (consumer) => deliver2(consumer, { heardFrom: true, liveness: true }),
    endTurn: async (consumer, { atRevision, handoff = false } = {}) => store.transaction(() => {
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
    }),
    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (; ; ) {
        if (signal?.aborted) return null;
        const delta = deliverIdle(consumer);
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

// src/core/delivery/provenance.ts
var upper = (outcome) => outcome.toUpperCase();
var TOUCHED_SHOWN = 3;
function change(entry3) {
  switch (entry3.kind) {
    case "first-seen-fail":
      if (entry3.from !== null) return `${upper(entry3.from)} -> FAIL`;
      return entry3.beforeEdits?.outcome === "pass" ? "PASS -> FAIL" : "first observed: FAIL";
    case "fail-changed":
      return "FAIL -> FAIL, failure changed";
    default:
      return `${entry3.from === null ? "NONE" : upper(entry3.from)} -> ${upper(entry3.to)}`;
  }
}
var commitText = (commit) => commit === null ? "no commit" : `commit ${commit.slice(0, 12)}`;
function inheritedFrom(entry3) {
  if (entry3.origin.kind !== "inherited") return null;
  return `${entry3.originRoot ?? `worktree ${entry3.origin.worktreeId}`} at ${commitText(entry3.origin.commit)}`;
}
function beforeEditsText(before) {
  switch (before?.outcome) {
    case "none": {
      const settle = before.commit === null ? "" : `; to settle it, run it in a checkout of ${before.commit.slice(0, 12)}: its result is shared with this worktree`;
      return `no baseline result, may predate your edits${settle}`;
    }
    case "fail": {
      const where3 = before.worktreeRoot ?? `worktree ${before.worktreeId}`;
      return `it also failed before your edits (${where3} at ${commitText(before.commit)})`;
    }
    default:
      return null;
  }
}
function changeBefore(entry3) {
  const before = entry3.kind === "first-seen-fail" ? beforeEditsText(entry3.beforeEdits) : null;
  return before === null ? { text: change(entry3), joined: ", " } : { text: `${change(entry3)}; ${before}`, joined: "; " };
}
function validityText(entry3, revision) {
  if (entry3.validity === "pending") return `revision ${revision} pending`;
  return entry3.validity === "stale" ? "stale" : null;
}
function seenLine(entry3, revision) {
  const from = inheritedFrom(entry3);
  const baseline = entry3.baseline === true;
  const { text, joined } = changeBefore(entry3);
  const parts = [
    from === null ? `seen by Squeal's ${baseline ? "baseline " : ""}run at revision ${entry3.observedAt}` : `seen by Squeal's run in ${from}, inherited ${baseline ? "by the baseline " : ""}at revision ${entry3.observedAt}`,
    validityText(entry3, revision)
  ];
  return `${text}${joined}${parts.filter((p) => p !== null).join(", ")}`;
}
function recoveryProvenance(entry3, revision) {
  const parts = [];
  if (entry3.validity === "stale") parts.push(`stale, observed at revision ${entry3.observedAt}`);
  if (entry3.validity === "pending") {
    parts.push(`observed at revision ${entry3.observedAt}, revision ${revision} pending`);
  }
  const from = inheritedFrom(entry3);
  if (from !== null) parts.push(`inherited from ${from}`);
  return parts.length === 0 ? null : parts.join("; ");
}
var CHANGED_HERE = "files changed here since this session started";
function touchesLine(entry3) {
  return closureLine(entry3.changesInClosure);
}
function closureLine(paths) {
  if (paths === void 0) return null;
  if (paths.length === 0) return `none of the ${CHANGED_HERE} are in its imports`;
  const more = paths.length - TOUCHED_SHOWN;
  const shown = paths.slice(0, TOUCHED_SHOWN).join(", ");
  return `its closure reads ${CHANGED_HERE}: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
}
function loadLine(entry3) {
  return entry3.loadAverage === void 0 ? null : `load average ${entry3.loadAverage.toFixed(2)} when it ran`;
}
function installSentences(header) {
  if (header.dependenciesInstalled === false) {
    return " No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.";
  }
  const lockfile = header.installedLockfile;
  return lockfile === void 0 ? "" : ` These results follow a dependency install (${lockfile} changed).`;
}

// src/core/delivery/failure-groups.ts
var FILES_NAMED = 3;
var ERROR_CHARS = 120;
var capitalize = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
function groupKey(entry3, revision) {
  if (entry3.summary === null) return null;
  return JSON.stringify([
    seenLine(entry3, revision),
    entry3.summary,
    entry3.location === null ? null : atText(entry3.location, void 0),
    entry3.flaky === void 0 ? null : flakyText(entry3.flaky),
    entry3.retry === void 0 ? null : retryText(entry3.retry)
  ]);
}
function failureGroups(failures, revision) {
  const byKey = /* @__PURE__ */ new Map();
  const groups = [];
  for (const failure2 of failures) {
    const key = groupKey(failure2, revision);
    const group = key === null ? void 0 : byKey.get(key);
    if (group !== void 0) {
      group.push(failure2);
      continue;
    }
    const fresh2 = [failure2];
    if (key !== null) byKey.set(key, fresh2);
    groups.push(fresh2);
  }
  return groups;
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
  const selected = files2.includes("") ? [] : files2.length <= FILES_NAMED ? files2 : [commonDirectory(files2)].filter((d) => d !== "");
  const error = Array.from((first.summary ?? "").split("\n")[0] ?? "").slice(0, ERROR_CHARS).join("");
  return [
    `${command} failures`,
    ...selected.map(shellWord),
    ...error === "" ? [] : [`--error ${shellWord(error)}`],
    "--per-check --limit all",
    ...first.origin.kind === "inherited" ? ["--all-worktrees"] : []
  ].join(" ");
}
function groupLines(group, revision, command) {
  const first = group[0];
  const checks = group.map((e) => e.check);
  const at = (e) => e.location === null ? null : atText(e.location, e.testFileFrame);
  const lines = [
    seenLine(first, revision),
    cap(first.summary ?? "", SUMMARY_MAX_CHARS),
    first.location === null ? null : shared(group, at) ?? atText(first.location, void 0),
    shared(group, touchesLine),
    loadsLine(group),
    first.flaky === void 0 ? null : capitalize(flakyText(first.flaky)),
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

// src/core/delivery/header.ts
var NOT_LISTED_SENTENCE = "The daemon has not listed this worktree's test files yet; these counts are not complete.";
var CHANGED_PATHS_SHOWN = 3;
var capitalize2 = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
function awaitingInstallText(header) {
  if (header.awaitingInstall !== true || header.daemon?.state === "down") return null;
  return awaitingInstallSentence(header.missingInstalls ?? [], header.installCommand);
}
function changedText(paths) {
  if (paths === void 0 || paths.length === 0) return "";
  const shown = paths.slice(0, CHANGED_PATHS_SHOWN).join(", ");
  const more = paths.length - CHANGED_PATHS_SHOWN;
  return ` (changed ${shown}${more > 0 ? ` and ${more} more` : ""})`;
}
function incompleteText(header) {
  const listed3 = header.testFilesListed === false ? ` ${NOT_LISTED_SENTENCE}` : "";
  const runnerPart = header.runnerPartPending === true ? ` ${capitalize2(runnerPartText(header.revision))} is pending; test files it adds are not counted yet.` : "";
  return `${listed3}${runnerPart}`;
}
function daemonText(header, command) {
  const awaiting = awaitingInstallText(header);
  return livenessSentence(header.daemon, header.revision, command) + (awaiting === null ? installSentences(header) : ` ${awaiting}`);
}
function fullLine(header, command) {
  const { revision, counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files2 } = header;
  const inheritedCount = header.inheritedCount ?? 0;
  const inherited = inheritedCount === 0 ? "" : ` Inherited: ${inheritedCount} of ${counts.current} current${partsSuffix(inheritedCount, header.inheritedFileLevelCount)}.`;
  const withoutChecks = files2.pending + files2.unknown === 0 ? "" : ` Test files without checks: ${files2.pending} pending, ${files2.unknown} unknown.`;
  return `Revision ${revisionText(revision, header.commit)}${changedText(header.changedPaths)}: ${countsText(counts, fileLevel)}.${inherited}${withoutChecks}${incompleteText(header)} Full-suite checkpoint: ${fullSuiteText(header, command)}.${daemonText(header, command)}${holdsText(header, command)}`;
}
function holdsText(header, command) {
  return (header.holds ?? []).map((hold) => ` ${holdLine(hold, command)}`).join("");
}
var ACTIONABLE = ["pending", "stale", "unknown"];
function newsLine(header, command) {
  const { counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files2 } = header;
  const actionable = ACTIONABLE.filter((v) => counts[v] > 0).map(
    (v) => countedText(counts[v], v, fileLevel?.[v])
  );
  const checks = actionable.length === 0 ? "no check pending, stale or unknown" : actionable.join(", ");
  const without = ["pending", "unknown"].filter((v) => files2[v] > 0).map((v) => `${files2[v]} ${v}`);
  const withoutChecks = without.length === 0 ? "" : ` Test files without checks: ${without.join(", ")}.`;
  return `Revision ${revisionText(header.revision, header.commit)}: ${checks}.${withoutChecks}${incompleteText(header)}${daemonText(header, command)}`;
}
function countsText(counts, fileLevel) {
  return ["current", ...ACTIONABLE].map((validity) => countedText(counts[validity], validity, fileLevel?.[validity])).join(", ");
}
function headerLines(header, command, form = "full", slowChanged = false) {
  const line = form === "full" ? fullLine(header, command) : newsLine(header, command);
  const slow = form === "full" || slowChanged ? slowTierText(header, command) : null;
  return slow === null ? [line] : [line, slow];
}
function stoppedText(command) {
  return `The daemon is stopped by request (\`${command} stop\`); a hook starts one at the next edit, or run \`${command} start\``;
}
function livenessSentence(daemon, revision, command) {
  if (daemon === void 0) return "";
  if (daemon.stopping !== void 0) {
    return ` The daemon is ${stoppingText(daemon.stopping, command)}; results are as of revision ${revision}.`;
  }
  if (daemon.state === "alive") {
    return daemon.short === void 0 ? "" : ` The daemon is up: ${shortText(daemon.short, command)}.`;
  }
  if (daemon.stopped === true)
    return ` ${stoppedText(command)}; results are as of revision ${revision}.`;
  const died = daemon.died === void 0 ? "" : ` The last daemon ${deathText(daemon.died)}. ${DEATH_CAUSE}`;
  if (daemon.startingSince !== void 0) {
    return ` A daemon is starting; results are as of revision ${revision}.${died}`;
  }
  if (daemon.resting === true) {
    return ` The daemon stopped while unused; results are as of revision ${revision}.`;
  }
  const since = daemon.since === null ? "No daemon is running" : `No daemon has validated since ${new Date(daemon.since).toISOString()}`;
  return ` ${since}; results are as of revision ${revision}.${died}`;
}

// src/core/delivery/format.ts
var MESSAGE_CAP_CHARS = 1e4;
var OVERFLOW_RESERVE = 400;
var INDENT = "      ";
var SQUEAL_COMMAND = "squeal";
var statusPointer = (command) => `\`${command} status\` lists every known failure.`;
var partsText = (checks, fileLevel) => checkPartsText(countChecks(checks), fileLevel);
var fileLevelWord = (shown) => shown === "fail" ? "that did not load" : "loaded";
var upper2 = (outcome) => outcome.toUpperCase();
var capitalize3 = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
function whyLine(check, command) {
  return `Full output: ${command} why ${shellWord(checkName(check))}`;
}
function block2(head, lines, counted) {
  const body = lines.filter((l) => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), counted };
}
function entryBlock(entry3, revision) {
  const failed2 = entry3.to === "fail";
  return block2(
    `${upper2(entry3.to)}  ${checkName(entry3.check)}`,
    [
      failed2 ? seenLine(entry3, revision) : change(entry3),
      entry3.summary === null ? null : cap(entry3.summary, SUMMARY_MAX_CHARS),
      entry3.location === null ? null : atText(entry3.location, entry3.testFileFrame),
      ...failed2 ? [touchesLine(entry3), loadLine(entry3)] : [recoveryProvenance(entry3, revision)],
      entry3.flaky === void 0 ? null : capitalize3(flakyText(entry3.flaky)),
      entry3.retry === void 0 ? null : capitalize3(retryText(entry3.retry))
    ],
    [{ check: entry3.check, shown: entry3.to }]
  );
}
function retiredBlock(entry3) {
  return block2(
    `RESOLVED  ${checkName(entry3.check)}`,
    ["FAIL -> no longer reported by the runner"],
    [{ check: entry3.check, shown: "resolved" }]
  );
}
function collapsedBlock({ head, lines }, shown, checks) {
  return block2(
    head,
    lines,
    checks.map((check) => ({ check, shown }))
  );
}
function failureBlocks(entries, revision, command) {
  return failureGroups(entries, revision).map((group) => {
    const [first] = group;
    if (group.length === 1 && first !== void 0) return entryBlock(first, revision);
    const lines = groupLines(group, revision, command);
    return collapsedBlock(
      lines,
      "fail",
      group.map((e) => e.check)
    );
  });
}
function recoveryBlocks(entries, delta) {
  const checks = entries.map((e) => e.check);
  const head = `PASS  ${plural(checks.length, "check")} recovered (FAIL -> PASS): ${partsText(checks)}`;
  const collapsed = collapse(head, checks, delta.stillFailing);
  if (collapsed !== null) return [collapsedBlock(collapsed, "pass", checks)];
  return entries.map((e) => entryBlock(e, delta.header.revision));
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
    const listed3 = files2.slice(0, 5).join(", ");
    const more = files2.length > 5 ? ` and ${plural(files2.length - 5, "more file")}` : "";
    return block2(
      `UNKNOWN  ${checksText(group.map((e) => e.check))} in ${plural(files2.length, "test file")}`,
      [
        counts.join(", "),
        cap(reason, SUMMARY_MAX_CHARS),
        `${listed3}${more}`,
        first === void 0 ? null : `Full reason: ${command} why ${shellWord(checkName(first))}`
      ],
      group.map((e) => ({ check: e.check, shown: "unknown" }))
    );
  });
}
function assemble(head, blocks, overflow, tail, max) {
  const end = tail === null ? "" : `

${tail}`;
  const room = max - end.length;
  let out = head;
  for (const [i, b] of blocks.entries()) {
    const next = `${out}

${b.text}`;
    const last = i === blocks.length - 1;
    if (next.length <= room - (last ? 0 : OVERFLOW_RESERVE)) {
      out = next;
      continue;
    }
    return `${cap(`${out}

${overflow(blocks.slice(i))}`, room)}${end}`;
  }
  return `${out}${end}`;
}
function formatDelta(delta, command = SQUEAL_COMMAND, max = MESSAGE_CAP_CHARS, form = "news") {
  const { header, entries } = delta;
  const changed = entries.filter((e) => e.kind !== "fail-retired");
  const retired = entries.filter((e) => e.kind === "fail-retired");
  const holds = (delta.holds ?? []).map((c) => holdChangeLine(c, header.revision, command));
  const holdTitle = entries.length === 0 && delta.liveness === void 0 ? holds[0] : void 0;
  const title = entries.length === 0 ? delta.liveness === void 0 ? holdTitle ?? `SQUEAL \xB7 revision ${header.revision}` : livenessTitle(delta.liveness, header.revision) : delta.label === "baseline" ? `SQUEAL \xB7 Squeal's baseline run found ${checksText(checksOf(entries), "failing check", "that did not load")} at revision ${header.revision}` : `SQUEAL \xB7 ${plural(entries.length, "check")} changed (${partsText(checksOf(entries))}) at revision ${header.revision}`;
  const blocks = [
    ...failureBlocks(
      changed.filter((e) => e.to === "fail"),
      header.revision,
      command
    ),
    ...unknownBlocks(
      changed.filter((e) => e.to === "unknown"),
      command
    ),
    ...recoveryBlocks(
      changed.filter((e) => e.to === "pass"),
      delta
    ),
    ...retiredBlocks(retired, delta)
  ];
  const failed2 = changed.find((e) => e.to === "fail");
  const overflow = (left) => {
    const counted = left.flatMap((b) => b.counted);
    const by = ["fail", "pass", "unknown", "resolved"].map((o) => [o, counted.filter((c) => c.shown === o).map((c) => c.check)]).filter(([, checks]) => checks.length > 0).map(([o, checks]) => `${checks.length} ${upper2(o)}: ${partsText(checks, fileLevelWord(o))}`);
    return `Not shown: ${counted.length} more changed checks (${by.join("; ")}). ${statusPointer(command)}`;
  };
  const tail = failed2 === void 0 ? null : whyLine(failed2.check, command);
  return assemble(
    [
      title,
      ...headerLines(header, command, form, delta.slowTierChanged === true),
      ...holdTitle === void 0 ? holds : holds.slice(1),
      ...editLines(delta)
    ].join("\n"),
    blocks,
    overflow,
    tail,
    max
  );
}
function sawEditLine(queued) {
  return `Squeal saw your edit and queued ${plural(queued, "test file")}; results arrive with later tool calls, and passing ones stay silent.`;
}
function settledLine({ since, files: files2, unknown }) {
  const which = `${files2 === 1 ? "The test file" : `All ${files2} test files`} your edits since revision ${since} re-keyed`;
  if (unknown === 0) return `${which} ${files2 === 1 ? "is" : "are"} current.`;
  return `${which} finished: ${files2 - unknown} current, ${unknown} with no result (unknown).`;
}
function sawSettledLine({ files: files2, unknown }) {
  const head = "Squeal saw your edit; ";
  const tail = "passing results stay silent.";
  if (unknown === 0) {
    const which = files2 === 1 ? "the 1 test file" : `all ${files2} test files`;
    return `${head}${which} it re-keyed ${files2 === 1 ? "is" : "are"} current, and ${tail}`;
  }
  return `${head}of the ${plural(files2, "test file")} it re-keyed, ${files2 - unknown} current and ${unknown} with no result (unknown); ${tail}`;
}
function editLines({ sawEdit, editsSettled }) {
  if (sawEdit !== void 0 && editsSettled !== void 0) return [sawSettledLine(editsSettled)];
  return [
    ...sawEdit === void 0 ? [] : [sawEditLine(sawEdit.queued)],
    ...editsSettled === void 0 ? [] : [settledLine(editsSettled)]
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
function livenessTitle(liveness2, revision) {
  if (liveness2?.stopping !== void 0) {
    const what = liveness2.stopping.to === void 0 ? "stopping" : "handing over";
    return `SQUEAL \xB7 the daemon is ${what} at revision ${revision}`;
  }
  if (liveness2?.state === "down" && liveness2.stopped === true) {
    return `SQUEAL \xB7 the daemon is stopped by request at revision ${revision}`;
  }
  if (liveness2?.state === "alive" && liveness2.short !== void 0) {
    return `SQUEAL \xB7 a ${liveness2.short.version} daemon is validating at revision ${revision}, not ${liveness2.short.claimed}`;
  }
  return liveness2?.state === "alive" ? `SQUEAL \xB7 a daemon is validating again at revision ${revision}` : `SQUEAL \xB7 no daemon is validating at revision ${revision}`;
}

// src/harness/shared/context.ts
function locate(cwd) {
  const root = findWorktreeRoot(cwd);
  if (root === null) return null;
  const commonDir = resolveCommonDir(root);
  return commonDir === null ? null : { root, commonDir };
}
function openContext(input, location2, options = {}) {
  const store = openStore(location2.commonDir, {
    create: false,
    busyTimeoutMs: options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS
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
      ...options.pollIntervalMs === void 0 ? {} : { pollIntervalMs: options.pollIntervalMs },
      ...options.harnessProcess === void 0 ? {} : { harnessProcess: options.harnessProcess },
      ...options.squealVersion === void 0 ? {} : { squealVersion: options.squealVersion }
    });
    return { ...location2, store, delivery, consumer, close: () => store.close() };
  } catch (error) {
    store.close();
    throw error;
  }
}

// src/harness/shared/coverage.ts
var VITEST_ONLY = {
  vitest: true,
  vitestConfig: null,
  nodeTest: [],
  slow: null
};

// src/core/daemon/client.ts
import { statSync as statSync2 } from "node:fs";
import { createConnection } from "node:net";
function endpointAt(socketPath) {
  try {
    const { dev, ino, ctimeNs, birthtimeNs } = statSync2(socketPath, { bigint: true });
    return { dev, ino, ctimeNs, birthtimeNs };
  } catch {
    return null;
  }
}
function sameEndpoint(a, b) {
  return a !== null && a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs && a.birthtimeNs === b.birthtimeNs;
}
function requestDaemon(socketPath, request, timeoutMs, endpoint) {
  return new Promise((resolve8, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled2 = false;
    const settle = (error, response) => {
      if (settled2) return;
      settled2 = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve8(response);
    };
    const timer = setTimeout(
      () => settle(failure("ETIMEDOUT", `no answer from ${socketPath} in ${timeoutMs} ms`)),
      timeoutMs
    );
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

// src/core/daemon/ensure.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync6, mkdirSync as mkdirSync4 } from "node:fs";
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
    const probe = await ping(record.socketPath, timeoutMs);
    if (probe.state !== "absent") return { socketPath: record.socketPath, probe };
  }
  return { socketPath, probe: await ping(socketPath, timeoutMs) };
}
async function ping(socketPath, timeoutMs) {
  try {
    const response = await requestDaemon(socketPath, { type: "ping" }, timeoutMs);
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
async function ensureDaemon(root, options = {}) {
  if (options.awaitLockMs === void 0) {
    const timeoutMs = options.socketTimeoutMs ?? DAEMON_SOCKET_TIMEOUT_MS;
    const probe = await probeDaemon(root, timeoutMs, options);
    if (probe.state === "alive") return "alive";
    if (probe.state === "unresponsive") return "unavailable";
  }
  const lockWait = options.awaitLockMs === void 0 ? [] : ["--await-lock", String(options.awaitLockMs)];
  const cli = daemonCliEntry(options.cli, options.env);
  if (cli === null || !existsSync6(cli)) return "unavailable";
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return "unavailable";
    const cwd = storePaths(commonDir).dir;
    mkdirSync4(cwd, { recursive: true });
    const child = spawn(process.execPath, [cli, "daemon", root, ...lockWait], {
      cwd,
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
    });
    child.unref();
    return "spawned";
  } catch {
    return "unavailable";
  }
}
function daemonCliEntry(cli, env = process.env) {
  const override = env.SQUEAL_CLI;
  if (override !== void 0 && override !== "") return override;
  return cli ?? null;
}

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
    ...overrides
  };
  const context = openContext(input, location2, options);
  if (context === null) return null;
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}

// src/harness/shared/primer.ts
var PRIMER_CAP_CHARS = 1500;
var PRIMER_OPENING = "Squeal runs this repository's ";
var REVISION = "A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed.";
function primer(command = SQUEAL_COMMAND, coverage = VITEST_ONLY) {
  const names = runnerNames(coverage);
  const sentences = (covers, naming, wait) => [
    `${PRIMER_OPENING}${listed2(names, "and")} tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run ${listed2(names, "or")} to learn whether your edits broke something.`,
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
function listed2(words, conjunction) {
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
  const files2 = coverage.slow?.files;
  const slow = coverage.slow === null ? "" : files2 === null || files2 === void 0 ? ", with slow test files not counted yet" : `, with ${files2} slow test ${files2 === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed2(suites, "and")}${slow}.`;
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
  const listed3 = entries.slice(0, shown);
  const rest = entries.length - shown;
  const tail = rest > 0 ? [...listed3, `${rest} more`] : listed3;
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
function trailingPrimer(text) {
  const at = text.lastIndexOf(`

${PRIMER_OPENING}`);
  if (at < 0) return "";
  const tail = text.slice(at);
  return tail.length - 2 <= PRIMER_CAP_CHARS && !tail.slice(2).includes("\n") ? tail : "";
}
var PRIMER = primer();

// src/harness/shared/deny.ts
import { readFileSync as readFileSync8, realpathSync as realpathSync3 } from "node:fs";
import { join as join15, resolve as resolve6 } from "node:path";

// src/core/delivery/test-command-denied.ts
function testCommandDeniedMetaKey(worktreeId) {
  return worktreeMetaKey("testCommandDenied", worktreeId);
}
function testCommandDenied(store, consumer) {
  return readSlot(store, testCommandDeniedMetaKey(consumer.worktreeId), consumer) !== void 0;
}
function recordTestCommandDenied(store, consumer, revision) {
  writeSlot(store, testCommandDeniedMetaKey(consumer.worktreeId), consumer, revision);
}

// src/runners/pytest/environment/discover.ts
import { existsSync as existsSync7, readdirSync as readdirSync4, readFileSync as readFileSync7, statSync as statSync3 } from "node:fs";
import { basename as basename2, dirname as dirname6, isAbsolute as isAbsolute7, join as join12, relative as relative2, resolve as resolve3 } from "node:path";
function projectDir(root, project) {
  return project.cwd === void 0 ? root : toAbsolute(root, project.cwd);
}
function discoverEnvironment(root, project) {
  const cwd = projectDir(root, project);
  if (project.python !== void 0) {
    const declared = resolve3(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join12(declared, "bin", "python"));
    if (existsSync7(declared)) return found("declared", dirname6(dirname6(declared)), declared);
    const target = basename2(declared).startsWith("python") ? dirname6(dirname6(declared)) : declared;
    return none(root, cwd, [declared], target);
  }
  const venv = join12(cwd, ".venv");
  if (existsSync7(join12(venv, "pyvenv.cfg"))) return found("venv", venv, join12(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname6(dirname6(pdm)), pdm);
  return none(root, cwd, [venv, join12(cwd, ".pdm-python")], venv);
}
function found(source, env, python) {
  return { kind: "found", source, env, python };
}
function pdmPython(root, cwd) {
  let text;
  try {
    text = readFileSync7(join12(cwd, ".pdm-python"), "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!isAbsolute7(text) || toRelative(root, text) === null || !existsSync7(text)) return null;
  return text;
}
var LOCKFILES2 = [
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
    const hit = LOCKFILES2.find(([file]) => existsSync7(join12(dir, file)));
    if (hit !== void 0)
      return { kind: "none", looked, command: hit[1], from: join12(dir, hit[0]) };
  }
  for (const dir of dirs) {
    const files2 = requirementsIn(dir).map((file) => join12(dir, file));
    if (files2.length === 0) continue;
    const install = files2.map((file) => `-r ${relative2(cwd, file)}`).join(" ");
    const command = `python -m venv ${venv} && ${venv}/bin/pip install ${install}`;
    return { kind: "none", looked, command, from: files2[0] };
  }
  return { kind: "none", looked, command: `python -m venv ${venv}`, from: null };
}
function requirementsIn(dir) {
  let names;
  try {
    names = readdirSync4(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names.filter((name) => REQUIREMENTS.test(name)).sort();
}
function isDirectory(path) {
  try {
    return statSync3(path).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

// src/harness/shared/test-command-pytest.ts
import { join as join13, resolve as resolve4 } from "node:path";
var OUTPUT_FLAG = /^(-[qvs]+|-r[fEsxXpPaAwN]+|--tb=(auto|long|short|line|native|no))$/;
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
    paths.push(resolve4(dir, path));
  }
  return { runner: "pytest", project: project.name, paths: paths.length === 0 ? null : paths };
}
function invocation(words, dir, env) {
  const [first, second, third] = words;
  const inEnv = (name) => env !== null && first?.includes("/") === true && resolve4(dir, first) === join13(env, "bin", name);
  if (first === "pytest" || inEnv("pytest")) return 1;
  if (first === "uv" && second === "run" && third === "pytest") return 3;
  if ((first === "python" || inEnv("python")) && second === "-m" && third === "pytest") return 3;
  return null;
}

// src/harness/shared/test-command.ts
function recognizeTestCommand(command, context) {
  const words = shellWords(command);
  if (words === null) return null;
  const atRoot = context.atRoot === false ? null : vitestCommand(words) ?? npmCommand(words, context) ?? nodeTestCommand(words, context);
  return atRoot ?? pytestCommand(words, context.pytest ?? []);
}
function bashCommand(input) {
  const toolInput = input.tool_input;
  if (input.tool_name !== "Bash" || typeof toolInput !== "object" || toolInput === null) return {};
  const { command } = toolInput;
  return typeof command === "string" ? { command } : {};
}
var REPORTER = "--reporter";
var SILENT_VALUES = /* @__PURE__ */ new Set(["true", "false", "yes", "no", "passed-only"]);
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
function npmCommand(words, context) {
  if (words[0] !== "npm") return null;
  const name = words.length === 2 && words[1] === "test" ? "test" : words.length === 3 && words[1] === "run" ? words[2] : void 0;
  if (name === void 0) return null;
  const { scripts } = context;
  if (!Object.hasOwn(scripts, name)) return null;
  if (Object.hasOwn(scripts, `pre${name}`) || Object.hasOwn(scripts, `post${name}`)) return null;
  const script = shellWords(scripts[name]);
  return script === null ? null : vitestCommand(script);
}
function nodeTestCommand(words, context) {
  const at = words.indexOf("--test");
  if (at === -1) return null;
  const argv = words.slice(1, at);
  const args = words.slice(at + 1);
  if (args.length === 0) return null;
  const project = context.nodeTest.find(
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
var SPECIAL = /[|&;()<>$`\\#*?[\]{}~!\n\r]/;
function shellWords(text) {
  const words = [];
  let word = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === " " || char === "	") {
      if (word !== null) words.push(word);
      word = null;
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return null;
      const quoted = text.slice(i + 1, end);
      if (char === '"' && /[$`\\]/.test(quoted)) return null;
      word = (word ?? "") + quoted;
      i = end;
    } else if (SPECIAL.test(char)) {
      return null;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== null) words.push(word);
  if (words.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return null;
  return words;
}

// src/harness/shared/test-command-files.ts
import { isAbsolute as isAbsolute8, join as join14, relative as relative3, resolve as resolve5 } from "node:path";
function resolveTestFiles(command, listing, root, nodeTest, omitted) {
  if (command.runner === "node-test") {
    const own = listing.filter((ref) => ref.project === command.project);
    if (command.files === null) return own.length === 0 ? null : own;
    const byPath = new Map(own.map((ref) => [ref.path, ref]));
    const files2 = command.files.map((file) => byPath.get(worktreePath(root, file) ?? ""));
    return files2.every((ref) => ref !== void 0) ? unique(files2) : null;
  }
  if (command.runner === "pytest") return pytestFiles(command, listing, root);
  if (omitted !== 0) return null;
  const vitest = listing.filter((ref) => !nodeTest.has(ref.project));
  if (new Set(vitest.map((ref) => ref.project)).size !== 1) return null;
  if (command.filters.length === 0) return vitest;
  const selected = /* @__PURE__ */ new Set();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref) => matchesFilter(join14(root, ref.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref of hits) selected.add(ref);
  }
  return vitest.filter((ref) => selected.has(ref));
}
function matchesFilter(file, filter, root) {
  if (isAbsolute8(filter) && file.startsWith(filter)) return true;
  const testFile = relative3(root, file).toLocaleLowerCase();
  const rel = relative3(root, resolve5(root, filter));
  const relativePath = filter.endsWith("/") ? join14(rel, "/") : rel;
  return testFile.includes(filter.toLocaleLowerCase()) || testFile.includes(relativePath.toLocaleLowerCase());
}
function pytestFiles(command, listing, root) {
  if (command.paths === null) return null;
  const own = listing.filter((ref) => ref.project === command.project);
  const named2 = new Set(command.paths.map((path) => worktreePath(root, path)));
  if (![...named2].every((rel) => own.some((ref) => ref.path === rel))) return null;
  return own.filter((ref) => named2.has(ref.path));
}
function worktreePath(root, path) {
  const rel = relative3(root, resolve5(root, path));
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute8(rel)) return null;
  return rel;
}
function unique(files2) {
  return [...new Set(files2)];
}

// src/harness/shared/test-command-reason.ts
var NAMED_FILES = 10;
function testCommandReason(answer) {
  const { revision, files: files2, states } = answer;
  const failures = states.flatMap((s) => toKnownFailure(s, revision) ?? []);
  const passed = states.filter((s) => s.outcome === "pass").length;
  const skipped = states.filter((s) => s.outcome === "skip").length;
  const counts = [
    `${plural(passed, "check")} passed`,
    ...skipped > 0 ? [`${skipped} skipped`] : [],
    failures.length === 0 ? "no known failures" : plural(failures.length, "known failure"),
    inheritedText(answer)
  ];
  const lines = [
    `The command did not run. Squeal holds current results at revision ${revision} for the ${plural(files2.length, "test file")} it runs (${filesText2(files2)}): ${counts.join(", ")}.`,
    ...failures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...f.summary === "" ? [] : [`        ${f.summary}`],
      ...f.location === null ? [] : [`        at ${f.location.path}:${f.location.line}:${f.location.column}`]
    ]),
    "Squeal does not cover typecheck, build, or test suites it is not configured for. Run the command again to run it anyway; it will not be stopped again this session."
  ];
  return lines.join("\n");
}
function filesText2(files2) {
  if (files2.length <= NAMED_FILES) return files2.map((f) => f.path).join(", ");
  const byDir = /* @__PURE__ */ new Map();
  for (const { path } of files2) {
    const at = path.lastIndexOf("/");
    const dir = at === -1 ? "./" : path.slice(0, at + 1);
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return [...byDir].map(([dir, count]) => `${dir} (${count})`).join(", ");
}
function inheritedText({ states, rootOf }) {
  const sources = /* @__PURE__ */ new Map();
  for (const { origin } of states) {
    if (origin?.kind !== "inherited") continue;
    const from2 = `${rootOf(origin.worktreeId) ?? origin.worktreeId} at ${shortCommit(origin.commit)}`;
    sources.set(from2, (sources.get(from2) ?? 0) + 1);
  }
  if (sources.size === 0) return "none inherited";
  const total = [...sources.values()].reduce((a, b) => a + b, 0);
  const from = [...sources].map(([source, count]) => `${count} from ${source}`).join(", ");
  return `${total} inherited (${from})`;
}

// src/harness/shared/text.ts
function denialSentence(toolName) {
  return `Squeal policy interrupt.onRegression denied this ${toolName} call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.`;
}

// src/harness/shared/deny.ts
var DENIED_KINDS = ["pass-to-fail"];
async function denyOnRegression(context, policy, call) {
  if (!call.edit || !policy.interrupt.onRegression) {
    resumeTurn(context.store, context.consumer);
    return null;
  }
  const delta = await context.delivery.peek(context.consumer, { kinds: DENIED_KINDS });
  if (delta === null) return null;
  return `${formatDelta(delta, call.command)}

${denialSentence(call.toolName)}`;
}
function testCommandOf(location2, policy, call) {
  if (!policy.testCommand.denyWhenCurrent || call.toolName !== "Bash") return null;
  if (call.command === void 0) return null;
  const { root } = location2;
  const cwd = realPath(call.cwd);
  if (cwd === null || cwd !== root && !cwd.startsWith(`${root}/`)) return null;
  return recognizeTestCommand(call.command, {
    scripts: cwd === root ? rootScripts(root) : {},
    nodeTest: policy.nodeTest,
    pytest: pytestHere(root, cwd, policy.pytest),
    atRoot: cwd === root
  });
}
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
    return realpathSync3(resolve6(path));
  } catch {
    return null;
  }
}
function rootScripts(root) {
  try {
    const manifest = JSON.parse(readFileSync8(join15(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text]) => typeof text === "string")
    );
  } catch {
    return {};
  }
}
function denyCurrentTestCommand(context, command, nodeTest, now) {
  const { store, consumer } = context;
  return store.transaction(() => {
    if (store.consumers.get(consumer) === null || testCommandDenied(store, consumer)) return null;
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
    if (header.daemon?.state !== "alive" || header.testFilesListed === false) return null;
    if (header.runnerPartPending === true || header.awaitingInstall === true) return null;
    const live = command.runner === "vitest" ? readPolicy(context.root) : null;
    if (live !== null && live.vitest.exclude.length > 0) return null;
    const pytest = live?.pytest ?? [];
    const names = new Set([...nodeTest, ...pytest].map((p) => p.name));
    const files2 = resolveTestFiles(
      command,
      keys.map((k) => k.testFile),
      context.root,
      names,
      readOmittedTestFiles(store, consumer.worktreeId)
    );
    if (files2 === null) return null;
    const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
    const byFile2 = /* @__PURE__ */ new Map();
    for (const state of states) {
      const id = testFileKeyOf(state.check);
      byFile2.set(id, [...byFile2.get(id) ?? [], state]);
    }
    const answered = [];
    for (const file of files2) {
      const row = rows.get(testFileId(file));
      const own = byFile2.get(testFileId(file)) ?? [];
      if (row === void 0 || row.key === null || row.pending !== null) return null;
      if (own.length === 0 || own.some((s) => s.validity !== "current")) return null;
      answered.push(...own);
    }
    recordTestCommandDenied(store, consumer, header.revision);
    return testCommandReason({
      revision: header.revision,
      files: files2,
      states: answered,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null
    });
  });
}

// src/harness/shared/stop-slow.ts
var STOP_SLOW_HANDOFF_MS = HOOK_TIMEOUT_MS + 1e3;

// src/harness/shared/version-copies.ts
import { spawnSync } from "node:child_process";
import {
  chmodSync as chmodSync2,
  copyFileSync,
  cpSync,
  existsSync as existsSync8,
  mkdirSync as mkdirSync5,
  readdirSync as readdirSync5,
  readFileSync as readFileSync9,
  renameSync as renameSync2,
  rmSync as rmSync4
} from "node:fs";
import { basename as basename3, dirname as dirname7, join as join16, resolve as resolve7 } from "node:path";
var COPIED = ["dist", "skills", ".codex-plugin"];
var MANIFEST = join16(".codex-plugin", "plugin.json");
var CLI = join16("dist", "cli", "squeal.mjs");
var SKILL = join16("skills", "squeal", "SKILL.md");
var LAUNCHER_SOURCE = join16("bin", "squeal-launcher");
var LAUNCHER = join16("bin", "squeal");
var VERSION = /^\d+\.\d+\.\d+$/;
var CODEX_CACHE = join16("plugins", "cache", "hearsay", "squeal");
var CODEX_DATA = join16("plugins", "data", "squeal-hearsay");
var LEFT = /^\..+\.(\d+)\.(tmp|gone)$/;
function dataLauncher(data) {
  return join16(data, LAUNCHER);
}
function copyOf(data, version) {
  return join16(data, "versions", version);
}
function manifestVersion2(dir) {
  try {
    const manifest = JSON.parse(readFileSync9(join16(dir, MANIFEST), "utf8"));
    return isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
function kept(data, version, file) {
  const dir = copyOf(data, version);
  const path = join16(dir, file);
  return existsSync8(path) && manifestVersion2(dir) === version ? path : null;
}
function keptCli(data, version) {
  return kept(data, version, CLI);
}
function dataOfCopy(cli) {
  const versions = dirname7(dirname7(dirname7(dirname7(cli))));
  return cli.endsWith(`/${CLI}`) && basename3(versions) === "versions" ? dirname7(versions) : null;
}
function keepVersion({ root, data, version }) {
  const dir = copyOf(data, version);
  if (!VERSION.test(version) || !existsSync8(join16(root, CLI))) return null;
  try {
    const versions = join16(data, "versions");
    const whole = keptCli(data, version) !== null;
    if (!whole && existsSync8(dir) && manifestVersion2(dir) !== version) remove(versions, version);
    if (manifestVersion2(root) !== version) return whole ? dir : null;
    let made = false;
    if (!whole) {
      mkdirSync5(versions, { recursive: true });
      const part = join16(versions, `.${version}.${process.pid}.tmp`);
      rmSync4(part, { recursive: true, force: true });
      for (const name of COPIED) {
        if (existsSync8(join16(root, name))) {
          cpSync(join16(root, name), join16(part, name), { recursive: true, dereference: true });
        }
      }
      try {
        renameSync2(part, dir);
        made = true;
      } catch {
        rmSync4(part, { recursive: true, force: true });
      }
    }
    writeLauncher(root, data, version);
    if (made) prune3(data, version);
    return keptCli(data, version) === null ? null : dir;
  } catch {
    return null;
  }
}
function writeLauncher(root, data, version) {
  const target = dataLauncher(data);
  const source = join16(root, LAUNCHER_SOURCE);
  if (!existsSync8(source)) return;
  if (existsSync8(target)) {
    if (copies(data).some((v) => isNewerVersion(v, version))) return;
    if (readFileSync9(target, "utf8") === readFileSync9(source, "utf8")) return;
  }
  mkdirSync5(join16(data, "bin"), { recursive: true });
  const part = `${target}.${process.pid}.tmp`;
  copyFileSync(source, part);
  chmodSync2(part, 493);
  renameSync2(part, target);
}
function copies(data) {
  try {
    return readdirSync5(join16(data, "versions")).filter((v) => VERSION.test(v));
  } catch {
    return [];
  }
}
function prune3(data, version) {
  const versions = join16(data, "versions");
  const others = copies(data).filter((v) => v !== version);
  const keep = others.reduce(
    (a, b) => a === null || isNewerVersion(b, a) ? b : a,
    null
  );
  const running = processArgs();
  const gone = readdirSync5(versions).filter((name) => {
    const left = LEFT.exec(name);
    return left !== null && !alive(Number(left[1]));
  });
  for (const other of others) {
    if (other !== keep && running !== null && !running.includes(`${join16(versions, other)}/`)) {
      gone.push(other);
    }
  }
  for (const name of gone) remove(versions, name);
}
function remove(versions, name) {
  const doomed = join16(versions, `.${name}.${process.pid}.gone`);
  try {
    renameSync2(join16(versions, name), doomed);
    rmSync4(doomed, { recursive: true, force: true });
  } catch {
  }
}
function processArgs() {
  const ps = spawnSync("ps", ["-A", "-o", "args="], { encoding: "utf8" });
  return ps.status === 0 && typeof ps.stdout === "string" ? ps.stdout : null;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// src/harness/codex/command.ts
import { existsSync as existsSync9 } from "node:fs";
import { join as join17 } from "node:path";
function codexCommand(env, bundleCli) {
  const data = env.PLUGIN_DATA === void 0 || env.PLUGIN_DATA === "" ? dataOfCopy(bundleCli) : env.PLUGIN_DATA;
  if (data !== null && existsSync9(dataLauncher(data))) return shellWord(dataLauncher(data));
  const root = env.PLUGIN_ROOT;
  const cli = root === void 0 || root === "" ? bundleCli : join17(root, "dist/cli/squeal.mjs");
  return `node --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}

// src/harness/codex/kept.ts
var set = (value) => value === void 0 || value === "" ? null : value;
function keptCodexCli(env, version = squealVersion()) {
  const data = set(env.PLUGIN_DATA);
  return data === null ? null : keptCli(data, version);
}
function keepCodexCli(env, version) {
  const root = set(env.PLUGIN_ROOT);
  const data = set(env.PLUGIN_DATA);
  if (root === null || data === null) return null;
  return keepVersion({ root, data, version }) === null ? null : keptCli(data, version);
}
function keepOnSpawn(deps) {
  const version = deps.squealVersion ?? squealVersion();
  const data = set(deps.env.PLUGIN_DATA);
  if (set(deps.env.PLUGIN_ROOT) === null || data === null || keptCli(data, version) !== null) {
    return deps;
  }
  const ensure2 = deps.ensureDaemon ?? ensureDaemon;
  return {
    ...deps,
    ensureDaemon: async (root, options) => {
      if (options.awaitLockMs === void 0) {
        const probe = await probeDaemon(root, options.socketTimeoutMs, options);
        if (probe.state === "alive") return "alive";
        if (probe.state === "unresponsive") return "unavailable";
      }
      const cli = keepCodexCli(deps.env, version);
      return ensure2(root, cli === null ? options : { ...options, cli });
    }
  };
}

// src/harness/codex/output.ts
var CONTEXT_CAP_CHARS = 8e3;
var cutLine = (command) => `SQUEAL \xB7 cut to fit a Codex hook; \`${command} status\` has the rest.`;
function capContext(text, command = SQUEAL_COMMAND, keep = "") {
  const primer2 = trailingPrimer(`

${text}`).slice(2);
  const head = text.slice(0, text.length - primer2.length).replace(/\n\n$/, "");
  const kept2 = [keep, primer2].filter((p) => p !== "").join("\n\n");
  const tail = head === "" || kept2 === "" ? kept2 : `

${kept2}`;
  if (head.length + tail.length <= CONTEXT_CAP_CHARS) return `${head}${tail}`;
  const cut = cutLine(command);
  const room = CONTEXT_CAP_CHARS - tail.length - cut.length - 1;
  const start = head.slice(0, room);
  const line = start.lastIndexOf("\n");
  return `${line > 0 ? start.slice(0, line) : start}
${cut}${tail}`;
}
function deny(reason, command) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: capContext(reason, command)
    }
  };
}

// src/harness/codex/handlers.ts
var preToolUse = (input, location2, deps) => {
  const policy = readPolicy(location2.root);
  const testCommand = testCommandOf(location2, policy, {
    toolName: input.tool_name ?? "",
    cwd: input.cwd,
    ...input.command === void 0 ? {} : { command: input.command }
  });
  return withContext(input, location2, deps, async (context) => {
    const reason = await denyOnRegression(context, policy, {
      edit: input.tool_name === "apply_patch",
      toolName: input.tool_name ?? "tool",
      command: deps.command
    }) ?? (testCommand === null ? null : denyCurrentTestCommand(context, testCommand, policy.nodeTest, (deps.now ?? Date.now)()));
    return reason === null ? null : deny(reason, deps.command);
  });
};

// src/harness/codex/main.ts
import { readFileSync as readFileSync11 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/harness/shared/session-root.ts
import { createHash as createHash3 } from "node:crypto";
import {
  existsSync as existsSync10,
  lstatSync as lstatSync3,
  readdirSync as readdirSync6,
  readFileSync as readFileSync10,
  renameSync as renameSync3,
  rmSync as rmSync5,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join18 } from "node:path";
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
  const dir = join18(runtimeDir(env), "squeal-sessions");
  const path = (key) => join18(dir, keyFile(key));
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
        writeFileSync2(temp, JSON.stringify({ root: location2.root, commonDir: location2.commonDir }));
        renameSync3(temp, file);
      } catch {
      }
    },
    delete: (key) => {
      try {
        rmSync5(path(key), { force: true });
        if (key.includes(AGENT_SEPARATOR)) return;
        const agents = `${keyFile(key)}-`;
        for (const name of readdirSync6(dir)) {
          if (name.startsWith(agents)) rmSync5(join18(dir, name), { force: true });
        }
      } catch {
      }
    }
  };
}
function keyFile(key) {
  const [session = "", ...agent] = key.split(AGENT_SEPARATOR);
  const own = hash(session);
  return agent.length === 0 ? own : `${own}-${hash(agent.join(AGENT_SEPARATOR))}`;
}
function hash(text) {
  return createHash3("sha256").update(text).digest("hex").slice(0, 32);
}
function readKept(file) {
  const stat = lstatSync3(file, { throwIfNoEntry: false });
  if (stat === void 0 || !stat.isFile() || stat.uid !== currentUid()) return null;
  const kept2 = JSON.parse(readFileSync10(file, "utf8"));
  if (!isRecord(kept2) || typeof kept2.root !== "string" || typeof kept2.commonDir !== "string") {
    return null;
  }
  return existsSync10(kept2.root) ? { root: kept2.root, commonDir: kept2.commonDir } : null;
}

// src/harness/codex/input.ts
function isUnservedThread(input) {
  return input.agent_id === void 0 && input.transcript_path !== void 0 && !input.transcript_path.endsWith(`${input.session_id}.jsonl`);
}
function parseCodexInput(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
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
    ...typeof v.turn_id === "string" ? { turn_id: v.turn_id } : {},
    ...typeof v.tool_name === "string" ? { tool_name: v.tool_name } : {},
    ...bashCommand(v),
    ...typeof v.stop_hook_active === "boolean" ? { stop_hook_active: v.stop_hook_active } : {},
    ...typeof v.source === "string" ? { source: v.source } : {},
    ...typeof v.transcript_path === "string" && v.transcript_path !== "" ? { transcript_path: v.transcript_path } : {}
  };
}

// src/harness/codex/run.ts
var SILENT = { stdout: "", stderr: "" };
async function runCodexHandler(name, handler, stdin, deps) {
  try {
    const input = parseCodexInput(stdin);
    if (input === null || isUnservedThread(input)) return SILENT;
    const start = name === "session-start" || name === "subagent-start";
    const location2 = sessionLocation(input, start, deps.sessionRoots);
    if (location2 === null) return SILENT;
    if (name === "session-end" || name === "subagent-stop") forgetRoot(input, deps.sessionRoots);
    const output = await handler(input, location2, deps);
    return output === null ? SILENT : { stdout: JSON.stringify(output), stderr: "" };
  } catch (error) {
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal codex ${name} hook: ${String(error)}
` };
    }
    return SILENT;
  }
}

// src/harness/codex/main.ts
async function runMain(name, handler) {
  let stdin = "";
  try {
    stdin = readFileSync11(0, "utf8");
  } catch {
  }
  const cli = keptCodexCli(process.env) ?? fileURLToPath2(new URL("./cli/squeal.mjs", import.meta.url));
  const deps = {
    env: process.env,
    sessionRoots: sessionRootFiles(process.env),
    cli,
    command: codexCommand(process.env, cli)
  };
  const kept2 = name === "session-start" ? deps : keepOnSpawn(deps);
  const result = await runCodexHandler(name, handler, stdin, kept2);
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}

// src/harness/codex/entries/pre-tool-use.ts
await runMain("pre-tool-use", preToolUse);
