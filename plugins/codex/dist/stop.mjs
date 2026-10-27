// src/harness/codex/adapter/index.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { join as join6 } from "node:path";
import { pathToFileURL } from "node:url";

// src/harness/codex/adapter/manifest.ts
import { lstatSync, readdirSync as readdirSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/harness/codex/adapter/layout.ts
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
var SCHEMA = 1;
var VERSION = /^\d+\.\d+\.\d+$/;
var versionsDir = (data) => join(data, "versions");
var runtimeRoot = (data, version) => join(data, "versions", version);
var currentFile = (data) => join(data, "runtime", "current.json");
var sessionsDir = (data) => join(data, "runtime", "sessions");
function pinFile(data, sessionId) {
  return join(sessionsDir(data), `${sha256(sessionId)}.json`);
}
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}
function isNewer(version, than) {
  const a = parts(version);
  const b = parts(than);
  if (a === null || b === null) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
function parts(version) {
  return VERSION.test(version) ? version.split(".").map(Number) : null;
}
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? void 0 : null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function readCurrent(data) {
  const value = readJson(currentFile(data));
  if (value === void 0) return null;
  return isObject(value) && value.schema === SCHEMA && typeof value.version === "string" && VERSION.test(value.version) ? { schema: SCHEMA, version: value.version } : "invalid";
}
function readPin(path) {
  const value = readJson(path);
  if (value === void 0) return null;
  return isObject(value) && value.schema === SCHEMA && typeof value.sessionId === "string" && typeof value.version === "string" && VERSION.test(value.version) ? { schema: SCHEMA, sessionId: value.sessionId, version: value.version } : "invalid";
}
var part = (path) => `${path}.${process.pid}.${Date.now()}.tmp`;
function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = part(path);
  try {
    writeWhole(tmp, text);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
function createExclusive(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = part(path);
  try {
    writeWhole(tmp, text);
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
}
function writeWhole(path, text) {
  rmSync(path, { force: true });
  writeFileSync(path, text, { flag: "wx", mode: 420 });
}

// src/harness/codex/adapter/manifest.ts
var RUNTIME_MANIFEST = "runtime.json";
var PLUGIN_MANIFEST = ".codex-plugin/plugin.json";
var RUNTIME_ENTRY = "dist/runtime.mjs";
var RUNTIME_HOOKS = [
  "session-start",
  "user-prompt-submit",
  "pre-tool-use",
  "post-tool-use",
  "stop",
  "stop-slow",
  "subagent-start",
  "subagent-stop",
  "interrupt",
  "session-end"
];
var REQUIRED_ENTRIES = [
  PLUGIN_MANIFEST,
  RUNTIME_ENTRY,
  "dist/cli/squeal.mjs",
  ...RUNTIME_HOOKS.map((name) => `dist/${name}.mjs`),
  "skills/squeal/SKILL.md",
  "bin/squeal-launcher"
];
var MODES = /* @__PURE__ */ new Set([420, 493]);
var SHA256 = /^[0-9a-f]{64}$/;
var NODE_FLOOR = /^\d+\.\d+\.\d+$/;
var LAUNCHER = "bin/squeal-launcher";
var RuntimeError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "RuntimeError";
  }
  kind;
};
var invalid = (root, detail) => new RuntimeError("invalid-runtime", `${root} is no valid Squeal runtime: ${detail}`);
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function meetsFloor(node, floor) {
  const have = node.split(".").map(Number);
  const need = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
function isInventoryPath(path) {
  if (path === RUNTIME_MANIFEST || path.includes("\\") || path.startsWith("/")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}
function parseManifest(root, text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid(root, `${RUNTIME_MANIFEST} is not JSON`);
  }
  if (!isObject2(value) || value.schema !== SCHEMA) {
    throw invalid(root, `${RUNTIME_MANIFEST} has no supported schema`);
  }
  const { version, nodeFloor, files } = value;
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw invalid(root, `${RUNTIME_MANIFEST} names no plain version`);
  }
  if (typeof nodeFloor !== "string" || !NODE_FLOOR.test(nodeFloor)) {
    throw invalid(root, `${RUNTIME_MANIFEST} names no supported Node floor`);
  }
  const inventory = parseInventory(root, files);
  for (const required of REQUIRED_ENTRIES) {
    if (inventory[required] === void 0) throw invalid(root, `${required} is missing`);
  }
  if (inventory[LAUNCHER]?.mode !== 493) throw invalid(root, `${LAUNCHER} must have mode 0755`);
  const manifest = { schema: SCHEMA, version, nodeFloor, files: inventory };
  if (serializeManifest(manifest) !== text) {
    throw invalid(root, `${RUNTIME_MANIFEST} is not in its canonical form`);
  }
  return manifest;
}
function parseInventory(root, files) {
  if (!isObject2(files)) throw invalid(root, `${RUNTIME_MANIFEST} has no file inventory`);
  const inventory = {};
  for (const [path, entry] of Object.entries(files)) {
    if (!isInventoryPath(path)) {
      throw invalid(root, `unsafe inventory path ${JSON.stringify(path)}`);
    }
    if (!isObject2(entry) || typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      throw invalid(root, `${path} has no SHA-256`);
    }
    if (typeof entry.mode !== "number" || !MODES.has(entry.mode)) {
      throw invalid(root, `${path} has a mode other than 0644 or 0755`);
    }
    inventory[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  return inventory;
}
function serializeManifest(manifest) {
  const files = {};
  for (const path of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[path];
    files[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  const { schema, version, nodeFloor } = manifest;
  return `${JSON.stringify({ schema, version, nodeFloor, files }, null, 2)}
`;
}
function pluginVersion(root) {
  let value;
  try {
    value = JSON.parse(readFileSync2(join2(root, PLUGIN_MANIFEST), "utf8"));
  } catch {
    throw invalid(root, `${PLUGIN_MANIFEST} is missing or not JSON`);
  }
  if (!isObject2(value) || value.name !== "squeal" || typeof value.version !== "string") {
    throw invalid(root, `${PLUGIN_MANIFEST} does not name squeal and a version`);
  }
  return value.version;
}
function readManifest(root) {
  let text;
  try {
    text = readFileSync2(join2(root, RUNTIME_MANIFEST), "utf8");
  } catch {
    throw invalid(root, `${RUNTIME_MANIFEST} is missing`);
  }
  return { manifest: parseManifest(root, text), text };
}
function checkRoot(root, expected, node) {
  const { manifest } = readManifest(root);
  const named = pluginVersion(root);
  if (named !== manifest.version) {
    throw invalid(
      root,
      `${PLUGIN_MANIFEST} names ${named}, ${RUNTIME_MANIFEST} ${manifest.version}`
    );
  }
  if (expected !== null && manifest.version !== expected) {
    throw invalid(root, `it holds runtime ${manifest.version}, not ${expected}`);
  }
  if (!meetsFloor(node, manifest.nodeFloor)) {
    throw new RuntimeError(
      "unsupported-node",
      `Squeal runtime ${manifest.version} needs Node ${manifest.nodeFloor} or later; this hook runs Node ${node}.`
    );
  }
  for (const entry of REQUIRED_ENTRIES) {
    if (!isRegularFile(join2(root, entry))) throw invalid(root, `${entry} is missing`);
  }
  return manifest;
}
function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
function listTree(root) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync2(dir).sort()) {
      const path = join2(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, rel);
      else if (!stat.isFile()) throw invalid(root, `${rel} is not a regular file or directory`);
      else if (stat.nlink > 1) throw invalid(root, `${rel} is hard-linked`);
      else files.push(rel);
    }
  };
  walk(root, "");
  return files;
}
function verifyTree(root, node) {
  const { manifest, text } = readManifest(root);
  checkRoot(root, manifest.version, node);
  const files = listTree(root).filter((f) => f !== RUNTIME_MANIFEST);
  const listed = Object.keys(manifest.files);
  const extra = files.find((f) => manifest.files[f] === void 0);
  if (extra !== void 0) throw invalid(root, `${extra} is not in ${RUNTIME_MANIFEST}`);
  const missing = listed.find((f) => !files.includes(f));
  if (missing !== void 0) throw invalid(root, `${missing} is missing`);
  return { manifest, text, files };
}
function checkBytes(root, manifest, path, sha) {
  if (manifest.files[path]?.sha256 !== sha)
    throw invalid(root, `${path} does not match its SHA-256`);
}
function samePayload(a, b) {
  const keys = Object.keys(a.files).sort();
  if (a.version !== b.version || a.nodeFloor !== b.nodeFloor) return false;
  if (keys.join("\n") !== Object.keys(b.files).sort().join("\n")) return false;
  return keys.every(
    (k) => a.files[k]?.sha256 === b.files[k]?.sha256 && a.files[k]?.mode === b.files[k]?.mode
  );
}

// src/harness/codex/adapter/repository.ts
import { existsSync, readFileSync as readFileSync3, statSync } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join3 } from "node:path";
var isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
var firstLine = (path) => readFileSync3(path, "utf8").split("\n")[0] ?? "";
function usesSquealAt(dir) {
  try {
    let root = dir;
    if (isFile(join3(root, "squeal.config.json"))) return true;
    while (!existsSync(join3(root, ".git"))) {
      const up = dirname2(root);
      if (up === root) return false;
      root = up;
    }
    if (isFile(join3(root, "squeal.config.json"))) return true;
    let git = join3(root, ".git");
    if (isFile(git)) {
      const named = firstLine(git).replace(/^gitdir:/, "").trim();
      git = isAbsolute(named) ? named : join3(root, named);
      const common = isFile(join3(git, "commondir")) ? firstLine(join3(git, "commondir")).trim() : "";
      if (common !== "") git = isAbsolute(common) ? common : join3(git, common);
    }
    return existsSync(join3(git, "squeal"));
  } catch {
    return false;
  }
}

// src/harness/codex/adapter/store.ts
import { readFileSync as readFileSync5, rmSync as rmSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/harness/codex/adapter/publish.ts
import {
  chmodSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync4,
  renameSync as renameSync2,
  rmSync as rmSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename, dirname as dirname4, join as join4 } from "node:path";

// src/harness/codex/adapter/selection.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname3 } from "node:path";
import { DatabaseSync } from "node:sqlite";
var selectionFile = (data) => `${currentFile(data)}.sqlite`;
function selectCurrent(data, version, options = {}) {
  const node = options.node ?? process.versions.node;
  const release = acquireSelection(data);
  try {
    const candidate = { root: runtimeRoot(data, version), version };
    checkRoot(candidate.root, version, node);
    const current = readCurrent(data);
    let winner = candidate;
    const advance = current === null || current === "invalid" || isNewer(version, current.version);
    if (!advance) {
      const root = runtimeRoot(data, current.version);
      try {
        checkRoot(root, current.version, node);
        winner = { root, version: current.version };
      } catch {
      }
    }
    options.beforeSelect?.();
    if (advance) {
      try {
        writeAtomic(currentFile(data), `${JSON.stringify({ schema: SCHEMA, version })}
`);
      } catch (error) {
        throw writeError(data, error);
      }
    }
    return winner;
  } finally {
    release();
  }
}
function acquireSelection(data) {
  let db;
  try {
    mkdirSync2(dirname3(selectionFile(data)), { recursive: true });
    db = new DatabaseSync(selectionFile(data));
  } catch (error) {
    throw writeError(data, error);
  }
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if ((error.errcode ?? 0) % 256 !== 5) throw writeError(data, error);
    throw new RuntimeError(
      "selection-busy",
      `Squeal runtime selection under ${data} is busy. Retry this hook or command; no session runtime was changed.`
    );
  }
  return () => db.close();
}
function writeError(data, error) {
  return new RuntimeError(
    "unwritable-data",
    `Squeal cannot write its runtime store under ${data}: ${error instanceof Error ? error.message : String(error)}`
  );
}

// src/harness/codex/adapter/publish.ts
var errorText = (error) => error instanceof Error ? error.message : String(error);
var unwritable = (data, error) => new RuntimeError(
  "unwritable-data",
  `Squeal cannot write its runtime store under ${data}: ${errorText(error)}`
);
function publishRuntime(options) {
  const { sourceRoot, data, select = false, node = process.versions.node } = options;
  const source = verifyTree(sourceRoot, node);
  const { version } = source.manifest;
  const root = runtimeRoot(data, version);
  if (held(root, source.manifest, node) !== "same") {
    let staged;
    try {
      mkdirSync3(versionsDir(data), { recursive: true });
      staged = join4(versionsDir(data), `.${version}.${process.pid}.tmp`);
      rmSync2(staged, { recursive: true, force: true });
    } catch (error) {
      throw unwritable(data, error);
    }
    try {
      stage(sourceRoot, source, staged, data);
      place(staged, root, source.manifest, node, data);
    } finally {
      rmSync2(staged, { recursive: true, force: true });
    }
  }
  if (select) return selectCurrent(data, version, options);
  return { root, version };
}
function stage(sourceRoot, source, staged, data) {
  const write = (path, bytes, mode) => {
    try {
      mkdirSync3(dirname4(join4(staged, path)), { recursive: true });
      writeFileSync2(join4(staged, path), bytes, { flag: "wx" });
      chmodSync(join4(staged, path), mode);
    } catch (error) {
      throw unwritable(data, error);
    }
  };
  for (const path of source.files) {
    let bytes;
    try {
      bytes = readFileSync4(join4(sourceRoot, path));
    } catch (error) {
      throw new RuntimeError("invalid-runtime", `${sourceRoot}: ${path}: ${errorText(error)}`);
    }
    checkBytes(sourceRoot, source.manifest, path, sha256(bytes));
    write(path, bytes, source.manifest.files[path]?.mode ?? 420);
  }
  write(RUNTIME_MANIFEST, source.text, 420);
}
function place(staged, root, manifest, node, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync2(staged, root);
      return;
    } catch (error) {
      if (attempt > 0 || !existsSync2(root)) throw unwritable(data, error);
    }
    if (held(root, manifest, node) === "same") return;
    removeTree(root);
  }
}
function held(root, manifest, node) {
  if (!existsSync2(root)) return "absent";
  let tree;
  try {
    tree = verifyTree(root, node);
    for (const path of tree.files) {
      checkBytes(root, tree.manifest, path, sha256(readFileSync4(join4(root, path))));
    }
  } catch {
    return "invalid";
  }
  if (samePayload(tree.manifest, manifest)) return "same";
  throw new RuntimeError(
    "version-conflict",
    `${root} already holds a different Squeal runtime ${manifest.version}; a runtime of another payload cannot claim that version.`
  );
}
function removeTree(root) {
  const doomed = join4(dirname4(root), `.${basename(root)}.${process.pid}.gone`);
  try {
    renameSync2(root, doomed);
  } catch {
    return;
  }
  rmSync2(doomed, { recursive: true, force: true });
}

