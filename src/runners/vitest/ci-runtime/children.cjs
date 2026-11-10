// The CI hook in each child process and Worker the run starts with an
// environment of its own (spec 018 D9; row 018-23, reviews
// `wave-5-0.1.421-r3.md` N1 and `018-23-0.1.424.md` B2). The hook
// (`vitest-ci.cjs`) rides in `NODE_OPTIONS` and its settings in
// `SQUEAL_CI_RECORD`; an `env` that drops them would start a Node the
// evidence never sees, whose writes could leave the parent's evidence of a
// path standing. So at every spawn, sync or async, and every Worker, both go
// back into the env the caller passed (`env: {}` too), as the daemon's
// recorder does for itself (`observe/spawn.cjs`). That recorder loads first,
// so its wrappers run inside these and still put its own preload first. The
// hook is an `--import` of its `file:` URL, or a `--require` where that env
// already runs a `--require`, as `squeal ci record` chose for the command
// (`recorderOption`).
//
// An env whose `SQUEAL_CI_RECORD` is another value (a test that runs
// `squeal ci record` itself) keeps it, and the hook cannot follow that
// child: its writes never reach this run's evidence. So this process
// withholds its current test file from the export (`evidence.withhold`):
// Vitest's, else the one the daemon's recorder carries, else, with none
// known, every file. A `SHARE_ENV` Worker shares this process's env, so the
// same holds when that env has another value. A call Node would reject
// passes through untouched, so Node's own validation runs.
"use strict";
const childProcess = require("node:child_process");
const path = require("node:path");
const workerThreads = require("node:worker_threads");
const { pathToFileURL } = require("node:url");

const VARIABLE = "SQUEAL_CI_RECORD";
/** The daemon's recorder's settings (`OBSERVE_VARIABLE`), which name its current test file. */
const OBSERVE = "SQUEAL_OBSERVE";
const HOOK = path.join(__dirname, "vitest-ci.cjs");
/** A `--require` or `-r` token in `NODE_OPTIONS`. */
const REQUIRE = /(^|\s)(-r|--require)(=|\s|$)/;

/** A value as `NODE_OPTIONS` reads it (`quoteNodeOption`). */
const quote = (value) => `"${value.replace(/["\\]/g, "\\$&")}"`;
const isOptions = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ownEnv = (options) =>
  Object.prototype.propertyIsEnumerable.call(options, "env") ? options.env : undefined;
/** `options` with its own `key` set to `value`; its prototype and other properties kept. */
const withOwn = (options, key, value) => {
  const next =
    options == null
      ? {}
      : Object.create(Object.getPrototypeOf(options), Object.getOwnPropertyDescriptors(options));
  Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true });
  return next;
};

/** Where a sync call's options sit, as Node reads them, or -1 (`optionsAt` in `observe/spawn.cjs`). */
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

/** The test file this process or thread runs now, absolute; `null` when none is known. */
function currentTestFile() {
  const vitest = globalThis.__vitest_worker__?.filepath;
  if (typeof vitest === "string") return vitest;
  try {
    const file = JSON.parse(process.env[OBSERVE] ?? "")?.file;
    return typeof file === "string" ? file : null;
  } catch {
    return null;
  }
}

/**
 * Puts the hook and this process's `SQUEAL_CI_RECORD` into the env of every
 * child and Worker; withholds the current test file (`evidence.withhold`)
 * for one the hook cannot follow.
 */
function wrapChildren(replace, evidence) {
  const settings = process.env[VARIABLE];
  if (typeof settings !== "string") return;
  const url = pathToFileURL(HOOK).href;
  /** Whether `env` names another recording, whose child this run cannot follow. */
  const foreign = (env) => {
    const own = env[VARIABLE];
    return own !== undefined && own !== settings;
  };
  const withhold = () => evidence.withhold(currentTestFile());
  /**
   * `env` with the hook and its settings, as a copy: what Node reads of it,
   * its prototype's keys too for a spawn (`inherited`), its own for a
   * Worker. `env` itself when it has both; with another recording's
   * settings, `env` itself, and the current test file withheld.
   */
  const carried = (env, inherited) => {
    const own = env[VARIABLE];
    if (foreign(env)) {
      withhold();
      return env;
    }
    const options = typeof env.NODE_OPTIONS === "string" ? env.NODE_OPTIONS : "";
    const loads = options.includes(HOOK) || options.includes(url);
    if (loads && own === settings) return env;
    const out = inherited ? {} : { ...env };
    if (inherited) for (const key in env) out[key] = env[key];
    out[VARIABLE] = settings;
    if (!loads) {
      const option = REQUIRE.test(options) ? `--require ${quote(HOOK)}` : `--import ${quote(url)}`;
      out.NODE_OPTIONS = options.trim() === "" ? option : `${option} ${options}`;
    }
    return out;
  };

  // Async spawns, fork and exec all reach this with Node's validated options.
  replace(
    childProcess.ChildProcess.prototype,
    "spawn",
    (fn) =>
      function (options) {
        try {
          if (options && Array.isArray(options.envPairs)) {
            const env = {};
            for (const pair of options.envPairs) {
              const at = pair.indexOf("=");
              if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1);
            }
            const next = carried(env, true);
            if (next !== env) options.envPairs = Object.entries(next).map(([k, v]) => `${k}=${v}`);
          }
        } catch {}
        return fn.call(this, options);
      },
  );

  for (const name of ["spawnSync", "execSync", "execFileSync"]) {
    replace(
      childProcess,
      name,
      (fn) =>
        function (...args) {
          let call = args;
          try {
            const at = optionsAt(name, args);
            const options = at === -1 ? undefined : args[at];
            // Node's own `options.env || process.env`; any other env passes through.
            const env = options == null ? undefined : ownEnv(options);
            if (at !== -1 && (!env || typeof env === "object")) {
              const from = env || process.env;
              const next = carried(from, true);
              if (next !== from) {
                call = [...args];
                while (call.length < at) call.push(undefined);
                call[at] = withOwn(options, "env", next);
              }
            }
          } catch {
            call = args;
          }
          return fn.apply(this, call);
        },
    );
  }

  // Node reads a Worker's `options.env` through the prototype; null or undefined is `process.env`.
  const Worker = workerThreads.Worker;
  workerThreads.Worker = class Worker_ extends Worker {
    constructor(filename, ...rest) {
      let next = rest;
      try {
        const options = rest[0];
        const env = options === undefined ? undefined : isOptions(options) ? options.env : null;
        const replaced =
          env !== workerThreads.SHARE_ENV && (env == null || typeof env === "object");
        if (replaced && (options === undefined || isOptions(options))) {
          const from = env ?? process.env;
          const env_ = carried(from, false);
          if (env_ !== from) next = [withOwn(options, "env", env_), ...rest.slice(1)];
        } else if (env === workerThreads.SHARE_ENV && foreign(process.env)) withhold();
      } catch {
        next = rest;
      }
      super(filename, ...next);
    }
  };
  Object.defineProperty(workerThreads.Worker, "name", { value: "Worker" });
}

module.exports = { wrapChildren };
