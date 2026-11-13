import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/harness/opencode/bridge.ts
import { readFileSync as readFileSync20 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/daemon/policy.ts
import { join } from "node:path";

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/types/runner.ts
var SLOW_LANE_PREFIX = "slow:";
function isSlowLane(lane) {
  return lane.startsWith(SLOW_LANE_PREFIX);
}

// src/core/types/store.ts
var WORKTREE_META_ROWS = {
  runtimeFiles: { prefix: "runtimeFiles.", owner: "keys/runtime-applied" },
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
  groupTiersTold: { prefix: "group-tiers-told:", owner: "delivery/slow-told" },
  commitTold: { prefix: "commit-told:", owner: "delivery/commit-told" },
  countsOwed: { prefix: "counts-owed:", owner: "delivery/counts-owed" },
  holdTold: { prefix: "hold-told:", owner: "delivery/hold-told" },
  leaving: { prefix: "leaving:", owner: "delivery/leaving" },
  notes: { prefix: "notes.", owner: "types/scheduler" },
  refined: { prefix: "refined.", owner: "types/scheduler" },
  awaitingInstall: { prefix: "awaiting-install.", owner: "types/scheduler" },
  installCommand: { prefix: "install-command.", owner: "types/scheduler" },
  checkpoint: { prefix: "checkpoint.", owner: "types/scheduler" },
  checkpointLanes: { prefix: "checkpoint-lanes.", owner: "store/repos/runs" },
  headMove: { prefix: "head-move.", owner: "types/scheduler" },
  commitReports: { prefix: "commit-reports:", owner: "commit/store" },
  feedDelivered: { prefix: "feed-delivered:", owner: "presence/stored" },
  daemonBootstrapped: { prefix: "daemon-bootstrapped:", owner: "types/daemon" },
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
  focused: { prefix: "focused:", owner: "scheduler/focused-row" },
  yields: { prefix: "yields:", owner: "scheduler/yields" },
  quiet: { prefix: "quiet:", owner: "scheduler/quiet" },
  poolWait: { prefix: "pool-wait:", owner: "scheduler/pool-wait" },
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
  unknownFiles: { prefix: "unknown-files:", owner: "scheduler/unknown-files" },
  importRewalk: { prefix: "import-rewalk:", owner: "scheduler/import-rewalk" },
  importsWaiting: { prefix: "imports-waiting:", owner: "scheduler/imports-waiting" },
  sharedRefused: { prefix: "shared-refused:", owner: "shared/refused" }
};
function worktreeMetaKey(row, worktreeId) {
  return `${WORKTREE_META_ROWS[row].prefix}${worktreeId}`;
}

// src/core/types/scheduler.ts
var TESTS_GROUP = "tests";
var SLOW_GROUP = "slow";
var GROUP_LANE_PREFIX = "group:";
function groupLane(group, runnerLane) {
  if (group === TESTS_GROUP) return runnerLane;
  if (group === SLOW_GROUP) return SLOW_LANE_PREFIX + runnerLane;
  return `${GROUP_LANE_PREFIX}${group}:${runnerLane}`;
}
function isGroupLane(lane) {
  return lane.startsWith(SLOW_LANE_PREFIX) || lane.startsWith(GROUP_LANE_PREFIX);
}
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
    const parsed2 = JSON.parse(raw);
    return Array.isArray(parsed2) ? parsed2.filter((p) => typeof p === "string") : null;
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
    const owed2 = value.owed;
    const lists = owed2 === void 0 ? [] : [owed2.ids, owed2.remaining, owed2.strict];
    if (!lists.every(Array.isArray)) return null;
    return value;
  } catch {
    return null;
  }
}

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
  shared: { ref: null },
  node: "project",
  requires: { commands: [] },
  remote: { allowed: true, needsRepository: [] }
};

// src/core/daemon/config-file.ts
import { readFileSync } from "node:fs";

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/daemon/config-file.ts
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
function loadConfigFile(path, shape, defaults) {
  let text2;
  try {
    text2 = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { value: defaults, problems: [] };
    return { value: defaults, problems: [`could not be read: ${String(error)}`], unparsed: true };
  }
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

// src/core/text.ts
function plural(count2, word) {
  return `${count2} ${word}${count2 === 1 ? "" : "s"}`;
}
function cap(text2, max) {
  return text2.length <= max ? text2 : `${text2.slice(0, max - 3)}...`;
}
function timeText(at) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
  const quoted = (list, join27) => {
    const all = list.map((entry3) => JSON.stringify(entry3));
    const last = all.pop();
    return all.length === 0 ? last : `${all.join(", ")} ${join27} ${last}`;
  };
  const names2 = entries.filter((entry3) => !entry3.includes("*"));
  const patterns = entries.filter((entry3) => entry3.includes("*"));
  const parts = [
    ...names2.length === 0 ? [] : [`${names2.length === 1 ? "project" : "projects"} ${quoted(names2, "and")}`],
    ...patterns.length === 0 ? [] : [`projects matching ${quoted(patterns, "or")}`]
  ];
  return { text: parts.join(" and "), plural: patterns.length > 0 || names2.length > 1 };
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

// src/core/daemon/check-groups.ts
var CHECK_MOMENTS = ["edit", "pause", "stop", "commit", "manual"];
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

// src/core/daemon/policy-node-test.ts
import { isAbsolute, posix } from "node:path";
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
  const normal = posix.normalize(v.replaceAll("\\", "/"));
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
  prepare
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
  const named3 = nonEmptyString(entry3.name) === null ? entry3.name : null;
  const skipped = named3 === null ? "it is skipped" : `project ${JSON.stringify(named3)} is skipped`;
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
  if (kept2.some((project) => project.name === named3)) {
    return `"${at}.name" repeats ${JSON.stringify(named3)} of an earlier project; it is skipped`;
  }
  return null;
}