// src/harness/codex/adapter/store.ts
var SEED = "seed";
function selectRuntime(options) {
  const node = options.node ?? process.versions.node;
  const { data, sessionId } = options;
  if (sessionId === null) return chooseNew(options.pluginRoot, data, node);
  const path = pinFile(data, sessionId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pin = readPin(path);
    if (pin !== null) return usePin(data, sessionId, path, pin, node);
    const chosen = chooseNew(options.pluginRoot, data, node);
    if (options.pin === false) return chosen;
    const record = { schema: SCHEMA, sessionId, version: chosen.version };
    let created;
    try {
      created = createExclusive(path, `${JSON.stringify(record)}
`);
    } catch (error) {
      throw unwritable(data, error);
    }
    if (created) return chosen;
  }
  throw new RuntimeError(
    "invalid-pin",
    `${path} kept changing while this hook read it. Start a new Codex session.`
  );
}
function usePin(data, sessionId, path, pin, node) {
  if (pin === "invalid" || pin.sessionId !== sessionId) {
    throw new RuntimeError(
      "invalid-pin",
      `This Codex session's runtime record ${path} is unreadable. Squeal does not guess the runtime of a running session. Start a new Codex session.`
    );
  }
  const root = runtimeRoot(data, pin.version);
  try {
    checkRoot(root, pin.version, node);
  } catch (error) {
    if (error instanceof RuntimeError && error.kind === "unsupported-node") throw error;
    throw new RuntimeError(
      "missing-pinned-runtime",
      `Squeal runtime ${pin.version}, which this Codex session started with, is missing or incomplete (${errorText(error)}). Squeal does not switch a running session to another runtime. Start a new Codex session to use the installed runtime.`
    );
  }
  return { root, version: pin.version, source: "pin" };
}
function chooseNew(pluginRoot, data, node) {
  const current = readCurrent(data);
  const now = usable(data, current, node);
  const seedRoot = join5(pluginRoot, SEED);
  let seed;
  try {
    seed = checkRoot(seedRoot, null, node).version;
  } catch (error) {
    if ("root" in now) return { ...now, source: "current" };
    throw new RuntimeError(
      "no-runtime",
      `No usable Squeal runtime. Installed: ${now.problem}. The plugin's seed: ${errorText(error)}. Reinstall the Squeal plugin (codex plugin add squeal@hearsay) or run Squeal's install.sh.`
    );
  }
  if ("root" in now && !isNewer(seed, now.version)) return { ...now, source: "current" };
  const retained = runtimeRoot(data, seed);
  try {
    checkRoot(retained, seed, node);
  } catch {
    publishRuntime({ sourceRoot: seedRoot, data, node });
  }
  const winner = selectCurrent(data, seed, { node });
  return { ...winner, source: winner.version === seed ? "seed" : "current" };
}
function usable(data, current, node) {
  if (current === null) return { problem: "none" };
  if (current === "invalid") return { problem: `${currentFile(data)} is unreadable` };
  const root = runtimeRoot(data, current.version);
  try {
    checkRoot(root, current.version, node);
    return { root, version: current.version };
  } catch (error) {
    return { problem: errorText(error) };
  }
}
function releaseSession(data, sessionId) {
  rmSync3(pinFile(data, sessionId), { force: true });
}

