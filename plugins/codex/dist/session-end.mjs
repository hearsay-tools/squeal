import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

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
  const entry2 = dotGit(root);
  if (entry2 === null) return null;
  if (!entry2.isFile) return realpathSync(entry2.gitDir);
  const { gitDir } = entry2;
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

// src/core/keys/closure.ts
var CLOSURE_METHOD = "static imports plus declared inputs";
function isInputList(inputs2) {
  return Array.isArray(inputs2);
}

// src/core/keys/hidden-lockfile.ts
var HIDDEN_LOCKFILE = "node_modules/.package-lock.json";

// src/core/keys/environment.ts
var LOCKFILES = [
  { path: HIDDEN_LOCKFILE, patches: "patches" },
  { path: "node_modules/.yarn-state.yml", patches: null },
  { path: ".pnp.cjs", patches: ".yarn/patches" },
  { path: ".pnp.js", patches: ".yarn/patches" },
  { path: "node_modules/.yarn-integrity", patches: "patches" },
  { path: "node_modules/.pnpm/lock.yaml", patches: null },
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
var VOLATILE = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  [/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms"],
  [/\b0x[0-9a-f]+\b/gi, "0x<addr>"],
  // A cache path names a tool's scratch space; its segments are hashes and run ids.
  [/(?:[^\s'"`(]*\/)?node_modules\/\.cache\/[^\s'"`):,]*/g, "<cache>"],
  ...tempPrefixes().map((prefix) => [
    new RegExp(`(?<![\\w.-])${escapeRegExp(prefix)}/[^\\s/'"\`):,]+`, "g"),
    "<tmp>"
  ]),
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // At least one letter, so a long decimal value in an assertion is kept.
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, "<hex>"]
];
function tempPrefixes() {
  const dir = tmpdir().replace(/\/+$/, "");
  let real = dir;
  try {
    real = realpathSync2(dir);
  } catch {
  }
  return [.../* @__PURE__ */ new Set([dir, real, "/tmp"])].filter((p) => p !== "").sort((a, b) => b.length - a.length);
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
var OUTCOMES = /* @__PURE__ */ new Set(["pass", "fail"]);
function isNote(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.key === "string" && OUTCOMES.has(v.from) && OUTCOMES.has(v.to) && typeof v.fromWorktreeId === "string" && typeof v.toWorktreeId === "string" && typeof v.at === "number";
}

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/daemon.ts
function bootstrappedMetaKey(worktreeId) {
  return `daemon-bootstrapped:${worktreeId}`;
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
    requireSlowSuite: false
  },
  baseline: { onStart: "lookup-then-run-missing" },
  inputs: [],
  observe: { runtimeInputs: true },
  env: { allowlist: [] },
  runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 6e5 },
  nodeTest: [],
  slow: { include: [], maxWorkers: 2, maxLoadPerCpu: 1, maxDeferMs: 6e5, maxParallel: 4 },
  daemon: { idleExitMinutes: 60 },
  store: { retentionDays: 7, maxSizeMb: null }
};

// src/core/types/scheduler.ts
var MAX_PERSISTED_NOTES = 20;
function notesMetaKey(worktreeId) {
  return `notes.${worktreeId}`;
}
function refinedMetaKey(worktreeId) {
  return `refined.${worktreeId}`;
}
function awaitingInstallMetaKey(worktreeId) {
  return `awaiting-install.${worktreeId}`;
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
  return `checkpoint.${worktreeId}`;
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
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/state/optimizer-note.ts
function optimizerOffMetaKey(worktreeId) {
  return `optimizer-off.${worktreeId}`;
}
function readOptimizerOff(store, worktreeId) {
  const text = store.meta.get(optimizerOffMetaKey(worktreeId));
  return text === null || text === "" ? void 0 : text;
}

// src/core/daemon/policy.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/core/notes.ts
function readDaemonNotes(store, worktreeId) {
  return parseList(store.meta.get(notesMetaKey(worktreeId))).flatMap(toNote).slice(-MAX_PERSISTED_NOTES);
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
  return [{ at, revision, text }];
}

// src/core/daemon/policy-node-test.ts
import { isAbsolute as isAbsolute2, posix } from "node:path";
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
  if (!Array.isArray(value)) return "an array of projects";
  const kept = [];
  const problems = [];
  value.forEach((entry2, index) => {
    const at = `${path}[${index}]`;
    const problem = entryProblem(entry2, at, kept);
    if (problem === null) kept.push(withDefaults(entry2));
    else problems.push(problem);
  });
  return { kept, problems };
}
function withDefaults(entry2) {
  return { ...entry2, argv: entry2.argv ?? [], env: entry2.env ?? {} };
}
function entryProblem(entry2, at, kept) {
  if (!isRecord(entry2))
    return `"${at}" must be an object, got ${JSON.stringify(entry2)}; it is skipped`;
  const named = nonEmptyString(entry2.name) === null ? entry2.name : null;
  const skipped = named === null ? "it is skipped" : `project ${JSON.stringify(named)} is skipped`;
  for (const key of Object.keys(entry2)) {
    if (!Object.hasOwn(FIELDS, key)) return `unknown key "${at}.${key}"; ${skipped}`;
  }
  for (const [key, field] of Object.entries(FIELDS)) {
    const given = entry2[key];
    if (given === void 0 && !REQUIRED.has(key)) continue;
    const expected = field(given);
    if (expected === null) continue;
    const why = typeof expected === "object" ? expected.problem : `must be ${expected}, got ${given === void 0 ? "undefined" : JSON.stringify(given)}`;
    return `"${at}.${key}" ${why}; ${skipped}`;
  }
  if (kept.some((project) => project.name === named)) {
    return `"${at}.name" repeats ${JSON.stringify(named)} of an earlier project; it is skipped`;
  }
  return null;
}

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
var positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
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
    requireSlowSuite: boolean2
  },
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
  slow: {
    include: slowInclude,
    maxWorkers: positiveInteger,
    maxLoadPerCpu: aboveZero,
    maxDeferMs: atLeastZero,
    maxParallel: positiveInteger
  },
  daemon: { idleExitMinutes: aboveZero },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) }
};
function loadPolicy(root) {
  let text;
  try {
    text = readFileSync2(join2(root, POLICY_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return { policy: DEFAULT_POLICY, problems: [] };
    return defaultsBecause(`could not be read: ${String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return defaultsBecause(`not valid JSON (${error.message})`);
  }
  if (!isRecord(parsed)) {
    return defaultsBecause(
      `must be a JSON object, got ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}`
    );
  }
  const problems = [];
  const merged = merge(SHAPE, DEFAULT_POLICY, parsed, "", problems);
  return { policy: merged, problems };
}
function readPolicy(root) {
  return loadPolicy(root).policy;
}
function defaultsBecause(problem) {
  return { policy: DEFAULT_POLICY, problems: [problem] };
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
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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
function slowFiles(policy, projects) {
  const matches = createInputMatcher(policy.slow.include);
  const slowProjects = new Set(
    projects.filter((project) => project.slow === true).map((project) => project.name)
  );
  return (testFile) => slowProjects.has(testFile.project) || matches(testFile.path);
}

// src/core/slow/inherit.ts
import { posix as posix2 } from "node:path";
function inheritsAcrossWorktrees(testFile, declaredInputs, testFiles, slowGlobs2) {
  if (!testFile.slow) return true;
  const covered = slowGlobs2.map(coveredPrefix);
  return declaredInputs.some(
    (path) => !testFiles.has(path) && !covered.some((prefix) => covers(prefix, path))
  );
}
function slowGlobs(policy, projects) {
  const globs2 = [...policy.slow.include];
  for (const project of projects) {
    if (project.slow !== true) continue;
    const cwd = project.cwd ?? ".";
    for (const glob of project.include) globs2.push(posix2.join(cwd, glob));
  }
  return globs2;
}
var GLOB_CHARS = /[*?[{]/;
function coveredPrefix(glob) {
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  const segments = source.split("/");
  const wild = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (wild === -1) return { file: source };
  return {
    dir: segments.slice(0, wild).map((segment) => `${segment}/`).join("")
  };
}
function covers(covered, path) {
  return "file" in covered ? covered.file === path : path.startsWith(covered.dir);
}

// src/core/slow/state.ts
function slowTierMetaKey(worktreeId) {
  return `slow-tier:${worktreeId}`;
}
function readSlowActivity(store, worktreeId) {
  const raw = store.meta.get(slowTierMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    return toActivity(JSON.parse(raw));
  } catch {
    return null;
  }
}
var WAITS = /* @__PURE__ */ new Set(["fast", "idle", "slot", "load"]);
function toActivity(value) {
  if (typeof value !== "object" || value === null) return null;
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
  return null;
}
function slowArtifactsMetaKey(worktreeId) {
  return `slow-artifacts:${worktreeId}`;
}
function readSlowArtifacts(store, worktreeId) {
  const raw = store.meta.get(slowArtifactsMetaKey(worktreeId));
  if (raw === null) return /* @__PURE__ */ new Map();
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return /* @__PURE__ */ new Map();
    return new Map(
      Object.entries(value).filter(
        (entry2) => Array.isArray(entry2[1]) && entry2[1].every((glob) => typeof glob === "string")
      )
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function failureKeysMetaKey(worktreeId) {
  return `failure-keys:${worktreeId}`;
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

// src/core/state/slow-sources.ts
function sourcesChanged(store, worktreeId, since, revision, artifact, isSource) {
  if (since >= revision) return false;
  const tested = /* @__PURE__ */ new Map();
  const now = /* @__PURE__ */ new Map();
  for (const { changes } of store.revisions.range(worktreeId, since, revision)) {
    for (const change2 of changes) {
      if (!tested.has(change2.path)) tested.set(change2.path, change2.oldHash);
      now.set(change2.path, change2.newHash);
    }
  }
  const isArtifact = createInputMatcher(artifact);
  return [...now].some(
    ([path, hash]) => hash !== tested.get(path) && path !== POLICY_FILE && !isArtifact(path) && isSource(path)
  );
}
function artifactSources(store, keys, view) {
  const testFiles = new Set(keys.map((row) => row.testFile.path));
  let closures;
  return (path) => {
    if (!inheritsAcrossWorktrees({ path, slow: true }, [path], testFiles, view.slowGlobs)) {
      return false;
    }
    closures ??= undeclaredClosures(store, keys, view);
    return closures.has(path);
  };
}
function undeclaredClosures(store, keys, view) {
  const listed = new Set(keys.map((row) => testFileId(row.testFile)));
  const paths = /* @__PURE__ */ new Set();
  for (const record of store.testFiles.list()) {
    if (!listed.has(testFileId(record.testFile))) continue;
    const declared = createInputMatcher(view.artifactFor(record.testFile.path));
    for (const path of record.closure.paths) if (!declared(path)) paths.add(path);
  }
  return paths;
}

// src/core/state/slow.ts
function slowPolicyView(policy) {
  const globs2 = slowGlobs(policy, policy.nodeTest);
  if (globs2.length === 0) return null;
  const { inputs: inputs2 } = policy;
  const rules = isInputList(inputs2) ? [{ applies: () => true, globs: inputs2 }] : Object.entries(inputs2).map(([testGlob, globs3]) => ({
    applies: createInputMatcher([testGlob]),
    globs: globs3
  }));
  return {
    isSlow: slowFiles(policy, policy.nodeTest),
    slowGlobs: globs2,
    artifactFor: (path) => [...new Set(rules.filter((r) => r.applies(path)).flatMap((r) => r.globs))].sort()
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
function readSlowTier(store, worktreeId, revision, states, keys, view) {
  const files = classifySlowFiles(states, keys, view.isSlow);
  const counts = { current: 0, pending: 0, notRun: 0 };
  for (const { class: cls } of files.values()) counts[cls]++;
  let currentAt = null;
  let currentUpTo = null;
  const ranFrom = /* @__PURE__ */ new Map();
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    if (files.get(id)?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
    currentUpTo = Math.max(currentUpTo ?? state.observedAt, state.observedAt);
    const origin = state.origin?.kind === "inherited" ? state.origin.worktreeId : worktreeId;
    ranFrom.set(id, origin);
  }
  const artifactOf = recordedArtifacts(store);
  const artifact = /* @__PURE__ */ new Set();
  const declaredToday = /* @__PURE__ */ new Set();
  let artifactUnknown = 0;
  for (const row of keys) {
    const from = ranFrom.get(testFileId(row.testFile));
    if (from === void 0) continue;
    const recorded = row.key === null ? void 0 : artifactOf(from, row.key);
    if (recorded === void 0) artifactUnknown++;
    for (const glob of recorded ?? []) artifact.add(glob);
    for (const glob of recorded === void 0 ? view.artifactFor(row.testFile.path) : []) {
      declaredToday.add(glob);
    }
  }
  const globs2 = [...artifact].sort();
  const isSource = artifactSources(store, keys, view);
  return {
    testFiles: files.size,
    ...counts,
    currentAt,
    ...currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {},
    artifact: globs2,
    ...artifactUnknown > 0 ? { artifactUnknown } : {},
    sourcesChangedSince: currentAt !== null && sourcesChanged(
      store,
      worktreeId,
      currentAt,
      revision,
      [...globs2, ...declaredToday],
      isSource
    ),
    activity: liveActivity(store, worktreeId, keys, view.isSlow)
  };
}
function recordedArtifacts(store) {
  const records = /* @__PURE__ */ new Map();
  return (from, key) => {
    let byKey = records.get(from);
    if (byKey === void 0) {
      byKey = readSlowArtifacts(store, from);
      records.set(from, byKey);
    }
    return byKey.get(key);
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
  const turns = readAll(store, `turn:${worktreeId}`);
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
}

// src/core/state/header.ts
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId), isSlow) {
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  const counts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  let inheritedCount = 0;
  for (const state of states) {
    counts[state.validity]++;
    if (state.validity === "current" && state.origin?.kind === "inherited") inheritedCount++;
  }
  const last = store.checkpoints.lastCompleted(worktreeId);
  const refinedRevision = readRefined(store, worktreeId);
  const missing = parseAwaitingInstall(store.meta.get(awaitingInstallMetaKey(worktreeId)));
  const awaiting = missing !== null;
  const view = worktreeSlowView(store, worktreeId);
  const slow = isSlow ?? view?.isSlow;
  const optimizerOff = readOptimizerOff(store, worktreeId);
  return {
    revision,
    counts,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    fullSuite: {
      atCurrentRevision: !awaiting && last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null
    },
    testFilesListed: keys.length > 0 || !awaiting && last !== null,
    inheritedCount,
    refinedRevision,
    runnerPartPending: refinedRevision !== null && refinedRevision < revision,
    ...slow === void 0 ? {} : { slowPending: countSlowPending(states, keys, slow) },
    ...view === null ? {} : { slowTier: readSlowTier(store, worktreeId, revision, states, keys, view) },
    ...awaiting ? { awaitingInstall: true } : {},
    ...missing !== null && missing.length > 0 ? { missingInstalls: missing } : {},
    ...optimizerOff === void 0 ? {} : { optimizerOff }
  };
}
function readRefined(store, worktreeId) {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
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
function countSlowPending(states, keys, isSlow) {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const files = /* @__PURE__ */ new Set();
  let checks = 0;
  for (const state of states) {
    if (state.validity !== "pending" || !isSlow(testFileOf(state.check))) continue;
    checks++;
    files.add(testFileKeyOf(state.check));
  }
  let testFilesWithoutChecks = 0;
  for (const row of keys) {
    const id = testFileId(row.testFile);
    if (withChecks.has(id) || !hasKey(row) || row.pending === null || !isSlow(row.testFile)) {
      continue;
    }
    testFilesWithoutChecks++;
    files.add(id);
  }
  return { testFiles: files.size, checks, testFilesWithoutChecks };
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

// src/core/delivery/consumer-version.ts
function versionMetaKey(worktreeId) {
  return `consumer-version:${worktreeId}`;
}
function recordVersion(store, consumer, version) {
  writeSlot(store, versionMetaKey(consumer.worktreeId), consumer, version);
}

// src/core/delivery/delivery.ts
import { setTimeout as sleep } from "node:timers/promises";

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
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/store/open.ts
import { existsSync as existsSync3, mkdirSync, renameSync, rmSync as rmSync2 } from "node:fs";
import { join as join5 } from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/core/store/paths.ts
import { join as join3 } from "node:path";
function storePaths(commonDir) {
  const dir = join3(commonDir, "squeal");
  return {
    dir,
    database: join3(dir, "store.sqlite"),
    runsDir: join3(dir, "runs"),
    locksDir: join3(dir, "locks")
  };
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
  if (oneOf2(row, "check_kind", ["test", "file"]) === "file") {
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
import { existsSync as existsSync2, rmSync } from "node:fs";
import { join as join4, resolve as resolve2, sep } from "node:path";
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
    if (existsSync2(join4(worktree.root, ".git"))) continue;
    worktrees.remove(worktree.id);
    worktreesRemoved++;
  }
  let resultsRemoved = dropPrunable(conn, cutoff);
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
    outcome: oneOf2(row, "outcome", OUTCOMES2),
    fingerprint: strOrNull(row, "fingerprint"),
    toldAt: num(row, "told_at")
  };
}

// src/core/store/repos/results.ts
import { createHash as createHash2 } from "node:crypto";
var OUTCOMES3 = ["pass", "fail", "skip"];
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
    outcome: oneOf2(row, "outcome", OUTCOMES3),
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
    list: (worktreeId) => conn.all(
      "SELECT * FROM test_file_keys WHERE worktree_id = ? ORDER BY project, path",
      worktreeId
    ).map(toTestFileKey),
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
var WORKTREE_META_PREFIXES = ["edits:", "checkpoint.", "rekeyed."];
var EDIT_KEYS_PREFIX = "edit-keys:";
function editKeysOf(key, worktreeId) {
  try {
    const owner = JSON.parse(key.slice(EDIT_KEYS_PREFIX.length));
    return Array.isArray(owner) && owner[0] === worktreeId;
  } catch {
    return false;
  }
}
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
        d?.heartbeatAt ?? record.lastHeartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null
      );
    },
    // Clearing keeps `daemon_heartbeat_at`: the last heartbeat (review wave 4.5, N5).
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?, daemon_started_at = ?,
           daemon_heartbeat_at = COALESCE(?, daemon_heartbeat_at),
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
        for (const prefix of WORKTREE_META_PREFIXES) {
          conn.run("DELETE FROM meta WHERE key = ?", `${prefix}${id}`);
        }
        const snapshots = conn.all(
          "SELECT key FROM meta WHERE substr(key, 1, ?) = ?",
          EDIT_KEYS_PREFIX.length,
          EDIT_KEYS_PREFIX
        );
        for (const row of snapshots) {
          const key = str(row, "key");
          if (editKeysOf(key, id)) conn.run("DELETE FROM meta WHERE key = ?", key);
        }
      });
    }
  };
}
function toRecord(row) {
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
  const lock2 = new DatabaseSync(join5(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock2.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock2.exec("BEGIN EXCLUSIVE");
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
    rollback(lock2);
    lock2.close();
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

// src/core/delivery/registered.ts
function registeredMetaKey(worktreeId) {
  return `revision-registered:${worktreeId}`;
}
function parkedMetaKey(worktreeId) {
  return `revision-registered-left:${worktreeId}`;
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
function scannedDaemon(store, worktreeId, alive) {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (!alive || daemon === null) return null;
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
  return parked === null ? null : { said: parked.said === true };
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
function park(store, consumer, at, { said } = { said: false }) {
  const key = registeredMetaKey(consumer.worktreeId);
  const current = registration(store, consumer);
  if (readSlot(store, key, consumer) !== void 0) writeSlot(store, key, consumer, null);
  if (current === null) return;
  const leftAt = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  const told = said ? { said: true } : {};
  writeParked(store, consumer, at, { ...current, leftAt, leftTime: at, ...told });
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
  const told = value.said === true ? { said: true } : {};
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
function loadOf(store, worktreeId, entry2) {
  if (entry2.summary === null || !TIMED_OUT.test(entry2.summary)) return void 0;
  const from = entry2.origin.kind === "inherited" ? entry2.origin.worktreeId : worktreeId;
  const result = store.results.listForCheck(entry2.check, LOAD_RESULTS_READ).find((r) => r.outcome === "fail" && r.provenance.worktreeId === from);
  return result?.errors.find((e) => e.loadAverage !== void 0)?.loadAverage;
}
function slowRunArtifact(worktreeId, slow, failureKeys, artifactOf, entry2) {
  const { origin } = entry2;
  const from = origin.kind === "inherited" ? origin.worktreeId : worktreeId;
  const key = failureKeys.get(checkIdentity(entry2.check));
  const recorded = key === void 0 ? void 0 : artifactOf(from, key);
  if (recorded !== void 0) return recorded;
  const { project, testPath } = entry2.check;
  return slow?.isSlow({ project, path: testPath }) === true ? null : void 0;
}
function recordedArtifacts2(store) {
  const records = /* @__PURE__ */ new Map();
  return (from, key) => {
    let byKey = records.get(from);
    if (byKey === void 0) {
      byKey = readSlowArtifacts(store, from);
      records.set(from, byKey);
    }
    return byKey.get(key);
  };
}
function closureFor(store, worktreeId) {
  const keys = /* @__PURE__ */ new Map();
  const keyOf = (id, ref) => {
    let byFile = keys.get(id);
    if (byFile === void 0) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  return (ref) => {
    const record = store.testFiles.get(ref);
    if (record === null) return void 0;
    if (record.updatedBy === worktreeId) return record.closure.paths;
    const key = keyOf(worktreeId, ref);
    return key !== null && key === keyOf(record.updatedBy, ref) ? record.closure.paths : void 0;
  };
}
function attribute(store, consumer, entries, revision) {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const from = registration(store, consumer);
  const changed = from === null ? null : changedAfter(store, consumer.worktreeId, from, revision);
  const sure = from !== null && seesEveryChange(store, consumer.worktreeId, from);
  const closureOf = closureFor(store, consumer.worktreeId);
  const slow = worktreeSlowView(store, consumer.worktreeId);
  const failureKeys = readFailureKeys(store, consumer.worktreeId);
  const artifactOf = recordedArtifacts2(store);
  return entries.map((entry2) => {
    if (entry2.kind === "fail-retired" || entry2.to !== "fail") return entry2;
    const { project, testPath } = entry2.check;
    const load = loadOf(store, consumer.worktreeId, entry2);
    const loaded = load === void 0 ? {} : { loadAverage: load };
    const slowArtifact = slowRunArtifact(consumer.worktreeId, slow, failureKeys, artifactOf, entry2);
    if (slowArtifact !== void 0) return { ...entry2, slowArtifact, ...loaded };
    const closure = changed === null ? void 0 : closureOf({ project, path: testPath });
    const touched = changed === null || closure === void 0 || closure.some((p) => changed.unknown.has(p)) ? void 0 : closure.filter((p) => changed.changed.has(p));
    const told = touched?.length === 0 && !sure ? void 0 : touched;
    return { ...entry2, ...told === void 0 ? {} : { changesInClosure: told }, ...loaded };
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
      entries.some((e) => e.to === "fail")
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
  return entries.map((entry2) => {
    if (entry2.kind === "fail-retired") return entry2;
    const note = notes.get(checkIdentity(entry2.check));
    const key = keys.get(testFileId(testFileOf(entry2.check)));
    return note === void 0 || note.key !== key ? entry2 : { ...entry2, flaky: note };
  });
}
function withDependencies(store, worktreeId, header, failing) {
  const installed = failing ? dependenciesInstalled(store, worktreeId) : void 0;
  return installed === void 0 ? header : { ...header, dependenciesInstalled: installed };
}

// src/core/delivery/delta.ts
function beforeFailing(history, state) {
  const last = history.at(-1);
  if (state.outcome !== "fail" || last?.to !== "fail" || last.toFingerprint !== state.fingerprint) {
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
  const sorted = entries.map((entry2, i) => ({ entry: entry2, i })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i).map(({ entry: entry2 }) => entry2);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}

// src/core/scheduler/rekeyed-record.ts
function rekeyedMetaKey(worktreeId) {
  return `rekeyed.${worktreeId}`;
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

// src/core/delivery/edits.ts
function editsMetaKey(worktreeId) {
  return `edits:${worktreeId}`;
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
  const legacy = `edit-keys:${JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId])}`;
  if (store.meta.get(legacy) !== null) store.meta.delete(legacy);
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
  for (const [id, entry2] of readRekeyed(store, consumer.worktreeId)) {
    const row = rows.get(id);
    if (row === void 0 || row.key === null || entry2.last <= state.since) continue;
    rekeyed.push(row);
    owed ||= entry2.open !== null && row.pending !== null;
  }
  const sawEdit = state.said || rekeyed.length === 0 ? void 0 : { queued: rekeyed.length };
  const editsSettled = owed ? void 0 : settled(state.since, rekeyed, states);
  if (sawEdit === void 0 && editsSettled === void 0) return null;
  return {
    ...sawEdit === void 0 ? {} : { sawEdit },
    ...editsSettled === void 0 ? {} : { editsSettled },
    tell: () => {
      writeState(store, consumer, {
        since: editsSettled === void 0 ? state.since : revision,
        said: true
      });
      if (editsSettled !== void 0) prune2(store, consumer.worktreeId);
    }
  };
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
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync2, rmSync as rmSync3 } from "node:fs";
import { join as join6 } from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
function waiterLockPath(locksDir, consumer) {
  const id = createHash3("sha256").update(JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId])).digest("hex").slice(0, 16);
  return join6(locksDir, `waiter-${id}.sqlite`);
}
function removeWaiterLock(locksDir, consumer) {
  const path = waiterLockPath(locksDir, consumer);
  if (!existsSync4(path)) return;
  const db = lock(path);
  if (db === null) return;
  try {
    rmSync3(path, { force: true });
  } finally {
    db.close();
  }
}
function lock(path) {
  const db = new DatabaseSync2(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
}

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
function harnessMetaKey(worktreeId) {
  return `harness-process:${worktreeId}`;
}
function recordHarness(store, consumer, harness) {
  writeSlot(store, harnessMetaKey(consumer.worktreeId), consumer, harness);
}

// src/core/status/git-head.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join7 } from "node:path";
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = gitDirOf(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read2(join7(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === void 0) return null;
    value = read2(join7(gitDir, ref)) ?? read2(join7(commonDir, ref)) ?? packed(commonDir, ref);
  }
  return null;
}
function packed(commonDir, ref) {
  for (const line of (read2(join7(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read2(path) {
  try {
    return readFileSync4(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
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
  const daemon = liveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
  const observed = daemon.state === "alive" ? revision : null;
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    worktreeId,
    worktreeRoot: worktree?.root ?? root,
    ...header,
    head: revision === null ? readGitHead(root) : revision.head,
    dirty: observed?.dirty ?? null,
    dirtyObservedAt: observed?.number ?? null,
    daemon,
    knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
    inherited: inheritedSources(store, states),
    breakdown: breakdown(states, keys),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes,
    daemonNotes: readDaemonNotes(store, worktreeId),
    ...openCheckpoint(store, worktreeId, daemon)
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
  const without = keys.filter((k) => !filesWithChecks.has(testFileId(k.testFile)));
  return {
    currentByOutcome,
    pendingByPhase,
    testFiles: keys.length,
    testFilesWithoutChecks: without.length,
    testFilesWithoutChecksRunning: without.filter((k) => k.pending === "running").length
  };
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
  const header = readHeader(store, worktreeId, states, keys);
  const changes = changedSince(store, worktreeId, header.revision, since);
  const installed = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path)
  );
  return {
    ...header,
    daemon: worktreeLiveness(store.worktrees.get(worktreeId), now),
    changedPaths: [...changes.keys()],
    ...installed === void 0 ? {} : { installedLockfile: installed.path }
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
var DAEMON_START_GRACE_MS = 1e4;
function livenessMetaKey(worktreeId) {
  return `liveness-told:${worktreeId}`;
}
function toldLiveness(store, consumer) {
  const told = readSlot(store, livenessMetaKey(consumer.worktreeId), consumer);
  if (told === "down") return "down";
  const since = isRecord(told) ? told.startingSince : void 0;
  return typeof since === "number" ? { startingSince: since } : "alive";
}
function tellLiveness(store, consumer, told) {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, told);
}
function asTold(live, told, at) {
  if (live.state === "alive" || typeof told !== "object") return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  return { ...live, startingSince };
}
function withTold(header, told, at) {
  return header.daemon === void 0 ? header : { ...header, daemon: asTold(header.daemon, told, at) };
}
function livenessChange(store, consumer, at) {
  const told = toldLiveness(store, consumer);
  const live = asTold(worktreeLiveness(store.worktrees.get(consumer.worktreeId), at), told, at);
  if (live.state === "down" && live.startingSince !== void 0) return null;
  return live.state === (typeof told === "object" ? "alive" : told) ? null : live;
}
function revisionMetaKey(worktreeId) {
  return `revision-told:${worktreeId}`;
}
function toldRevision(store, consumer) {
  const told = readSlot(store, revisionMetaKey(consumer.worktreeId), consumer);
  return typeof told === "number" ? told : null;
}
function tellRevision(store, consumer, revision) {
  writeSlot(store, revisionMetaKey(consumer.worktreeId), consumer, revision);
}

// src/core/delivery/turn.ts
function turnMetaKey(worktreeId) {
  return `turn:${worktreeId}`;
}
var START_IDLE = { turn: "idle", testFiles: [], newTestFiles: false };
var IN_TURN = { turn: "in-turn" };
function parse(value) {
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
    ...typeof value.revision === "number" ? { revision: value.revision } : {}
  };
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
function currentKeys(keys) {
  return new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
}
function endTurn(store, consumer, states, undelivered) {
  const keys = store.testFileKeys.list(consumer.worktreeId);
  const files = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") files.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.key !== null && k.pending !== null) files.add(testFileId(k.testFile));
  for (const e of undelivered) files.add(testFileKeyOf(e.check));
  const header = readHeader(store, consumer.worktreeId, states, keys);
  const current = currentKeys(keys);
  const testFiles = [...files].sort();
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles,
    newTestFiles: header.runnerPartPending === true,
    keys: Object.fromEntries(testFiles.map((f) => [f, current.get(f) ?? null])),
    revision: header.revision
  });
}
function atKey(state, file, keys) {
  const recorded = state.keys?.[file];
  return recorded === void 0 || keys.get(file) === recorded;
}
function waitedFor(state, entry2, keys) {
  if (state.turn !== "idle") return false;
  const file = testFileKeyOf(entry2.check);
  if (state.testFiles.includes(file)) return atKey(state, file, keys);
  return state.newTestFiles && entry2.kind !== "fail-retired" && entry2.from === null && (state.revision === void 0 || entry2.observedAt <= state.revision);
}
function trimmed(state, states, keys) {
  if (state.turn !== "idle" || state.testFiles.length === 0) return null;
  const current = currentKeys(keys);
  const pending = /* @__PURE__ */ new Set();
  for (const s of states) if (s.validity === "pending") pending.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.pending !== null) pending.add(testFileId(k.testFile));
  const owed = state.testFiles.filter((f) => pending.has(f) && atKey(state, f, current));
  if (owed.length === state.testFiles.length) return null;
  const { keys: recorded, ...rest } = state;
  const kept = Object.entries(recorded ?? {}).filter(([f]) => owed.includes(f));
  return {
    ...rest,
    testFiles: owed,
    ...recorded === void 0 ? {} : { keys: Object.fromEntries(kept) }
  };
}

// src/core/delivery/expiry.ts
function drop(store, consumer, at) {
  park(store, consumer, at, { said: editsSaid(store, consumer) });
  store.consumers.unregister(consumer);
  forget(store, consumer);
  store.meta.set(departedMetaKey(consumer.worktreeId), String(at));
}
function departedMetaKey(worktreeId) {
  return `departed:${worktreeId}`;
}
function forget(store, consumer) {
  tellLiveness(store, consumer, null);
  tellRevision(store, consumer, null);
  writeTurn(store, consumer, null);
  recordHarness(store, consumer, null);
  recordVersion(store, consumer, null);
  forgetEdits(store, consumer);
}

// src/core/delivery/own-edit.ts
var MOVED_ONLY = /^(?:[\w-]+: )?vitest adapter: (.+) changed on disk after this run loaded it; the run may have executed bytes no check key names \(task 001-146\)$/;
function movedPaths(reason) {
  const match = MOVED_ONLY.exec(reason);
  return match?.[1] === void 0 ? null : match[1].split(", ");
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
  function plan(consumer, states, toldAt, keep) {
    const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
    const full = planDelta({
      view: store.views.list(consumer),
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
  function deliver2(consumer, { heardFrom, keep = null, liveness: liveness2 = false, idle = false, stop = false }) {
    const select = (states) => {
      if (!idle) return { only: keep, trim: null };
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle") return "silent";
      const keys = store.testFileKeys.list(consumer.worktreeId);
      const current = currentKeys(keys);
      return {
        only: (entry2) => waitedFor(turn, entry2, current),
        trim: trimmed(turn, states, keys)
      };
    };
    if (!heardFrom) {
      if (store.consumers.get(consumer) === null) return null;
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const quiet = !liveness2 || livenessChange(store, consumer, now()) === null;
      const empty = isEmpty(plan(consumer, states, now(), selection.only));
      if (quiet && empty && selection.trim === null) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const delta = plan(consumer, states, at, selection.only);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const changed = liveness2 ? livenessChange(store, consumer, at) : null;
      if (changed !== null) tellLiveness(store, consumer, changed.state);
      const news = delta.entries.length > 0 || changed !== null;
      const notes = liveness2 || idle && news ? editNotes(store, consumer, states, news) : null;
      const delivered = news || liveness2 && !stop && notes?.sawEdit !== void 0;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) {
        if (selection.trim !== null) writeTurn(store, consumer, selection.trim);
        return null;
      }
      if (idle) startTurn(store, consumer);
      const told = toldRevision(store, consumer);
      const read3 = readLiveHeader(store, consumer.worktreeId, at, states, told);
      const live = withTold(read3, toldLiveness(store, consumer), at);
      tellRevision(store, consumer, live.revision);
      const { entries, header, stillFailing } = annotate(
        store,
        consumer,
        delta.entries,
        live,
        states
      );
      notes?.tell();
      const label = delta.entries.length > 0 && delta.entries.every(isBaselineEntry) ? "baseline" : "transitions";
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        label,
        entries,
        stillFailing,
        ...changed === null ? {} : { liveness: changed },
        ...notes?.sawEdit === void 0 ? {} : { sawEdit: notes.sawEdit },
        ...notes?.editsSettled === void 0 ? {} : { editsSettled: notes.editsSettled }
      };
    });
  }
  const quietAt = /* @__PURE__ */ new Map();
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
      const states = store.knownStates.list(consumer.worktreeId);
      store.views.writeMany(
        consumer,
        states.map((s) => toView2(s, at))
      );
      const told = startingSince === void 0 ? null : { startingSince };
      const read3 = readLiveHeader(store, consumer.worktreeId, at, states);
      const live = told === null ? read3 : withTold(read3, told, at);
      const knownFailures = states.flatMap((s) => toKnownFailure(s, live.revision) ?? []);
      const header = withDependencies(store, consumer.worktreeId, live, knownFailures.length > 0);
      const starting = header.daemon?.state === "down" && header.daemon.startingSince !== void 0;
      tellLiveness(store, consumer, starting ? told : header.daemon?.state ?? null);
      tellRevision(store, consumer, header.revision);
      if (!registered) {
        const alive = atStart && header.daemon?.state === "alive";
        const resumed = tellRegistered(store, consumer, header.revision, {
          at,
          scanned: scannedDaemon(store, consumer.worktreeId, alive)
        });
        startEdits(store, consumer, header.revision, resumed?.said === true);
      }
      if (inTurn) startTurn(store, consumer);
      else writeTurn(store, consumer, null);
      recordHarness(store, consumer, options.harnessProcess?.() ?? null);
      recordVersion(store, consumer, options.squealVersion ?? null);
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        knownFailures
      };
    }),
    unregister: async (consumer) => {
      store.transaction(() => drop(store, consumer, now()));
    },
    onToolBoundary: async (consumer, { stop = false } = {}) => deliver2(consumer, { heardFrom: true, liveness: true, stop }),
    peek: async (consumer, { kinds }) => {
      const only = new Set(kinds);
      return deliver2(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) });
    },
    startTurn: async (consumer) => deliver2(consumer, { heardFrom: true, liveness: true }),
    endTurn: async (consumer, { atRevision } = {}) => store.transaction(() => {
      if (store.consumers.get(consumer) === null) return true;
      const latest = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
      if (atRevision !== void 0 && latest !== atRevision) return false;
      const states = store.knownStates.list(consumer.worktreeId);
      endTurn(store, consumer, states, plan(consumer, states, now(), null).entries);
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

// src/core/delivery/format.ts
var SQUEAL_COMMAND = "squeal";
function shellWord(text) {
  return /["$`\\]/.test(text) ? `'${text.replaceAll("'", "'\\''")}'` : `"${text}"`;
}

