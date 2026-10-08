// The recorder's children and threads (`recorder.cjs`; spec 001 D4; tasks
// 001-132, 001-135). At every spawn, sync or async, and every Worker, the
// recorder and its settings ride in whatever env the caller passed (`env: {}`
// too), so grandchildren are recorded. A call Node would reject, or whose env
// the recorder cannot extend as Node reads it, passes through untouched, so
// Node's own validation runs (review wave 12d, B6). A thread's test file also
// rides in its environment data, which a `SHARE_ENV` Worker gets though it
// shares its parent's env (B4). A child whose env carries another Squeal's
// settings, a test starting its own Squeal, is left to that recorder.
"use strict";
const childProcess = require("node:child_process");
const path = require("node:path");
const workerThreads = require("node:worker_threads");
const { statSync } = require("node:fs");

/** The environment-data key carrying the test file into a thread. */
const FILE_KEY = "squeal.observe.file";

const isOptions = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ownEnv = (options) =>
  Object.prototype.propertyIsEnumerable.call(options, "env") ? options.env : undefined;
/** `options` with its own `env` replaced; its prototype and other properties kept. */
const withEnv = (options, env) => {
  const next =
    options == null
      ? {}
      : Object.create(Object.getPrototypeOf(options), Object.getOwnPropertyDescriptors(options));
  Object.defineProperty(next, "env", {
    value: env,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
};

/**
 * Where a sync call's options sit, as Node reads them (`normalizeSpawnArguments`,
 * `normalizeExecFileArgs`, `normalizeExecArgs`), or -1 for a call Node rejects
 * or whose options are not an object the recorder can copy.
 */
function optionsAt(name, args) {
  const [command, second] = args;
  if (typeof command !== "string") return -1;
  if (name === "execSync") return second == null || isOptions(second) ? 1 : -1;
  if (Array.isArray(second) || second == null) {
    const options = args[2];
    if (options === undefined || isOptions(options)) return 2;
    return options === null && name === "execFileSync" ? 2 : -1;
  }
  return isOptions(second) ? 1 : -1;
}

/**
 * Wraps child processes and Workers for `api`: `current()` the test file,
 * `record(kind, p)`, `scoped(p)`, `self` the recorder's path, `variable` the
 * settings' env name, `settings`.
 */
/** Whether `value`, a child's settings, names a recorder output other than `out`. */
function foreign(value, out) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.out === "string" && parsed.out !== out;
  } catch {
    return false;
  }
}

function wrapChildren(api) {
  const { variable, self, settings } = api;
  /**
   * `env` plus the recorder: what Node reads of it, its prototype's keys too
   * for a spawn, its own keys only for a Worker.
   */
  const injected = (env, inherited = true) => {
    const out = inherited ? {} : { ...env };
    if (inherited) for (const key in env) out[key] = env[key];
    // Another Squeal's settings (a test starting its own Squeal): that subtree is its.
    if (foreign(out[variable], settings.out)) return out;
    const options = typeof out.NODE_OPTIONS === "string" ? out.NODE_OPTIONS : "";
    if (!options.includes(self)) {
      out.NODE_OPTIONS = `--require ${JSON.stringify(self)}${options === "" ? "" : ` ${options}`}`;
    }
    const file = api.current();
    out[variable] = JSON.stringify({ ...settings, ...(typeof file === "string" ? { file } : {}) });
    return out;
  };
  const recordArguments = (command, args, cwd) => {
    try {
      const base = typeof cwd === "string" ? cwd : process.cwd();
      for (const arg of [command, ...(Array.isArray(args) ? args : [])]) {
        if (typeof arg !== "string" || arg.startsWith("-") || !/[/\\.]/.test(arg)) continue;
        const abs = api.scoped(path.resolve(base, arg));
        if (abs !== null && statSync(abs, { throwIfNoEntry: false })?.isFile())
          api.record("f", abs);
      }
    } catch {
      // never the test's failure
    }
  };

  // Async spawns, fork and exec all reach this with Node's validated options.
  const proto = childProcess.ChildProcess.prototype;
  const spawn = proto.spawn;
  proto.spawn = function (options) {
    try {
      if (options && Array.isArray(options.envPairs)) {
        const env = {};
        for (const pair of options.envPairs) {
          const at = pair.indexOf("=");
          if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1);
        }
        options.envPairs = Object.entries(injected(env)).map(([k, v]) => `${k}=${v}`);
      }
      // `args[0]` is the command again; a shell's `-c` string names no file
      recordArguments(options?.file, options?.args?.slice(1), options?.cwd);
    } catch {
      // never the test's failure
    }
    return spawn.call(this, options);
  };

  for (const name of ["spawnSync", "execSync", "execFileSync"]) {
    const original = childProcess[name];
    if (typeof original !== "function") continue;
    const wrapped = function (...args) {
      let call = args;
      try {
        const at = optionsAt(name, args);
        const options = at === -1 ? undefined : args[at];
        // Node's own `options.env || process.env`; any other env passes through
        const env = options == null ? undefined : ownEnv(options);
        if (at !== -1 && (!env || typeof env === "object")) {
          const next = [...args];
          while (next.length < at) next.push(undefined);
          next[at] = withEnv(options, injected(env || process.env));
          call = next;
          if (name !== "execSync") {
            recordArguments(args[0], Array.isArray(args[1]) ? args[1] : [], options?.cwd);
          }
        }
      } catch {
        call = args;
      }
      return original.apply(this, call);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    childProcess[name] = wrapped;
  }

  // Worker threads load `--require` from their env's NODE_OPTIONS; the env carries the test
  // file, and so does the environment data, which a SHARE_ENV thread's env cannot.
  const Worker = workerThreads.Worker;
  workerThreads.Worker = class Worker_ extends Worker {
    constructor(filename, ...rest) {
      let next = rest;
      try {
        const file = api.current();
        if (typeof file === "string") workerThreads.setEnvironmentData(FILE_KEY, file);
        const options = rest[0];
        // Node reads `options.env` through the prototype; null or undefined means process.env
        const env = options === undefined ? undefined : isOptions(options) ? options.env : null;
        if (env !== workerThreads.SHARE_ENV && (env == null || typeof env === "object")) {
          if (options === undefined || isOptions(options)) {
            next = [withEnv(options, injected(env ?? process.env, false)), ...rest.slice(1)];
          }
        }
        if (typeof filename === "string" && options?.eval !== true) api.record("f", filename);
        else if (filename instanceof URL) api.record("f", filename);
      } catch {
        next = rest;
      }
      super(filename, ...next);
    }
  };
  Object.defineProperty(workerThreads.Worker, "name", { value: "Worker" });
}

/** The test file a thread's parent set in its environment data, or `null`. */
function threadFile() {
  try {
    const file = workerThreads.getEnvironmentData(FILE_KEY);
    return typeof file === "string" ? file : null;
  } catch {
    return null;
  }
}

module.exports = { threadFile, wrapChildren };
