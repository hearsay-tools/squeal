"use strict";
/*
 * Spec 028 D7 (row 028-07): one warm Jest worker. `run/warm.ts` starts it
 * in a process group of its own, with an IPC channel, from the project's
 * Jest working directory. It reads the project's config and builds its
 * haste map once, at `init`, through the project's own `@jest/core`,
 * `jest-config` and `jest-runtime`, then runs each `run` message's files
 * in band through `createTestScheduler(...).scheduleTests(...)`: no Jest
 * process start and no config read per batch (research 028-01 F2.2).
 *
 * Messages in: `init` `{ root, cwd, wrapperPath, cacheDir, coreDir,
 * configDir, runtimeDir, reporterPath, coverage }`; `run` `{ id, files,
 * eventsFile, coverageDir, observeOut, observeSkip, env }`; `shutdown`. Out:
 * `ready` `{ pid, rssBytes, hostModules }`, `done` `{ id, rssBytes,
 * hostModules, runtimeHostModules }`, `error` `{ id, message, hostModules }`
 * (then it exits 1).
 *
 * Each batch starts with the recorder's reset (`recorder.cjs`, when it is
 * loaded), so a path read by a batch before is recorded again, to the
 * batch's own folder. Squeal's reporter reads `SQUEAL_JEST_EVENTS` and
 * `SQUEAL_JEST_COVERAGE_DIR` when the scheduler builds it, once per batch.
 * `env` goes over this process's own environment for the batch only, so
 * what a test starts carries the run's marks while this process does not.
 *
 * A new resolver per batch, with Jest's resolver caches cleared as
 * `runJest` clears them, and Jest's in-memory transforms forgotten: a
 * changed `package.json` resolves, and a transform keyed on more than its
 * file transforms, as a fresh Jest would. An added or deleted file, or a config change,
 * needs a new haste map: `warm.ts` starts a new worker then.
 *
 * Node's own module cache is never cleared (review 0.1.648 B1): a local
 * transformer, resolver or test environment, and every worktree file it
 * requires or imports, stays as this process first loaded it. So every
 * worktree module Node loads here (outside `node_modules` and `.git`) is in
 * `hostModules`, and `warm.ts` retires the worker when one of them changes.
 * `runtimeHostModules` are those loaded by a batch, not by `init`: a batch
 * uses them, cached or not, so each of its test files is observed to read
 * them. Test files and the sources they load run in Jest's sandbox, never
 * through Node's loader, and are neither.
 *
 * Without its parent (the channel closes) it kills its own group at once,
 * so no worker outlives the runner that started it. Node built-ins only.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { fileURLToPath } = require("node:url");

const { createRequire } = Module;
const RESET = Symbol.for("squeal.observeReset");

/** The project's Jest, loaded at `init`. */
let core = null;
let globalConfig = null;
let context = null;
let firstRun = true;
/** The keys a batch's `env` set, with what this process had before. */
const before = new Map();

/** The worktree, real, from `init`; until then nothing is recorded. */
let root = null;
/** What Node had loaded before `init`: Squeal's own files and the recorder. */
const baseline = new Set(Object.keys(require.cache));
/** Every worktree module Node loaded, and those a batch loaded; absolute paths. */
const hostModules = new Set();
const runtimeHostModules = new Set();
/** The modules `init` loaded; set once it is done. */
let initModules = null;
let running = false;
const realPaths = new Map();

/** `file`, a path or a `file:` URL, and its real path, when inside the worktree; `runtime` when a batch loads it. */
function recordNative(file, runtime = running) {
  if (root === null || typeof file !== "string") return;
  let abs = file;
  if (abs.startsWith("file:")) {
    try {
      abs = fileURLToPath(abs);
    } catch {
      return;
    }
  }
  if (!path.isAbsolute(abs)) return;
  let real = realPaths.get(abs);
  if (real === undefined) {
    try {
      real = fs.realpathSync(abs);
    } catch {
      real = abs;
    }
    realPaths.set(abs, real);
  }
  for (const candidate of real === abs ? [abs] : [abs, real]) {
    if (!inWorktree(candidate)) continue;
    hostModules.add(candidate);
    if (runtime) runtimeHostModules.add(candidate);
  }
}

function inWorktree(abs) {
  const relative = path.relative(root, abs);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  return !parts.includes("node_modules") && parts[0] !== ".git";
}

/** What Node holds now that it did not before `init`; a batch's own when `init` did not load it. */
function scanCache() {
  for (const file of Object.keys(require.cache)) {
    if (baseline.has(file)) continue;
    recordNative(file, running && initModules?.has(file) !== true);
  }
}

function sorted(set) {
  return [...set].sort();
}

// Resolved before the load, so a module that throws while it loads is recorded too.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain, ...rest) {
  if (root !== null && typeof request === "string" && !Module.isBuiltin(request)) {
    try {
      recordNative(Module._resolveFilename(request, parent, isMain));
    } catch {
      // the original load reports it
    }
  }
  return originalLoad.call(this, request, parent, isMain, ...rest);
};
// Native ESM, a transformer written as one: Node 22.15 and later.
try {
  Module.registerHooks?.({
    load(url, context, next) {
      recordNative(url);
      return next(url, context);
    },
  });
} catch {
  // no synchronous hooks here: CommonJS loads are still recorded
}