// src/core/daemon/version.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname2, join as join8 } from "node:path";
import { fileURLToPath } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var PACKAGE_NAME = "squeal";
function squealVersion() {
  if (true) return "0.1.103";
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}
function manifestVersion(module) {
  let dir = dirname2(fileURLToPath(module));
  for (; ; ) {
    const version = readVersion(join8(dir, "package.json"));
    if (version !== null) return version;
    const parent = dirname2(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync5(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { name, version } = parsed;
    return name === PACKAGE_NAME && typeof version === "string" ? version : null;
  } catch {
    return null;
  }
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
  const read3 = lookup.read ?? readProcStat;
  const namespace = (lookup.namespace ?? pidNamespace)();
  if (namespace === null) return null;
  let pid = lookup.ppid ?? process.ppid;
  try {
    for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
      const stat = read3(pid);
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
function primer(command = SQUEAL_COMMAND, nodeTest = false, slow = false) {
  const runners = nodeTest ? "Vitest and node:test" : "Vitest";
  const run = nodeTest ? "Vitest or node:test" : "Vitest";
  return [
    `Squeal runs this repository's ${runners} tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run ${run} to learn whether your edits broke something.`,
    `Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: \`${command} status --wait 60000\`.`,
    "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
    ...slow ? [slowSentence(command)] : [],
    slow ? "Squeal does not cover typecheck or build." : "Squeal does not cover typecheck, build or other test suites."
  ].join(" ");
}
function slowSentence(command) {
  const arrives = command === SQUEAL_COMMAND ? "a slow failure wakes you when you are idle in an interactive session, otherwise it arrives with your next prompt or tool call" : "a slow failure arrives with your next prompt or tool call";
  return `Slow test suites run when you pause between turns or on \`${command} run --slow\`, never during Stop's wait; the header's slow-tier line says whether they are current, and ${arrives}.`;
}
var PRIMER = primer();

// src/harness/shared/sweep.ts
async function unregisterSession(context, sessionId, options) {
  const { store, delivery } = context;
  const worktrees = /* @__PURE__ */ new Set([
    context.consumer.worktreeId,
    ...store.worktrees.list().map((w) => w.id)
  ]);
  const consumers = [...worktrees].flatMap(
    (id) => store.consumers.list(id).map((record) => record.consumer).filter((consumer) => consumer.sessionId === sessionId && !same(consumer, options.except))
  );
  const errors = [];
  const attempt = async (fn) => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  };
  for (const consumer of consumers) await attempt(() => delivery.unregister(consumer));
  if (options.removeLocks) {
    const { locksDir } = storePaths(context.commonDir);
    for (const consumer of consumers) await attempt(() => removeWaiterLock(locksDir, consumer));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `squeal: ${errors.length} errors unregistering session ${sessionId}`
    );
  }
  return consumers;
}
function same(a, b) {
  return b !== void 0 && a.worktreeId === b.worktreeId && a.sessionId === b.sessionId && a.agentId === b.agentId;
}

// src/harness/shared/session.ts
async function endSession(input, locations, deps) {
  for (const at of locations) {
    await withContext(input, at, deps, async (context) => {
      await unregisterSession(context, input.session_id, { removeLocks: true });
      return null;
    });
  }
}

// src/core/slow/slot.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/harness/codex/handlers.ts
var sessionEnd = async (input, location2, deps) => {
  await endSession(input, [location2], deps);
  return null;
};

// src/harness/codex/main.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/harness/codex/command.ts
import { join as join9 } from "node:path";
function codexCommand(env, bundleCli) {
  const root = env.PLUGIN_ROOT;
  const cli = root === void 0 || root === "" ? bundleCli : join9(root, "dist/cli/squeal.mjs");
  return `node --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
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
    const location2 = locate(input.cwd);
    if (location2 === null) return SILENT;
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
    stdin = readFileSync6(0, "utf8");
  } catch {
  }
  const cli = fileURLToPath2(new URL("./cli/squeal.mjs", import.meta.url));
  const result = await runCodexHandler(name, handler, stdin, {
    env: process.env,
    cli,
    command: codexCommand(process.env, cli)
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}

// src/harness/codex/entries/session-end.ts
await runMain("session-end", sessionEnd);
