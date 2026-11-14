import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/harness/opencode/bridge.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { fileURLToPath } from "node:url";

// src/core/fs/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

// src/core/daemon/config-file.ts
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";

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
  const names2 = entries.filter((entry) => !entry.includes("*"));
  const patterns = entries.filter((entry) => entry.includes("*"));
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
function withDefaults(entry) {
  return { ...entry, argv: entry.argv ?? [], env: entry.env ?? {} };
}
function projectEntries(value, path, fields, required, withDefaults3, check) {
  if (!Array.isArray(value)) return "an array of projects";
  const kept2 = [];
  const problems = [];
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry, at, kept2, fields, required, check);
    if (problem === null) kept2.push(withDefaults3(entry));
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function entryProblem(entry, at, kept2, fields, required, check) {
  if (!isRecord(entry))
    return `"${at}" must be an object, got ${JSON.stringify(entry)}; it is skipped`;
  const named3 = nonEmptyString(entry.name) === null ? entry.name : null;
  const skipped = named3 === null ? "it is skipped" : `project ${JSON.stringify(named3)} is skipped`;
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
  value.forEach((entry, index) => {
    const at = `checks[${index}]`;
    const problem = entryProblem2(entry, at) ?? nameProblem(entry, at, kept2);
    if (problem === null) kept2.push(entry);
    else problems.push(problem);
  });
  return { kept: kept2, problems };
}
function nameProblem(entry, at, kept2) {
  if (DEFAULT_GROUP_NAMES.includes(entry.name)) {
    return `"${at}.name" is "${entry.name}", the name of a default group; it is left out`;
  }
  if (kept2.some((group) => group.name === entry.name)) {
    return `"${at}.name" repeats "${entry.name}" of an earlier group; it is left out`;
  }
  return null;
}
function entryProblem2(entry, at) {
  if (!isRecord(entry)) return `"${at}" must be an object, got ${show(entry)}; it is left out`;
  const problem = shapeProblem(entry, at);
  return problem === null ? null : `${problem}; ${leftOut(entry)}`;
}
function shapeProblem(entry, at) {
  const isTest = entry.runner !== void 0;
  const isLint = entry.lint !== void 0;
  if (isTest && isLint) return `"${at}" has both "runner" and "lint"; a group has one`;
  if (!isTest && !isLint) return `"${at}" has neither "runner" nor "lint"; a group needs one`;
  if (isLint) {
    const testKey = TEST_ONLY.find((key) => entry[key] !== void 0);
    if (testKey !== void 0) return `"${at}.${testKey}" needs "runner"; a lint group has none`;
    const unbuilt = TEST_GROUP_ONLY.find((key) => entry[key] !== void 0);
    if (unbuilt !== void 0) {
      return `"${at}.${unbuilt}" applies to test groups only; a lint group has "name", "lint" and "at"`;
    }
  }
  for (const key of ["name", "at"]) {
    if (entry[key] === void 0) return `"${at}.${key}" is missing; every group needs one`;
  }
  return (isTest ? TEST_RULES : LINT_RULES)(entry, at);
}
function leftOut(entry) {
  return typeof entry.name === "string" && NAME.test(entry.name) ? `group "${entry.name}" is left out` : "it is left out";
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

// src/core/daemon/policy-remote.ts
var boolean4 = (v) => typeof v === "boolean" ? null : "true or false";
var kept = (key, bad) => (value) => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return "an array of strings";
  }
  const good = [];
  const problems = [];
  value.forEach((entry, index) => {
    const why = bad(entry);
    if (why === null) good.push(entry);
    else problems.push(`"${key}[${index}]" ${why}; it is left out`);
  });
  return { kept: good, problems };
};
function commandName(entry) {
  return /^[^-\s/\\][^\s/\\]*$/.test(entry) && !new RegExp("\\p{Cc}", "u").test(entry);
}
var commands = kept(
  "requires.commands",
  (entry) => commandName(entry) ? null : `must be a command name such as "git", got ${JSON.stringify(entry)}`
);
var needsRepository = kept("remote.needsRepository", (glob) => compiles([glob])?.problem ?? null);
var REMOTE_SHAPE = {
  requires: { commands },
  remote: { allowed: boolean4, needsRepository }
};