function send(message, then) {
  if (typeof process.send === "function" && process.connected) process.send(message, then);
  else then?.();
}

function rss() {
  return process.memoryUsage().rss;
}

function message(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** Without its parent: the worker and everything its tests left in its group, at once. */
function orphaned() {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    // not a group leader: only this process
  }
  process.exit(1);
}

function load(dir) {
  const loaded = require(dir);
  return loaded.default ?? loaded;
}

async function init(options) {
  root = typeof options.root === "string" ? options.root : null;
  fs.mkdirSync(options.cacheDir, { recursive: true });
  core = require(options.coreDir);
  const { readConfigs } = require(options.configDir);
  const Runtime = load(options.runtimeDir);
  const argv = {
    $0: "jest",
    _: [],
    config: options.wrapperPath,
    cacheDirectory: options.cacheDir,
    runInBand: true,
    ci: true,
    silent: true,
    watchman: false,
    testLocationInResults: true,
    reporters: [options.reporterPath],
    ...(options.coverage === true
      ? {
          coverage: true,
          coverageProvider: "v8",
          coverageReporters: ["none"],
          coverageThreshold: "{}",
        }
      : {}),
  };
  // An absolute project path: a relative one reads as a second project (research 028-01 F2.2).
  const read = await readConfigs(argv, [options.cwd]);
  globalConfig = read.globalConfig;
  const config = read.configs[0];
  const hasteMap = await Runtime.createHasteMap(config, {
    maxWorkers: 1,
    resetCache: false,
    watch: false,
    watchman: false,
  });
  const { hasteFS, moduleMap } = await hasteMap.build();
  context = { Runtime, config, hasteFS, moduleMap, transforms: transformModules(config, options) };
  scanCache();
  initModules = new Set(hostModules);
  send({ type: "ready", pid: process.pid, rssBytes: rss(), hostModules: sorted(hostModules) });
}

/**
 * Every `@jest/transform` this Jest may run with: the test runner's, then `jest-runtime`'s and
 * `@jest/core`'s. Each keeps, per config, the transforms of the process by path and mtime.
 */
function transformModules(config, options) {
  const from = [
    typeof config.runner === "string" ? config.runner : null,
    path.join(options.runtimeDir, "package.json"),
    path.join(options.coreDir, "package.json"),
  ];
  const found = new Set();
  for (const file of from) {
    if (file === null) continue;
    try {
      found.add(createRequire(file)("@jest/transform"));
    } catch {
      // not a dependency of that package
    }
  }
  if (found.size === 0) throw new Error("no @jest/transform reachable from this Jest");
  return [...found];
}

/**
 * Forgets Jest's in-memory transforms before a batch. They are keyed by path and mtime, so a
 * transform whose cache key reads other files (a type checker's `.d.ts`) would never run its
 * key again for an unchanged test file. Each module now asks its transformer's cache key and
 * Jest's disk cache again, as a new Jest process does.
 */
async function freshTransforms(transforms, config) {
  for (const transform of transforms) {
    const transformer = await transform.createScriptTransformer(config);
    transformer._cache?.transformedFiles?.clear();
  }
}

/** Sets the batch's own variables; the ones of the batch before go back to what they were. */
function batchEnv(env) {
  for (const [key, value] of before) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  before.clear();
  for (const [key, value] of Object.entries(env)) {
    before.set(key, process.env[key]);
    if (typeof value === "string" && value !== "") process.env[key] = value;
    else delete process.env[key];
  }
}

async function run(batch) {
  running = true;
  try {
    await runBatch(batch);
  } finally {
    scanCache();
    running = false;
  }
  send({
    type: "done",
    id: batch.id,
    rssBytes: rss(),
    hostModules: sorted(hostModules),
    runtimeHostModules: sorted(runtimeHostModules),
  });
}

async function runBatch(batch) {
  if (typeof batch.observeOut === "string" && batch.observeOut !== "") {
    globalThis[RESET]?.(batch.observeOut, batch.observeSkip);
  }
  batchEnv({
    ...(batch.env ?? {}),
    SQUEAL_JEST_EVENTS: batch.eventsFile,
    SQUEAL_JEST_COVERAGE_DIR: batch.coverageDir ?? "",
  });
  const { Runtime, config, hasteFS, moduleMap, transforms } = context;
  await freshTransforms(transforms, config);
  const resolver = Runtime.createResolver(config, moduleMap);
  resolver.constructor.clearDefaultResolverCache?.();
  const testContext = { config, hasteFS, moduleMap, resolver };
  const scheduler = await core.createTestScheduler(globalConfig, {
    firstRun,
    previousSuccess: true,
  });
  firstRun = false;
  await scheduler.scheduleTests(
    batch.files.map((path) => ({ context: testContext, path })),
    { isInterrupted: () => false, setState() {} },
  );
}

// The parent kills what is left of the group once this process exits.
process.on("disconnect", orphaned);
process.on("message", (msg) => {
  if (msg === null || typeof msg !== "object") return;
  if (msg.type === "shutdown") {
    process.exit(0);
  }
  const step = msg.type === "init" ? init(msg) : msg.type === "run" ? run(msg) : null;
  step?.catch((error) => {
    // Out once the message is sent: `process.send` is asynchronous.
    const reply = { type: "error", id: msg.id ?? null, message: message(error) };
    send({ ...reply, hostModules: sorted(hostModules) }, () => process.exit(1));
  });
});
