// The recorder's children and threads (`recorder.cjs`; spec 001 D4; tasks
// 001-132, 001-135). At every spawn, sync or async, and every Worker, the
// recorder and its settings ride in whatever env the caller passed (`env: {}`
// too), so grandchildren are recorded: as `--import` of its `file:` URL, or as
// `--require` where the child's Node would run a `--require` (`preloads.cjs`),
// as `recorderOption` in `runtime.ts` decides (spec 001 D11 Fidelity, task
// 001-390); where the command cannot be read before it runs, an `--import`
// (review wave-13bt, B2). The form is chosen at each spawn, also when the env inherits the
// recorder already: that one is taken out first, so it runs once, in the
// child's form (review 001-401, B1). A call Node would reject, or whose env
// the recorder cannot extend as Node reads it, passes through untouched, so
// Node's own validation runs (review wave 12d, B6). A thread's test file also
// rides in its environment data, which a `SHARE_ENV` Worker gets though it
// shares its parent's env (B4); such a Worker with a `--require` of its own
// gets the recorder's in its `execArgv`, ahead of it, the shared env left as
// it is. A child whose env carries another Squeal's settings, a test starting
// its own Squeal, is left to that recorder; one that does not observe passes
// `UNOBSERVED`, so its processes run with no recorder (task 001-431).
"use strict";
const childProcess = require("node:child_process");
const path = require("node:path");
const workerThreads = require("node:worker_threads");
const { statSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  asWritten,
  isRequire,
  optionsRequire,
  shellRequires,
  spawnRequires,
  tokenizeNodeOptions,
} = require("./preloads.cjs");

/** The environment-data key carrying the test file into a thread. */
const FILE_KEY = "squeal.observe.file";

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
  Object.defineProperty(next, key, {
    value,
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
/** Whether `value`, a child's settings, names a recorder output other than `out`: `UNOBSERVED`'s empty one too. */
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
  const url = pathToFileURL(self).href;
  /** `tokens` without this recorder's own preload, in either form. */
  const withoutSelf = (tokens) => {
    const kept = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const flag = token === "--import" || isRequire(token);
      const value = flag ? tokens[i + 1] : token.slice(token.indexOf("=") + 1);
      const preload = flag || token.startsWith("--import=") || isRequire(token);
      if (preload && (value === self || value === url)) {
        if (flag) i++;
      } else kept.push(token);
    }
    return kept;
  };
  /**
   * `env` plus the recorder: what Node reads of it, its prototype's keys too
   * for a spawn, its own keys only for a Worker. A `--require` there or, as
   * `require` says, in the child's own options, which Node runs before any
   * `--import`, makes the recorder a `--require`; Node parses the nearest
   * `package.json` then anyway. The recorder already there is taken out first.
   * A `spawned` process is `started` (spec 016 D4, row 016-22): what it loads
   * puts the test file in `direct`. A Worker keeps its parent's value, so a
   * thread of the test file's own process loads as that process does.
   */
  const injected = (env, inherited, require, spawned) => {
    const out = inherited ? {} : { ...env };
    if (inherited) for (const key in env) out[key] = env[key];
    // Another Squeal's settings (a test starting its own Squeal): that subtree is its.
    if (foreign(out[variable], settings.out)) return out;
    const options = typeof out.NODE_OPTIONS === "string" ? out.NODE_OPTIONS : "";
    const tokens = tokenizeNodeOptions(options);
    // one Node rejects: as before, a `--require` unless the recorder is there
    if (tokens === null) {
      if (!options.includes(self) && !options.includes(url))
        out.NODE_OPTIONS = `--require ${quote(self)} ${options}`;
    } else {
      const own = withoutSelf(tokens);
      const option =
        require || optionsRequire(own) ? `--require ${quote(self)}` : `--import ${quote(url)}`;
      const rest = own.length === tokens.length ? options : own.map(asWritten).join(" ");
      out.NODE_OPTIONS = rest.trim() === "" ? option : `${option} ${rest}`;
    }
    const file = api.current();
    out[variable] = JSON.stringify({
      ...settings,
      ...(typeof file === "string" ? { file } : {}),
      ...(spawned ? { started: true } : {}),
    });
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
        const argv = Array.isArray(options.args) ? options.args.slice(1) : [];
        const require = spawnRequires(options.file, argv);
        options.envPairs = Object.entries(injected(env, true, require, true)).map(
          ([k, v]) => `${k}=${v}`,
        );
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
          const argv = Array.isArray(args[1]) ? args[1] : [];
          // Node's `shell` joins the command and its arguments into one shell command
          const require =
            name === "execSync" || options?.shell
              ? shellRequires([args[0], ...argv].join(" "))
              : spawnRequires(args[0], argv);
          next[at] = withOwn(options, "env", injected(env || process.env, true, require, true));
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

  // Worker threads load the recorder from their env's NODE_OPTIONS; the env carries the test
  // file, and so does the environment data, which a SHARE_ENV thread's env cannot. Without
  // its own `execArgv` a Worker takes its parent thread's.
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
        const own = Array.isArray(options?.execArgv) ? options.execArgv : process.execArgv;
        const require = optionsRequire(own);
        if (env === workerThreads.SHARE_ENV) {
          // the env is the parent's own: the recorder's `--require` goes ahead of the thread's
          if (require && isOptions(options)) {
            const execArgv = ["--require", self, ...own];
            next = [withOwn(options, "execArgv", execArgv), ...rest.slice(1)];
          }
        } else if (env == null || typeof env === "object") {
          if (options === undefined || isOptions(options)) {
            const env_ = injected(env ?? process.env, false, require, false);
            next = [withOwn(options, "env", env_), ...rest.slice(1)];
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
