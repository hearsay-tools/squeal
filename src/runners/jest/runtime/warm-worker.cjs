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
 * Messages in: `init` `{ cwd, wrapperPath, cacheDir, coreDir, configDir,
 * runtimeDir, reporterPath, coverage }`; `run` `{ id, files, eventsFile,
 * coverageDir, observeOut, observeSkip, env }`; `shutdown`. Out: `ready`
 * `{ pid, rssBytes }`, `done` `{ id, rssBytes }`, `error` `{ id, message }`
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
 * `runJest` clears them: a changed `package.json` or a moved file resolves
 * as a fresh Jest would. An added or deleted file, or a config change,
 * needs a new haste map: `warm.ts` starts a new worker then.
 *
 * Without its parent (the channel closes) it kills its own group at once,
 * so no worker outlives the runner that started it. Node built-ins only.
 */
const fs = require("node:fs");

const RESET = Symbol.for("squeal.observeReset");

/** The project's Jest, loaded at `init`. */
let core = null;
let globalConfig = null;
let context = null;
let firstRun = true;
/** The keys a batch's `env` set, with what this process had before. */
const before = new Map();

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
  context = { Runtime, config, hasteFS, moduleMap };
  send({ type: "ready", pid: process.pid, rssBytes: rss() });
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
  if (typeof batch.observeOut === "string" && batch.observeOut !== "") {
    globalThis[RESET]?.(batch.observeOut, batch.observeSkip);
  }
  batchEnv({
    ...(batch.env ?? {}),
    SQUEAL_JEST_EVENTS: batch.eventsFile,
    SQUEAL_JEST_COVERAGE_DIR: batch.coverageDir ?? "",
  });
  const { Runtime, config, hasteFS, moduleMap } = context;
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
  send({ type: "done", id: batch.id, rssBytes: rss() });
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
    send({ type: "error", id: msg.id ?? null, message: message(error) }, () => process.exit(1));
  });
});