// src/core/daemon/policy-checks.ts
var show = (value) => value === void 0 ? "undefined" : JSON.stringify(value);
var must = (expected, ok) => (value, path) => ok(value) ? null : `"${path}" must be ${expected}, got ${show(value)}`;
var oneOf = (values) => must(`one of ${values.map((v) => `"${v}"`).join(", ")}`, (v) => values.includes(v));
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
  priority: oneOf(["normal", "low"]),
  deferUnderLoad: object({ maxLoadPerCpu: aboveZero, maxDeferMs: atLeastZero })
});
var moment = oneOf(CHECK_MOMENTS);
var COMMON = {
  name,
  at: moment,
  after: names,
  quietMs: atLeastZero,
  limits
};
var TEST_RULES = object({
  ...COMMON,
  runner: oneOf(CHECK_RUNNERS),
  project: must("a non-empty string", (v) => typeof v === "string" && v.length > 0),
  tests
});
var LINT_RULES = object({ name, at: moment, lint });
var TEST_ONLY = ["project", "tests"];
var TEST_GROUP_ONLY = ["after", "quietMs", "limits"];
function checkGroups(value) {
  if (!Array.isArray(value)) return "an array of check groups";
  const kept2 = [];
  const problems = [];
  value.forEach((entry3, index) => {
    const at = `checks[${index}]`;
    const problem = entryProblem2(entry3, at) ?? nameProblem(entry3, at, kept2);
    if (problem === null) kept2.push(entry3);
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function nameProblem(entry3, at, kept2) {
  if (DEFAULT_GROUP_NAMES.includes(entry3.name)) {
    return `"${at}.name" is "${entry3.name}", the name of a default group; it is left out`;
  }
  if (kept2.some((group) => group.name === entry3.name)) {
    return `"${at}.name" repeats "${entry3.name}" of an earlier group; it is left out`;
  }
  return null;
}
function entryProblem2(entry3, at) {
  if (!isRecord(entry3)) return `"${at}" must be an object, got ${show(entry3)}; it is left out`;
  const problem = shapeProblem(entry3, at);
  return problem === null ? null : `${problem}; ${leftOut(entry3)}`;
}
function shapeProblem(entry3, at) {
  const isTest = entry3.runner !== void 0;
  const isLint = entry3.lint !== void 0;
  if (isTest && isLint) return `"${at}" has both "runner" and "lint"; a group has one`;
  if (!isTest && !isLint) return `"${at}" has neither "runner" nor "lint"; a group needs one`;
  if (isLint) {
    const testKey = TEST_ONLY.find((key) => entry3[key] !== void 0);
    if (testKey !== void 0) return `"${at}.${testKey}" needs "runner"; a lint group has none`;
    const unbuilt = TEST_GROUP_ONLY.find((key) => entry3[key] !== void 0);
    if (unbuilt !== void 0) {
      return `"${at}.${unbuilt}" applies to test groups only; a lint group has "name", "lint" and "at"`;
    }
  }
  for (const key of ["name", "at"]) {
    if (entry3[key] === void 0) return `"${at}.${key}" is missing; every group needs one`;
  }
  return (isTest ? TEST_RULES : LINT_RULES)(entry3, at);
}
function leftOut(entry3) {
  return typeof entry3.name === "string" && NAME.test(entry3.name) ? `group "${entry3.name}" is left out` : "it is left out";
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
  const projects2 = group.runner === "nodeTest" ? policy.nodeTest : policy.pytest;
  return projects2.some((project) => project.name === group.project) ? null : `"project" names no ${group.runner} project "${group.project}"`;
}
function afterProblem(group, byName, defaults, all) {
  for (const name2 of group.after ?? []) {
    const named3 = byName.get(name2);
    if (named3 !== void 0 && "lint" in named3) {
      return `"after" names "${name2}", a lint group; a group follows test groups only`;
    }
    const at = named3?.at ?? defaults.get(name2);
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

// src/core/daemon/policy-gate.ts
var groups = (v) => v === null || Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of check-group names, or null";
var GATE_SHAPE = { gate: { groups } };

// src/core/daemon/policy-lint.ts
var boolean3 = (v) => typeof v === "boolean" ? null : "true or false";
var globs3 = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? compiles(v) : "an array of strings";
var TOOL_NAMES = ["eslint", "oxlint"];
var tools = (v) => Array.isArray(v) && v.every((s) => TOOL_NAMES.includes(s)) ? null : `an array of ${TOOL_NAMES.join(" and ")}`;
var LINT_SHAPE = {
  lint: { enabled: boolean3, include: globs3, exclude: globs3, blocking: boolean3, tools }
};

// src/core/daemon/policy-node.ts
var node = (v) => v === "project" || v === "session" ? null : '"project" or "session"';
var NODE_SHAPE = { node };

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
  batchSize: positiveInteger3
};
var REQUIRED2 = /* @__PURE__ */ new Set(["name", "include"]);
function positiveInteger3(value) {
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
  if (python === void 0 || isAbsolute2(python)) return null;
  const path = posix2.join(entry3.cwd ?? ".", python.replaceAll("\\", "/"));
  if (insideRoot(path) === null) return null;
  return {
    key: "python",
    problem: `must stay inside the worktree when relative (absolute only for an environment outside it), got ${JSON.stringify(python)}`
  };
};

// src/core/daemon/policy-remote.ts
var boolean4 = (v) => typeof v === "boolean" ? null : "true or false";
var kept = (key, bad) => (value) => {
  if (!Array.isArray(value) || !value.every((entry3) => typeof entry3 === "string")) {
    return "an array of strings";
  }
  const good = [];
  const problems = [];
  value.forEach((entry3, index) => {
    const why = bad(entry3);
    if (why === null) good.push(entry3);
    else problems.push(`"${key}[${index}]" ${why}; it is left out`);
  });
  return { kept: good, problems };
};
function commandName(entry3) {
  return /^[^-\s/\\][^\s/\\]*$/.test(entry3) && !new RegExp("\\p{Cc}", "u").test(entry3);
}
var commands = kept(
  "requires.commands",
  (entry3) => commandName(entry3) ? null : `must be a command name such as "git", got ${JSON.stringify(entry3)}`
);
var needsRepository = kept("remote.needsRepository", (glob) => compiles([glob])?.problem ?? null);
var REMOTE_SHAPE = {
  requires: { commands },
  remote: { allowed: boolean4, needsRepository }
};

// src/core/fs/compare.ts
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/core/keys/observed.ts
import { createHash } from "node:crypto";
function observedMetaKey(project) {
  return `observed.${project}`;
}
function observedDirectMetaKey(project) {
  return `observedDirect.${project}`;
}
var LIST = "";
function readSharedEntries(store, key, shape = "map") {
  return parse(store.meta.get(key), shape);
}
var ABSENT_LISTING = createHash("sha1").update("\0absent").digest("hex");
var EMPTY_LISTING = createHash("sha1").update("\0empty").digest("hex");
function parse(raw, shape) {
  if (raw === null) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  const entries = shape === "list" ? { [LIST]: value } : value;
  if (!isRecord(entries)) return {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(
      ([entry3, paths]) => Array.isArray(paths) ? [[entry3, paths.filter((p) => typeof p === "string")]] : []
    )
  );
}

// src/core/keys/closure.ts
var CLOSURE_METHOD = "static imports plus declared inputs";

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
var SHARED_SHAPE = { shared: { ref } };

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
var oneOf2 = (...values) => (v) => values.includes(v) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;
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
  baseline: { onStart: oneOf2("lookup-then-run-missing", "lookup-only") },
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
  vitest: { excludeProjects: strings2, exclude: (v) => strings2(v) ?? compiles(v) },
  slow: {
    include: slowInclude,
    maxWorkers: positiveInteger,
    maxLoadPerCpu: aboveZero3,
    maxDeferMs: atLeastZero2,
    maxParallel: positiveInteger,
    rank: oneOf2("tokens", "duration"),
    // Spec 004 D2, D7 as amended 2026-10-18 (row 004-80).
    trigger: oneOf2("continuous", "idle"),
    quietMs: atLeastZero2
  },
  delivery: { uncoveredEdits: boolean5 },
  daemon: { idleExitMinutes: aboveZero3, unusedExitMinutes: aboveZero3 },
  store: { retentionDays: atLeastZero2, maxSizeMb: orNull(aboveZero3) },
  ...CODE_SHAPE,
  ...LINT_SHAPE,
  ...SHARED_SHAPE,
  ...REMOTE_SHAPE,
  ...GATE_SHAPE,
  ...NODE_SHAPE
};
function loadPolicy(root) {
  const loaded = loadConfigFile(join(root, POLICY_FILE), SHAPE, DEFAULT_POLICY);
  const settled3 = settleChecks(loaded.value);
  return {
    policy: settled3.problems.length === 0 ? loaded.value : { ...loaded.value, checks: settled3.checks },
    problems: [...loaded.problems, ...settled3.problems],
    ...loaded.unparsed === true ? { unparsed: true } : {},
    ...loaded.unknownKeys === void 0 ? {} : { unknownKeys: loaded.unknownKeys }
  };
}
function readPolicy(root) {
  return loadPolicy(root).policy;
}
function isNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/types/daemon.ts
function daemonIncarnation(daemon) {
  if (daemon?.token === void 0) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}
function bootstrappedMetaKey(worktreeId) {
  return worktreeMetaKey("daemonBootstrapped", worktreeId);
}

// src/core/store/paths.ts
import { basename, dirname, join as join2 } from "node:path";
function storePaths(commonDir) {
  const dir = join2(commonDir, "squeal");
  return {
    dir,
    database: join2(dir, "store.sqlite"),
    runsDir: join2(dir, "runs"),
    locksDir: join2(dir, "locks")
  };
}
function lockFileFor(commonDir, worktreeId) {
  return join2(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
}

// src/core/presence/marks.ts
import { existsSync, readFileSync as readFileSync3, statSync } from "node:fs";

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
import { readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { readFile } from "node:fs/promises";
var TICKS_PER_SECOND = 100;
var COMMAND_CHARS = 120;
var PF_EXITING = 4;
function lifeOf(pid) {
  let text2;
  try {
    text2 = readFileSync2(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  const fields = text2.slice(text2.lastIndexOf(")") + 2).split(" ");
  const zombie = fields[0] === "Z" || fields[0] === "X";
  const dying = zombie || (Number(fields[6]) & PF_EXITING) !== 0;
  const entry3 = {
    pid,
    ppid: Number(fields[1]),
    pgrp: Number(fields[2]),
    start: Number(fields[19])
  };
  return { ...entry3, dying, zombie };
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
      Number(readFileSync2("/proc/uptime", "utf8").split(" ")[0]) * TICKS_PER_SECOND
    );
  } catch {
    return 0;
  }
}

// src/core/presence/heartbeat.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
var DAEMON_START_GRACE_MS = 1e4;
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
function claimLiveness(now) {
  return { now, graceIntervals: HEARTBEAT_GRACE_INTERVALS };
}
function daemonLiveness(record, now, lastHeartbeatAt = null) {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (heartbeatFresh(record, now)) return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  return { state: "down", since: record.heartbeatAt };
}
function worktreeLiveness(worktree, now) {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
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
function startMarkFor(lockFile) {
  return `${lockFile}.starting`;
}
function spawnMarkFor(lockFile) {
  return `${lockFile}.spawned`;
}
function readLockMarks(lockFile, now) {
  return {
    start: once(() => {
      const pid = markedPid(lockFile);
      return pid === null ? null : { pid, since: writtenAt(startMarkFor(lockFile), now) };
    }),
    spawnedAt: once(() => spawnedAt(lockFile))
  };
}
function startOf(marks, now, heartbeatAt = null) {
  const start = marks.start();
  if (start !== null) return { kind: "locked", since: start.since, pid: start.pid };
  const at = marks.spawnedAt();
  if (at === null || Math.abs(now - at) > DAEMON_START_GRACE_MS) return null;
  return heartbeatAt !== null && heartbeatAt >= at ? null : { kind: "spawned", since: at };
}
function spawnedAt(lockFile) {
  try {
    const mark = JSON.parse(readFileSync3(spawnMarkFor(lockFile), "utf8"));
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
    mark = JSON.parse(readFileSync3(startMarkFor(lockFile), "utf8"));
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
function readStop(store, worktreeId) {
  const text2 = store.meta.get(stoppedMetaKey(worktreeId));
  if (text2 === null) return null;
  try {
    const mark = JSON.parse(text2);
    if (!isRecord(mark) || typeof mark.at !== "number") return null;
    return {
      at: mark.at,
      tree: typeof mark.tree === "string" ? mark.tree : null,
      ...mark.untilStart === true ? { untilStart: true } : {}
    };
  } catch {
    return null;
  }
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
function readPresenceFacts(store, worktreeId, now, row) {
  const worktree = once(() => row === void 0 ? store.worktrees.get(worktreeId) : row);
  const self = once(() => daemonIncarnation(worktree()?.daemon ?? null));
  const exitNote = once(() => {
    const incarnation = self();
    if (incarnation === null) return void 0;
    return readDaemonNotes(store, worktreeId).find((n) => n.exitOf === incarnation);
  });
  const lockFile = once(() => {
    const w = worktree();
    return w === null ? null : lockFileFor(w.commonDir, w.id);
  });
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
    stop: once(() => readStop(store, worktreeId)),
    feedDelivered: once(() => readFeedDelivered(store, worktreeId)),
    marks: once(() => {
      const file = lockFile();
      return file === null ? null : readLockMarks(file, now);
    }),
    lockFree: once(() => {
      const file = lockFile();
      return file !== null && lockFree(file);
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
  const heartbeat = row.daemon?.heartbeatAt ?? row.lastHeartbeatAt ?? Number.POSITIVE_INFINITY;
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

// src/core/presence/findings.ts
function liveOf(facts, at) {
  const row = facts.row();
  return daemonLiveness(row?.daemon ?? null, at, row?.lastHeartbeatAt ?? null);
}
function startCurrentOf(marks, record) {
  return marks?.kind === "locked" || marks?.kind === "spawned" && record === null;
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
function startOfMarks(facts, record, down, stopping, marks) {
  if (!down || facts.row() === null) return null;
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
function lateOf(facts, record, heartbeat, stopping, at) {
  if (heartbeat.state !== "alive" || record === null || stopping() !== null) return null;
  const since = facts.feedDelivered();
  if (since === null || since < record.startedAt || at - since <= FEED_LATE_MS) return null;
  return { since };
}

// src/core/presence/decide.ts
function readPresence(store, worktreeId, now, row) {
  return decidePresence(readPresenceFacts(store, worktreeId, now, row), now);
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
  const startCurrent = once(() => startCurrentOf(marks(), record()));
  const stop = once(() => heldStop(facts, heartbeat()));
  const stopped = once(() => !startCurrent() && stop() !== null);
  const stopping = once(() => stoppingOf(facts, record(), shutDown, heartbeat(), marks, at));
  const start = once(() => startOfMarks(facts, record(), down(), stopping, marks));
  const died = once(() => {
    if (!down() || record() === null || shutDown() || marks() !== null) return null;
    return facts.lockFree() ? { runs: facts.inFlight() } : null;
  });
  const rest = once(() => restOf(facts, at));
  const short = once(() => shortOf(facts, record(), shutDown, heartbeat()));
  const late = once(() => lateOf(facts, record(), heartbeat(), stopping, at));
  const heartbeatLate = once(() => {
    const daemon = record();
    if (!down() || daemon === null || shutDown() || start() !== null || stopped()) return null;
    return died() === null ? { ageMs: at - daemon.heartbeatAt } : null;
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
      return startCurrent();
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
  "change feed late"
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
function statusView(p) {
  if (p.heartbeat.state === "alive") return aliveView(p, p.heartbeat);
  return withLateHeartbeat(p, withRecordFacts(p, withStop(p, p.heartbeat)));
}
function headerView(p, told) {
  if (p.heartbeat.state === "alive") return aliveView(p, p.heartbeat);
  const rested = withRest(p, withStop(p, p.heartbeat));
  const live = withLateHeartbeat(p, withRecordFacts(p, rested));
  return told === void 0 ? live : withToldStart(live, told, p.at);
}
function newsChange(p, told) {
  const live = newsView(p, told);
  let forgetRest2 = false;
  if (live.state === "down" && live.stopped !== true) {
    if (live.startingSince !== void 0) return { change: null, forgetRest: forgetRest2 };
    if (p.rest?.kind === "quiet") return { change: null, forgetRest: forgetRest2 };
    forgetRest2 = p.rest?.kind === "overdue";
  }
  return { change: alreadyTold(told, toldOf(live)) ? null : live, forgetRest: forgetRest2 };
}
function withToldStart(live, told, at) {
  if (live.state === "alive" || typeof told !== "object" || !("startingSince" in told)) return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  const { heartbeatLate: _late, ...starting } = withoutStop(live);
  return { ...starting, startingSince };
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
  if (live.startingSince !== void 0) return { state: "starting", notes: died };
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
function withRecordFacts(p, live) {
  if (p.facts.row() === null) return live;
  if (p.record === null) {
    const stopping2 = p.stopping;
    if (stopping2 !== null) return { ...live, stopping: stopping2 };
    if (live.stopped === true || live.startingSince !== void 0) return live;
    return withStart(live, p.start);
  }
  if (!p.shutDown) {
    const start2 = p.start;
    if (start2 !== null) return withStart(live, start2);
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
  const stopped = live.startingSince === void 0 ? withStop(p, live) : live;
  if (p.facts.row() === null) return stopped;
  if (p.record === null) {
    const stopping2 = p.stopping;
    if (stopping2 !== null) return { ...stopped, stopping: stopping2 };
    if (stopped.stopped === true || stopped.startingSince !== void 0) return stopped;
    return withStart(stopped, p.start);
  }
  if (!p.shutDown) {
    if (stopped.startingSince !== void 0) return stopped;
    const marks = p.marks;
    if (marks?.kind === "locked")
      return { ...stopped, startingSince: marks.since, startMark: "start" };
    if (stopped.stopped === true) return stopped;
    const died = p.died();
    return died === null ? withLateHeartbeat(p, stopped) : { ...stopped, died };
  }
  const start = p.start;
  if (start !== null) return withStart(stopped, start);
  const stopping = p.stopping;
  return stopping === null ? stopped : { ...stopped, stopping };
}

// src/core/keys/reverse-index.ts
function testFileId(ref2) {
  return `${ref2.project}\0${ref2.path}`;
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
function firstLine(text2) {
  const line = stripVTControlCharacters(text2).split(/\r?\n/).find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}
function normalize(line) {
  return VOLATILE.reduce((text2, [rule, replacement]) => {
    const pattern = typeof rule === "function" ? rule() : rule;
    return typeof replacement === "string" ? text2.replace(pattern, replacement) : text2.replace(pattern, replacement);
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
function describeFailure(errors, fallback2) {
  const first = errors[0];
  if (first === void 0) {
    return { fingerprint: `fail @ ${where(fallback2)}`, summary: "failed without an error message" };
  }
  const line = firstLine(first.message);
  const location2 = first.location ?? fallback2;
  const more = errors.length - 1;
  const text2 = withCauses(
    `${PHASE_PREFIX[first.phase ?? "load"]}${withCode(line === "" ? first.name : line, first.code)}`,
    first.causes ?? []
  );
  const summary = more > 0 ? `${text2} (${more} more error${more === 1 ? "" : "s"})` : text2;
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

// src/core/state/slow-text.ts
function holdsText(maxHolds) {
  return maxHolds === void 0 || maxHolds <= 1 ? "once" : `up to ${maxHolds} times in a turn`;
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
function pendingAt(testFile, key) {
  const id = testFileId(testFile);
  return (r) => r.end === null && r.key === key && testFileId(r.testFile) === id;
}
function isRecord2(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  const ref2 = v.testFile;
  return typeof v.id === "string" && typeof ref2 === "object" && ref2 !== null && typeof ref2.project === "string" && typeof ref2.path === "string" && typeof v.key === "string" && typeof v.session === "string" && RETRY_REASONS.includes(v.reason) && typeof v.askedAt === "number" && typeof v.askedIn === "string" && (v.claim === null || typeof v.claim === "object") && (v.end === null || typeof v.end === "object");
}

// src/core/retry/gate.ts
var LOAD_RETRY_WAIT_MS = 6e5;
function gateClosedSince(records) {
  const times = records.flatMap(
    (r) => typeof r.gateClosedAt === "number" ? [r.gateClosedAt] : []
  );
  return times.length === 0 ? null : Math.min(...times);
}

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

// src/core/retry/text.ts
function waitedText(ms) {
  return durationText(ms, Math.floor);
}
var BOUND_TEXT = waitedText(LOAD_RETRY_WAIT_MS);

// src/core/status/checks.ts
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

// src/core/delivery/harness-process.ts
import { readFileSync as readFileSync4, readlinkSync } from "node:fs";

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
    text2 = readFileSync4(`/proc/${pid}/stat`, "utf8");
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
function isCommandHold(entry3) {
  if (!isRecord(entry3)) return false;
  const { token, since, until, command, wrapper, child } = entry3;
  return typeof token === "string" && typeof since === "number" && typeof until === "number" && typeof command === "string" && (wrapper === null || toHarness(wrapper) !== void 0) && (child === null || toHarness(child) !== void 0);
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
function claimantOf(store, worktreeId, ref2, key, now) {
  if (!store.testFileKeys.claimed(worktreeId, key, claimLiveness(now))) return null;
  const id = testFileId(ref2);
  for (const worktree of store.worktrees.list()) {
    if (worktree.id === worktreeId || worktree.daemon === null) continue;
    if (!heartbeatFresh(worktree.daemon, now)) continue;
    const row = store.testFileKeys.list(worktree.id, [ref2])[0];
    if (row?.key !== key || row.pending !== "running") continue;
    const runs = store.runs.inFlight(worktree.id, worktree.daemon.startedAt);
    const run2 = runs.find((r) => r.testFiles.some((f) => testFileId(f) === id)) ?? null;
    return { worktree, run: run2 };
  }
  return null;
}

// src/core/status/holds.ts
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
  const commands2 = readCommandHolds(store, worktree.id).sort((a, b) => a.since - b.since).map((entry3) => {
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
  return [...merge2, ...commands2];
}

// src/core/status/ignored-config.ts
import { isDeepStrictEqual } from "node:util";

// src/core/daemon/version.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var PACKAGE_NAME = "squeal";
function squealVersion() {
  if (true) return "0.1.478";
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}
function manifestVersion(module) {
  let dir = dirname3(fileURLToPath(module));
  for (; ; ) {
    const version = readVersion(join3(dir, "package.json"));
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

// src/core/status/git-head.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { join as join5 } from "node:path";

// src/core/fs/git-layout.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2, lstatSync, readFileSync as readFileSync6, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute3, join as join4, resolve } from "node:path";
var GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
function findWorktreeRoot(path) {
  let dir = resolve(path);
  if (existsSync2(dir)) dir = realpathSync2(dir);
  for (; ; ) {
    if (existsSync2(join4(dir, ".git"))) return dir;
    const parent2 = dirname4(dir);
    if (parent2 === dir) return null;
    dir = parent2;
  }
}
function worktreeIdFor(root) {
  return worktreeIdOfRealPath(realpathSync2(root));
}
function worktreeIdOfRealPath(realPath2) {
  return createHash2("sha256").update(realPath2).digest("hex").slice(0, 16);
}
function gitDirOf(root) {
  return dotGit(root)?.gitDir ?? null;
}
function resolveCommonDir(root) {
  const entry3 = dotGit(root);
  if (entry3 === null) return null;
  if (!entry3.isFile) return realpathSync2(entry3.gitDir);
  const { gitDir } = entry3;
  if (lstatOrNull(gitDir) === null) return null;
  const commondirFile = join4(gitDir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync2(gitDir);
  const commondir = readFileSync6(commondirFile, "utf8").trim();
  const common = isAbsolute3(commondir) ? commondir : resolve(gitDir, commondir);
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
  const path = join4(root, ".git");
  const stat = lstatOrNull(path);
  if (stat === null) return null;
  if (stat.isDirectory()) return { gitDir: path, isFile: false };
  if (!stat.isFile()) return null;
  const match = GITDIR_LINE.exec(readFileSync6(path, "utf8"));
  return match?.[1] ? { gitDir: resolve(root, match[1]), isFile: true } : null;
}

// src/core/status/git-head.ts
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = gitDirOf(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read(join5(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref2 = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref2 === void 0) return null;
    value = read(join5(gitDir, ref2)) ?? read(join5(commonDir, ref2)) ?? packed(commonDir, ref2);
  }
  return null;
}
function packed(commonDir, ref2) {
  for (const line of (read(join5(commonDir, "packed-refs")) ?? "").split("\n")) {
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

// src/core/keys/runtime-applied.ts
function runtimeFilesMetaKey(worktreeId) {
  return worktreeMetaKey("runtimeFiles", worktreeId);
}
function runtimePolicySignature(policy) {
  const rules = policy.runtimeFiles.map(
    (rule) => JSON.stringify([
      rule.project,
      [...new Set(rule.tests)].sort(),
      [...new Set(rule.paths)].sort()
    ])
  );
  return JSON.stringify([[...new Set(rules)].sort(), policy.inputs]);
}

// src/core/status/runtime-files.ts
function runtimeFilesStatus(store, worktreeId, root) {
  const policy = loadPolicy(root).policy;
  let applied;
  try {
    const raw = store.meta.get(runtimeFilesMetaKey(worktreeId));
    if (raw !== null) {
      const parsed2 = JSON.parse(raw);
      if (isRecord(parsed2) && typeof parsed2.signature === "string" && Array.isArray(parsed2.readers) && Array.isArray(parsed2.notes))
        applied = parsed2;
    }
  } catch {
  }
  if (policy.runtimeFiles.length === 0 && !applied?.readers.length) return void 0;
  const rows = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row.key])
  );
  const readers = applied?.readers ?? [];
  return {
    pending: applied?.signature !== runtimePolicySignature(policy) || readers.some(
      (reader) => !reader.verified || rows.get(testFileId(reader.testFile)) !== reader.key
    ),
    readers,
    notes: applied?.notes ?? []
  };
}

// src/core/status/stopping.ts
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);

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
  const entries = value.filter(isEntry).map(knownCause);
  return new Map(entries.map((e) => [testFileId(e.testFile), e]));
}
var CAUSES = ["timeout", "install", "runner", "setup"];
function isEntry(value) {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return typeof value.testFile.path === "string" && typeof value.testFile.project === "string" && (value.key === null || typeof value.key === "string") && typeof value.reason === "string" && typeof value.ran === "boolean" && Array.isArray(value.samples) && value.samples.every((p) => typeof p === "string") && typeof value.revision === "number" && typeof value.at === "number";
}
function knownCause(entry3) {
  if (entry3.cause === void 0 || CAUSES.includes(entry3.cause)) return entry3;
  const { cause: _cause, ...rest } = entry3;
  return rest;
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
  const files = unknown.sort((a, b) => testFileId(a.testFile).localeCompare(testFileId(b.testFile))).slice(0, UNKNOWN_FILES_LISTED).map((row) => reasons.of(row, checks.get(testFileId(row.testFile)) ?? []));
  return { unknownTestFiles: { total: unknown.length, files } };
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

// src/core/status/test-frame.ts
var V8_FRAME = /^\s*at (.+?)\s*$/;
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
    const entry3 = PYTEST_ENTRY.exec(text2) ?? NATIVE_ENTRY.exec(text2);
    return entry3 === null ? [] : [{ path: entry3[1], line: Number(entry3[2]) }];
  });
}
function prefixOf(found2, location2) {
  const named3 = found2.find(
    (p) => p.line === location2.line && (p.column === void 0 || p.column === location2.column) && (p.path === location2.path || location2.path.endsWith(`/${p.path}`))
  );
  return named3 === void 0 ? null : location2.path.slice(0, -named3.path.length);
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
function uncountableFiles(store, worktreeId, files) {
  const failed2 = readUncountable(store.meta, worktreeId);
  const spent = /* @__PURE__ */ new Map();
  if (failed2.size === 0) return spent;
  for (const file of files) {
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
function failingOf(store, worktreeId, measures) {
  return measures.flatMap((measure2) => store.states.list(worktreeId, { measure: measure2, outcome: "fail" }));
}
function evidenceOf(store, worktreeId, entry3) {
  if (entry3.measure === "complexity" || entry3.kind === "removed") return {};
  const [file] = store.files.list(worktreeId, [entry3.check.path]);
  const evidence = readEvidence(store.meta, worktreeId, entry3.check.path);
  const fn = evidence?.functions[functionKey(entry3.check)];
  if (file === void 0 || fn === void 0) return {};
  const count2 = store.counts.get(file.blob, file.language, file.counterVersion);
  const counted = count2?.functions.find(
    (f) => f.qualifiedName === entry3.check.qualifiedName && f.occurrence === entry3.check.occurrence
  );
  if (counted === void 0) return {};
  const [lines, covered, testFiles, ...first] = fn;
  const children = readSummary(store.meta, worktreeId)?.children === true ? { children: true } : {};
  return {
    evidence: { complexity: counted.complexity, lines, covered, testFiles, first, ...children }
  };
}
var isCoverage = (entry3) => entry3.measure !== "complexity";

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
    const { write: write2, removal, entry: entry3 } = stateStep(state, before, input);
    if (write2 !== void 0) writes.push(write2);
    if (removal !== void 0) removals.push(removal);
    if (entry3 !== void 0) entries.push(entry3);
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
  const sorted = entries.map((entry3, i) => ({ entry: entry3, i })).sort((a, b) => RANK[a.entry.kind] - RANK[b.entry.kind] || a.i - b.i).map(({ entry: entry3 }) => entry3);
  return { entries: sorted, writes, removals };
}

// src/runners/node-test/describe.ts
var UNCONFIGURED = { nodeTest: [] };
var NODE_TEST = {
  runner: "node-test",
  name: "node:test",
  fallback: false,
  unconfigured: UNCONFIGURED,
  projects: (policy) => policy.nodeTest,
  coverage: ({ projects: projects2 }) => ({ nodeTest: projects2 }),
  built: (coverage) => coverage.nodeTest.length > 0,
  covered: (coverage) => ({ projects: coverage.nodeTest }),
  excluded: () => null,
  context: (policy, _root, _cwd) => ({ nodeTest: policy.nodeTest }),
  command: (words, context) => context.atRoot === false ? null : nodeTestCommand(words, context.nodeTest),
  resolves: () => true,
  files: (command, listing) => command.runner === "node-test" ? nodeTestFiles(command, listing) : null,
  slowProjects: (policy) => policy.nodeTest
};
function nodeTestCommand(words, projects2) {
  const at = words.indexOf("--test");
  if (at === -1) return null;
  const argv = words.slice(1, at);
  const args = words.slice(at + 1);
  if (args.length === 0) return null;
  const project = projects2.find(
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
  const files = command.files.map((file) => byPath.get(listing.pathOf(file) ?? ""));
  return files.every((ref2) => ref2 !== void 0) ? [...new Set(files)] : null;
}

// src/runners/pytest/describe.ts
import { realpathSync as realpathSync3 } from "node:fs";
import { join as join8, resolve as resolve3 } from "node:path";

// src/runners/pytest/environment/discover.ts
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync8, statSync as statSync2 } from "node:fs";
import { basename as basename2, dirname as dirname5, isAbsolute as isAbsolute5, join as join7, relative as relative2, resolve as resolve2 } from "node:path";

// src/core/fs/paths.ts
import { isAbsolute as isAbsolute4, join as join6, relative, sep } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute4(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
function toAbsolute(root, rel) {
  return join6(root, ...rel.split("/"));
}

// src/runners/pytest/environment/discover.ts
function projectDir(root, project) {
  return project.cwd === void 0 ? root : toAbsolute(root, project.cwd);
}
function discoverEnvironment(root, project) {
  const cwd = projectDir(root, project);
  if (project.python !== void 0) {
    const declared = resolve2(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join7(declared, "bin", "python"));
    if (existsSync3(declared)) return found("declared", dirname5(dirname5(declared)), declared);
    const target = basename2(declared).startsWith("python") ? dirname5(dirname5(declared)) : declared;
    return none(root, cwd, [declared], target);
  }
  const venv = join7(cwd, ".venv");
  if (existsSync3(join7(venv, "pyvenv.cfg"))) return found("venv", venv, join7(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname5(dirname5(pdm)), pdm);
  return none(root, cwd, [venv, join7(cwd, ".pdm-python")], venv);
}
function found(source, env, python) {
  return { kind: "found", source, env, python };
}
function pdmPython(root, cwd) {
  let text2;
  try {
    text2 = readFileSync8(join7(cwd, ".pdm-python"), "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!isAbsolute5(text2) || toRelative(root, text2) === null || !existsSync3(text2)) return null;
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
  for (let dir = cwd; ; dir = dirname5(dir)) {
    dirs.push(dir);
    if (toRelative(root, dir) === null) break;
  }
  for (const dir of dirs) {
    const hit = LOCKFILES.find(([file]) => existsSync3(join7(dir, file)));
    if (hit !== void 0)
      return { kind: "none", looked, command: hit[1], from: join7(dir, hit[0]) };
  }
  for (const dir of dirs) {
    const files = requirementsIn(dir).map((file) => join7(dir, file));
    if (files.length === 0) continue;
    const install = files.map((file) => `-r ${relative2(cwd, file)}`).join(" ");
    const command = `python -m venv ${venv} && ${venv}/bin/pip install ${install}`;
    return { kind: "none", looked, command, from: files[0] };
  }
  return { kind: "none", looked, command: `python -m venv ${venv}`, from: null };
}
function requirementsIn(dir) {
  let names2;
  try {
    names2 = readdirSync3(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names2.filter((name2) => REQUIREMENTS.test(name2)).sort();
}
function isDirectory(path) {
  try {
    return statSync2(path).isDirectory();
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
  coverage: ({ projects: projects2 }) => ({ pytest: projects2 }),
  built: (coverage) => (coverage.pytest?.length ?? 0) > 0,
  covered: (coverage) => ({ projects: coverage.pytest ?? [] }),
  excluded: () => null,
  context: (policy, root, cwd) => ({ pytest: pytestHere(root, cwd, policy.pytest) }),
  command: (words, context) => pytestCommand(words, context.pytest ?? []),
  resolves: () => true,
  files: (command, listing) => command.runner === "pytest" ? pytestFiles(command, listing) : null,
  // `slowFiles` and `slowGlobs` read `pytest[].slow` from the policy itself (004 D1, 007 D1; row 019-10).
  slowProjects: () => []
};
function pytestHere(root, cwd, projects2) {
  return projects2.flatMap((project) => {
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
    return realpathSync3(resolve3(path));
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
    paths.push(resolve3(dir, path));
  }
  return { runner: "pytest", project: project.name, paths: paths.length === 0 ? null : paths };
}
function invocation(words, dir, env) {
  const [first, second, third] = words;
  const inEnv = (name2) => env !== null && first?.includes("/") === true && resolve3(dir, first) === join8(env, "bin", name2);
  if (first === "pytest" || inEnv("pytest")) return 1;
  if (first === "uv" && second === "run" && third === "pytest") return 3;
  if ((first === "python" || inEnv("python")) && second === "-m" && third === "pytest") return 3;
  return null;
}
function pytestFiles(command, listing) {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref2) => ref2.project === command.project);
  const named3 = new Set(command.paths.map((path) => listing.pathOf(path)));
  if (![...named3].every((rel) => own.some((ref2) => ref2.path === rel))) return null;
  return own.filter((ref2) => named3.has(ref2.path));
}

// src/runners/vitest/describe.ts
import { existsSync as existsSync4, readFileSync as readFileSync10 } from "node:fs";
import { isAbsolute as isAbsolute6, join as join10, relative as relative3, resolve as resolve4 } from "node:path";

// src/core/daemon/runner.ts
import { readdirSync as readdirSync4, readFileSync as readFileSync9 } from "node:fs";
import { join as join9, posix as posix3 } from "node:path";

// src/core/types/runner-traits.ts
function declareTraits(stated = {}) {
  const { omittedTestFiles, slowWidth, tierWidth, tierPart, besideBacklog, backlogSlot: backlogSlot2 } = stated;
  const { focuses, lane } = stated;
  return {
    omittedTestFiles: () => omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => Math.max(1, slowWidth?.(testFiles) ?? testFiles.length),
    tierWidth: (testFile, grant) => Math.max(1, tierWidth?.(testFile, grant) ?? grant),
    tierPart: (testFile) => tierPart?.(testFile) ?? "",
    besideBacklog: (testFile) => besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => {
      const files = backlogSlot2?.(testFile) ?? null;
      return files === null ? null : Math.max(1, Math.floor(files));
    },
    focuses: (testFile) => focuses?.(testFile) ?? false,
    lane: (testFile) => lane?.(testFile) ?? ""
  };
}
var NO_TRAITS = declareTraits();

// src/core/daemon/runner.ts
var VITEST_CONFIG = /^(vitest\.(config|workspace|projects)|vite\.config)\.[cm]?[jt]s$/;
function vitestDetected(root) {
  let names2;
  try {
    names2 = readdirSync4(root);
  } catch {
    return false;
  }
  if (names2.some((name2) => VITEST_CONFIG.test(name2))) return true;
  return listsVitest(readManifest(join9(root, "package.json")));
}
function runsVitest(root, policy) {
  return policy.nodeTest.length + policy.pytest.length === 0 || vitestDetected(root);
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
    return JSON.parse(readFileSync9(path, "utf8"));
  } catch {
    return null;
  }
}

// src/runners/vitest/describe.ts
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
  const selected = /* @__PURE__ */ new Set();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref2) => matchesFilter(join10(root, ref2.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref2 of hits) selected.add(ref2);
  }
  return vitest.filter((ref2) => selected.has(ref2));
}
function matchesFilter(file, filter, root) {
  if (isAbsolute6(filter) && file.startsWith(filter)) return true;
  const testFile = relative3(root, file).toLocaleLowerCase();
  const rel = relative3(root, resolve4(root, filter));
  const relativePath = filter.endsWith("/") ? join10(rel, "/") : rel;
  return testFile.includes(filter.toLocaleLowerCase()) || testFile.includes(relativePath.toLocaleLowerCase());
}
function rootScripts(root) {
  try {
    const manifest = JSON.parse(readFileSync10(join10(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text2]) => typeof text2 === "string")
    );
  } catch {
    return {};
  }
}
function configFile(root) {
  for (const name2 of CONFIG_NAMES) {
    for (const extension of CONFIG_EXTENSIONS) {
      if (existsSync4(join10(root, `${name2}${extension}`))) return `${name2}${extension}`;
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

// src/core/code/coverage/runtime.ts
var RECORDING_RUNNERS = /* @__PURE__ */ new Set(["vitest", "node-test"]);
function coverageOn(policy) {
  return policy.coverage.enabled && policy.complexity.enabled;
}

// src/core/delivery/code-runners.ts
function notMeasuredNames(policy) {
  if (!coverageOn(policy)) return [];
  return DESCRIPTIONS.filter(
    (d) => !RECORDING_RUNNERS.has(d.runner) && d.projects(policy).length > 0
  ).map((d) => d.name);
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

// src/core/commit/report.ts
var isFailedReport = (report) => "failed" in report;
var isCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function countsOf(raw, keys) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  return keys.every((key) => isCount(value[key])) ? value : null;
}
var TEST_KEYS = ["files", "failures", "notDetermined", "running", "unknown"];
var LINT_KEYS = ["findings", "notDetermined", "running"];
function parseCommitReport(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  const { commit, revision, at } = value;
  if (typeof commit !== "string" || !isCount(revision) || !isCount(at)) return null;
  const base = { commit, revision, at };
  if (typeof value.failed === "string") return { ...base, failed: value.failed };
  const tests2 = countsOf(value.tests, TEST_KEYS);
  if (tests2 === null) return null;
  const pick = (counts, keys) => Object.fromEntries(keys.map((key) => [key, counts[key]]));
  const lint2 = value.lint === void 0 ? void 0 : countsOf(value.lint, LINT_KEYS);
  if (lint2 === null) return null;
  const waiting = waitingOf(value.waiting);
  const { from } = value;
  const { untracked, unanswered, notDeterminedFiles } = value.tests;
  const files = notDeterminedOf(notDeterminedFiles);
  return {
    ...base,
    ...typeof from === "string" ? { from } : {},
    tests: {
      ...pick(tests2, TEST_KEYS),
      ...isCount(untracked) && untracked > 0 ? { untracked } : {},
      ...isCount(unanswered) && unanswered > 0 ? { unanswered } : {},
      ...files.length > 0 ? { notDeterminedFiles: files } : {}
    },
    ...lint2 === void 0 ? {} : { lint: pick(lint2, LINT_KEYS) },
    ...waiting === null ? {} : { waiting },
    ...value.updated === true ? { updated: true } : {}
  };
}
var isText = (value) => typeof value === "string";
function entriesOf(raw, keys) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry3) => {
    if (typeof entry3 !== "object" || entry3 === null) return [];
    const value = entry3;
    if (!keys.every((key) => isText(value[key]))) return [];
    return [Object.fromEntries(keys.map((key) => [key, value[key]]))];
  });
}
function waitingOf(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw;
  const tests2 = entriesOf(value.tests, ["project", "path", "key"]);
  const lint2 = entriesOf(value.lint, ["tool", "path", "blob"]);
  return tests2.length === 0 && lint2.length === 0 ? null : { tests: tests2, lint: lint2 };
}
function notDeterminedOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry3) => {
    if (typeof entry3 !== "object" || entry3 === null) return [];
    const { project, path, through, more, deleted, unanswered } = entry3;
    if (!isText(project) || !isText(path)) return [];
    if (!Array.isArray(through) || !through.every(isText)) return [];
    const silent = Array.isArray(unanswered) ? through.filter((p) => unanswered.includes(p)) : [];
    return [
      {
        project,
        path,
        through: [...through],
        ...isCount(more) && more > 0 ? { more } : {},
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
var commitText = (commit) => commit.slice(0, 7);
function commitReportText(report) {
  const head = `Commit ${commitText(report.commit)}`;
  if (isFailedReport(report)) return `${head}: no report (${report.failed})`;
  const { tests: tests2, lint: lint2 } = report;
  const parts = [plural(tests2.failures, "known failure")];
  if (lint2 !== void 0) {
    const more = [
      ...lint2.notDetermined > 0 ? [`${plural(lint2.notDetermined, "file")} not determined`] : [],
      ...lint2.running > 0 ? [`${plural(lint2.running, "file")} still running`] : []
    ];
    parts.push([`lint ${plural(lint2.findings, "finding")}`, ...more].join(", "));
  }
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
function commitLine(report) {
  const line = { commit: report.commit, text: commitReportText(report) };
  if (isFailedReport(report)) return line;
  const { notDetermined: count2, notDeterminedFiles: files = [] } = report.tests;
  return count2 > 0 && files.length > 0 ? { ...line, notDetermined: { count: count2, files } } : line;
}

// src/core/slow/classify.ts
import { posix as posix4 } from "node:path";
function slowFiles(policy, projects2) {
  const matches2 = createInputMatcher(policy.slow.include);
  const slowProjects = new Set(
    marked(policy, projects2).map((project) => project.name)
  );
  return (testFile) => slowProjects.has(testFile.project) || matches2(testFile.path);
}
function slowGlobs(policy, projects2) {
  const globs4 = [...policy.slow.include];
  for (const project of marked(policy, projects2)) {
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs4.push(posix4.join(cwd, glob));
  }
  return globs4;
}
function marked(policy, projects2) {
  return [...projects2, ...policy.pytest].filter((project) => project.slow === true);
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
var views = /* @__PURE__ */ new WeakMap();
function slowView(policy) {
  let view = views.get(policy);
  if (view === void 0) {
    const globs4 = slowGlobs(policy, policy.nodeTest);
    const groups2 = groupView(policy);
    view = {
      isSlow: (ref2) => groups2.of(ref2).name !== TESTS_GROUP,
      globs: globs4,
      declared: globs4.length > 0
    };
    views.set(policy, view);
  }
  return view;
}
function laneFor(policy, ref2, runnerLane) {
  return groupLane(groupView(policy).of(ref2).name, runnerLane);
}

// src/core/daemon/client.ts
import { statSync as statSync3 } from "node:fs";
import { createConnection } from "node:net";
function endpointAt(socketPath) {
  try {
    const { dev, ino, ctimeNs, birthtimeNs } = statSync3(socketPath, { bigint: true });
    return { dev, ino, ctimeNs, birthtimeNs };
  } catch {
    return null;
  }
}
function sameEndpoint(a, b) {
  return a !== null && a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs && a.birthtimeNs === b.birthtimeNs;
}
function requestDaemon(socketPath, request, timeoutMs, endpoint) {
  return new Promise((resolve7, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled3 = false;
    const settle = (error, response) => {
      if (settled3) return;
      settled3 = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve7(response);
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

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

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
function readGroupActivity(store, worktreeId, group) {
  if (group === SLOW_GROUP) return readSlowActivity(store, worktreeId);
  return toSlowActivity(groupEntries(store.meta.get(groupTiersMetaKey(worktreeId)))[group] ?? null) ?? null;
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
function worktreeSlowView(store, worktreeId) {
  const root = store.worktrees.get(worktreeId)?.root;
  return root === void 0 ? null : slowPolicyView(readPolicy(root));
}
function classifySlowFiles(states, keys, isSlow) {
  const checks = laneChecks(states, isSlow);
  const files = /* @__PURE__ */ new Map();
  for (const row of keys) {
    if (!isSlow(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const cls = own.length === 0 ? row.key !== null && row.pending !== null ? "pending" : "notRun" : own.some((s) => s.validity === "pending") ? "pending" : own.every((s) => s.validity === "current") ? "current" : "notRun";
    files.set(id, { ref: row.testFile, class: cls });
  }
  return files;
}
function laneChecks(states, inLane) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    const ref2 = testFileOf(state.check);
    if (!inLane(ref2)) continue;
    const id = testFileId(ref2);
    checks.set(id, [...checks.get(id) ?? [], state]);
  }
  return checks;
}
function readSlowTier(store, worktreeId, states, keys, view) {
  return {
    ...readLane(store, worktreeId, states, keys, view.isSlow, SLOW_GROUP),
    ...view.stopWaitMs === null ? {} : { stopWaitMs: view.stopWaitMs },
    ...view.stopWaitMs === null || view.maxHolds === 1 ? {} : { maxHolds: view.maxHolds },
    ...view.pausesOnly ? { pausesOnly: true } : {}
  };
}
function readLane(store, worktreeId, states, keys, inLane, group, classify2 = classifySlowFiles) {
  const files = classify2(states, keys, inLane);
  const counts = { current: 0, pending: 0, notRun: 0 };
  for (const { class: cls } of files.values()) counts[cls]++;
  let currentAt = null;
  let currentUpTo = null;
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    if (files.get(id)?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
    currentUpTo = Math.max(currentUpTo ?? state.observedAt, state.observedAt);
  }
  return {
    testFiles: files.size,
    ...counts,
    currentAt,
    ...currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {},
    activity: liveActivity(store, worktreeId, keys, inLane, group)
  };
}
function liveActivity(store, worktreeId, keys, inLane, group) {
  const activity = readGroupActivity(store, worktreeId, group);
  if (activity?.kind === "waiting") {
    if (activity.for !== "idle" || consumerInTurn(store, worktreeId)) return activity;
    const fast = keys.some((row) => row.pending !== null && !inLane(row.testFile));
    return fast ? { kind: "waiting", for: "fast" } : null;
  }
  if (activity === null) return null;
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
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
function consumerInTurn(store, worktreeId) {
  const turns = readAll(store, worktreeMetaKey("turn", worktreeId));
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
}

// src/core/state/groups.ts
function groupTextsShown(policy) {
  return policy.checks.length > 0;
}
function testsAtEdit(policy, listed4) {
  const view = groupView(policy);
  const owns = (name2) => listed4.some((row) => view.of(row.testFile).name === name2);
  return view.groups.some(
    (group) => group.at === "edit" && group.select.kind !== "lint" && (group.index !== null || group.name === TESTS_GROUP && listed4.length === 0 || owns(group.name))
  );
}
function readGroupTiers(store, worktreeId, states, keys, policy) {
  const view = groupView(policy);
  const waitMs = stopWaitBoundMs(policy);
  return view.groups.flatMap((group) => {
    if (group.index === null || group.select.kind !== "tests") return [];
    const inLane = (ref2) => view.of(ref2) === group;
    return [
      {
        name: group.name,
        at: group.at,
        after: group.after,
        quietMs: group.quietMs,
        ...readLane(store, worktreeId, states, keys, inLane, group.name, classifyGroupFiles),
        ...group.stopRequires ? { stopWaitMs: waitMs } : {}
      }
    ];
  });
}
function classifyGroupFiles(states, keys, inLane) {
  const checks = laneChecks(states, inLane);
  const files = /* @__PURE__ */ new Map();
  for (const row of keys) {
    if (!inLane(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const cls = fileClassOf(row, checks.get(id) ?? []);
    files.set(id, {
      ref: row.testFile,
      class: cls === "current" || cls === "pending" ? cls : "notRun"
    });
  }
  return files;
}
function inGroupLane(policy) {
  const view = groupView(policy);
  return (ref2) => view.of(ref2).name !== TESTS_GROUP;
}
function readCommitLine(store, worktreeId) {
  const report = newestCommitReport(store.meta, worktreeId);
  return report === null ? void 0 : commitLine(report);
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
function countStates(states) {
  const counts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const fileLevelCounts = { ...counts };
  let inheritedCount = 0;
  let inheritedFileLevelCount = 0;
  let importedCount = 0;
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    counts[state.validity]++;
    if (state.check.kind === "file") fileLevelCounts[state.validity]++;
    if (state.validity !== "current") continue;
    if (state.origin?.kind === "inherited") {
      inheritedCount++;
      if (state.check.kind === "file") inheritedFileLevelCount++;
    }
    if (state.origin?.kind === "imported") importedCount++;
  }
  return { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount };
}
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId), isSlow, openFiles2) {
  const latest = store.revisions.latest(worktreeId);
  const revision = latest?.number ?? 0;
  const commit = readRevisionCommit(store, worktreeId, latest);
  const { counts, fileLevelCounts, inheritedCount, inheritedFileLevelCount, importedCount } = countStates(states);
  const refinedRevision = readRefined(store, worktreeId);
  const missing = parseAwaitingInstall(store.meta.get(awaitingInstallMetaKey(worktreeId)));
  const awaiting2 = missing !== null;
  const last = store.checkpoints.lastCompletedFull(worktreeId);
  const lane = awaiting2 ? null : laneAfter(store.checkpoints.lastCompleted(worktreeId), last);
  const root = store.worktrees.get(worktreeId)?.root;
  const policy = root === void 0 ? null : readPolicy(root);
  const view = policy === null ? null : slowPolicyView(policy);
  const slow = isSlow ?? view?.isSlow;
  const optimizerOff = readOptimizerOff(store, worktreeId);
  const runnerPartPending = refinedRevision !== null && refinedRevision < revision;
  return {
    revision,
    ...commit === void 0 ? {} : { commit },
    counts,
    fileLevelCounts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    ...countNotCurrent(states, keys, openFiles2),
    fullSuite: {
      atCurrentRevision: !awaiting2 && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null,
      ...lane === null ? {} : { lane }
    },
    testFilesListed: keys.length > 0 || !awaiting2 && last !== null,
    inheritedCount,
    inheritedFileLevelCount,
    ...importedCount === 0 ? {} : { importedCount },
    refinedRevision,
    runnerPartPending,
    ...listingRunnersField(runnerPartPending, root, policy),
    ...slow === void 0 ? {} : { slowPending: countSlowPending(states, keys, slow) },
    ...slowTierField(store, worktreeId, states, keys, policy, view),
    ...policy !== null && groupTextsShown(policy) ? groupFields(store, worktreeId, states, keys, policy) : {},
    ...awaiting2 ? { awaitingInstall: true } : {},
    ...missing !== null && missing.length > 0 ? { missingInstalls: missing } : {},
    ...awaiting2 ? installCommandField(store, worktreeId) : {},
    ...optimizerOff === void 0 ? {} : { optimizerOff }
  };
}
function slowTierField(store, worktreeId, states, keys, policy, view) {
  if (policy === null || view === null) return {};
  const slowTier = readSlowTier(store, worktreeId, states, keys, view);
  const owned = slowTier.testFiles > 0 || keys.length === 0 || !groupTextsShown(policy);
  return owned ? { slowTier } : {};
}
function groupFields(store, worktreeId, states, keys, policy) {
  const commitLine2 = readCommitLine(store, worktreeId);
  return {
    groupTiers: readGroupTiers(store, worktreeId, states, keys, policy),
    lanePending: countSlowPending(states, keys, inGroupLane(policy)),
    ...testsAtEdit(policy, keys) ? {} : { noTestsAtEdit: true },
    ...commitLine2 === void 0 ? {} : { commitLine: commitLine2 }
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
  const files = /* @__PURE__ */ new Map();
  let checks = 0;
  for (const state of states) {
    const ref2 = testFileOf(state.check);
    if (state.validity !== "pending" || !isSlow(ref2)) continue;
    checks++;
    files.set(testFileKeyOf(state.check), ref2);
  }
  let testFilesWithoutChecks = 0;
  for (const row of keys) {
    const id = testFileId(row.testFile);
    if (withChecks.has(id) || !hasKey(row) || row.pending === null || !isSlow(row.testFile)) {
      continue;
    }
    testFilesWithoutChecks++;
    files.set(id, row.testFile);
  }
  const named3 = [...files.values()].sort((a, b) => a.path.localeCompare(b.path) || a.project.localeCompare(b.project)).slice(0, SLOW_FILES_NAMED);
  return {
    testFiles: files.size,
    checks,
    testFilesWithoutChecks,
    ...named3.length === 0 ? {} : { files: named3 }
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

// src/core/delivery/format.ts
var SQUEAL_COMMAND = "squeal";

// src/core/code/store/open.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync3 } from "node:fs";
import { join as join13 } from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/store/open.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync2, readFileSync as readFileSync11, renameSync, rmSync as rmSync2, writeFileSync } from "node:fs";
import { join as join12 } from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

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
function oneOf3(row, column, values) {
  const value = str(row, column);
  if (!values.includes(value)) {
    throw new TypeError(`squeal store: ${column} has unexpected value ${value}`);
  }
  return value;
}
function oneOfOrNull(row, column, values) {
  return row[column] === null ? null : oneOf3(row, column, values);
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
  const kind = oneOf3(row, "check_kind", ["test", "file", "setup"]);
  if (kind !== "test") return { kind, project, testPath };
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}
var OUTCOMES2 = ["pass", "fail", "skip"];
function toResult(row) {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf3(row, "outcome", OUTCOMES2),
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
function inTestFiles(column, files) {
  if (files.length === 0) return { sql: "0", params: [] };
  const values = files.map(() => "(?, ?)").join(", ");
  return {
    sql: `${column} IN (SELECT id FROM checks WHERE (project, test_path) IN (VALUES ${values}))`,
    params: files.flatMap((f) => [f.project, f.path])
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
import { existsSync as existsSync5, rmSync } from "node:fs";
import { join as join11, resolve as resolve5, sep as sep2 } from "node:path";

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
  return readMetaList(conn, REPLACED_META_KEY, isEntry2);
}
function keepReplaced(conn, failing, records, loadOf2) {
  if (failing.length === 0) return 0;
  const passes = new Map(
    records.filter((r) => r.outcome === "pass").map((r) => [identity(r.check), r])
  );
  const added = [];
  for (const { result, failureId } of failing) {
    const pass = passes.get(identity(result.check));
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
    const check = identity(entry3.check);
    const id = JSON.stringify([check, entry3.key, entry3.provenance.runId]);
    const count2 = perCheck.get(check) ?? 0;
    if (seen.has(id) || count2 >= REPLACED_PER_CHECK) continue;
    seen.add(id);
    perCheck.set(check, count2 + 1);
    kept2.push(entry3);
  }
  return kept2.reverse();
}
function identity(check) {
  return JSON.stringify(checkParams(check));
}
function isEntry2(value) {
  if (!isRecord(value) || !isRecord(value.check) || !isRecord(value.provenance)) return false;
  const { check, provenance: p, replacedBy: by } = value;
  return typeof check.project === "string" && typeof check.testPath === "string" && typeof check.kind === "string" && typeof value.key === "string" && typeof p.runId === "string" && typeof p.worktreeId === "string" && typeof p.revision === "number" && typeof p.recordedAt === "number" && typeof value.durationMs === "number" && (value.failureId === null || typeof value.failureId === "string") && (value.loadPerCpu === null || typeof value.loadPerCpu === "number") && isRecord(by) && typeof by.runId === "string" && typeof by.worktreeId === "string" && typeof by.recordedAt === "number";
}

// src/core/store/repos/unknown-runs.ts
var UNKNOWN_RUNS_META_KEY = "unknown-runs";
function readUnknownRuns(conn) {
  return readMetaList(conn, UNKNOWN_RUNS_META_KEY, isEntry3);
}
function recordUnknownRuns(conn, worktreeId, revision, marked2, at) {
  const added = marked2.flatMap(
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
function isEntry3(value) {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return typeof value.worktreeId === "string" && typeof value.testFile.project === "string" && typeof value.testFile.path === "string" && (value.runId === null || typeof value.runId === "string") && typeof value.revision === "number" && typeof value.reason === "string" && typeof value.at === "number";
}

// src/core/store/prune-rules.ts
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
  const toRecord2 = (row) => {
    const record = fromRow(row);
    const d = record.daemon;
    const token = d === null ? void 0 : tokenRowOf(record.id, d.startedAt, d.squealVersion);
    return token === void 0 || d === null ? record : { ...record, daemon: { ...d, ...token } };
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
  yield () => conn.transaction(() => expireReplaced(conn, cutoff));
  yield () => conn.transaction(() => dropFallenUnknownRuns(conn));
  yield* dropPrunable(conn, cutoff, counts);
  if (options.maxSizeMb !== null) {
    yield* evictToCap(conn, options.maxSizeMb * 1024 * 1024, counts);
  }
  yield* dropRuns(conn, paths, cutoff, counts);
  yield () => {
    counts.checkpointsRemoved += conn.transaction(
      () => conn.run(
        `DELETE FROM checkpoints
         WHERE id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
           AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
           AND (worktree_id NOT IN (SELECT id FROM worktrees)
                OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
        cutoff
      )
    );
  };
  yield () => {
    counts.checksRemoved += conn.transaction(
      () => conn.run(
        `DELETE FROM checks WHERE id NOT IN (
           SELECT check_id FROM results UNION SELECT check_id FROM known_states
           UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`
      )
    );
  };
  yield* vacuum(conn);
}
function isGone(root) {
  return !existsSync5(join11(root, ".git"));
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
        if (!isGone(worktree.root)) return;
        removed = conn.transaction(
          () => conn.run(
            `DELETE FROM ${table} WHERE worktree_id = ? AND ${key} IN (
               SELECT ${key} FROM ${table} WHERE worktree_id = ? LIMIT ?)`,
            worktree.id,
            worktree.id,
            DELETE_BATCH
          )
        );
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
    };
  }
}
function* dropPrunable(conn, cutoff, counts) {
  const ids = conn.read(() => conn.all(`SELECT rowid AS id FROM results WHERE ${PRUNABLE}`, cutoff)).map((row) => num(row, "id"));
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    yield () => {
      counts.resultsRemoved += conn.transaction(
        () => conn.run(
          `DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND ${PRUNABLE}`,
          batch,
          cutoff
        )
      );
    };
  }
  yield () => conn.transaction(() => dropOrphanFailureTexts(conn));
}
function* vacuum(conn) {
  let free = pragmaNumber(conn, "freelist_count");
  while (free > 0) {
    yield () => conn.transaction(() => conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`));
    const left = pragmaNumber(conn, "freelist_count");
    if (left >= free) return;
    free = left;
  }
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
    JSON.stringify(keptByReplaced(conn).texts)
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
  const runsDir = resolve5(paths.runsDir);
  const target = resolve5(logDir);
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
    list: (consumer, files) => {
      const only = files === void 0 ? null : inTestFiles("v.check_id", files);
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
    outcome: oneOf3(row, "outcome", OUTCOMES3),
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
    recordUnknownRuns: (worktreeId, revision, marked2, at) => recordUnknownRuns(conn, worktreeId, revision, marked2, at),
    unknownRuns: (worktreeId) => readUnknownRuns(conn).filter((r) => r.worktreeId === worktreeId)
  };
}

// src/core/store/repos/results.ts
import { createHash as createHash3 } from "node:crypto";
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
  const id = createHash3("sha256").update(JSON.stringify([summary, text2])).digest("hex");
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
    kind: oneOf3(row, "kind", CHECKPOINT_KINDS),
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
    list: (worktreeId, files) => {
      const only = files === void 0 ? null : inTestFiles("s.check_id", files);
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
  const stored4 = strOrNull(row, "origin_kind");
  const kind = stored4 === "own" || stored4 === "inherited" ? stored4 : null;
  if (stored4 !== null && kind === null) return null;
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
    outcome: oneOf3(row, "outcome", OUTCOMES4),
    validity: oneOf3(row, "validity", VALIDITIES),
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
    kind: oneOf3(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES4),
    to: oneOf3(row, "to_outcome", OUTCOMES4),
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
      method: oneOf3(row, "method", METHODS)
    },
    updatedAt: num(row, "updated_at"),
    updatedBy: str(row, "updated_by")
  };
}
function createTestFileKeyRepo(conn) {
  return {
    list: (worktreeId, files) => {
      if (files?.length === 0) return [];
      const only = files === void 0 ? "" : `AND (project, path) IN (VALUES ${files.map(() => "(?, ?)").join(", ")})`;
      return conn.all(
        `SELECT * FROM test_file_keys WHERE worktree_id = ? ${only} ORDER BY project, path`,
        worktreeId,
        ...(files ?? []).flatMap((f) => [f.project, f.path])
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
  const recordRunners = (worktreeId, named3) => {
    const kept2 = runners(worktreeId);
    let changed = false;
    for (const [project, runner] of named3) {
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
      const stored4 = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
      conn.run(
        `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        stored4.worktreeId,
        stored4.number,
        stored4.createdAt,
        stored4.head,
        flag(stored4.dirty),
        stored4.trigger,
        JSON.stringify(stored4.changes)
      );
      return stored4;
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
    trigger: oneOf3(row, "trigger", TRIGGERS),
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
var JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;
var META_STORE_RECOVERED = "store.recovered";
function markPath(database) {
  return `${database}.check-failed`;
}
function readMark(path) {
  let text2;
  try {
    text2 = readFileSync11(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const { at, problem } = JSON.parse(text2);
    if (typeof at === "number" && typeof problem === "string") return { at, problem };
  } catch {
  }
  return { at: 0, problem: "the full integrity check failed" };
}
function isStoreOpenFailure(value) {
  return "reason" in value;
}
function openStore(commonDir, options = {}) {
  const paths = storePaths(commonDir);
  if (!existsSync6(paths.database)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync2(paths.dir, { recursive: true });
  }
  const opened = connect(paths, options);
  if (!("corrupt" in opened)) return opened;
  if (options.checkIntegrity === void 0) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}
function connect(paths, options) {
  let db;
  try {
    db = new DatabaseSync2(paths.database);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout(options)}`);
    const found2 = userVersion(db);
    if (found2 > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found: found2, supported: SCHEMA_VERSION };
    }
    if (options.checkIntegrity !== void 0) {
      const mark = readMark(markPath(paths.database));
      if (mark !== null) {
        db.close();
        return { corrupt: mark.problem, mark };
      }
      const problem = integrityProblem(db);
      if (problem !== null) {
        db.close();
        return { corrupt: problem };
      }
    }
    if (pragmaNumber2(db, "page_count") === 0) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    switchToWal(db, busyTimeout(options));
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
    const version = migrate(db);
    return createStore(options.connection?.(db) ?? new Connection(db), version, paths);
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
function pragmaNumber2(db, name2) {
  return Number(db.prepare(`PRAGMA ${name2}`).get()?.[name2]);
}
function integrityProblem(db) {
  const rows = db.prepare("PRAGMA quick_check").all();
  const messages = rows.map((row) => String(row.quick_check));
  return messages.length === 1 && messages[0] === "ok" ? null : messages.join("; ");
}
function isCorruption(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}
function recover(paths, options) {
  mkdirSync2(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync2(join12(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: options.checkIntegrity ?? "quick" });
    if (!("corrupt" in again)) return again;
    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const { checkIntegrity: _, ...unchecked } = options;
    const fresh2 = connect(paths, unchecked);
    if ("corrupt" in fresh2) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh2)) {
      const full = again.mark === void 0 ? {} : { check: "full", checkedAt: again.mark.at };
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt, ...full });
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
  for (let n = 1; existsSync6(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  if (existsSync6(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync2(`${database}-shm`, { force: true });
  if (existsSync6(markPath(database))) renameSync(markPath(database), markPath(movedTo));
  return movedTo;
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
  coverage_recorded: "CREATE INDEX coverage_recorded ON coverage (recorded_at)"
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
function createFileRepo(conn) {
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
             SELECT 1 FROM counts c WHERE c.blob = f.blob AND c.language = f.language
               AND c.counter_version = f.counter_version)
           ORDER BY f.path`,
        worktreeId
      ).map(toFile);
    },
    upsertMany(worktreeId, files) {
      conn.transaction(() => {
        for (const file of files) {
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
    language: oneOf3(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    functions: json(row, "functions"),
    errors: json(row, "errors")
  };
}
function toFile(row) {
  return {
    path: str(row, "path"),
    blob: str(row, "blob"),
    language: oneOf3(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    size: num(row, "size"),
    revision: num(row, "revision"),
    ...num(row, "too_big") === 1 ? { tooBig: true } : {}
  };
}

// src/core/code/coverage/parts.ts
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
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
function stored(text2, last = false) {
  const body = Buffer.from(text2, "utf8");
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
function sweepParts(conn, cutoff, marked2, batch) {
  const ids = conn.all("SELECT id FROM coverage_parts WHERE used_at < ?", cutoff).map((row) => num(row, "id")).filter((id) => !marked2.has(id));
  let removed = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const some = JSON.stringify(ids.slice(i, i + batch));
    removed += conn.transaction(
      () => conn.run(
        "DELETE FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?",
        some,
        cutoff
      )
    );
  }
  return removed;
}
function pruneParts(conn, cutoff, batch) {
  if (!hasParts(conn)) return 0;
  return sweepParts(conn, cutoff, markParts(conn, cutoff + PART_REFRESH_MS), batch);
}

// src/core/code/store/coverage.ts
var INDEX = "coverage_stored";
var PART_CACHE_LIMIT = 8192;
var UPSERT = `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET record = excluded.record,
    recorded_at = max(excluded.recorded_at, recorded_at + 1)`;
function createCoverageRepo(conn) {
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
        return manifest === null ? null : assemble(manifest, partsOf(manifest.parts.map((p) => p.id)));
      });
    },
    has: (key) => storedAt2(key) !== null,
    storedAt: storedAt2,
    put(key, record, at) {
      conn.run(UPSERT, key.resultKey, key.providerVersion, record, at);
    },
    putParts(key, record, at) {
      conn.transaction(() => {
        const before = storedAt2(key);
        const stored4 = before === null ? at : Math.max(at, before + 1);
        const known = /* @__PURE__ */ new Map();
        for (const row of conn.all(
          `SELECT j.key AS i, p.id, p.used_at FROM json_each(?) j
             JOIN coverage_parts p ON p.hash = j.value`,
          JSON.stringify(record.parts.map((p) => p.hash))
        )) {
          const hash2 = record.parts[num(row, "i")]?.hash ?? "";
          known.set(hash2, { id: num(row, "id"), usedAt: num(row, "used_at") });
        }
        const stale = [...known.values()].filter((p) => p.usedAt < stored4 - PART_REFRESH_MS).map((p) => p.id);
        const ids = record.parts.map((part) => {
          const found2 = known.get(part.hash);
          if (found2 !== void 0) return found2.id;
          const made = conn.get(
            "INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, ?, ?) RETURNING id",
            part.hash,
            part.bytes,
            stored4
          );
          const id = made === null ? 0 : num(made, "id");
          known.set(part.hash, { id, usedAt: stored4 });
          return id;
        });
        if (stale.length > 0) {
          conn.run(
            "UPDATE coverage_parts SET used_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?",
            stored4,
            JSON.stringify(stale),
            stored4 - PART_REFRESH_MS
          );
        }
        conn.run(UPSERT, key.resultKey, key.providerVersion, manifestBytes(record, ids), stored4);
      });
    }
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

// src/core/code/store/prune.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var DELETE_BATCH2 = 256;
var VACUUM_PAGES2 = 512;
var OF_WORKTREES = "worktree_id IN (SELECT value FROM json_each(?))";
var worktreeIdsOf = (table) => `WITH RECURSIVE ids(id) AS (
    SELECT min(worktree_id) FROM ${table}
    UNION ALL SELECT (SELECT min(worktree_id) FROM ${table} WHERE worktree_id > ids.id)
      FROM ids WHERE ids.id IS NOT NULL)
  SELECT id FROM ids WHERE id IS NOT NULL`;
var COVERAGE_META_OF_DEAD = `key LIKE 'coverage:%' AND (CASE
    WHEN instr(substr(key, 10), ':') = 0 THEN substr(key, 10)
    ELSE substr(key, 10, instr(substr(key, 10), ':') - 1) END) NOT IN (SELECT value FROM json_each(?))`;
var OLDER_RECORD = "provider_version < ?";
var COVERAGE_KEY = "result_key, provider_version";
var PER_WORKTREE = [
  ["files", "worktree_id, path"],
  ["states", "worktree_id, check_id, measure"],
  ["views", "worktree_id, session_id, agent_id, check_id, measure"],
  ["transitions", "id"]
];
function pruneCodeStore(conn, options) {
  const cutoff = options.now - options.retentionDays * DAY_MS2;
  const live = JSON.stringify(options.worktrees);
  const dead = deadWorktrees(conn, options.worktrees);
  if (dead.length > 0) {
    for (const [table, key] of PER_WORKTREE) {
      deleteInBatches(conn, table, key, OF_WORKTREES, JSON.stringify(dead));
    }
  }
  deleteInBatches(conn, "meta", "key", COVERAGE_META_OF_DEAD, live);
  const viewsRemoved = deleteInBatches(
    conn,
    "views",
    "worktree_id, session_id, agent_id, check_id, measure",
    `(worktree_id, session_id, agent_id) NOT IN (
       SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
       FROM json_each(?))`,
    JSON.stringify(options.consumers)
  );
  const countsRemoved = deleteInBatches(
    conn,
    "counts",
    "blob, language, counter_version",
    `counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob
       AND f.language = counts.language AND f.counter_version = counts.counter_version)
     AND counts.blob NOT IN (SELECT s.blob FROM states s)`,
    cutoff
  );
  const coverageRemoved = pruneCoverage(conn, options.resultKeys, cutoff);
  const partsRemoved = pruneParts(conn, cutoff, DELETE_BATCH2);
  const checksRemoved = deleteInBatches(
    conn,
    "checks",
    "id",
    `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
       UNION SELECT check_id FROM transitions)`
  );
  vacuum2(conn);
  return {
    countsRemoved,
    coverageRemoved,
    partsRemoved,
    worktreesRemoved: dead.length,
    viewsRemoved,
    checksRemoved
  };
}
function deadWorktrees(conn, live) {
  const kept2 = new Set(live);
  const found2 = new Set(
    PER_WORKTREE.flatMap(([table]) => conn.all(worktreeIdsOf(table)).map((row) => str(row, "id")))
  );
  return [...found2].filter((id) => !kept2.has(id));
}
function pruneCoverage(conn, resultKeys, cutoff) {
  if (resultKeys === void 0) {
    return deleteInBatches(
      conn,
      "coverage",
      COVERAGE_KEY,
      `recorded_at < ? OR ${OLDER_RECORD}`,
      cutoff,
      COVERAGE_RECORD_VERSION
    );
  }
  const held = conn.all("SELECT DISTINCT result_key FROM coverage").map((row) => str(row, "result_key"));
  const kept2 = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  return deleteInBatches(
    conn,
    "coverage",
    COVERAGE_KEY,
    `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    JSON.stringify(held.filter((key) => !kept2.has(key))),
    COVERAGE_RECORD_VERSION
  );
}
function deleteInBatches(conn, table, key, where3, ...params) {
  let removed = 0;
  for (; ; ) {
    const changed = conn.transaction(
      () => conn.run(
        `DELETE FROM ${table} WHERE (${key}) IN (
           SELECT ${key} FROM ${table} WHERE ${where3} LIMIT ${DELETE_BATCH2})`,
        ...params
      )
    );
    removed += changed;
    if (changed < DELETE_BATCH2) return removed;
  }
}
function vacuum2(conn) {
  let free = freePages(conn);
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES2})`);
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
  }
}
function freePages(conn) {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count ?? 0);
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
function ensureCodeCheckId(conn, check) {
  conn.run(
    "INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ...checkParams2(check)
  );
  const id = findCodeCheckId(conn, check);
  if (id === null) throw new Error("squeal code store: check row missing after insert");
  return id;
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
function statesOf(worktreeId, paths) {
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
function createStateRepo(conn) {
  return {
    list(worktreeId, filter = {}) {
      const { from, params } = statesOf(worktreeId, filter.paths);
      return conn.all(
        `SELECT s.*, ${CHECK_COLUMNS2} FROM ${from}
             AND (? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?)
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
        ...params,
        ...Array(2).fill(filter.measure ?? null),
        ...Array(2).fill(filter.outcome ?? null)
      ).map((row) => toState(worktreeId, row));
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          conn.run(
            `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
               counted_at, blob, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
               counted_at = excluded.counted_at, blob = excluded.blob,
               changed_at = excluded.changed_at`,
            state.worktreeId,
            ensureCodeCheckId(conn, state.check),
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
      const { from, params } = statesOf(worktreeId, paths);
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
        const toId = ensureCodeCheckId(conn, to);
        for (const table of ["states", "views"]) {
          conn.run(
            `UPDATE OR REPLACE ${table} SET check_id = ? WHERE worktree_id = ? AND check_id = ?`,
            toId,
            worktreeId,
            fromId2
          );
        }
        conn.run(
          "DELETE FROM transitions WHERE worktree_id = ? AND check_id = ?",
          worktreeId,
          toId
        );
        conn.run(
          "UPDATE transitions SET check_id = ? WHERE worktree_id = ? AND check_id = ?",
          toId,
          worktreeId,
          fromId2
        );
      });
    },
    adopt(worktreeId, staged, measure2, removed) {
      return conn.transaction(() => {
        const written2 = conn.run(
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
            `DELETE FROM states WHERE worktree_id = ? AND check_id IN (
               SELECT c.id FROM json_each(?) j JOIN checks c ON c.path = j.value ->> 0
                 AND c.qualified_name = j.value ->> 1 AND c.occurrence = j.value ->> 2)`,
            worktreeId,
            JSON.stringify(removed.map((c) => [c.path, c.qualifiedName, c.occurrence]))
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
    measure: oneOf3(row, "measure", MEASURES),
    outcome: oneOf3(row, "outcome", OUTCOMES5),
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
    measure: oneOf3(row, "measure", MEASURES),
    revision: num(row, "edited_revision"),
    at: num(row, "edited_at")
  };
}

// src/core/code/store/staged.ts
var SUFFIX = " recount";
var isStagedId = (id) => id.endsWith(SUFFIX);

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
            `INSERT INTO transitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureCodeCheckId(conn, t.check),
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
        return conn.run(
          `INSERT INTO transitions (${COLUMNS})
           SELECT ?, check_id, measure, kind, from_outcome, to_outcome, from_value, to_value,
             threshold, revision, at
           FROM transitions WHERE worktree_id = ? ORDER BY id`,
          worktreeId,
          staged
        );
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
    measure: oneOf3(row, "measure", MEASURES),
    kind: oneOf3(row, "kind", KINDS2),
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
        for (const entry3 of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, measure, outcome,
               threshold, told, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, threshold = excluded.threshold,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams2(consumer),
            ensureCodeCheckId(conn, entry3.check),
            entry3.measure,
            entry3.outcome,
            entry3.threshold,
            entry3.told,
            entry3.toldAt
          );
        }
      });
    },
    removeMany(consumer, entries) {
      conn.transaction(() => {
        for (const entry3 of entries) {
          const id = findCodeCheckId(conn, entry3.check);
          if (id === null) continue;
          conn.run(
            `DELETE FROM views WHERE ${WHERE_CONSUMER2} AND check_id = ? AND measure = ?`,
            ...consumerParams2(consumer),
            id,
            entry3.measure
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
    measure: oneOf3(row, "measure", MEASURES),
    outcome: oneOf3(row, "outcome", OUTCOMES5),
    threshold: numOrNull(row, "threshold"),
    told: oneOf3(row, "told", TOLD),
    toldAt: num(row, "told_at")
  };
}

// src/core/code/store/store.ts
function createCodeStore(conn, schemaVersion, path) {
  return {
    path,
    schemaVersion,
    meta: createMetaRepo2(conn),
    counts: createCountRepo(conn),
    files: createFileRepo(conn),
    states: createStateRepo(conn),
    transitions: createTransitionRepo2(conn),
    views: createViewRepo2(conn),
    coverage: createCoverageRepo(conn),
    transaction: (fn) => conn.transaction(fn),
    read: (fn) => conn.read(fn),
    prune: (options) => pruneCodeStore(conn, options),
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
    delete(key) {
      conn.run("DELETE FROM meta WHERE key = ?", key);
    }
  };
}

// src/core/code/store/open.ts
function codeStorePath(commonDir) {
  return join13(storePaths(commonDir).dir, "code.sqlite");
}
function isCodeStoreOpenFailure(value) {
  return "reason" in value;
}
function openCodeStore(commonDir, policy, options = {}) {
  if (!policy.complexity.enabled) return { reason: "off" };
  const path = codeStorePath(commonDir);
  if (!existsSync7(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync3(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db;
  try {
    db = new DatabaseSync3(path);
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
    const version = migrate(db, CODE_MIGRATIONS);
    if (options.create !== false) makeIndexes(db);
    return createCodeStore(options.connection?.(db) ?? new Connection(db), version, path);
  } catch (error) {
    db?.close();
    if (isCorruption2(error)) return { reason: "corrupt", error: String(error) };
    throw error;
  }
}
function makeIndexes(db) {
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
function isCorruption2(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}

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
    this.#file = fileOf(db);
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
    return new Promise((resolve7) => waiters.push({ file: this.#file, resolve: resolve7 }));
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
function fileOf(db) {
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
function heldWrite(access, fn, holds) {
  const held = holds === void 0 ? null : access.connection?.hold() ?? null;
  if (held === null || holds === void 0) return access.store.transaction(fn);
  let result;
  try {
    result = fn();
  } catch (error) {
    held.rollback();
    throw error;
  }
  const close = () => access.store.close();
  holds.push({
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
  const names2 = new Set(bases.keys());
  for (const t of transitions) {
    const name2 = lintCheckName(t.check);
    if (t.id > (bases.get(name2) ?? mark.transition)) names2.add(name2);
  }
  return [...names2].sort();
}
var settled = (s) => s.judged !== null && (s.outcome === "fail" || s.outcome === "pass" && !s.stale);
function netChange(transitions) {
  const net = /* @__PURE__ */ new Map();
  const entry3 = (f) => {
    const key = JSON.stringify([f.rule, f.message]);
    const found2 = net.get(key);
    if (found2 !== void 0) return found2;
    const e = { n: 0, added: [], removed: [] };
    net.set(key, e);
    return e;
  };
  for (const t of transitions) {
    for (const f of t.added) {
      const e = entry3(f);
      e.n++;
      e.added.push(f);
    }
    for (const f of t.removed) {
      const e = entry3(f);
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
  const entry3 = {
    path: check.path,
    ...check.tool === "eslint" ? {} : { tool: check.tool },
    kind: kindOf(told?.outcome === "fail", now, own),
    findings: failing === null ? 0 : input.findings(failing)?.length ?? null,
    ...change2,
    revision: last.revision,
    ...now?.stale === true ? { stale: true } : {}
  };
  return { ...view, entry: entry3 };
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
  const sorted = entries.map((entry3, i) => ({ entry: entry3, i })).sort((a, b) => RANK2[a.entry.kind] - RANK2[b.entry.kind] || a.i - b.i).map(({ entry: entry3 }) => entry3);
  return { entries: sorted, writes, removals, deferred };
}

// src/core/lint/pass/moment.ts
var MOMENTS = ["pause", "stop", "commit", "manual"];
function pauseReleases(at) {
  return at === "pause" || at === "stop";
}
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
  return { kind: "lint", path: str(row, "path"), tool: oneOf3(row, "tool", TOOLS) };
}

// src/core/lint/surface/snapshot.ts
var isCurrentFail = (s) => s.outcome === "fail" && !s.stale;
function countsOf2(states) {
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
    reasons: [...reasons].map(([reason, files]) => ({ reason, files })).sort((a, b) => b.files - a.files || a.reason.localeCompare(b.reason))
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
function awaiting(meta, worktreeId, states, which) {
  const byGroup = /* @__PURE__ */ new Map();
  for (const [tool, scope] of scopes(worktreeId)) {
    const group = readHeld(meta, scope)?.group;
    const isHeld = heldOf(meta, scope, which);
    for (const s of states) {
      if (group === void 0 || s.check.tool !== tool || s.outcome !== "pending") continue;
      if (isHeld(s.check.path)) byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    }
  }
  return byGroup;
}
function awaitingPause(meta, worktreeId, states) {
  const byGroup = awaiting(meta, worktreeId, states, (held) => pauseReleases(held.at));
  return [...byGroup.values()].reduce((sum, n) => sum + n, 0);
}
function awaitingRun(meta, worktreeId, states) {
  const byGroup = awaiting(meta, worktreeId, states, (held) => held.at === "manual");
  return [...byGroup].map(([group, checks]) => ({ group, checks }));
}
function progressOf(store, worktreeId, states) {
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
  return { done: states.length - pending.length, total: states.length - held };
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
import { existsSync as existsSync8, mkdirSync as mkdirSync4 } from "node:fs";
import { join as join14 } from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";

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
    outcome: oneOf3(row, "outcome", JUDGED),
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
    outcome: oneOf3(row, "outcome", OUTCOMES6),
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
    kind: oneOf3(row, "kind", KINDS3),
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
        for (const entry3 of entries) {
          conn.run(
            `INSERT INTO views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint,
               told, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, session_id, agent_id, check_id) DO UPDATE SET
               outcome = excluded.outcome, fingerprint = excluded.fingerprint,
               told = excluded.told, told_at = excluded.told_at`,
            ...consumerParams3(consumer),
            ensureLintCheckId(conn, entry3.check),
            entry3.outcome,
            entry3.fingerprint,
            entry3.told,
            entry3.toldAt
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
    outcome: oneOf3(row, "outcome", OUTCOMES6),
    fingerprint: strOrNull(row, "fingerprint"),
    told: oneOf3(row, "told", TOLD2),
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
  return join14(storePaths(commonDir).dir, "lint.sqlite");
}
function isLintStoreOpenFailure(value) {
  return "reason" in value;
}
function openLintStore(commonDir, policy, options = {}) {
  if (!policy.lint.enabled) return { reason: "off" };
  const path = lintStorePath(commonDir);
  if (!existsSync8(path)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync4(storePaths(commonDir).dir, { recursive: true });
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be >= 0: ${busyTimeoutMs}`);
  }
  let db;
  try {
    db = new DatabaseSync4(path);
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
  const { failing, stale } = countsOf2(all);
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
  const listed4 = (filter) => store.states.list(worktreeId, filter);
  const states = new Map(
    (paths.length === 0 ? [] : listed4({ paths })).map((s) => [lintCheckName(s.check), s])
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
  const due = summaryOf(store, consumer, keying, mark, () => all ??= listed4({}));
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
      const { failing, stale } = countsOf2(states);
      const linting = progressOf(store, worktreeId, states);
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
    const recorded = {
      worktreeId: provenance.worktreeId,
      worktreeRoot: store.worktrees.get(provenance.worktreeId)?.root ?? null,
      revision: provenance.revision,
      recordedAt: provenance.recordedAt,
      loadPerCpu: loads.get(provenance.runId) ?? null,
      ...retry === void 0 ? {} : { retry },
      ...notes.get(id)?.key === row.key ? {} : { noEarlierPass: true }
    };
    return { ...failure2, recorded };
  });
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
function importFiles(store, importId) {
  const conn = readable(store);
  if (conn === null) return [];
  return conn.all("SELECT * FROM import_files WHERE import_id = ? ORDER BY project, path", importId).map(toImportFile);
}
function toImportFile(row) {
  return {
    importId: String(row.import_id),
    project: String(row.project),
    path: String(row.path),
    key: String(row.key),
    environment: String(row.environment),
    closure: String(row.closure),
    observed: String(row.observed)
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

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/keys/hidden-lockfile.ts
import { createHash as createHash4 } from "node:crypto";
import { lstatSync as lstatSync2, readdirSync as readdirSync5, readFileSync as readFileSync12, readlinkSync as readlinkSync2 } from "node:fs";
import { isAbsolute as isAbsolute7, join as join15 } from "node:path";
var HIDDEN_LOCKFILE = "node_modules/.package-lock.json";
var PACKAGE_FOLDERS_ENCODING = "squeal-package-folders/1";
function staleHiddenLockfile(dir, lockfile) {
  const listed4 = lockfile === null ? null : packagesIn(lockfile);
  if (listed4 === null) return "not valid JSON";
  const lockTime = lstatSync2(join15(dir, HIDDEN_LOCKFILE)).mtimeMs;
  const folders = packageFolders(dir, workspaces(listed4));
  const seen = new Set(folders.map((folder) => folder.path));
  const unlisted2 = folders.filter((folder) => !Object.hasOwn(listed4, folder.path)).map((folder) => folder.path);
  const newer = folders.filter(
    (folder) => Object.hasOwn(listed4, folder.path) && folder.mtimeMs > lockTime
  );
  const missing = Object.keys(listed4).filter((path) => isInstalledFolder(path) && !seen.has(path));
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
    ({ path, link }) => link ? [path, "link", readlinkSync2(join15(dir, path))] : [path, ...nameAndVersion(dir, path)]
  );
  return createHash4("sha256").update(JSON.stringify([PACKAGE_FOLDERS_ENCODING, entries])).digest("hex");
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
  const own = (path, entry3) => (path === "" || isWorkspace(path)) && isRecord(entry3) ? { ...entry3, version: void 0 } : entry3;
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
  return path !== "" && !isAbsolute7(path) && path !== ".." && !path.startsWith("../");
}
function isWorkspace(path) {
  return insideInstall(path) && !isInstalledFolder(path);
}
function workspaces(listed4) {
  return Object.keys(listed4).filter(isWorkspace);
}
function packageFolders(dir, workspaceFolders) {
  const folders = [];
  const visit = (path, entry3) => {
    if (!entry3.isSymbolicLink() && !entry3.isDirectory()) return;
    const link = entry3.isSymbolicLink();
    folders.push({ path, link, mtimeMs: lstatSync2(join15(dir, path)).mtimeMs });
    if (!link) walk(`${path}/node_modules`);
  };
  const walk = (modules) => {
    for (const entry3 of entriesOf2(join15(dir, modules))) {
      if (entry3.name.startsWith(".")) continue;
      const path = `${modules}/${entry3.name}`;
      if (entry3.name.startsWith("@") && entry3.isDirectory()) {
        for (const child of entriesOf2(join15(dir, path))) visit(`${path}/${child.name}`, child);
      } else {
        visit(path, entry3);
      }
    }
  };
  for (const path of ["", ...workspaceFolders])
    walk(path === "" ? "node_modules" : `${path}/node_modules`);
  return folders;
}
function entriesOf2(path) {
  try {
    return readdirSync5(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || error.code === "ENOTDIR") return [];
    throw error;
  }
}
function nameAndVersion(dir, path) {
  try {
    const manifest = JSON.parse(readFileSync12(join15(dir, path, "package.json"), "utf8"));
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
import { join as join17, posix as posix5 } from "node:path";

// src/core/keys/package-scans.ts
import { readdirSync as readdirSync6, readFileSync as readFileSync13 } from "node:fs";
import { join as join16 } from "node:path";
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
  return entries.some((entry3) => {
    if (entry3.name === "node_modules") return false;
    if (entry3.isDirectory()) return hasRuntimeFile(join16(dir, entry3.name));
    return !NOT_RUNTIME.some((pattern) => pattern.test(entry3.name));
  });
}
function referencesOpaque(dir) {
  const entries = entriesOf3(dir);
  if (entries === null) return true;
  return entries.some((entry3) => {
    if (entry3.name === "node_modules") return false;
    const path = join16(dir, entry3.name);
    if (entry3.isDirectory()) return referencesOpaque(path);
    if (!entry3.isFile() || !CODE.test(entry3.name) || DECLARATION.test(entry3.name)) return false;
    try {
      return OPAQUE_REFERENCE.test(readFileSync13(path, "utf8"));
    } catch {
      return true;
    }
  });
}
function entriesOf3(dir) {
  try {
    return readdirSync6(dir, { withFileTypes: true });
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
    for (const [location2, entry3] of Object.entries(packages)) {
      if (isRecord(entry3)) entries[location2] = entry3;
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
      const entry3 = location2 === null ? void 0 : this.#packages[location2];
      if (location2 === null) found2.add(absent(local ?? from, name2));
      else if (manifest === true && entry3 !== void 0 && isInstalled(location2)) {
        found2.add(identityOf(location2, entry3));
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
      return location2 !== void 0 && this.scans.opaque(this.#scanId(identity3), join17(this.dir, location2));
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
        const entry3 = this.#packages[location2];
        if (entry3 !== void 0) {
          return entry3.link === true && typeof entry3.resolved === "string" ? entry3.resolved : location2;
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
      const entry3 = this.#packages[location2];
      if (entry3 === void 0 || !isInstalled(location2)) {
        identities.push(`workspace:${location2}`);
        continue;
      }
      const identity3 = identityOf(location2, entry3);
      if (this.scans.typesOnly(this.#scanId(identity3), join17(this.dir, location2))) {
        identities.push(`${location2}@types-only`);
        continue;
      }
      identities.push(identity3);
      this.#locations.set(identity3, location2);
      for (const field of EDGES) {
        const names2 = entry3[field];
        if (!isRecord(names2)) continue;
        for (const name2 of Object.keys(names2)) {
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
function identityOf(location2, entry3) {
  return `${location2}@${text(entry3.version)}#${text(entry3.integrity ?? entry3.resolved)}`;
}
function absent(from, name2) {
  return `absent:${from}>${name2}`;
}
function parent(dir) {
  const up = posix5.dirname(dir);
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
  const listed4 = packagesOf(content);
  const graph = listed4 === null || base === null ? null : new InstalledGraph(dir, base, listed4, scans);
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
import { createHash as createHash6 } from "node:crypto";
import { lstatSync as lstatSync3, readdirSync as readdirSync7, readFileSync as readFileSync14, readlinkSync as readlinkSync3 } from "node:fs";
import { join as join19 } from "node:path";

// src/core/keys/pnpm-graph.ts
import { join as join18, posix as posix6 } from "node:path";

// src/core/keys/pnpm-lockfile.ts
import { createHash as createHash5 } from "node:crypto";
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
  const { entry: entry3 } = reader;
  if (entry3 === null) return false;
  if (indent === 4) {
    reader.reading = (part === "importers" ? IMPORTER_FIELDS : SNAPSHOT_FIELDS).has(key);
    return reader.reading ? value === "" : UNREAD[part].has(key);
  }
  if (part === "snapshots") return isRef(value) && setOnce(entry3, key, value);
  return readDependencyLine(reader, entry3, indent, pair);
}
function readDependencyLine(reader, entry3, indent, [key, value]) {
  if (indent === 6) {
    if (value !== "") return false;
    reader.dependency = key;
    if (!entry3.has(key)) entry3.set(key, "");
    return true;
  }
  if (key === "version") return isRef(value) && setOnce(entry3, reader.dependency, value);
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
function isRef(value) {
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
    const digest2 = createHash5("sha256").update(name2).digest("hex");
    return `${name2.slice(0, max - 33)}_${digest2.slice(0, 32)}`;
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
      return folder !== void 0 && this.scans.opaque(this.#scanId(identity3), join18(this.dir, folder));
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
    return base.startsWith(`${id}#`) && this.scans.typesOnly(this.#scanId(base), join18(this.dir, this.#folderOf(id)));
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
  return `workspace:${posix6.normalize(posix6.join(dir, ref2.slice("link:".length)))}`;
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
    modules = JSON.parse(readFileSync14(join19(dir, PNPM_MODULES), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(modules) || modules.nodeLinker !== "isolated") return null;
  if (modules.virtualStoreDir !== ".pnpm" || modules.enableGlobalVirtualStore === true) return null;
  return modules;
}
function stalePnpmLockfile(dir, graph) {
  const lockTime = lstatSync3(join19(dir, PNPM_LOCKFILE)).mtimeMs;
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
    const stat = lstatSync3(join19(dir, path), { throwIfNoEntry: false });
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
    const present = new Set(namesIn(join19(dir, modules)));
    for (const name2 of present) {
      const path = `${modules}/${name2}`;
      if (!declared.has(name2) && !(importer === "." && graph.publicHoisted.has(name2))) {
        stale.unlisted.push(path);
      } else if (lstatSync3(join19(dir, path)).mtimeMs > lockTime) stale.newer.push(path);
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
  return lstatSync3(join19(dir, path), { throwIfNoEntry: false }) !== void 0;
}
function pnpmPackageFoldersFingerprint(dir, importers) {
  const roots = /* @__PURE__ */ new Set(["node_modules", `${PNPM_VIRTUAL_STORE}/node_modules`]);
  for (const importer of importers)
    roots.add(importer === "." ? "node_modules" : `${importer}/node_modules`);
  for (const folder of entriesOf4(join19(dir, PNPM_VIRTUAL_STORE))) {
    if (folder.isDirectory() && folder.name !== "node_modules") {
      roots.add(`${PNPM_VIRTUAL_STORE}/${folder.name}/node_modules`);
    }
  }
  const entries = [];
  const walk = (at) => {
    for (const name2 of namesIn(join19(dir, at))) {
      const path = `${at}/${name2}`;
      const link = lstatSync3(join19(dir, path)).isSymbolicLink();
      entries.push(
        link ? [path, "link", readlinkSync3(join19(dir, path))] : [path, ...manifestOf(dir, path)]
      );
      if (!link) walk(`${path}/node_modules`);
    }
  };
  for (const at of [...roots].sort(compare)) walk(at);
  return createHash6("sha256").update(JSON.stringify([PACKAGE_FOLDERS_ENCODING2, entries])).digest("hex");
}
function namesIn(modules) {
  const names2 = [];
  for (const entry3 of entriesOf4(modules)) {
    if (entry3.name.startsWith(".")) continue;
    if (entry3.name.startsWith("@") && entry3.isDirectory()) {
      for (const child of entriesOf4(join19(modules, entry3.name)))
        names2.push(`${entry3.name}/${child.name}`);
    } else names2.push(entry3.name);
  }
  return names2.sort(compare);
}
function entriesOf4(path) {
  try {
    return readdirSync7(path, { withFileTypes: true });
  } catch {
    return [];
  }
}
function manifestOf(dir, path) {
  try {
    const manifest = JSON.parse(readFileSync14(join19(dir, path, "package.json"), "utf8"));
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
    const slots = {};
    for (const [slot2, at] of Object.entries(value.slots)) {
      if (typeof at === "number" && snapshots[at] !== void 0) slots[slot2] = at;
    }
    return { snapshots, slots };
  } catch {
    return EMPTY;
  }
}
var identity2 = (keys) => JSON.stringify(Object.entries(keys).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
function recordRegisteredKeys(store, worktreeId, slot2, { resumed, kept: kept2 }) {
  const recorded = read3(store, worktreeId);
  const named3 = /* @__PURE__ */ new Map();
  for (const [at, index] of Object.entries(recorded.slots)) {
    const keys = recorded.snapshots[index];
    if (keys !== void 0 && kept2.has(at) && (resumed || at !== slot2)) named3.set(at, keys);
  }
  if (!resumed) {
    const keys = {};
    for (const row of store.testFileKeys.list(worktreeId)) {
      if (row.key !== null) keys[testFileId(row.testFile)] = row.key;
    }
    named3.set(slot2, keys);
  }
  const snapshots = [];
  const indexOf = /* @__PURE__ */ new Map();
  const slots = {};
  for (const [at, keys] of named3) {
    const id = identity2(keys);
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
  const keyOf = (id, ref2) => {
    let byFile = keys.get(id);
    if (byFile === void 0) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref2)) ?? null;
  };
  return (record) => {
    if (record.updatedBy === worktreeId) return true;
    const key = keyOf(worktreeId, record.testFile);
    return key !== null && key === keyOf(record.updatedBy, record.testFile);
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
    const listed4 = new Set(store.testFileKeys.list(worktreeId).map((r) => testFileId(r.testFile)));
    const trusts = closureTrust(store, worktreeId);
    return store.testFiles.list().filter((r) => listed4.has(testFileId(r.testFile)) && trusts(r)).map((r) => r.closure.paths);
  };
  return (path) => {
    closures ??= read4();
    return closures.filter((paths) => paths.includes(path)).length;
  };
}

// src/core/delivery/registered.ts
function registeredMetaKey(worktreeId) {
  return worktreeMetaKey("registered", worktreeId);
}
function parkedMetaKey(worktreeId) {
  return worktreeMetaKey("registeredLeft", worktreeId);
}
var isNumber3 = (value) => typeof value === "number";
var isString = (value) => typeof value === "string";
var isGap = (value) => Array.isArray(value) && value.length === 2 && value.every(isNumber3);
function toRegistration(value) {
  if (isNumber3(value)) return { since: value, gaps: [] };
  if (!isRecord(value) || !isNumber3(value.since) || !Array.isArray(value.gaps)) return null;
  if (!value.gaps.every(isGap)) return null;
  return {
    since: value.since,
    gaps: value.gaps,
    ...isNumber3(value.scanned) ? { scanned: value.scanned } : {},
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
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  return marker !== null && Number(marker) === daemon.startedAt ? daemon.startedAt : null;
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
  return parked === null ? null : { said: parked.said === true, uncovered: parked.uncovered ?? [] };
}
function registeredSlots(store, worktreeId, at) {
  const slots = new Set(Object.keys(readAll(store, registeredMetaKey(worktreeId))));
  for (const [k, v] of Object.entries(readAll(store, parkedMetaKey(worktreeId)))) {
    if (isRecord(v) && isNumber3(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) slots.add(k);
  }
  return slots;
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
  if (r === null || !isRecord(value) || !isNumber3(value.leftAt) || !isNumber3(value.leftTime)) {
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
    if (isRecord(v) && isNumber3(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) next[k] = v;
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
  const from = originWorktree(entry3.origin) ?? worktreeId;
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
  const files = store.fileHashes.list(worktreeId);
  if (files.length === 0) return void 0;
  return files.some((f) => isInstalledLockfile(f.path));
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

// src/core/delivery/code-told.ts
function toldOver(store, worktreeId, consumers, measures = ["complexity"]) {
  const told = new Set(
    consumers.flatMap(
      (c) => store.views.list(c).filter((v) => measures.includes(v.measure) && v.told !== "count").map(codeKey)
    )
  );
  if (told.size === 0) return [];
  return measures.flatMap(
    (measure2) => store.states.list(worktreeId, { measure: measure2, outcome: "fail" }).filter((s) => told.has(codeKey(s)))
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
  const files = store.files.list(worktreeId, paths);
  const spent = uncountableFiles(store, worktreeId, files);
  return files.flatMap((file) => {
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
function standing2(store, consumer, { threshold, maxFileBytes }, since) {
  const { worktreeId } = consumer;
  const measures = ["complexity", ...coverageMeasures(store, worktreeId)];
  const over = toldOver(store, worktreeId, [consumer], measures);
  const changed = changedNotJudged(store, worktreeId, since === null ? [] : [since]);
  if (over.length === 0 && changed.length === 0) return null;
  const told = over.length === 0 ? null : toldOf2(over, threshold);
  const files = changed.map(({ file, failure: failure2 }) => [
    file.path,
    failure2 === null ? `over ${maxFileBytes}` : "could not count"
  ]).sort(([a], [b]) => compare(a, b));
  return {
    part: {
      ...told === null ? {} : { toldOver: told },
      ...changed.length === 0 ? {} : { notJudged: notJudgedOf(changed, maxFileBytes) }
    },
    signature: JSON.stringify({ told, files })
  };
}
function summaryChanged(store, consumer, policy, since) {
  return readSent(store.meta, consumer) !== (standing2(store, consumer, policy, since)?.signature ?? null);
}
function withToldOver(store, consumer, news, policy, since) {
  const now = standing2(store, consumer, policy, since);
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
  return functions.length > 0 && functions.every(([, , testFiles]) => testFiles === 0);
}
function crapOf(store, consumer, entry3) {
  const key = functionKey(entry3.check);
  const state = store.states.list(consumer.worktreeId, { paths: [entry3.check.path], measure: "crap" }).find((s) => functionKey(s.check) === key);
  return (state?.outcome === "pass" || state?.outcome === "fail") && state.value !== null ? state.value : void 0;
}
function withUntested(store, consumer, news, loaders) {
  if (news === null || loaders === void 0 || !news.entries.some(saysWhy)) return news;
  const count2 = loaders();
  const files = /* @__PURE__ */ new Map();
  const fileOf2 = (path) => {
    const known = files.get(path);
    if (known !== void 0) return known;
    const n = count2(path);
    const facts = n > 0 && noneRan(store, consumer, path) ? { count: n, processes: true } : { count: n };
    files.set(path, facts);
    return facts;
  };
  const entries = news.entries.map((e) => {
    if (!saysWhy(e)) return e;
    const fileLoaders = fileOf2(e.check.path);
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
  const files = store.files.list(worktreeId).filter((f) => !isTooBig(f));
  const spent = uncountableFiles(store, worktreeId, files);
  const pending = store.files.uncounted(worktreeId).filter((f) => !spent.has(f.path)).length;
  const total = files.length - spent.size;
  return { done: total - pending, total, uncountable: spent.size };
}
function lastTransition(store, worktreeId, check, measure2 = MEASURE) {
  return store.transitions.history(worktreeId, check).findLast((t) => t.measure === measure2) ?? null;
}
var failingIn = (store, worktreeId) => store.states.list(worktreeId, { measure: MEASURE, outcome: "fail" });
function seed(store, consumer, failing, at) {
  store.views.clear(consumer);
  const covered = failingOf(
    store,
    consumer.worktreeId,
    coverageMeasures(store, consumer.worktreeId)
  );
  store.views.writeMany(
    consumer,
    [...failing, ...covered].map((s) => seedEntry(s, at))
  );
  writeJson(store, seededKey(consumer), at);
}
function registerCode(source, consumer, at) {
  const { worktreeId } = consumer;
  const names2 = source?.notMeasured?.() ?? [];
  const notMeasured = names2.length === 0 ? {} : { notMeasured: names2 };
  const read4 = withCode2(
    source,
    ({ store, complexity }) => store.transaction(() => {
      const failing = failingIn(store, worktreeId);
      const recounted = Math.max(
        readRecount(store, worktreeId)?.at ?? 0,
        readCrapRecount(store.meta, worktreeId)?.at ?? 0
      );
      seed(store, consumer, failing, Math.max(at, recounted));
      const { done, total } = countingOf(store, worktreeId);
      const counted = readCursor2(store.meta, worktreeId) !== null;
      if (!counted) awaitFirstCount(store.meta, worktreeId);
      const counting = counted && done === total ? {} : { counting: { done, total } };
      const over = failing.length;
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
  const files = store.files.list(consumer.worktreeId, own).filter((f) => isTooBig(f) && !told.has(f.path));
  if (files.length === 0) return [];
  if (write2) writeJson(store, tooBigToldKey(consumer), [...told, ...files.map((f) => f.path)]);
  return files.map((f) => ({ path: f.path, size: f.size, limit }));
}
function lineOf(store, worktreeId, check) {
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
function summaryNews(store, worktreeId, over, seededAt) {
  const recount = readRecount(store, worktreeId);
  const crap = readCrapRecount(store.meta, worktreeId);
  const change2 = readCoverageChange(store.meta, worktreeId);
  const recounted = recount !== null && recount.at > seededAt;
  const crapRecounted = crap !== null && crap.at > seededAt;
  const changed = change2 !== null && change2.at > seededAt;
  if (!recounted && !crapRecounted && !changed) return null;
  const crapOver = () => failingOf(store, worktreeId, ["crap"]).length;
  return {
    news: {
      v: 1,
      entries: [],
      more: 0,
      ...recounted ? { recount: { ...recount, over } } : {},
      // Row 015-40: a `crap.threshold` change, as D6's summary for complexity.
      ...crapRecounted ? { crapRecount: { ...crap, over: crapOver() } } : {},
      // Row 015-64: a coverage check switched off or files newly excluded (D1).
      ...changed ? { coverageChange: change2 } : {}
    },
    newest: Math.max(recount?.at ?? 0, crap?.at ?? 0, change2?.at ?? 0)
  };
}
function codeStep(store, consumer, { at, since, limit }, write2) {
  const { worktreeId } = consumer;
  const seeded = readJson(store, seededKey(consumer));
  const seededAt = typeof seeded === "number" ? seeded : 0;
  const failing = failingIn(store, worktreeId);
  const tooBig = newTooBig(store, consumer, since, limit, write2);
  const big = tooBig.length === 0 ? {} : { tooBig };
  const summary = summaryNews(store, worktreeId, failing.length, seededAt);
  if (summary !== null) {
    if (write2) seed(store, consumer, failing, Math.max(at, summary.newest));
    return { news: { ...summary.news, ...big }, writes: true };
  }
  const covered = coverageMeasures(store, worktreeId);
  const measures = [MEASURE, ...covered];
  const edits = new Map(
    measures.flatMap((m) => store.states.edits(worktreeId, m)).map((e) => [codeKey(e), e])
  );
  const view = store.views.list(consumer).filter((v) => measures.includes(v.measure));
  const judged2 = [...failing, ...failingOf(store, worktreeId, covered)];
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
  const listed4 = plan.entries.slice(0, CODE_LISTED_MAX);
  const more = plan.entries.slice(CODE_LISTED_MAX).filter((e) => !isStillFail(e.kind)).length;
  if (write2) {
    const full = new Set(listed4.map(codeKey));
    store.views.removeMany(consumer, plan.removals);
    store.views.writeMany(
      consumer,
      plan.writes.map((w) => full.has(codeKey(w)) ? w : { ...w, told: "count" })
    );
  }
  const writes = plan.removals.length + plan.writes.length + tooBig.length > 0;
  if (plan.entries.length === 0 && tooBig.length === 0) return { news: null, writes };
  const entries = listed4.map((e) => ({
    ...e,
    line: e.kind === "removed" ? null : lineOf(store, worktreeId, e.check),
    ...evidenceOf(store, worktreeId, e)
  }));
  const coverage = plan.entries.some(isCoverage) ? { coverage: true } : {};
  return { news: { v: 1, entries, more, ...big, ...coverage }, writes };
}
function tellCode(source, consumer, at, since, { changes = true, toldOver: toldOver2 = false, loaders, holds } = {}) {
  if (!changes && !toldOver2) return null;
  const told = withCode2(source, (access) => {
    const { store, complexity } = access;
    const seen = since();
    const over = (news) => toldOver2 ? withToldOver(store, consumer, news, complexity, seen) : news;
    if (changes) {
      const input = { at, since: seen, limit: complexity.maxFileBytes };
      if (store.read(() => codeStep(store, consumer, input, false)).writes) {
        return heldWrite(
          access,
          () => over(
            withUntested(store, consumer, codeStep(store, consumer, input, true).news, loaders)
          ),
          holds
        );
      }
    }
    if (!toldOver2) return null;
    return store.read(() => summaryChanged(store, consumer, complexity, seen)) ? heldWrite(access, () => over(null), holds) : null;
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
function earliest(store, consumers) {
  const bounds = consumers.flatMap((c) => codeSeenUpTo(store, c) ?? []);
  return bounds.reduce((a, b) => a === null || b.since < a.since ? b : a, null);
}
function registeredOf(store, worktreeId, shell) {
  const registered = store.consumers.list(worktreeId).map((r) => r.consumer);
  const own = registered.filter(
    (c) => shell?.session != null && c.sessionId === shell.session && (shell.agent === null || c.agentId === shell.agent)
  );
  return { registered, own };
}
function codeSince(store, worktreeId, shell) {
  const { registered, own } = registeredOf(store, worktreeId, shell);
  const session = earliest(store, own);
  if (session !== null) return { ...session, scope: "session" };
  const oldest = earliest(store, registered);
  return oldest === null ? null : { ...oldest, scope: "oldest" };
}
function wentOverSince(code, worktreeId, since, measures = ["complexity"]) {
  return measures.flatMap(
    (measure2) => code.states.list(worktreeId, { measure: measure2, outcome: "fail" }).filter((s) => {
      const last = lastTransition(code, worktreeId, s.check, measure2);
      return last?.to === "fail" && isOwn(since, last.revision);
    })
  );
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

// src/core/delivery/consumer-version.ts
function versionMetaKey(worktreeId) {
  return worktreeMetaKey("consumerVersion", worktreeId);
}
function recordVersion(store, consumer, version) {
  writeSlot(store, versionMetaKey(consumer.worktreeId), consumer, version);
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
function payCounts(store, consumer, header) {
  const key = countsOwedMetaKey(consumer.worktreeId);
  if (owed(header) || readSlot(store, key, consumer) !== true) return {};
  writeSlot(store, key, consumer, null);
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  const lookupOnly = root !== void 0 && readPolicy(root).baseline.onStart === "lookup-only";
  return { countsOwed: { lookupOnly } };
}
var owed = (header) => header.testFilesListed === false;

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
  let owed2 = false;
  for (const [id, entry3] of readRekeyed(store, consumer.worktreeId)) {
    const row = rows.get(id);
    if (row === void 0 || row.key === null || entry3.last <= state.since) continue;
    rekeyed.push(row);
    owed2 ||= row.pending !== null;
  }
  const sawEdit = state.said || rekeyed.length === 0 ? void 0 : { queued: rekeyed.length };
  const editsSettled = owed2 ? void 0 : settled2(state.since, rekeyed, states);
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
function settled2(since, rekeyed, states) {
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
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";

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

// src/core/presence/events.ts
function forgetRest(store, worktreeId) {
  store.meta.delete(daemonRestMetaKey(worktreeId));
}

// src/core/delivery/liveness.ts
function readLiveHeader(store, worktreeId, now, states, since = null, keys) {
  const worktree = store.worktrees.get(worktreeId);
  const presence = readPresence(store, worktreeId, now, worktree);
  const runs = openRuns(store, worktree, presence.heartbeat);
  const open2 = new Set(runs.flatMap((run2) => run2.testFiles.map(testFileId)));
  const header = readHeader(store, worktreeId, states, keys, void 0, open2);
  const changes = changedSince(store, worktreeId, header.revision, since);
  const installed2 = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path)
  );
  const ignored = [...changes.values()].filter((c) => c.ignored === true).map((c) => c.path);
  const holds = readHolds(store, worktree, presence.heartbeat, now);
  return {
    ...header,
    ...holds.length === 0 ? {} : { holds },
    daemon: headerView(presence),
    changedPaths: [...changes.keys()],
    ...ignored.length === 0 ? {} : { ignoredPaths: ignored },
    ...installed2 === void 0 ? {} : { installedLockfile: installed2.path }
  };
}
function changedSince(store, worktreeId, revision, since) {
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
function livenessChange(store, consumer, at) {
  const presence = readPresence(store, consumer.worktreeId, at);
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
function groupsToldMetaKey(worktreeId) {
  return worktreeMetaKey("groupTiersTold", worktreeId);
}
function groupTiersState(groups2) {
  if (groups2 === void 0) return null;
  return JSON.stringify(groups2.map((group) => [group.name, slowTierState(group)]));
}
function groupTiersChanged(store, consumer, groups2) {
  const state = groupTiersState(groups2);
  return state !== null && readSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer) !== state;
}
function tellGroupTiers(store, consumer, groups2) {
  writeSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer, groupTiersState(groups2));
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
  const files = Array.isArray(value.testFiles) ? value.testFiles : [];
  const keys = isRecord(value.keys) ? Object.entries(value.keys).filter(
    (e) => typeof e[1] === "string" || e[1] === null
  ) : null;
  return {
    turn: "idle",
    testFiles: files.filter((f) => typeof f === "string"),
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
  const holds = isRecord(value) ? value.stopHolds : void 0;
  return typeof holds === "number" && Number.isInteger(holds) && holds > 0 ? holds : 0;
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
  const files = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") files.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.key !== null && k.pending !== null) files.add(testFileId(k.testFile));
  for (const e of undelivered) files.add(testFileKeyOf(e.check));
  const header = readHeader(store, consumer.worktreeId, states, keys);
  const current2 = currentKeys(keys);
  const testFiles = [...files].sort();
  const owed2 = Object.fromEntries(testFiles.map((f) => [f, current2.get(f) ?? null]));
  const newTestFiles = header.runnerPartPending === true;
  const { revision } = header;
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles,
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
  const files = state.testFiles.map(fromTestFileId);
  const owed2 = files.length === 0 ? [] : store.knownStates.list(consumer.worktreeId, files);
  const untold = state.newTestFiles ? store.knownStates.untold(consumer) : [];
  const seen = new Set(owed2.map((s) => checkIdentity(s.check)));
  return {
    states: [...owed2, ...untold.filter((s) => !seen.has(checkIdentity(s.check)))],
    view: files.length === 0 ? [] : store.views.list(consumer, files),
    keys: files.length === 0 ? [] : store.testFileKeys.list(consumer.worktreeId, files)
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
  const named3 = match?.[1] ?? match?.[2];
  return named3 === void 0 ? null : named3.split(", ");
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
function commitHolds(holds) {
  endInOrder(holds, (held) => held.commit(), rollbackHolds);
}
function rollbackHolds(holds) {
  for (const held of [...holds].reverse()) {
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
    const settled3 = acknowledge;
    try {
      held?.commit();
    } catch (error) {
      rollbackHolds(code);
      throw error;
    }
    if (settled3 === null) return rollbackHolds(code);
    commitHolds(code);
    settled3();
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
    settle(report, then) {
      acknowledge = then;
      if (held !== null && report === null) commit();
      return report;
    }
  };
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
      sourceOf: importSourceOf(store),
      revision,
      history: (check) => store.transitions.history(consumer.worktreeId, check),
      ownEdit: ownEditUnknown(store, consumer, revision)
    });
    return keep === null ? full : restrictPlan(full, keep);
  }
  function deliver2(consumer, {
    heardFrom,
    keep = null,
    liveness = false,
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
      const quiet = !liveness || livenessChange(store, consumer, now()) === null && holdsChange(store, consumer, now()) === null;
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
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const delta2 = plan(consumer, states, at, selection.only);
      store.views.removeMany(consumer, delta2.removals);
      store.views.writeMany(consumer, delta2.writes);
      const { live: changed, held: holds } = toldAtStop(
        { stop, transitions: delta2.entries.length > 0 },
        {
          live: liveness ? livenessChange(store, consumer, at) : null,
          held: liveness ? holdsChange(store, consumer, at) : null
        }
      );
      if (changed !== null) tellLiveness(store, consumer, toldOf(changed));
      if (holds !== null) tellHolds(store, consumer, holds.now);
      const tests2 = delta2.entries.length > 0 || changed !== null || holds !== null;
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
      const notes = liveness || idle && news ? editNotes(store, consumer, states, news) : null;
      const delivered = news || liveness && !stop && notes?.sawEdit !== void 0;
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
        delta2.entries,
        live,
        states
      );
      notes?.tell();
      const slowChanged = slowTierChanged(store, consumer, header.slowTier);
      if (stop || slowChanged) tellSlowTier(store, consumer, header.slowTier);
      const groupsChanged = groupTiersChanged(store, consumer, header.groupTiers);
      if (stop || groupsChanged) tellGroupTiers(store, consumer, header.groupTiers);
      if (commit !== void 0) tellCommit(store, consumer, commit);
      const countsOwed = payCounts(store, consumer, header);
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
        ...holds === null ? {} : { holds: holdChanges(holds, header) },
        ...slowChanged ? { slowTierChanged: true } : {},
        ...groupsChanged ? { groupTiersChanged: true } : {},
        ...commit === void 0 ? {} : { commitChanged: true },
        ...countsOwed,
        ...sawEdit === void 0 ? {} : { sawEdit },
        ...notes?.editsSettled === void 0 ? {} : { editsSettled: notes.editsSettled },
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
    const delta = deliver2(consumer, { heardFrom: false, idle: true });
    quietAt.delete(key);
    if (delta !== null || before === null) return delta;
    const after = changeMarker(store);
    quietAt.set(key, after !== null && after.others === before.others ? after : before);
    return null;
  }
  const free = () => holdFree(options.prepare?.connection, HOOK_TIMEOUT_MS);
  const unit = (work) => {
    const freed = async () => {
      const wait = free();
      if (wait !== null) await wait;
      return work();
    };
    return options.prepare?.unit?.(freed) ?? freed();
  };
  return {
    register: (consumer, registerOptions = {}) => unit(() => registerNow(consumer, registerOptions)),
    unregister: (consumer) => unit(() => store.transaction(() => drop(store, consumer, now()))),
    onToolBoundary: (consumer, { stop = false, atRevision } = {}) => unit(
      () => deliver2(consumer, {
        heardFrom: true,
        liveness: true,
        stop,
        ...atRevision === void 0 ? {} : { atRevision }
      })
    ),
    peek: (consumer, { kinds }) => {
      const only = new Set(kinds);
      return unit(() => deliver2(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) }));
    },
    startTurn: (consumer) => unit(() => {
      promptTurn(store, consumer);
      return deliver2(consumer, { heardFrom: true, liveness: true });
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
  function registerNow(consumer, { inTurn = false, atStart = false, startingSince }) {
    return store.transaction(() => {
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
      tellGroupTiers(store, consumer, header.groupTiers);
      tellCommit(store, consumer, header.commitLine);
      oweCounts(store, consumer, header);
      tellHolds(store, consumer, heldNow(store, consumer.worktreeId, at));
      if (!registered) {
        const alive = atStart && header.daemon?.state === "alive";
        const resumed = tellRegistered(store, consumer, header.revision, {
          at,
          scanned: scannedDaemon(store, consumer.worktreeId, alive),
          head: options.root === void 0 ? null : registrationHead(options.root)
        });
        startEdits(store, consumer, header.revision, resumed?.said === true);
        if (resumed !== null) recordUncoveredTold(store, consumer, resumed.uncovered);
      }
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
    const token = this.#token;
    if (release2) this.#token = null;
    const request = {
      type: "write",
      worktreeId: this.#options.worktreeId,
      storeSchema: this.#options.storeSchema,
      token,
      release: release2,
      batch: encodeBatch(batch)
    };
    const answer = await this.#ask(socket, request);
    if (!isWrite(answer)) return this.#notTaken("not-taken", socket, token);
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
      if (!isWrite(next)) throw new Error(`squeal: ${errorOf(next)}`);
      state = next;
    }
    if (state.written) return "written";
    return this.#notTaken("not-taken", socket, release2 ? null : token);
  }
  async release() {
    const token = this.#token;
    const socket = this.#socket;
    this.#token = null;
    if (token === null || socket === null || socket === void 0) return;
    const { worktreeId } = this.#options;
    await this.#ask(socket, { type: "release", worktreeId, token });
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
  async #notTaken(answer, socket, token) {
    this.#off = true;
    this.#token = null;
    if (socket !== void 0 && token !== void 0 && token !== null) {
      const { worktreeId } = this.#options;
      await this.#ask(socket, { type: "release", worktreeId, token }).catch(() => null);
    }
    return answer;
  }
  #timeout() {
    return this.#options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }
};
function isLease(answer) {
  if (answer === null || !answer.ok || answer.type !== "lease") return false;
  const { token, holder } = answer;
  return (token === null || typeof token === "string") && holder !== void 0;
}
function isWrite(answer) {
  if (answer === null || !answer.ok || answer.type !== "write") return false;
  const { requestId, written: written2 } = answer;
  return typeof requestId === "string" && (written2 === null || typeof written2 === "boolean");
}
function pauseOf(pauses2, attempt) {
  return pauses2[Math.min(attempt, pauses2.length - 1)] ?? 0;
}
function errorOf(response) {
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

// src/core/delivery/sent-meta.ts
var READ = "SELECT value FROM meta WHERE key = ?";
var SETS = /* @__PURE__ */ new Set([
  "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
]);
var DELETE = "DELETE FROM meta WHERE key = ?";
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
        const result = await work();
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
  /** Waits until every batch sent so far is written; rethrows the first that failed. */
  async sent() {
    while (this.#sending.size > 0) await Promise.allSettled([...this.#sending]);
    const failure2 = this.#failure;
    this.#failure = null;
    if (failure2 !== null) throw failure2;
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
    if (this.#unsent > 0) {
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
    if (this.#held !== null) this.#held.push(...batch);
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
  if (connection === null) throw new Error("squeal: the store opened without its connection");
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  const now = (options.now ?? Date.now)();
  if (daemonLiveness(record, now).state !== "alive") connection.writeDirectly();
  const acquire = () => sender?.acquire() ?? Promise.resolve(false);
  return { store, connection, write: (work) => connection.unit(work, acquire) };
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

// src/core/node-pin.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync15, realpathSync as realpathSync4, statSync as statSync4 } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname as dirname6, isAbsolute as isAbsolute8, join as join20 } from "node:path";

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
function readPin(root) {
  for (const name2 of PIN_FILES) {
    let text2;
    try {
      text2 = readFileSync15(join20(root, name2), "utf8");
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
  return loadConfigFile(join20(root, "squeal.config.json"), NODE_SHAPE, {
    node: "project"
  }).value.node;
}
function managerCandidates(version, env) {
  const home = env.HOME ?? homedir();
  const data = env.XDG_DATA_HOME ?? join20(home, ".local", "share");
  const fnm = env.FNM_DIR === void 0 ? [join20(data, "fnm"), join20(home, ".fnm"), join20(home, "Library", "Application Support", "fnm")] : [env.FNM_DIR];
  return [
    join20(env.NVM_DIR ?? join20(home, ".nvm"), "versions", "node", `v${version}`, "bin", "node"),
    ...fnm.map((dir) => join20(dir, "node-versions", `v${version}`, "installation", "bin", "node")),
    join20(env.VOLTA_HOME ?? join20(home, ".volta"), "tools", "image", "node", version, "bin", "node"),
    join20(env.ASDF_DATA_DIR ?? join20(home, ".asdf"), "installs", "nodejs", version, "bin", "node"),
    join20(env.MISE_DATA_DIR ?? join20(data, "mise"), "installs", "node", version, "bin", "node"),
    join20(env.N_PREFIX ?? "/usr/local", "n", "versions", "node", version, "bin", "node")
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
    if (!isAbsolute8(dir)) continue;
    const candidate = join20(dir, "node");
    const resolved = real(candidate);
    if (resolved === null || resolved === own || seen.has(resolved)) continue;
    seen.add(resolved);
    const said = probe(candidate, ["-p", SELF], { env, cwd: root })?.split("\n");
    const binary = said?.[1]?.trim();
    if (said?.[0]?.trim() === `v${version}` && binary !== void 0 && isAbsolute8(binary)) {
      return binary;
    }
  }
  return null;
}
function real(path) {
  try {
    return realpathSync4(path);
  } catch {
    return null;
  }
}
function fileStat(path) {
  try {
    return statSync4(path);
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

// src/core/retry/pending.ts
function pendingRetriesOf(store, keys, load = hostLoad, runs = []) {
  const current2 = new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
  const byFile = /* @__PURE__ */ new Map();
  for (const r of readRetries(store)) {
    const id = testFileId(r.testFile);
    if (r.end !== null || current2.get(id) !== r.key) continue;
    byFile.set(id, [...byFile.get(id) ?? [], r]);
  }
  if (byFile.size === 0) return {};
  const running = new Map(
    keys.filter((k) => k.pending === "running").map((k) => [testFileId(k.testFile), k])
  );
  const retries = [...byFile.values()].map((records) => {
    const id = testFileId(records[0].testFile);
    const run2 = running.has(id) ? runs.find((r) => r.testFiles.some((f) => testFileId(f) === id)) : void 0;
    return { ...entry2(records), ...run2 === void 0 ? {} : { runningSince: run2.startedAt } };
  });
  const { oneMinute, cpus } = load();
  return { pendingRetries: { retries, loadAverage: oneMinute, cpus } };
}
function entry2(records) {
  const first = records[0];
  const testFile = first.testFile;
  const since = gateClosedSince(records);
  return {
    testFile,
    reason: records.some((r) => r.reason === "environment") ? "environment" : "load",
    // A run asked for a file with no result starts at once whatever its reason (011 C5, gh-36).
    ...records.some((r) => r.noResult === true) ? { noResult: true } : {},
    askedAt: first.askedAt,
    claimedBy: records.find((r) => r.claim !== null)?.claim?.worktreeId ?? null,
    requests: records.length,
    // Row 011-213: since when the load gate has been closed on it.
    ...since === null ? {} : { gateClosedAt: since }
  };
}

// src/core/status/code-status.ts
import { readFileSync as readFileSync16 } from "node:fs";
import { join as join21 } from "node:path";

// src/core/code/crap/checks.ts
function coverageChecks(policy) {
  const on = {
    crap: policy.crap.enabled,
    uncovered: policy.coverage.untested
  };
  return {
    measures: COVERAGE_MEASURES.filter((m) => on[m]),
    exclude: policy.coverage.exclude,
    excluded: createInputMatcher(policy.coverage.exclude),
    children: policy.coverage.children
  };
}
function checksField(measures) {
  return measures.length === COVERAGE_MEASURES.length ? {} : { checks: measures };
}

// src/core/code/crap/status.ts
function coverageStatusOf(store, worktreeId, policy) {
  const summary = readSummary(store.meta, worktreeId);
  if (summary === null) return void 0;
  const fails = (measure2) => store.states.list(worktreeId, { measure: measure2, outcome: "fail" }).length;
  const files = Object.values(summary.files);
  const waiting = (reason) => files.filter((f) => f.state === "pending" && f.reason === reason).length;
  const causes = {};
  for (const f of files) if (f.state === "unknown") causes[f.cause] = (causes[f.cause] ?? 0) + 1;
  const notRead = [...policy.vitest.exclude, ...policy.vitest.excludeProjects];
  return {
    v: 1,
    threshold: policy.crap.threshold,
    crap: fails("crap"),
    uncovered: fails("uncovered"),
    files: files.length,
    waitingForRuns: waiting("run"),
    waitingForRecords: waiting("record"),
    ...waiting("imports") === 0 ? {} : {
      waitingForImports: { files: waiting("imports"), testFiles: summary.withoutImports ?? 0 }
    },
    unknown: causes,
    ...notRead.length === 0 ? {} : { notRead },
    ...checksField(coverageChecks(policy).measures)
  };
}

// src/core/status/code-status.ts
function codeStatusOf(store, worktreeId, at, shell) {
  const policy = readPolicy(at.root);
  if (!policy.complexity.enabled) return {};
  const commonDir = at.commonDir();
  if (commonDir === null) return {};
  const idle = coverageOn(policy) ? [] : setWithoutCoverage(at.root);
  const without = idle.length === 0 ? {} : { withoutCoverage: idle };
  const source = codeSource(commonDir, at.root);
  const since = () => codeSince(store, worktreeId, shell);
  const coverageOf2 = (code) => {
    const coverage = coverageOn(policy) ? coverageStatusOf(code, worktreeId, policy) : void 0;
    return coverage === void 0 ? {} : { coverage };
  };
  const read4 = withCode2(
    source,
    ({ store: code, complexity }) => code.read(() => {
      const states = code.states.list(worktreeId, { measure: "complexity" });
      const from = since();
      const { done, total, uncountable } = countingOf(code, worktreeId);
      return {
        v: 1,
        threshold: complexity.threshold,
        over: states.filter((s) => s.outcome === "fail").length,
        sinceRegistration: from === null ? 0 : wentOverSince(code, worktreeId, from).length,
        since: from?.scope ?? null,
        pending: total - done,
        files: total,
        unknown: states.filter((s) => s.outcome === "unknown").length,
        ...uncountable === 0 ? {} : { uncountable },
        ...coverageOf2(code),
        ...without
      };
    })
  );
  if (read4 !== "missing") return read4 === null ? {} : { code: read4 };
  const threshold = source.policy()?.threshold;
  if (threshold === void 0) return {};
  return {
    code: {
      v: 1,
      threshold,
      over: 0,
      sinceRegistration: 0,
      since: null,
      pending: 0,
      files: 0,
      unknown: 0,
      ...without
    }
  };
}
function setWithoutCoverage(root) {
  let config;
  try {
    config = JSON.parse(readFileSync16(join21(root, POLICY_FILE), "utf8"));
  } catch {
    return [];
  }
  const on = (section, key) => isRecord(config) && isRecord(config[section]) && config[section][key] === true;
  return [
    ...on("crap", "enabled") ? ["crap.enabled"] : [],
    ...on("coverage", "untested") ? ["coverage.untested"] : []
  ];
}

// src/core/status/config-problems.ts
function configProblemsOf(root) {
  const { problems } = loadPolicy(root);
  return problems.length === 0 ? {} : { configProblems: problems };
}

// src/core/scheduler/promotions-row.ts
function promotionsMetaKey(worktreeId) {
  return worktreeMetaKey("promotions", worktreeId);
}
function publishedBatches(store, worktreeId, daemonStartedAt, now) {
  const places = /* @__PURE__ */ new Map();
  const row = readRow(store, worktreeId);
  if (row === null || row.at < daemonStartedAt) return places;
  const batches = row.entries.filter(isBatch);
  for (const p of row.entries) {
    const position = batches.indexOf(p) + 1;
    if (position === 0 && (p.batch !== void 0 || p.until <= now)) continue;
    const files = strings4(position === 0 ? p.files : p.batch?.files);
    const end = p.batch?.estimatedEnd;
    const place = position === 0 ? null : {
      position,
      of: batches.length,
      files: files.length,
      estimatedEnd: typeof end === "number" ? end : null
    };
    for (const f of files) if (!places.has(f)) places.set(f, place);
  }
  return places;
}
function readRow(store, worktreeId) {
  const raw = store.meta.get(promotionsMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const { at, promotions } = JSON.parse(raw);
    if (typeof at !== "number" || !Array.isArray(promotions)) return null;
    const entries = promotions.filter(
      (p) => typeof p === "object" && p !== null && typeof p.until === "number" && Array.isArray(p.files)
    );
    return { at, entries };
  } catch {
    return null;
  }
}
function isBatch(p) {
  return typeof p.batch === "object" && p.batch !== null && (p.batch.files?.length ?? 0) > 0;
}
function strings4(value) {
  return Array.isArray(value) ? value.filter((f) => typeof f === "string") : [];
}

// src/core/scheduler/focused-row.ts
function focusedMetaKey(worktreeId) {
  return worktreeMetaKey("focused", worktreeId);
}
function readFocused(store, worktreeId) {
  const raw = store.meta.get(focusedMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isFocusedRun) : [];
  } catch {
    return [];
  }
}
function isFocusedRun(value) {
  if (typeof value !== "object" || value === null) return false;
  const run2 = value;
  const file = run2.testFile;
  return typeof file?.project === "string" && typeof file.path === "string" && typeof run2.key === "string" && typeof run2.revision === "number" && typeof run2.runId === "string" && Array.isArray(run2.texts) && Array.isArray(run2.checks);
}

// src/core/status/focused.ts
function readFocusedFiles(store, worktreeId, files) {
  const runs = readFocused(store, worktreeId);
  const refs = files ?? runs.map((run2) => run2.testFile);
  if (refs.length === 0) return [];
  const keys = new Map(
    store.testFileKeys.list(worktreeId, refs).map((row) => [testFileId(row.testFile), row.key])
  );
  const byFile = new Map(runs.map((run2) => [testFileId(run2.testFile), run2]));
  return refs.map((testFile) => {
    const key = keys.get(testFileId(testFile)) ?? null;
    const run2 = byFile.get(testFileId(testFile));
    const results = key === null ? [] : store.results.byKey(key, 0);
    const applies = run2 !== void 0 && run2.key === key && results.length === 0;
    return { testFile, key, ...run2 === void 0 ? {} : { run: run2 }, results, applies };
  });
}
function readStatusFocused(store, worktreeId, phases) {
  return readFocusedFiles(store, worktreeId).flatMap(({ testFile, run: run2, applies }) => {
    if (run2 === void 0) return [];
    const phase = phases.get(testFileId(testFile))?.phase ?? null;
    return [{ ...statusFocusedOf(run2, applies), phase }];
  });
}
function statusFocusedOf(run2, applies) {
  return {
    testFile: run2.testFile,
    key: run2.key,
    revision: run2.revision,
    texts: run2.texts,
    runId: run2.runId,
    logDir: run2.logDir,
    startedAt: run2.startedAt,
    endedAt: run2.endedAt,
    durationMs: run2.endedAt === null ? null : Math.max(0, run2.endedAt - run2.startedAt),
    end: run2.end,
    reason: run2.reason,
    collected: run2.collected,
    matched: run2.matched,
    checks: run2.checks.map(focusedCheckOf),
    more: run2.more,
    ...countsOf3(run2.outcomes) ?? {},
    applies
  };
}
function focusedCheckOf(c) {
  return {
    check: c.check,
    name: formatCheck(c.check),
    outcome: c.outcome,
    durationMs: c.durationMs,
    summary: c.summary,
    location: c.location
  };
}
function countsOf3(outcomes) {
  if (typeof outcomes !== "object" || outcomes === null) return null;
  const { pass, fail, skip } = outcomes;
  const whole = (n) => Number.isInteger(n) && n >= 0;
  return whole(pass) && whole(fail) && whole(skip) ? { outcomes: { pass, fail, skip } } : null;
}

// src/core/keys/modules.ts
function observedModulesMetaKey(project) {
  return `observedModules.${project}`;
}

// src/core/scheduler/imports-waiting.ts
function importsWaitingMetaKey(worktreeId) {
  return worktreeMetaKey("importsWaiting", worktreeId);
}
function importsWaiting(store, worktreeId) {
  const value = store.meta.get(importsWaitingMetaKey(worktreeId));
  if (value === null) return [];
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// src/core/store/environments.ts
var ENVIRONMENT_TABLES = {
  environments: `
CREATE TABLE environments (
  hash TEXT PRIMARY KEY,
  descriptor TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`,
  worktree_environment_hashes: `
CREATE TABLE worktree_environment_hashes (
  worktree_id TEXT NOT NULL,
  project TEXT NOT NULL,
  hash TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, project)
) STRICT, WITHOUT ROWID;
`
};
function readEnvironment(store, hash2) {
  const conn = openedConnection(store);
  if (conn === null || !hasTables2(conn)) return null;
  const row = conn.get("SELECT descriptor FROM environments WHERE hash = ?", hash2);
  return row === null ? null : parseDescriptor(row.descriptor);
}
function worktreeEnvironments(store, worktreeId) {
  const conn = openedConnection(store);
  if (conn === null || !hasTables2(conn)) return [];
  return conn.all(
    `SELECT w.project, w.hash, w.recorded_at, e.descriptor
       FROM worktree_environment_hashes w LEFT JOIN environments e ON e.hash = w.hash
       WHERE w.worktree_id = ? ORDER BY w.project`,
    worktreeId
  ).map(stored3);
}
function stored3(row) {
  return {
    project: String(row.project),
    hash: String(row.hash),
    descriptor: parseDescriptor(row.descriptor),
    recordedAt: Number(row.recorded_at)
  };
}
function parseDescriptor(text2) {
  if (typeof text2 !== "string") return null;
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const d = value;
  const strings5 = [
    "project",
    "runnerName",
    "runnerVersion",
    "adapterVersion",
    "nodeVersion",
    "platform",
    "arch",
    "installedDependencies"
  ];
  const env = d.env;
  const sound = typeof d.keyFormat === "number" && strings5.every((name2) => typeof d[name2] === "string") && typeof env === "object" && env !== null && Array.isArray(env.names) && typeof env.hash === "string" && typeof d.config === "object" && d.config !== null && Array.isArray(d.files) && typeof d.ci === "boolean";
  return sound ? value : null;
}
function openedConnection(store) {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}
function hasTables2(conn) {
  const found2 = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(Object.keys(ENVIRONMENT_TABLES))
  );
  return found2.length === Object.keys(ENVIRONMENT_TABLES).length;
}

// src/core/store/transfer-bundle.ts
import { createHash as createHash7 } from "node:crypto";
var OBSERVED_MAPS = ["observed", "observedDirect", "observedModules"];
function listHash(paths) {
  const sorted = [...new Set(paths)].sort(compare);
  return createHash7("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}
var STATIC_LIST = "static:";
function staticListHash(paths, observed = []) {
  const taken = new Set(observed);
  return `${STATIC_LIST}${listHash(paths.filter((p) => !taken.has(p)))}`;
}
function observedHash(observed) {
  return listHash(OBSERVED_MAPS.flatMap((map) => (observed[map] ?? []).map((p) => `${map}:${p}`)));
}

// src/core/keys/environment-descriptor.ts
import { createHash as createHash8 } from "node:crypto";
function configFieldHash(value) {
  return digest(JSON.stringify(value));
}
function digest(text2) {
  return createHash8("sha256").update(text2).digest("hex");
}
var PLAIN = [
  ["keyFormat", "key format"],
  ["project", "project"],
  ["runnerName", "runner"],
  ["runnerVersion", "runner version"],
  ["adapterVersion", "adapter version"],
  ["nodeVersion", "Node"],
  ["platform", "platform"],
  ["arch", "arch"]
];
var SHOWN = 5;
function describeDifferences(a, b) {
  const differences = [];
  for (const [part, word] of PLAIN) {
    const [x, y] = [String(a[part]), String(b[part])];
    if (x === y) continue;
    const shown = part === "project" ? [JSON.stringify(x), JSON.stringify(y)] : [x, y];
    differences.push({
      part,
      values: [x, y],
      text: `${word} ${shown[0]} in the export, ${shown[1]} here`
    });
  }
  if (a.installedDependencies !== b.installedDependencies) {
    differences.push({ part: "installedDependencies", text: installedText(a, b) });
  }
  if (a.env.hash !== b.env.hash) differences.push(envDifference(a.env.names, b.env.names));
  const fields = differingNames(
    new Map(Object.entries(a.config)),
    new Map(Object.entries(b.config))
  );
  const files = differingNames(new Map(a.files), new Map(b.files));
  if (fields.length > 0) {
    const onlyFields = differences.length === 0 && files.length === 0;
    const ci = a.ci && !b.ci && onlyFields ? " (the export ran with CI set)" : "";
    differences.push({
      part: "config",
      names: fields,
      text: `config fields ${listed(fields)} differ${ci}`
    });
  }
  if (files.length > 0) {
    differences.push({
      part: "files",
      names: files,
      text: `config and setup files differ: ${listed(files)}`
    });
  }
  return differences;
}
var CI_FIELDS = ["watch", "coverage"];
var ONLY_REJECTED = configFieldHash(false);
var ONLY_ALLOWED = configFieldHash(true);
function importDifferences(exported, local) {
  if (exported.runnerName !== "vitest" || local.runnerName !== "vitest") {
    return describeDifferences(exported, local);
  }
  const tolerated = new Set(CI_FIELDS);
  if (exported.browser === false && local.browser === false) tolerated.add("browser");
  if (exported.config.allowOnly === ONLY_REJECTED && local.config.allowOnly === ONLY_ALLOWED) {
    tolerated.add("allowOnly");
  }
  const keyed = (d) => ({
    ...d,
    config: Object.fromEntries(Object.entries(d.config).filter(([name2]) => !tolerated.has(name2)))
  });
  return describeDifferences(keyed(exported), keyed(local));
}
function installedText(a, b) {
  if (a.installedDependencies === "none") return "no installed dependencies in the export";
  if (b.installedDependencies === "none") return "no installed dependencies here";
  return "installed dependencies differ";
}
function envDifference(a, b) {
  const ours = new Set(b);
  const theirs = new Set(a);
  const apart = [.../* @__PURE__ */ new Set([...a, ...b])].filter((n) => !ours.has(n) || !theirs.has(n)).sort(compare);
  if (apart.length > 0) {
    return {
      part: "env",
      names: apart,
      text: `allow-listed variables differ (names: ${listed(apart)})`
    };
  }
  return {
    part: "env",
    names: [...b],
    text: `allow-listed variables differ (values: ${listed(b)})`
  };
}
function differingNames(a, b) {
  const names2 = /* @__PURE__ */ new Set([...a.keys(), ...b.keys()]);
  return [...names2].filter((n) => !a.has(n) || !b.has(n) || a.get(n) !== b.get(n)).sort(compare);
}
function listed(names2) {
  const shown = names2.slice(0, SHOWN).join(", ");
  return names2.length > SHOWN ? `${shown} and ${names2.length - SHOWN} more` : shown;
}

// src/core/status/import-environment.ts
function blockingDifferences(exported, local) {
  if (exported === null || local === null) return ["parts not recorded"];
  return importDifferences(exported, local).map((d) => d.text);
}
var NODE_BUILD = "nodeBuild";
function nodeGap(exported, local) {
  if (exported === null || local === null) return { versions: null, onlyNode: false };
  const versions = exported.nodeVersion === local.nodeVersion ? null : [exported.nodeVersion, local.nodeVersion];
  const build = local.config[NODE_BUILD];
  const sameNode = {
    ...exported,
    nodeVersion: local.nodeVersion,
    config: build === void 0 || exported.config[NODE_BUILD] === void 0 ? exported.config : { ...exported.config, [NODE_BUILD]: build }
  };
  return { versions, onlyNode: importDifferences(sameNode, local).length === 0 };
}

// src/core/status/imports.ts
var MAP_KEY = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey
};
function readImports(store, worktreeId, keys, states) {
  const imports = listImports(store);
  if (imports.length === 0) return [];
  const here = hereOf(store, worktreeId, keys, states);
  return imports.flatMap((record) => {
    const files = importFiles(store, record.id).filter((f) => here.keys.has(testFileId(f)));
    if (files.length === 0) return [];
    const notCurrent = {
      sameKeyKept: 0,
      sameKeyNotAdopted: 0,
      environment: 0,
      closure: 0,
      observed: 0,
      content: 0,
      keysPending: 0,
      noKey: 0
    };
    let currentFiles = 0;
    let currentResults = 0;
    for (const file of files) {
      const reason = reasonOf(file, here);
      if (reason === "current") currentFiles++;
      else notCurrent[reason]++;
      const current2 = here.current.get(testFileId(file)) ?? [];
      currentResults += current2.filter((s) => fromImport(s, record.id)).length;
    }
    return [
      {
        importId: record.id,
        source: sourceLabel(record.header),
        commit: record.header.commit,
        importedAt: record.importedAt,
        currentResults,
        testFiles: files.length,
        currentFiles,
        notCurrent,
        ...notCurrent.environment === 0 ? { environmentDifferences: [] } : environmentOf(store, worktreeId, files)
      }
    ];
  });
}
function reasonOf(file, here) {
  const key = here.keys.get(testFileId(file));
  if (key?.key === file.key) return adoption(file, here);
  const environment = here.environments.get(file.project);
  if (environment !== void 0 && environment !== file.environment) return "environment";
  const closure = here.closure(file);
  if (closure !== null && file.closure !== "" && closure !== file.closure) return "closure";
  if (here.observed(file) !== file.observed) return "observed";
  if (key?.key === null || key?.key === void 0) return "noKey";
  return here.waiting.has(file.importId) ? "keysPending" : "content";
}
function adoption(file, here) {
  const current2 = here.current.get(testFileId(file)) ?? [];
  if (current2.length > 0) {
    return current2.every((s) => fromImport(s, file.importId)) ? "current" : "sameKeyKept";
  }
  return here.stored(file.importId, file.key) ? "sameKeyNotAdopted" : "sameKeyKept";
}
function fromImport(state, importId) {
  return state.origin?.kind === "imported" && state.origin.importId === importId;
}
function currentByFile(states) {
  const byFile = /* @__PURE__ */ new Map();
  for (const s of states) {
    if (s.validity !== "current" || s.check.kind === "setup") continue;
    const id = testFileId({ project: s.check.project, path: s.check.testPath });
    const list = byFile.get(id);
    if (list === void 0) byFile.set(id, [s]);
    else list.push(s);
  }
  return byFile;
}
function hereOf(store, worktreeId, keys, states) {
  const maps = /* @__PURE__ */ new Map();
  const entries = (map, project) => {
    const key = MAP_KEY[map](project);
    const read4 = maps.get(key) ?? readSharedEntries(store, key);
    maps.set(key, read4);
    return read4;
  };
  return {
    keys: new Map(keys.map((k) => [testFileId(k.testFile), k])),
    current: currentByFile(states),
    stored: (importId, key) => store.results.byKey(key, 0).some((r) => importIdOf(r.provenance.worktreeId) === importId),
    environments: new Map(worktreeEnvironments(store, worktreeId).map((e) => [e.project, e.hash])),
    waiting: new Set(importsWaiting(store, worktreeId)),
    closure: (file) => {
      const record = store.testFiles.get(file);
      if (record === null) return null;
      if (!file.closure.startsWith(STATIC_LIST)) return listHash(record.closure.paths);
      return staticListHash(record.closure.paths, entries("observed", file.project)[file.path]);
    },
    observed: (file) => {
      const observed = {};
      for (const map of OBSERVED_MAPS) {
        const paths = entries(map, file.project)[file.path];
        if (paths !== void 0) observed[map] = paths;
      }
      return observedHash(observed);
    }
  };
}
function environmentOf(store, worktreeId, files) {
  const local = new Map(worktreeEnvironments(store, worktreeId).map((e) => [e.project, e]));
  const projects2 = new Set(files.map((f) => f.project)).size;
  const differing = /* @__PURE__ */ new Map();
  for (const f of files) {
    const ours = local.get(f.project);
    if (ours !== void 0 && ours.hash !== f.environment) {
      differing.set(f.project, [f.environment, ours]);
    }
  }
  const named3 = [];
  const gaps = [];
  for (const [project, [hash2, ours]] of differing) {
    const theirs = readEnvironment(store, hash2);
    const texts = blockingDifferences(theirs, ours.descriptor);
    if (texts.length === 0) continue;
    gaps.push(nodeGap(theirs, ours.descriptor));
    named3.push(...projects2 === 1 ? texts : texts.map((d) => `${project || "(default)"}: ${d}`));
  }
  const versions = gaps.find((g) => g.versions !== null)?.versions;
  if (versions === void 0 || versions === null) return { environmentDifferences: named3 };
  const [theirNode, here] = versions;
  const only = gaps.every((g) => g.onlyNode);
  return { environmentDifferences: named3, node: { exported: theirNode, here, only } };
}

// src/core/lint/surface/report.ts
function closedAs(read4, empty) {
  if ("read" in read4) return read4.read;
  if (read4.closed === "missing") return empty({});
  if (read4.closed === "unreadable") return empty({ unreadable: read4.reason });
  return void 0;
}
var NOT_STARTED = { linting: { done: 0, total: 0 } };
var LEAVES_FAIL = /* @__PURE__ */ new Set(["first-seen-fail", "pass-to-fail", "fail-changed"]);
function wentToFail(store, worktreeId, states, since) {
  const failing = states.filter(isCurrentFail);
  if (failing.length === 0) return [];
  const cut = readKeying(store.meta, worktreeId)?.transition ?? 0;
  const into = /* @__PURE__ */ new Map();
  for (const t of store.transitions.after(worktreeId, cut)) {
    if (t.kind === "first-seen-fail" || t.kind === "pass-to-fail")
      into.set(lintCheckName(t.check), t);
  }
  const last = new Map(
    store.transitions.latest(worktreeId).map((t) => [lintCheckName(t.check), t])
  );
  return failing.flatMap((state) => {
    const t = into.get(lintCheckName(state.check));
    const kind = last.get(lintCheckName(state.check))?.kind;
    if (t === void 0 || kind === void 0 || !LEAVES_FAIL.has(kind)) return [];
    return isOwn(since, t.revision) ? [{ state, revision: t.revision }] : [];
  });
}
function lintStatus(source, worktreeId, since) {
  const scope = since?.scope ?? null;
  const read4 = withLint(
    source,
    ({ store }) => store.read(() => {
      const states = store.states.list(worktreeId);
      const linting = progressOf(store, worktreeId, states);
      const went = since === null ? [] : wentToFail(store, worktreeId, states, since);
      const awaiting2 = awaitingPause(store.meta, worktreeId, states);
      const asked = awaitingRun(store.meta, worktreeId, states);
      return {
        v: 1,
        ...countsOf2(states),
        ...awaiting2 === 0 ? {} : { awaitingPause: awaiting2 },
        ...asked.length === 0 ? {} : { awaitingRun: asked },
        sinceRegistration: went.length,
        since: scope,
        ...linting === void 0 ? {} : { linting },
        ...reasonsOf(store, worktreeId)
      };
    })
  );
  return closedAs(read4, (reasons) => ({
    v: 1,
    files: 0,
    failing: 0,
    sinceRegistration: 0,
    since: scope,
    pending: 0,
    stale: 0,
    unknown: 0,
    reasons: [],
    ...reasons.unreadable === void 0 ? NOT_STARTED : reasons
  }));
}

// src/core/status/lint-status.ts
function lintStatusOf(store, worktreeId, at, shell) {
  const commonDir = at.commonDir();
  if (commonDir === null) return {};
  const source = lintStoreSource(commonDir, at.root);
  if (source.policy() === null) return {};
  const lint2 = lintStatus(source, worktreeId, codeSince(store, worktreeId, shell));
  return lint2 === void 0 ? {} : { lint: lint2 };
}

// src/core/status/node-mismatch.ts
function sharedOf(ref2, imports, pin) {
  if (ref2 === null) return {};
  const newest = imports[0];
  if (newest?.node === void 0) return { shared: { ref: ref2 } };
  const node2 = {
    needed: newest.node.exported,
    daemon: newest.node.here,
    pin: pinOf(pin()),
    testFiles: newest.notCurrent.environment,
    imports: imports.filter((i) => i.node?.only === true).length
  };
  return { shared: { ref: ref2, node: node2 } };
}
function pinOf(pinned) {
  if ("binary" in pinned) return { state: "pinned", wanted: pinned.version };
  return {
    state: pinned.reason,
    ...pinned.wanted === void 0 ? {} : { wanted: pinned.wanted }
  };
}

// src/core/retry/waits.ts
var UNKNOWN = { kind: "unknown" };
function retryWaitOf(ref2, reads) {
  const { isSlow, activity, runs, groupOf: groupOf2 } = reads;
  const id = testFileId(ref2);
  const own = runs.find((run2) => run2.testFiles.some((f) => testFileId(f) === id));
  if (own !== void 0) return { kind: "running", since: own.startedAt };
  const group = groupOf2?.(ref2) ?? null;
  if (group !== null) return groupWaitOf(group);
  const fastFile = (f) => !isSlow(f) && (groupOf2?.(f) ?? null) === null;
  if (!isSlow(ref2)) {
    const since = earliest2(runs, (f) => f.project === ref2.project && fastFile(f));
    return since === null ? UNKNOWN : { kind: "tier", since };
  }
  const fast = earliest2(runs, fastFile);
  if (activity?.kind === "running") return { kind: "slow", since: activity.since };
  if (activity?.kind === "waiting") {
    return activity.for === "fast" ? { kind: "fast", since: fast } : { kind: activity.for };
  }
  return fast === null ? UNKNOWN : { kind: "fast", since: fast };
}
function earliest2(runs, holds) {
  const starts = runs.filter((run2) => run2.testFiles.some(holds)).map((run2) => run2.startedAt);
  return starts.length === 0 ? null : Math.min(...starts);
}
function groupWaitOf({ name: name2, at, after, activity }) {
  const lane = activity === null ? null : activity.kind === "running" ? { kind: "running", since: activity.since } : activity;
  return { kind: "group", group: name2, at, after, lane };
}
function groupLanesOf(tiers, ownerOf) {
  const byName = new Map((tiers ?? []).map((tier) => [tier.name, tier]));
  return (ref2) => byName.get(ownerOf(ref2)) ?? null;
}

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

// src/core/slow/slot-files.ts
import { createHash as createHash10 } from "node:crypto";
import { basename as basename4, join as join24 } from "node:path";

// src/core/daemon/scratch.ts
import { createHash as createHash9, randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync as lstatSync5,
  mkdirSync as mkdirSync6,
  mkdtempSync,
  readdirSync as readdirSync8,
  readFileSync as readFileSync17,
  renameSync as renameSync2,
  rmSync as rmSync3,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename as basename3, dirname as dirname8, join as join23 } from "node:path";

// src/core/daemon/paths.ts
import { chmodSync, lstatSync as lstatSync4, mkdirSync as mkdirSync5 } from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute9, join as join22 } from "node:path";
function checkPrivateDir(dir, uid, role = "socket directory") {
  const stat = lstatSync4(dir);
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
  return join22("/tmp", `squeal-${uid}`);
}
function currentUid() {
  return process.getuid?.() ?? 0;
}

// src/core/daemon/scratch.ts
function repositoryId(commonDir) {
  const dir = storePaths(commonDir).dir;
  const file = join23(dir, "repository-id");
  mkdirSync6(dir, { recursive: true });
  const draft = `${file}.${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync2(draft, `${randomBytes(16).toString("hex")}
`);
  try {
    linkSync(draft, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    unlinkSync(draft);
  }
  return readFileSync17(file, "utf8").trim();
}

// src/core/slow/slot-files.ts
var SLOW_LOCK_FILE = "slow.lock";
var SLOW_GROUP2 = "slow";
var GROUP_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var GROUP_SLOT_SCOPES = ["user", "repository"];
var DEFAULT_GROUP_SLOT_SCOPE = "repository";
function slotFiles(group = SLOW_GROUP2, scope = DEFAULT_GROUP_SLOT_SCOPE) {
  const dir = (base, commonDir) => scope === "user" ? base : join24(base, `repo.${hash(repositoryId(commonDir))}`);
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
  return createHash10("sha256").update(text2).digest("hex").slice(0, 16);
}
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/slow/slot.ts
import { existsSync as existsSync9 } from "node:fs";
import { dirname as dirname9, isAbsolute as isAbsolute10, join as join25 } from "node:path";
import { DatabaseSync as DatabaseSync6 } from "node:sqlite";
import { pathToFileURL } from "node:url";
function slowSlotDir(env = process.env, userDir = userTmpDir()) {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== void 0 && xdg !== "" && isAbsolute10(xdg) ? join25(xdg, "squeal") : userDir;
}
function heldPermits(request) {
  const { dir } = request;
  const files = slotFiles(request.group);
  if (!existsSync9(dir)) return [];
  checkPrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const held = [];
  for (let i = 0; i < Math.max(1, request.permits ?? 1); i++) {
    const file = files.permit(i);
    const path = join25(dir, file);
    if (!existsSync9(path)) continue;
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
    db = new DatabaseSync6(immutableUrl(path), { readOnly: true });
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
  const db = new DatabaseSync6(path);
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

// src/core/capacity/background.ts
var DEFAULT_BACKGROUND_SHARE = 0.75;
function isBackgroundShare(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

// src/core/daemon/outlived.ts
import { execFile } from "node:child_process";
import { readdirSync as readdirSync9, readFileSync as readFileSync18 } from "node:fs";
import { readFile as readFile2 } from "node:fs/promises";
import { promisify } from "node:util";

// src/runners/process/recorders.ts
var UNOBSERVED = JSON.stringify({ out: "" });

// src/core/daemon/outlived.ts
var PF_EXITING2 = 4;
var CHUNK = 64;
function procRow(pid) {
  let text2;
  try {
    text2 = readFileSync18(`/proc/${pid}/stat`, "latin1");
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
    const names2 = readdirSync9("/proc").filter((name2) => /^\d+$/.test(name2));
    const rows = [];
    for (let at = 0; at < names2.length; at += CHUNK) {
      if (at > 0) await new Promise((done) => setImmediate(done));
      for (const name2 of names2.slice(at, at + CHUNK)) {
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
var run = promisify(execFile);
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

// src/core/scheduler/capacity.ts
var CAPACITY_RECHECK_MS = 2e3;

// src/core/scheduler/pool-wait.ts
function poolWaitMetaKey(worktreeId) {
  return worktreeMetaKey("poolWait", worktreeId);
}
var NO_WAITS = /* @__PURE__ */ new Map();
function publishedPoolWaits(store, worktreeId, daemonStartedAt, now) {
  const raw = store.meta.get(poolWaitMetaKey(worktreeId));
  if (raw === null) return NO_WAITS;
  try {
    const { at, lanes } = JSON.parse(raw);
    if (typeof at !== "number" || at < daemonStartedAt || now - at > SLOT_WAITER_FRESH_MS)
      return NO_WAITS;
    if (typeof lanes !== "object" || lanes === null) return NO_WAITS;
    return new Map(
      Object.entries(lanes).filter((entry3) => isPoolWait(entry3[1]))
    );
  } catch {
    return NO_WAITS;
  }
}
function isPoolWait(value) {
  if (typeof value !== "object" || value === null) return false;
  const w = value;
  const busy2 = w.busyCores;
  return typeof w.since === "number" && (busy2 === null || typeof busy2 === "number") && typeof w.cpus === "number" && typeof w.hostSlots === "number" && typeof w.grants === "number";
}
var ASKS_AGAIN = `the daemon asks again every ${CAPACITY_RECHECK_MS / 1e3} s`;

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

// src/core/status/retried.ts
function retriedRuns(store, worktreeId) {
  const records = readRetries(store).filter(
    (r) => r.end === null && r.claim?.worktreeId === worktreeId
  );
  if (records.length === 0) return () => false;
  return (ref2, key) => key !== null && records.some(pendingAt(ref2, key));
}

// src/core/daemon/user-config.ts
import { readFileSync as readFileSync19, realpathSync as realpathSync5 } from "node:fs";
import { availableParallelism as availableParallelism2, homedir as homedir2 } from "node:os";
import { dirname as dirname10, isAbsolute as isAbsolute11, join as join26, resolve as resolve6 } from "node:path";
function userConfigPath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== void 0 && xdg !== "" && isAbsolute11(xdg) ? xdg : join26(env.HOME !== void 0 && env.HOME !== "" ? env.HOME : homedir2(), ".config");
  return join26(base, "squeal", "config.json");
}
function defaultHostSlots2(cpus = availableParallelism2()) {
  return Math.max(1, cpus - 1);
}
function loadUserConfig(options = {}) {
  const path = userConfigPath(options.env);
  const cpus = options.cpus ?? availableParallelism2();
  const defaults = {
    capacity: {
      hostSlots: defaultHostSlots2(cpus),
      projects: {},
      groupSlotScope: DEFAULT_GROUP_SLOT_SCOPE,
      backgroundShare: DEFAULT_BACKGROUND_SHARE
    },
    runner: { hostIdleMinutes: null }
  };
  const { value, problems } = loadConfigFile(path, SHAPE2, defaults);
  const { hostSlots } = value.capacity;
  if (hostSlots <= cpus) return { path, config: value, problems };
  return {
    path,
    config: { ...value, capacity: { ...value.capacity, hostSlots: cpus } },
    problems,
    cut: `"capacity.hostSlots" ${hostSlots} is above the CPU count, ${cpus}; it is cut to ${cpus}`
  };
}
var projects = (value) => {
  if (!isRecord(value)) return 'an object from repository root path to { "slots": n }';
  const kept2 = {};
  const problems = [];
  for (const [root, entry3] of Object.entries(value)) {
    const at = `"capacity.projects[${root}]"`;
    if (!isAbsolute11(root)) {
      problems.push(`${at} must name an absolute path; it is left out`);
      continue;
    }
    const why = entryProblem3(entry3);
    if (why !== null) {
      problems.push(`${at} ${why}; it is left out`);
      continue;
    }
    const slots = entry3.slots;
    const key = normalize2(root);
    kept2[key] = { slots: Math.min(slots, kept2[key]?.slots ?? slots) };
  }
  return { kept: kept2, problems };
};
function entryProblem3(entry3) {
  if (!isRecord(entry3)) return `must be { "slots": n }, got ${JSON.stringify(entry3)}`;
  const unknown = Object.keys(entry3).find((key) => key !== "slots");
  if (unknown !== void 0) return `has unknown key "${unknown}"`;
  const expected = positiveInteger(entry3.slots);
  return expected === null ? null : `"slots" must be ${String(expected)}, got ${JSON.stringify(entry3.slots) ?? "undefined"}`;
}
function normalize2(path) {
  try {
    return realpathSync5(path);
  } catch {
    return resolve6(path);
  }
}
var groupSlotScope = (v) => GROUP_SLOT_SCOPES.includes(v) ? null : `one of ${GROUP_SLOT_SCOPES.map((s) => `"${s}"`).join(", ")}`;
var backgroundShare = (v) => isBackgroundShare(v) ? null : "a number from 0 to 1";
var SHAPE2 = {
  capacity: { hostSlots: positiveInteger, projects, groupSlotScope, backgroundShare },
  // Spec 021 D20.4 (row 021-26).
  runner: { hostIdleMinutes: (v) => v === null ? null : hostIdleMinutes(v) }
};

// src/core/status/slot-holders.ts
function pidRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function slowSlotOf(store, worktreeId, root, header, alive, now) {
  const tier = header.slowTier;
  if (!alive || tier === void 0 || tier.pending === 0) return void 0;
  if (tier.activity?.kind !== "waiting" || tier.activity.for !== "slot") return void 0;
  const permits = readPolicy(root).slow.maxParallel;
  let held;
  try {
    held = heldPermits({ dir: slowSlotDirOf(store, worktreeId), permits, group: SLOW_GROUP });
  } catch {
    return void 0;
  }
  const groups2 = /* @__PURE__ */ new Map();
  for (const { record } of held) {
    const id = record.kind === "holder" ? `${record.pid}\0${record.worktreeId}` : `\0${record.kind}`;
    const group = groups2.get(id);
    if (group === void 0) groups2.set(id, { record, permits: 1 });
    else {
      group.permits++;
      if (record.kind === "holder" && group.record.kind === "holder") {
        if (record.since < group.record.since) group.record = record;
      }
    }
  }
  const holders2 = [...groups2.values()].map(
    ({ record, permits: n }) => holderOf(store, worktreeId, record, n, now)
  );
  return { permits, holders: holders2.sort(longestFirst) };
}
function slowSlotDirOf(store, worktreeId) {
  const scope = loadUserConfig({ env: process.env }).config.capacity.groupSlotScope;
  const base = slowSlotDir();
  if (scope === "user") return base;
  const commonDir = store.worktrees.get(worktreeId)?.commonDir;
  if (commonDir === void 0) throw new Error(`worktree ${worktreeId} has no row`);
  return slotFiles(SLOW_GROUP, scope).dir(base, commonDir);
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
function once2(read4) {
  let value;
  return () => {
    value ??= { v: read4() };
    return value.v;
  };
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
      ended: new Map(entriesOf5(row.ended).filter((e) => isCount2(e[1]))),
      endedFiles: new Map(
        entriesOf5(row.endedFiles).filter((e) => isRefs(e[1]))
      ),
      last: isLastYield(row.last) ? row.last : null,
      lanes: new Map(entriesOf5(row.lanes).filter((e) => isRef2(e[1]))),
      at: row.at
    };
  } catch {
    return NO_YIELD_ROW;
  }
}
function entriesOf5(value) {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}
function isCount2(value) {
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
  return typeof v.at === "number" && typeof v.runId === "string" && (v.to === "edit" || v.to === "promoted" || v.to === "runner") && (v.rule === "remainder" || v.rule === "overrun") && typeof v.remainderMs === "number" && typeof v.lane === "string" && Array.isArray(v.files) && v.files.every(isRef2) && typeof v.runStartedAt === "number" && (v.runEndedAt === null || typeof v.runEndedAt === "number");
}
function isRefs(value) {
  return Array.isArray(value) && value.every(isRef2);
}
function isRef2(value) {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value;
  return typeof project === "string" && typeof path === "string";
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
function withYieldFacts(pending, lane, run2, { row, startedAt, laneOf: laneOf2 }) {
  const last = lastIn(row, lane, run2?.id, laneOf2);
  const ended = run2 === void 0 ? void 0 : row.ended.get(run2.id);
  if (pending.kind === "queued")
    return last === void 0 ? pending : { ...pending, lastYield: last };
  if (run2 === void 0) return pending;
  if (pending.kind === "unlisted") {
    const waited = {
      lane,
      since: run2.startedAt,
      files: run2.testFiles.length,
      ...ended === void 0 ? {} : { ended }
    };
    return { ...pending, run: waited };
  }
  const tier = row.tiers.get(run2.id);
  const first = startedAt !== null && firstTier(row, lane, run2, laneOf2);
  return {
    ...pending,
    ...tier === void 0 ? {} : { yields: tier },
    ...ended === void 0 ? {} : { ended },
    ...last === void 0 ? {} : { lastYield: last },
    ...first ? { yieldsSince: startedAt } : {}
  };
}
var UNREPORTED_SHOWN = 3;
function endOf(ref2, pending, run2, { row }) {
  if (pending.kind !== "running" || run2 === void 0) return {};
  const end = fileEndOf(ref2, run2, row);
  return end === void 0 ? {} : { end };
}
function fileEndOf(ref2, run2, row) {
  const named3 = row.endedFiles.get(run2.id);
  if (named3 === void 0 || row.at === void 0) return void 0;
  const ended = new Set(named3.map(testFileId));
  if (!ended.has(testFileId(ref2))) return void 0;
  const unreported = run2.testFiles.filter((f) => !ended.has(testFileId(f)));
  return {
    revision: run2.revision,
    asOf: row.at,
    unreported: unreported.slice(0, UNREPORTED_SHOWN),
    unreportedCount: unreported.length
  };
}
function lastIn(row, lane, runId, laneOf2) {
  const { last } = row;
  const [cut] = last?.files ?? [];
  if (last === null || cut === void 0 || last.runId === runId) return void 0;
  return laneOf2(cut) === lane ? { ...last, lane } : void 0;
}
function firstTier(row, lane, run2, laneOf2) {
  if (run2.testFiles.length < 2 || isSlowLane(lane) || row.last !== null) return false;
  return ![...row.lanes.values()].some((ref2) => laneOf2(ref2) === lane);
}

// src/core/status/standing.ts
function standingsOf(store, worktreeId, root, daemon, now, load = hostLoad, reads) {
  const states = reads?.states ?? store.knownStates.list(worktreeId);
  const keys = reads?.keys ?? store.testFileKeys.list(worktreeId);
  const rows = new Map(keys.map((row2) => [testFileId(row2.testFile), row2]));
  const checks = checksByFile(states);
  const policy = readPolicy(root);
  const worktree = store.worktrees.get(worktreeId);
  const startedAt = liveStartedAt(worktree, daemon);
  const runs = reads?.runs ?? openRuns(store, worktree, daemon);
  const promoted = startedAt === null ? /* @__PURE__ */ new Map() : publishedBatches(store, worktreeId, startedAt, now);
  const batchOf = (ref2) => {
    const place = promoted.get(testFileId(ref2));
    return place === null || place === void 0 ? {} : { batch: place };
  };
  const row = liveYieldRow(store, worktreeId, startedAt);
  const yields = row.tiers;
  const quiet = startedAt === null ? null : publishedWaits(store, worktreeId, startedAt, now);
  const pool = startedAt === null ? null : publishedPoolWaits(store, worktreeId, startedAt, now);
  const header = reads?.header ?? readHeader(store, worktreeId, states, keys);
  const unlisted2 = unlistedReason(header, policy);
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  const setups = setupsOf(states);
  const retried = retriedRuns(store, worktreeId);
  const alive = daemon.state === "alive";
  const hold = (reads?.holds ?? readHolds(store, worktree, daemon, now))[0];
  const slot2 = once2(
    () => reads?.slowSlot === void 0 ? slowSlotOf(store, worktreeId, root, header, alive, now) : reads.slowSlot ?? void 0
  );
  const yieldReads = {
    row,
    startedAt,
    laneOf: (f) => laneFor(policy, f, runnerLaneOf(policy, f.project))
  };
  const yieldFacts = (pending, lane, run2) => {
    if (pending.kind === "running") return withYieldFacts(pending, lane, run2, yieldReads);
    if (pending.kind !== "queued" && pending.kind !== "unlisted") return pending;
    return withYieldFacts(pending, lane, runIn(runs, lane, policy), yieldReads);
  };
  const facts = {
    lookupOnly: policy.baseline.onStart === "lookup-only",
    installCommand: header.installCommand ?? null,
    load: once2(load),
    // What `run --all --wait` runs, from the rows and states read above: no further read.
    notCurrent: once2(
      () => keys.filter(
        (row2) => fileClassOf(row2, checks.get(testFileId(row2.testFile)) ?? []) !== "current"
      ).length
    )
  };
  return (files) => files.map((ref2) => {
    const row2 = rows.get(testFileId(ref2));
    const own = checks.get(testFileId(ref2)) ?? [];
    const state = fileClassOf(row2, own);
    if (state === "current") return { testFile: ref2, state, ...verdictOf(own) };
    const key = row2?.key ?? null;
    const claimant = state === "pending" || key === null ? null : claimantOf(store, worktreeId, ref2, key, now);
    const claim = claimant === null ? null : { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
    if (state === "stale") {
      const verdict = verdictOf(own);
      const standing3 = claim ?? {
        kind: "stale",
        verdict: verdict.verdict ?? null,
        lookupOnly: facts.lookupOnly,
        notCurrent: facts.notCurrent()
      };
      return { testFile: ref2, state, ...verdict, standing: standing3 };
    }
    if (state === "unknown") {
      if (row2 === void 0) return { testFile: ref2, state };
      const unknown = reasons.of(row2, own);
      return {
        testFile: ref2,
        state,
        unknown,
        standing: claim ?? unknownStanding(unknown, facts)
      };
    }
    const running = row2?.pending === "running" || own.some((s) => s.pendingPhase === "running");
    const lane = laneFor(policy, ref2, runnerLaneOf(policy, ref2.project));
    const run2 = running ? runOf(runs, ref2) : void 0;
    const setup = isGroupLane(lane) ? setups.get(ref2.project) : void 0;
    const base = running ? {
      kind: "running",
      lane,
      since: run2?.startedAt ?? null,
      ...run2 === void 0 ? {} : { files: run2.testFiles.length },
      ...setup === void 0 ? {} : { setup }
    } : unlisted2 ?? queuedReason(store, worktreeId, ref2, key, lane, runs, policy, now);
    const told = yieldFacts(base, lane, run2);
    const asRetry = told.kind === "queued" && !promoted.has(testFileId(ref2)) && retried(ref2, key);
    const pending = told.kind === "running" ? { ...told, ...batchOf(ref2) } : asRetry ? { ...told, retried: true } : told;
    if (hold !== void 0 && (pending.kind === "queued" || pending.kind === "slow")) {
      const held = { kind: "on-hold", hold };
      return { testFile: ref2, state, pending: held, standing: held };
    }
    const wait = pending.kind === "queued" ? quietWait(quiet, pending.lane) : void 0;
    if (pending.kind === "queued" && pending.behind === null && wait !== void 0) {
      if (!promoted.has(testFileId(ref2))) {
        const held = { ...pending, ...wait };
        return { testFile: ref2, state, pending: held, standing: held };
      }
    }
    const refused = pending.kind === "queued" ? pool?.get(pending.lane) : void 0;
    if (pending.kind === "queued" && pending.behind === null && refused !== void 0) {
      if (!promoted.has(testFileId(ref2))) {
        const held = { ...pending, pool: refused };
        return { testFile: ref2, state, pending: held, standing: held };
      }
    }
    if (pending.kind === "queued" && promoted.has(testFileId(ref2))) {
      const tier = pending.behind === null ? void 0 : yieldIn(runs, lane, policy, yields);
      const promotedReason = {
        ...pending,
        promoted: true,
        ...tier === void 0 ? {} : { yields: tier },
        ...batchOf(ref2)
      };
      return { testFile: ref2, state, pending: promotedReason, standing: promotedReason };
    }
    if (pending.kind === "slow") {
      const held = slotOf(pending, slot2);
      if (held !== void 0) {
        const waiting = { ...pending, slot: held };
        return { testFile: ref2, state, pending: waiting, standing: waiting };
      }
    }
    if (pending.kind === "unlisted" && promoted.has(testFileId(ref2))) {
      const run3 = yieldIn(runs, lane, policy, yields);
      if (run3?.kind === "yields") {
        const yielding = { ...pending, yields: run3 };
        return { testFile: ref2, state, pending: yielding, standing: yielding };
      }
    }
    return {
      testFile: ref2,
      state,
      pending,
      standing: pending,
      ...endOf(ref2, pending, run2, yieldReads)
    };
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
function slotOf(pending, slot2) {
  return pending.group === void 0 ? slot2() : void 0;
}
function yieldIn(runs, lane, policy, yields) {
  const run2 = runIn(runs, lane, policy);
  return run2 === void 0 ? void 0 : yields.get(run2.id);
}
function runIn(runs, lane, policy) {
  return runs.find(
    (run2) => run2.testFiles.some((f) => laneFor(policy, f, runnerLaneOf(policy, f.project)) === lane)
  );
}
function runnerLaneOf(policy, project) {
  if (policy.nodeTest.some((p) => p.name === project)) return "node-test";
  if (policy.pytest.some((p) => p.name === project)) return "pytest";
  return "vitest";
}
function queuedReason(store, worktreeId, ref2, key, lane, runs, policy, now) {
  const claimant = key === null ? null : claimantOf(store, worktreeId, ref2, key, now);
  if (claimant !== null && store.results.byKey(key, 0).length === 0) {
    return { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
  }
  const tier = runIn(runs, lane, policy);
  if (tier !== void 0) {
    return { kind: "queued", lane, behind: tier.startedAt, files: tier.testFiles.length };
  }
  const group = groupView(policy).of(ref2);
  if (group.name !== SLOW_GROUP && group.name !== TESTS_GROUP) {
    return { kind: "slow", group: { name: group.name, at: group.at } };
  }
  if (slowView(policy).isSlow(ref2)) {
    return policy.slow.trigger === "idle" ? { kind: "slow", pausesOnly: true } : { kind: "slow" };
  }
  return { kind: "queued", lane, behind: null };
}
function unlistedReason(header, policy) {
  const refined2 = header.refinedRevision;
  if (header.runnerPartPending !== true || refined2 === null || refined2 === void 0) return null;
  const callBoundMs = runnerPartBoundMs(policy.runner.timeoutMs);
  const runners = header.listingRunners;
  return {
    kind: "unlisted",
    revision: header.revision,
    callBoundMs,
    ...runners === void 0 ? {} : { runners }
  };
}
function runOf(runs, ref2) {
  const id = testFileId(ref2);
  return runs.find((run2) => run2.testFiles.some((f) => testFileId(f) === id));
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
      return `running ${s.lane} ${(s.files ?? 1) > 1} ${s.setup?.file ?? ""} ${batchId(s.batch)}`;
    case "queued":
      return `queued ${s.lane} ${s.behind === null} ${s.promoted === true} ${yieldId(s.yields)} ${s.quietUntil ?? "-"} ${s.quietCatchUp === true} ${batchId(s.batch)} ${s.pool?.since ?? "-"}`;
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
function batchId(batch) {
  if (batch === void 0) return "-";
  const end = batch.estimatedEnd === null ? "-" : timeText(batch.estimatedEnd);
  return `batch ${batch.position}/${batch.of} ${batch.files} ${end}`;
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
  const retries = retryStandings(reads, worktreeId, policy);
  const refs = reads.keys.map((row) => row.testFile).sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  const files = standingsOf(store, worktreeId, root, daemon, now, load, reads)(refs);
  const groups2 = /* @__PURE__ */ new Map();
  const add = (standing3, ref2) => {
    const id = groupId(standing3) + waitsId(standing3);
    const group = groups2.get(id);
    if (group === void 0) {
      groups2.set(id, { standing: standing3, files: ref2 === null ? [] : [ref2] });
      return;
    }
    if (ref2 !== null) group.files.push(ref2);
    group.standing = widest(group.standing, standing3);
  };
  for (const file of files) {
    const retry = retries.get(testFileId(file.testFile));
    if (retry !== void 0) {
      add(retry, file.testFile);
      continue;
    }
    const standing3 = file.state === "current" ? void 0 : file.standing ?? file.pending;
    if (standing3 === void 0) continue;
    const held = standing3.kind === "running" && standing3.setup !== void 0;
    if (slow.isSlow(file.testFile) && !held) continue;
    add(standing3, file.testFile);
  }
  const said = [...groups2.values()].some((g) => g.standing.kind === "unlisted");
  if (header.runnerPartPending === true && !said) add(unlisted(header, policy), null);
  if (reads.checkpoint !== void 0 && !reads.checkpoint.owed) {
    add({ kind: "checkpoint" }, null);
  }
  return [...groups2.values()].sort(
    (a, b) => ORDER.indexOf(a.standing.kind) - ORDER.indexOf(b.standing.kind)
  );
}
function waitsId(standing3) {
  return standing3.kind === "retry" && standing3.waits !== void 0 ? ` ${JSON.stringify(standing3.waits)}` : "";
}
function unlisted(header, policy) {
  const runners = header.listingRunners;
  return {
    kind: "unlisted",
    revision: header.revision,
    callBoundMs: runnerPartBoundMs(policy.runner.timeoutMs),
    ...runners === void 0 ? {} : { runners }
  };
}
function retryStandings(reads, worktreeId, policy) {
  const { header, runs } = reads;
  const groups2 = groupView(policy);
  const queue = {
    isSlow: slowView(policy).isSlow,
    activity: header.slowTier?.activity ?? null,
    runs,
    groupOf: groupLanesOf(header.groupTiers, (ref2) => groups2.of(ref2).name)
  };
  const retries = /* @__PURE__ */ new Map();
  for (const r of reads.pendingRetries?.retries ?? []) {
    const runningSince = r.runningSince ?? null;
    const queued = r.claimedBy === worktreeId && runningSince === null;
    retries.set(testFileId(r.testFile), {
      kind: "retry",
      reason: r.reason,
      noResult: r.noResult === true,
      runningSince,
      elsewhere: r.claimedBy !== null && r.claimedBy !== worktreeId,
      ...queued ? { waits: retryWaitOf(r.testFile, queue) } : {}
    });
  }
  return retries;
}

// src/core/status/phase-files.ts
var PHASE_FILES_LISTED = 100;
function pendingPhasesOf(states, keys, openFiles2) {
  const checks = /* @__PURE__ */ new Map();
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === void 0) checks.set(id, [state]);
    else own.push(state);
  }
  const phases = /* @__PURE__ */ new Map();
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    if (fileClassOf(row, own) !== "pending") continue;
    const runs = openFiles2.has(id) || row.pending === "running" || own.some((s) => s.pendingPhase === "running");
    phases.set(id, { testFile: row.testFile, phase: runs ? "running" : "queued" });
  }
  return phases;
}
function pendingTestFilesOf(phases) {
  const running = [];
  const queued = [];
  for (const { testFile, phase } of phases.values()) {
    (phase === "running" ? running : queued).push(testFile);
  }
  return { running: listed2(running), queued: listed2(queued) };
}
function listed2(files) {
  const sorted = files.sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  return {
    files: sorted.slice(0, PHASE_FILES_LISTED),
    omitted: Math.max(0, sorted.length - PHASE_FILES_LISTED)
  };
}

// src/core/keys/key-format.ts
var KEY_FORMAT_VERSION = 21;

// src/core/shared/refused.ts
function sharedRefusedMetaKey(worktreeId) {
  return worktreeMetaKey("sharedRefused", worktreeId);
}
function readSquealMismatch(store, worktreeId) {
  const raw = store.meta.get(sharedRefusedMetaKey(worktreeId));
  if (raw === null) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { ci, here, commit, at } = value;
  const ciBuild = buildOf(ci);
  const hereBuild = buildOf(here);
  if (ciBuild === null || hereBuild === null) return null;
  if (typeof commit !== "string" || typeof at !== "number") return null;
  return { ci: ciBuild, here: hereBuild, commit, at };
}
function buildOf(value) {
  if (!isRecord(value)) return null;
  const { version, keyFormat } = value;
  return typeof version === "string" && typeof keyFormat === "number" ? { version, keyFormat } : null;
}

// src/core/status/squeal-mismatch.ts
function squealMismatchOf(store, worktreeId) {
  const m = readSquealMismatch(store, worktreeId);
  if (m === null) return {};
  if (m.here.keyFormat !== KEY_FORMAT_VERSION || m.ci.keyFormat === KEY_FORMAT_VERSION) return {};
  return { squeal: m };
}

// src/core/status/snapshot.ts
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
function snapshot(store, worktreeId, root, now, hostLoadNow = hostLoad, shell = null) {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const runtime = runtimeFilesStatus(store, worktreeId, root);
  const notes = [];
  if (worktree === null) {
    notes.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes.push(recovered);
  const daemon = statusView(readPresence(store, worktreeId, now, worktree));
  const runs = openRuns(store, worktree, daemon);
  const held = openFiles(runs);
  const holds = readHolds(store, worktree, daemon, now);
  const header = readHeader(store, worktreeId, states, keys, void 0, held);
  const knownFailures = withTestFileFrames(
    store,
    worktreeId,
    withRecorded(store, worktreeId, states, header.revision)
  );
  const load = once2(hostLoadNow);
  const retries = pendingRetriesOf(store, keys, load, runs);
  const checkpoint = openCheckpoint(store, worktreeId, daemon);
  const at = worktree?.root ?? root;
  const phases = pendingPhasesOf(states, keys, held);
  const focused = readStatusFocused(store, worktreeId, phases);
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
    ...importsOf(store, worktreeId, keys, states, at),
    breakdown: breakdown(states, keys, held),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes,
    daemonNotes: readDaemonNotes(store, worktreeId),
    ...checkpoint,
    ...vitestExcluded(at),
    ...configProblemsOf(at),
    // Row 011-275 (gh-120): beside the live daemon's version, the keys a runtime here leaves out.
    ...ignoredConfigOf(at, liveDaemonVersion(worktree, daemon)),
    ...runtime === void 0 ? {} : { runtimeFiles: runtime },
    ...retries,
    ...unknownTestFilesOf(store, worktreeId, states, keys, at, now),
    ...daemon.state === "alive" ? { runsOpen: runs.length } : {},
    outstanding,
    pendingTestFiles: pendingTestFilesOf(phases),
    ...slowSlot === void 0 ? {} : { slowSlot },
    ...focused.length === 0 ? {} : { focused },
    ...codeStatusOf(
      store,
      worktreeId,
      { root: at, commonDir: () => worktree?.commonDir ?? resolveCommonDir(at) },
      shell
    ),
    // Spec 017 D8: after the code's, from the lint store.
    ...lintStatusOf(
      store,
      worktreeId,
      { root: at, commonDir: () => worktree?.commonDir ?? resolveCommonDir(at) },
      shell
    )
  };
}
function vitestExcluded(root) {
  const policy = readPolicy(root);
  const { excludeProjects: names2, exclude: globs4 } = policy.vitest;
  if (names2.length + globs4.length === 0) return {};
  if (policy.nodeTest.length > 0 && !vitestDetected(root)) return {};
  return {
    ...names2.length === 0 ? {} : { vitestExcluded: names2 },
    ...globs4.length === 0 ? {} : { vitestExcludedFiles: globs4 }
  };
}
function openCheckpoint(store, worktreeId, daemon) {
  const progress = parseCheckpointProgress(store.meta.get(checkpointMetaKey(worktreeId)));
  if (progress === null) return {};
  const { owed: owed2, ...rest } = progress;
  if (owed2 !== void 0) {
    if (daemon.state === "alive") return {};
    return { checkpoint: { ...rest, owed: true } };
  }
  if (daemon.state !== "alive" || store.checkpoints.get(progress.id)?.end !== null) return {};
  return { checkpoint: { ...rest, owed: false } };
}
function importsOf(store, worktreeId, keys, states, root) {
  const imports = readImports(store, worktreeId, keys, states);
  const { shared } = sharedOf(readPolicy(root).shared.ref, imports, () => pinnedNode(root));
  return {
    ...imports.length === 0 ? {} : { imports },
    ...shared === void 0 ? {} : { shared: { ...shared, ...squealMismatchOf(store, worktreeId) } }
  };
}
function inheritedSources(store, states) {
  const groups2 = /* @__PURE__ */ new Map();
  let count2 = 0;
  for (const s of states) {
    if (s.validity !== "current" || s.origin?.kind !== "inherited") continue;
    count2++;
    const id = JSON.stringify([s.origin.worktreeId, s.origin.commit]);
    const group = groups2.get(id) ?? {
      worktreeId: s.origin.worktreeId,
      commit: s.origin.commit,
      count: 0,
      fileLevelCount: 0
    };
    group.count++;
    if (s.check.kind === "file") group.fileLevelCount++;
    groups2.set(id, group);
  }
  const sources = [...groups2.values()].map((g) => ({ ...g, worktreeRoot: store.worktrees.get(g.worktreeId)?.root ?? null })).sort(
    (a, b) => b.count - a.count || a.worktreeId.localeCompare(b.worktreeId) || String(a.commit).localeCompare(String(b.commit))
  ).map(({ worktreeId, worktreeRoot, commit, count: count3, fileLevelCount }) => ({
    worktreeId,
    worktreeRoot,
    commit,
    count: count3,
    fileLevelCount
  }));
  return { count: count2, sources };
}
function openFiles(runs) {
  return new Set(runs.flatMap((run2) => run2.testFiles.map(testFileId)));
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
    const { at, movedTo, check, checkedAt } = JSON.parse(raw);
    const when = typeof at === "number" ? ` at ${new Date(at).toISOString()}` : "";
    const checked = typeof checkedAt === "number" && checkedAt > 0 ? ` at ${new Date(checkedAt).toISOString()}` : "";
    const found2 = check === "full" ? `: the full integrity check${checked} found a fault` : "";
    const where3 = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}${found2}; the baseline was lost${where3}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
}

// src/core/types/delivery.ts
var MAIN_AGENT = "main";

// src/harness/shared/context.ts
function locate(cwd) {
  const root = findWorktreeRoot(cwd);
  if (root === null) return null;
  const commonDir = resolveCommonDir(root);
  return commonDir === null ? null : { root, commonDir };
}
function openContext(input, location2, options = {}) {
  const worktreeId = worktreeIdFor(location2.root);
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const opened = open(location2, worktreeId, options, busyTimeoutMs, now);
  if (opened === null) return null;
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
      status: createStatusBuilder(store, { now }),
      now,
      ...options.pollIntervalMs === void 0 ? {} : { pollIntervalMs: options.pollIntervalMs },
      ...options.harnessProcess === void 0 ? {} : { harnessProcess: options.harnessProcess },
      ...options.squealVersion === void 0 ? {} : { squealVersion: options.squealVersion },
      code,
      lint: lint2,
      ...prepare2 === void 0 ? {} : { prepare: prepare2 },
      // Row 011-312: a registration records the commit `HEAD` names here.
      root: location2.root
    });
    const close = () => store.close();
    const prepared = prepare2 === void 0 ? {} : { prepared: prepare2.reports };
    return { ...location2, store, delivery, consumer, code, lint: lint2, ...prepared, write: write2, sent, close };
  } catch (error) {
    store.close();
    throw error;
  }
}
function open(location2, worktreeId, options, busyTimeoutMs, now) {
  if (options.prepare !== true) {
    const store = openStore(location2.commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return null;
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
  return "reason" in sent ? null : sent;
}

// src/harness/shared/coverage.ts
var DEFAULT_COVERAGE = { ...UNCONFIGURED3, slow: null };

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
  return new Promise((resolve7, reject) => {
    const timer = setTimeout(() => reject(new Error("output not written in time")), boundMs);
    try {
      stream.write(text2, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve7();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
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
    prepare: true,
    ...deps.writer === void 0 ? {} : { writer: deps.writer },
    ...overrides
  };
  const context = openContext(input, location2, options);
  if (context === null) return null;
  let handed = false;
  try {
    const result = await fn(context);
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

// src/harness/shared/primer.ts
var PRIMER_CAP_CHARS = 1500;
var PRIMER_OPENING = "Squeal runs this repository's ";
var REVISION = "A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed.";
function primer(command = SQUEAL_COMMAND, coverage = DEFAULT_COVERAGE) {
  const names2 = runnersOf(coverage).map((runner) => runner.name);
  const groups2 = coverage.groups;
  const when = groups2 === void 0 ? " after each edit" : "";
  const quiet = groups2?.noTestsAtEdit === true;
  const arrivals = quiet ? [
    ", but no test group runs after each edit, so silence between edits is not a pass; a SQUEAL message with your next tool call means a check changed;",
    ", but not after each edit, so silence between edits is not a pass; a SQUEAL message means a check changed;"
  ] : [
    `${when}; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working;`
  ];
  const most = Math.max(
    0,
    ...DESCRIPTIONS.map((runner) => projectsOf(runner.covered(coverage))?.length ?? 0)
  );
  let text2 = "";
  for (const arrival of arrivals) {
    const sentences = (covers, naming, wait) => [
      `${PRIMER_OPENING}${listed3(names2, "and")} tests in the background${arrival} do not run ${listed3(names2, "or")} to learn whether your edits broke something.`,
      ...groups2 === void 0 ? [] : [momentsSentence(command, naming, groups2)],
      waitSentence(command, naming, wait, quiet),
      ...coverage.slow === null ? [] : slowSentences(command, naming, coverage.slow),
      "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
      retrySentence(command, naming),
      REVISION,
      covers,
      notCovered(coverage)
    ].join(" ");
    text2 = folded(sentences, coverage, most);
    if (text2.length <= PRIMER_CAP_CHARS) return text2;
  }
  return text2;
}
function folded(sentences, coverage, most) {
  let text2 = "";
  for (const naming of ["every", "first", "none"]) {
    for (let node2 = most; node2 >= 0; node2--) {
      text2 = sentences(coversSentence(coverage, node2), naming, "plain");
      if (text2.length > PRIMER_CAP_CHARS) continue;
      const paths = sentences(coversSentence(coverage, node2), naming, "paths");
      return paths.length <= PRIMER_CAP_CHARS ? paths : text2;
    }
    if (naming !== "first") continue;
    for (let node2 = most; node2 >= 0; node2--) {
      text2 = sentences(coversSentence(coverage, node2), naming, "short");
      if (text2.length <= PRIMER_CAP_CHARS) return text2;
    }
  }
  return text2;
}
function waitSentence(command, naming, form, quiet = false) {
  if (form === "short") {
    return `Wait only when you need a result, as before you finish: \`${command} status --wait 60000\`.`;
  }
  if (form === "plain") {
    const wait = naming === "none" ? "`status --wait 60000` on the CLI SQUEAL messages name" : `\`${command} status --wait 60000\``;
    return `Wait only when you need a result before your next step, for example before saying the task is done: ${wait}.`;
  }
  const full = naming === "every" && command === SQUEAL_COMMAND;
  const cli = (sub, first) => naming !== "none" && (first || full) ? `\`${command} ${sub}\`` : naming === "none" ? `\`${sub}\`` : `the CLI's \`${sub}\``;
  const on = naming === "none" ? ", on the CLI SQUEAL messages name" : "";
  const finish = `before you finish, ${cli("status --wait 60000", false)} or a checkpoint, ${cli("run --all --wait", false)}.`;
  if (quiet) {
    return `Before you rely on a result for files you changed${on}: ${cli("run <group> <path>... --wait 60000", true)}; ${finish}`;
  }
  return `Wait only when you need a result before your next step${on}: ${cli("status --wait 60000 <path>...", true)} for the verdict on files you just changed; ${finish}`;
}
var AT = {
  edit: "after each edit",
  pause: "between your turns",
  stop: "at Stop, and Stop waits for them",
  commit: "when you commit"
};
function momentsSentence(command, naming, groups2) {
  const cli = (sub) => naming === "every" && command === SQUEAL_COMMAND ? `\`${command} ${sub}\`` : `the CLI's \`${sub}\``;
  const clauses = groups2.moments.map(({ at, names: names2 }) => {
    const named3 = listed3(
      names2.map((name2) => name2 === "tests" ? "tests (the test files no group selects)" : name2),
      "and"
    );
    if (at !== "manual") return `${named3} ${AT[at]}`;
    const one = names2.length === 1;
    return `${named3} ${one ? "waits" : "wait"} for ${cli(`run ${one ? names2[0] : "<group>"}`)}`;
  });
  return `Check groups: ${clauses.join("; ")}; ${cli("run <group> --wait 60000")} runs one now.`;
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
function listed3(words, conjunction) {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}
function coversSentence(coverage, node2) {
  const suites = runnersOf(coverage).map(
    (runner) => suite(runner.name, runner.covered(coverage), node2)
  );
  const files = coverage.slow?.files;
  const slow = coverage.slow === null ? "" : files === null || files === void 0 ? ", with slow test files not counted yet" : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed3(suites, "and")}${slow}.`;
}
function suite(runner, covered, shown) {
  if (!("projects" in covered)) {
    const config = covered.config === null ? runner : `${runner} (${covered.config})`;
    return `${config}${excluded(covered.excludedProjects)}`;
  }
  const entries = covered.projects.map(
    ({ name: name2, include }) => `${JSON.stringify(name2)} (${include.join(", ")})`
  );
  const list = named2("project", entries, shown);
  return shown === 0 ? `${runner} (${list})` : `${runner} ${list}`;
}
function excluded(entries) {
  if (entries.length === 0) return "";
  const { text: text2, plural: plural2 } = excludedProjectsText(entries);
  return `; its ${text2} ${plural2 ? "are" : "is"} not run, excluded by squeal.config.json`;
}
function notCovered(coverage) {
  const files = DESCRIPTIONS.flatMap((runner) => runner.excluded(coverage) ?? []);
  const what = files.length === 0 ? "typecheck, build" : `typecheck, build, the ${files.join(", the ")}, which squeal.config.json excludes,`;
  return `Squeal does not cover ${what} or any other test suite: run those yourself.`;
}
function named2(noun, entries, shown) {
  const nouns = entries.length === 1 ? noun : `${noun}s`;
  if (shown === 0) return `${entries.length} ${nouns}`;
  const listed4 = entries.slice(0, shown);
  const rest = entries.length - shown;
  const tail = rest > 0 ? [...listed4, `${rest} more`] : listed4;
  const last = tail.pop();
  return `${nouns} ${tail.length === 0 ? last : `${tail.join(", ")} and ${last}`}`;
}
function slowSentences(command, naming, slow) {
  const run2 = naming === "every" ? `\`${command} run --slow --wait 60000\`` : "the CLI's `run --slow --wait 60000`";
  const when = slow.pausesOnly === true ? "between your turns" : "after the fast tests";
  return [
    slow.requireSlowSuite === true ? `Slow test files run ${when}; this repository requires them once you change a file: before you say the task is done, wait with ${run2} unless the latest \`Slow tier:\` line says every slow file is current; Stop waits or holds you ${holdsText(slow.maxHolds)}.` : `Slow test files run ${when}; this repository does not require them before you finish: say slow tests pass only when the latest \`Slow tier:\` line states every slow file is current, else say how many are not, or wait for them with ${run2}.`,
    command === SQUEAL_COMMAND ? "A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call." : "A slow failure arrives with your next prompt or tool call."
  ];
}
var PRIMER = primer();

// src/harness/opencode/bridge-verdict.ts
var VERDICT_SIGNAL = "SIGUSR2";
var ignore = () => {
};
function ignoreVerdictSignal() {
  if (!process.listeners(VERDICT_SIGNAL).includes(ignore)) process.on(VERDICT_SIGNAL, ignore);
}
function ackOf(request) {
  const ack = request?.ack;
  return typeof ack?.by === "number" && Number.isFinite(ack.by) ? { by: ack.by } : null;
}
function awaitSignal(boundMs) {
  let finish = () => {
  };
  const commit = new Promise((resolve7) => {
    const on = () => end(true);
    const timer = setTimeout(() => end(false), Math.max(0, boundMs));
    const end = (value) => {
      clearTimeout(timer);
      process.off(VERDICT_SIGNAL, on);
      resolve7(value);
    };
    finish = end;
    process.on(VERDICT_SIGNAL, on);
  });
  return { commit, cancel: () => finish(false) };
}

// src/harness/opencode/bridge.ts
function opencodeCommand(cli, node2 = process.execPath) {
  return `${shellWord(node2)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}
function bridgeDeps(module, host) {
  const cli = fileURLToPath2(new URL("../cli/squeal.mjs", module));
  return {
    env: process.env,
    cli,
    command: opencodeCommand(cli),
    harnessProcess: () => findHarnessProcess({ ppid: host.pid })
  };
}
var consumerInput = (consumer) => ({
  session_id: consumer.sessionId,
  ...consumer.agentId === void 0 ? {} : { agent_id: consumer.agentId }
});
async function runBridge(stdin, module, kind, handler) {
  ignoreVerdictSignal();
  let handOff = null;
  try {
    const request = JSON.parse(stdin);
    if (request.kind !== kind) throw new Error(`not a ${kind} request`);
    const ack = ackOf(request);
    handOff = ack === null ? null : new HandOff();
    const deps = bridgeDeps(module, request);
    const answer = await handler(
      request,
      handOff === null ? deps : { ...deps, handOff }
    );
    if (ack === null || handOff === null || !handOff.pending) {
      process.stdout.write(JSON.stringify({ answer }));
      return;
    }
    await handOver(handOff, ack, `${JSON.stringify({ answer, held: true })}
`);
  } catch {
    handOff?.abandon();
    process.exitCode = 1;
  }
}
async function handOver(handOff, ack, line, out = process.stdout) {
  const bound = Math.min(ack.by - Date.now(), HAND_OFF_BOUND_MS);
  const verdict = awaitSignal(bound);
  try {
    await written(out, line, Math.max(0, bound));
  } catch {
    verdict.cancel();
    return handOff.abandon();
  }
  handOff.settle(await verdict.commit);
}
async function runEntry(module, kind, handler) {
  ignoreVerdictSignal();
  let stdin = "";
  try {
    stdin = readFileSync20(0, "utf8");
  } catch {
  }
  await runBridge(stdin, new URL(module), kind, handler);
}

// src/harness/opencode/bridge-turn.ts
var endContinued = ({ store, consumer }) => store.transaction(() => {
  if (store.consumers.get(consumer) === null) return true;
  endTurn(store, consumer, store.knownStates.list(consumer.worktreeId), []);
  return true;
});
var endTurn2 = async (request, deps) => {
  const location2 = locate(request.worktree);
  if (location2 === null) return { ended: false };
  const ended = await withContext(
    consumerInput(request.consumer),
    location2,
    deps,
    async (context) => request.continued === true ? context.write(() => endContinued(context)) : context.delivery.endTurn(context.consumer)
  );
  return { ended: ended ?? false };
};

// src/harness/opencode/entries/hooks/end-turn.ts
await runEntry(import.meta.url, "endTurn", endTurn2);