// src/core/keys/observed.ts
import { createHash } from "node:crypto";
var ABSENT_LISTING = createHash("sha1").update("\0absent").digest("hex");
var EMPTY_LISTING = createHash("sha1").update("\0empty").digest("hex");

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
function isNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/core/daemon/lock.ts
import { DatabaseSync } from "node:sqlite";

// src/core/store/connection.ts
import { AsyncLocalStorage } from "node:async_hooks";
var slices = new AsyncLocalStorage();

// src/core/daemon/test-pause.ts
import { channel } from "node:diagnostics_channel";
var TEST_PAUSE_CHANNEL = "squeal:test-pause";
var pauses = channel(TEST_PAUSE_CHANNEL);

// src/core/daemon/terminate.ts
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

// src/core/presence/stored.ts
var SUCCESSOR_LOCK_WAIT_MS = 12e4;
var HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 1e4;

// src/core/types/watcher.ts
var WATCHER_TIMINGS = {
  quietMs: 100,
  maxBatchMs: 500,
  reconcileIntervalMs: 3e4
};

// src/core/status/feed-late.ts
var FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;

// src/core/state/slow-text.ts
function holdsText(maxHolds) {
  return maxHolds === void 0 || maxHolds <= 1 ? "once" : `up to ${maxHolds} times in a turn`;
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

// src/core/delivery/harness-process.ts
import { readFileSync as readFileSync2, readlinkSync } from "node:fs";
function readProcStat(pid) {
  let text;
  try {
    text = readFileSync2(`/proc/${pid}/stat`, "utf8");
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

// src/core/status/stopping.ts
var BOUND_S = Math.round(HANDOFF_BOUND_MS / 1e3);

// src/core/code/gate/rule.ts
var UNRUN_GAPS = ["not-prepared", "not-finished"];
var UNRUN = new Set(UNRUN_GAPS);

// src/core/delivery/code-coverage-words.ts
var NOT_RUN = "no test runs it in the test's own thread";
var NOT_RUN_CHILDREN = "no test runs it, in the test's own thread or in a process or thread the test starts";
var UNMEASURED = "Squeal does not measure worker threads or child processes.";
var LOWER_BOUND = "Squeal counts what the processes and threads a test starts run as a lower bound: a process that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE is not counted.";
var UNTESTED = `untested: ${NOT_RUN}`;
var UNTESTED_CHILDREN = `untested: ${NOT_RUN_CHILDREN}`;
var MEASURED = `  Coverage counts what ran in the test's own thread. ${UNMEASURED}`;
var MEASURED_CHILDREN = `  Coverage counts what ran in the test's own thread and in the processes and threads it started. ${LOWER_BOUND}`;

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
  const own = listing.files.filter((ref2) => ref2.project === command.project);
  if (command.files === null) return own.length === 0 ? null : own;
  const byPath = new Map(own.map((ref2) => [ref2.path, ref2]));
  const files = command.files.map((file) => byPath.get(listing.pathOf(file) ?? ""));
  return files.every((ref2) => ref2 !== void 0) ? [...new Set(files)] : null;
}

// src/runners/pytest/describe.ts
import { realpathSync } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";

// src/runners/pytest/environment/discover.ts
import { existsSync, readdirSync as readdirSync2, readFileSync as readFileSync3, statSync } from "node:fs";
import { basename, dirname, isAbsolute as isAbsolute4, join as join2, relative as relative2, resolve } from "node:path";

// src/core/fs/paths.ts
import { isAbsolute as isAbsolute3, join, relative, sep } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute3(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
function toAbsolute(root, rel) {
  return join(root, ...rel.split("/"));
}

// src/runners/pytest/environment/discover.ts
function projectDir(root, project) {
  return project.cwd === void 0 ? root : toAbsolute(root, project.cwd);
}
function discoverEnvironment(root, project) {
  const cwd = projectDir(root, project);
  if (project.python !== void 0) {
    const declared = resolve(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join2(declared, "bin", "python"));
    if (existsSync(declared)) return found("declared", dirname(dirname(declared)), declared);
    const target = basename(declared).startsWith("python") ? dirname(dirname(declared)) : declared;
    return none(root, cwd, [declared], target);
  }
  const venv = join2(cwd, ".venv");
  if (existsSync(join2(venv, "pyvenv.cfg"))) return found("venv", venv, join2(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname(dirname(pdm)), pdm);
  return none(root, cwd, [venv, join2(cwd, ".pdm-python")], venv);
}
function found(source, env, python) {
  return { kind: "found", source, env, python };
}
function pdmPython(root, cwd) {
  let text;
  try {
    text = readFileSync3(join2(cwd, ".pdm-python"), "utf8").trim();
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
    const hit = LOCKFILES.find(([file]) => existsSync(join2(dir, file)));
    if (hit !== void 0)
      return { kind: "none", looked, command: hit[1], from: join2(dir, hit[0]) };
  }
  for (const dir of dirs) {
    const files = requirementsIn(dir).map((file) => join2(dir, file));
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
    names2 = readdirSync2(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names2.filter((name2) => REQUIREMENTS.test(name2)).sort();
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
  // `slowFiles` and `slowGlobs` read `pytest[].slow` from the policy itself (004 D1, 007 D1; row 019-10).
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
  const inEnv = (name2) => env !== null && first?.includes("/") === true && resolve2(dir, first) === join3(env, "bin", name2);
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
import { existsSync as existsSync2, readFileSync as readFileSync5 } from "node:fs";
import { isAbsolute as isAbsolute5, join as join5, relative as relative3, resolve as resolve3 } from "node:path";

// src/core/daemon/runner.ts
import { readdirSync as readdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join4, posix as posix3 } from "node:path";

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
    names2 = readdirSync3(root);
  } catch {
    return false;
  }
  if (names2.some((name2) => VITEST_CONFIG.test(name2))) return true;
  return listsVitest(readManifest(join4(root, "package.json")));
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
    const hits = vitest.filter((ref2) => matchesFilter(join5(root, ref2.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref2 of hits) selected.add(ref2);
  }
  return vitest.filter((ref2) => selected.has(ref2));
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
    const manifest = JSON.parse(readFileSync5(join5(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text]) => typeof text === "string")
    );
  } catch {
    return {};
  }
}
function configFile(root) {
  for (const name2 of CONFIG_NAMES) {
    for (const extension of CONFIG_EXTENSIONS) {
      if (existsSync2(join5(root, `${name2}${extension}`))) return `${name2}${extension}`;
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

// src/core/delivery/format.ts
var SQUEAL_COMMAND = "squeal";

// src/core/code/store/open.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/core/store/open.ts
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

// src/core/code/coverage/parts.ts
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
var SYNC = { finishFlush: constants.Z_SYNC_FLUSH };
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

// src/core/hash/blob.ts
import { constants as constants2 } from "node:fs";
var OPEN_FLAGS = constants2.O_RDONLY | constants2.O_NOFOLLOW | constants2.O_NONBLOCK;

// src/core/code/coverage/sourcemap.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

// src/core/code/store/prune.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;

// src/core/lint/store/open.ts
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

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/keys/pnpm-lockfile.ts
var PNPM_VIRTUAL_STORE = "node_modules/.pnpm";
var PNPM_LOCKFILE = `${PNPM_VIRTUAL_STORE}/lock.yaml`;

// src/core/waiter-lock/waiter-lock.ts
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";

// src/core/delivery/prepared.ts
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

// src/core/status/open.ts
var SLEEP = new Int32Array(new SharedArrayBuffer(4));

// src/core/keys/environment-descriptor.ts
import { createHash as createHash2 } from "node:crypto";
function configFieldHash(value) {
  return digest(JSON.stringify(value));
}
function digest(text) {
  return createHash2("sha256").update(text).digest("hex");
}
var ONLY_REJECTED = configFieldHash(false);
var ONLY_ALLOWED = configFieldHash(true);

// src/core/slow/slot-files.ts
var SLOT_WAITER_FRESH_MS = 3e4;

// src/core/slow/slot.ts
import { DatabaseSync as DatabaseSync6 } from "node:sqlite";

// src/core/daemon/outlived.ts
import { execFile } from "node:child_process";
import { readdirSync as readdirSync4, readFileSync as readFileSync6 } from "node:fs";
import { readFile as readFile2 } from "node:fs/promises";
import { promisify } from "node:util";

// src/runners/process/recorders.ts
var UNOBSERVED = JSON.stringify({ out: "" });

// src/core/daemon/outlived.ts
var PF_EXITING = 4;
var CHUNK = 64;
function procRow(pid) {
  let text;
  try {
    text = readFileSync6(`/proc/${pid}/stat`, "latin1");
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
    const names2 = readdirSync4("/proc").filter((name2) => /^\d+$/.test(name2));
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

// src/core/ps/proc.ts
var MARK = Buffer.from(`${CHILD_VARIABLE}=`);

// src/core/capacity/pool.ts
var MARK_REFRESH_MS = SLOT_WAITER_FRESH_MS / 3;

// src/core/scheduler/capacity.ts
var CAPACITY_RECHECK_MS = 2e3;

// src/core/scheduler/pool-wait.ts
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

// src/harness/shared/coverage.ts
var DEFAULT_COVERAGE = { ...UNCONFIGURED3, slow: null };

// src/core/daemon/log-file.ts
var DAEMON_LOG_MAX_BYTES = 4 * 1024 * 1024;

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
function written(stream, text, boundMs) {
  return new Promise((resolve4, reject) => {
    const timer = setTimeout(() => reject(new Error("output not written in time")), boundMs);
    try {
      stream.write(text, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve4();
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
  let text = "";
  for (const arrival of arrivals) {
    const sentences = (covers, naming, wait) => [
      `${PRIMER_OPENING}${listed(names2, "and")} tests in the background${arrival} do not run ${listed(names2, "or")} to learn whether your edits broke something.`,
      ...groups2 === void 0 ? [] : [momentsSentence(command, naming, groups2)],
      waitSentence(command, naming, wait, quiet),
      ...coverage.slow === null ? [] : slowSentences(command, naming, coverage.slow),
      "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
      retrySentence(command, naming),
      REVISION,
      covers,
      notCovered(coverage)
    ].join(" ");
    text = folded(sentences, coverage, most);
    if (text.length <= PRIMER_CAP_CHARS) return text;
  }
  return text;
}
function folded(sentences, coverage, most) {
  let text = "";
  for (const naming of ["every", "first", "none"]) {
    for (let node2 = most; node2 >= 0; node2--) {
      text = sentences(coversSentence(coverage, node2), naming, "plain");
      if (text.length > PRIMER_CAP_CHARS) continue;
      const paths = sentences(coversSentence(coverage, node2), naming, "paths");
      return paths.length <= PRIMER_CAP_CHARS ? paths : text;
    }
    if (naming !== "first") continue;
    for (let node2 = most; node2 >= 0; node2--) {
      text = sentences(coversSentence(coverage, node2), naming, "short");
      if (text.length <= PRIMER_CAP_CHARS) return text;
    }
  }
  return text;
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
    const named3 = listed(
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
function listed(words, conjunction) {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}
function coversSentence(coverage, node2) {
  const suites = runnersOf(coverage).map(
    (runner) => suite(runner.name, runner.covered(coverage), node2)
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
    ({ name: name2, include }) => `${JSON.stringify(name2)} (${include.join(", ")})`
  );
  const list = named2("project", entries, shown);
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
function named2(noun, entries, shown) {
  const nouns = entries.length === 1 ? noun : `${noun}s`;
  if (shown === 0) return `${entries.length} ${nouns}`;
  const listed2 = entries.slice(0, shown);
  const rest = entries.length - shown;
  const tail = rest > 0 ? [...listed2, `${rest} more`] : listed2;
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
  const commit = new Promise((resolve4) => {
    const on = () => end(true);
    const timer = setTimeout(() => end(false), Math.max(0, boundMs));
    const end = (value) => {
      clearTimeout(timer);
      process.off(VERDICT_SIGNAL, on);
      resolve4(value);
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
    stdin = readFileSync7(0, "utf8");
  } catch {
  }
  await runBridge(stdin, new URL(module), kind, handler);
}

// src/harness/opencode/entries/hooks/ping.ts
await runEntry(import.meta.url, "ping", ping);