// src/harness/codex/adapter/index.ts
var ADAPTER_ROOT_ENV = "SQUEAL_ADAPTER_ROOT";
var CONTEXT_EVENTS = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  "subagent-start": "SubagentStart"
};
async function runAdapterHook(name, options = {}) {
  if (!RUNTIME_HOOKS.includes(name)) return;
  const env = options.env ?? process.env;
  const write = options.write ?? ((text) => process.stdout.write(text));
  const stdin = options.stdin ?? readStdin();
  const pluginRoot = env.PLUGIN_ROOT ?? "";
  const data = env.PLUGIN_DATA ?? "";
  if (pluginRoot === "" || data === "") return;
  const input = fields(stdin);
  const inUse = input.cwd !== null && usesSquealAt(input.cwd);
  let runtime;
  let module;
  try {
    runtime = selectRuntime({ pluginRoot, data, sessionId: input.sessionId, pin: inUse });
    module = await load(runtime.root);
  } catch (error) {
    if (inUse) diagnose(name, error, write);
    debug(env, name, error);
    return;
  }
  env[ADAPTER_ROOT_ENV] = pluginRoot;
  env.PLUGIN_ROOT = runtime.root;
  try {
    await module.runRuntimeHook(name, stdin, env);
  } catch (error) {
    debug(env, name, error);
  }
  if (name === "session-end" && input.sessionId !== null) {
    try {
      releaseSession(data, input.sessionId);
    } catch (error) {
      debug(env, name, error);
    }
  }
}
function readStdin() {
  try {
    return readFileSync6(0, "utf8");
  } catch {
    return "";
  }
}
function fields(stdin) {
  try {
    const value = JSON.parse(stdin);
    if (typeof value !== "object" || value === null) return { sessionId: null, cwd: null };
    const { session_id, cwd } = value;
    return {
      sessionId: typeof session_id === "string" && session_id !== "" ? session_id : null,
      cwd: typeof cwd === "string" && cwd !== "" ? cwd : null
    };
  } catch {
    return { sessionId: null, cwd: null };
  }
}
async function load(root) {
  const entry = join6(root, RUNTIME_ENTRY);
  let module;
  try {
    module = await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new RuntimeError("invalid-runtime", `${entry} cannot be loaded: ${String(error)}`);
  }
  const run = module.runRuntimeHook;
  if (typeof run !== "function") {
    throw new RuntimeError("invalid-runtime", `${entry} exports no runRuntimeHook`);
  }
  return { runRuntimeHook: run };
}
function diagnosticText(error) {
  const reason = error instanceof Error ? error.message : String(error);
  return `SQUEAL \xB7 validation unavailable in this session. ${reason}
Squeal reports no test results here until this is fixed: run the project's tests yourself meanwhile.`;
}
function diagnose(name, error, write) {
  const event = CONTEXT_EVENTS[name];
  if (event === void 0) return;
  write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: diagnosticText(error) }
    })
  );
}
function debug(env, name, error) {
  if (env.SQUEAL_HOOK_DEBUG === "1") {
    process.stderr.write(`squeal codex adapter ${name}: ${String(error)}
`);
  }
}

// squeal-adapter-hook:stop
await runAdapterHook("stop");
