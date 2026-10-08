// Squeal's runtime-input recorder (spec 001 D3, D4; task 001-132; research
// observed-runtime-inputs F1). Loaded as a `--require` preload through
// `NODE_OPTIONS`, in every Vitest worker and in every process and thread a test
// starts. CommonJS, so it loads synchronously on any Node; it requires only Node
// built-ins.
//
// Records, per test file, the worktree paths a process reads, stats, lists,
// loads or executes, and the ones it writes: the `fs` calls, the modules Node
// resolves (`module.registerHooks`), its own entry point, and the existing files
// named by a spawn's arguments. Never changes a call's arguments or result,
// except the env of a child: at every spawn, sync or async, and every Worker, it
// puts `--require <this file>` into the child's `NODE_OPTIONS` and its settings
// into `SQUEAL_OBSERVE`, whatever env the caller passed (`env: {}` too), so
// grandchildren are recorded. Any error of its own is swallowed.
//
// Settings, `SQUEAL_OBSERVE`, JSON: `out` the directory written to, `root` the
// worktree, `skip` absolute prefixes never recorded (Squeal's and Vitest's temp
// directories), `file` the test file a child or thread works for. A Vitest worker
// attributes by `__vitest_worker__.filepath` instead. Kept only: paths under
// `root`, outside `node_modules` and `.git`, outside `skip`, while a test file is
// known.
//
// Batched: each new path waits in memory, and one append per event-loop turn
// that found any (and one at exit) writes them as a line
// `{"t":file,"f":[...],"l":[...],"w":[...]}` to `<out>/<pid>-<thread>.ndjson`:
// `f` read, stat'ed, loaded or executed, `l` listed, `w` written. Not only at
// exit: Vitest stops a fork with SIGTERM and a thread with `terminate()`, and
// neither runs an exit hook.
//
// Not in Node's internal threads: a synchronous resolve hook in an async
// loader's hooks thread kills the process on Node 22 (003-30).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const module_ = require("node:module");
const workerThreads = require("node:worker_threads");
const { fileURLToPath } = require("node:url");

const VARIABLE = "SQUEAL_OBSERVE";
const SELF = __filename;

function readSettings() {
  try {
    const value = JSON.parse(process.env[VARIABLE] ?? "");
    if (typeof value.out !== "string" || typeof value.root !== "string") return null;
    return {
      out: value.out,
      root: value.root,
      skip: Array.isArray(value.skip) ? value.skip.filter((s) => typeof s === "string") : [],
      file: typeof value.file === "string" ? value.file : null,
    };
  } catch {
    return null;
  }
}

const settings = readSettings();
if (settings !== null && !workerThreads.isInternalThread && !globalThis.__squealObserve) {
  globalThis.__squealObserve = true;
  try {
    install(settings);
  } catch {
    // never the test's failure
  }
}

function install(settings) {
  const { appendFileSync, statSync } = fs;
  const realSetImmediate = setImmediate;
  const root = settings.root.endsWith(path.sep) ? settings.root : settings.root + path.sep;
  const skip = [settings.out, ...settings.skip].map((p) =>
    p.endsWith(path.sep) ? p : p + path.sep,
  );
  const gitDir = `${root}.git${path.sep}`;
  const nodeModules = `${path.sep}node_modules${path.sep}`;
  const output = path.join(
    settings.out,
    `${process.pid}-${workerThreads.threadId}-${Date.now().toString(36)}.ndjson`,
  );

  /** test file -> { f, l, w }: every path seen, and the ones not written out yet. */
  const seen = new Map();
  const pending = new Map();
  let scheduled = false;

  const current = () => globalThis.__vitest_worker__?.filepath ?? settings.file;

  const toPath = (p) => {
    if (typeof p === "string") return path.resolve(p);
    if (p instanceof URL) return p.protocol === "file:" ? fileURLToPath(p) : null;
    if (Buffer.isBuffer(p)) return path.resolve(p.toString());
    return null;
  };

  const kept = (abs) =>
    abs.startsWith(root) &&
    !abs.startsWith(gitDir) &&
    !abs.includes(nodeModules) &&
    !skip.some((prefix) => abs.startsWith(prefix) || `${abs}${path.sep}` === prefix);

  const flush = () => {
    scheduled = false;
    if (pending.size === 0) return;
    let text = "";
    for (const [t, sets] of pending) {
      const line = { t };
      for (const kind of ["f", "l", "w"]) if (sets[kind].length > 0) line[kind] = sets[kind];
      text += `${JSON.stringify(line)}\n`;
    }
    pending.clear();
    try {
      appendFileSync(output, text);
    } catch {
      // an output directory removed under a long-lived descendant
    }
  };

  const record = (kind, p) => {
    try {
      const file = current();
      if (typeof file !== "string") return;
      const abs = toPath(p);
      if (abs === null || !kept(abs)) return;
      let known = seen.get(file);
      if (known === undefined) {
        known = { f: new Set(), l: new Set(), w: new Set() };
        seen.set(file, known);
      }
      if (known[kind].has(abs)) return;
      known[kind].add(abs);
      let sets = pending.get(file);
      if (sets === undefined) {
        sets = { f: [], l: [], w: [] };
        pending.set(file, sets);
      }
      sets[kind].push(abs);
      if (!scheduled) {
        scheduled = true;
        realSetImmediate(flush).unref();
      }
    } catch {
      // never the test's failure
    }
  };

  const wrap = (target, name, kind, index = 0) => {
    const original = target[name];
    if (typeof original !== "function") return;
    const wrapped = function (...args) {
      record(kind, args[index]);
      return original.apply(this, args);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapped;
  };
  const writes = (flags) =>
    (typeof flags === "string" && /[wa+]/.test(flags)) ||
    (typeof flags === "number" && (flags & 3) !== 0);
  const wrapOpen = (target, name) => {
    const original = target[name];
    if (typeof original !== "function") return;
    const wrapped = function (p, flags, ...rest) {
      record(writes(flags) ? "w" : "f", p);
      return original.call(this, p, flags, ...rest);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapped;
  };

  const promises = fs.promises;
  for (const target of [fs, promises]) {
    for (const name of ["readFile", "readFileSync", "createReadStream"]) wrap(target, name, "f");
    for (const name of ["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync"]) {
      wrap(target, name, "f");
    }
    for (const name of ["access", "accessSync", "realpath", "realpathSync"])
      wrap(target, name, "f");
    for (const name of ["readdir", "readdirSync", "opendir", "opendirSync"])
      wrap(target, name, "l");
    for (const name of ["writeFile", "writeFileSync", "appendFile", "appendFileSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["createWriteStream", "mkdir", "mkdirSync", "rm", "rmSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["unlink", "unlinkSync", "rmdir", "rmdirSync", "truncate", "truncateSync"]) {
      wrap(target, name, "w");
    }
    for (const name of ["copyFile", "copyFileSync", "cp", "cpSync"]) {
      wrap(target, name, "f", 0);
      wrap(target, name, "w", 1);
    }
    // a rename's source is gone afterwards: both ends are written
    for (const name of ["rename", "renameSync"]) {
      wrap(target, name, "w", 0);
      wrap(target, name, "w", 1);
    }
    for (const name of ["open", "openSync"]) wrapOpen(target, name);
  }

  // Children: the recorder and its settings ride in whatever env the caller passed.
  const injected = (env) => {
    const out = { ...env };
    const options = typeof out.NODE_OPTIONS === "string" ? out.NODE_OPTIONS : "";
    if (!options.includes(SELF)) {
      out.NODE_OPTIONS = `--require ${JSON.stringify(SELF)}${options === "" ? "" : ` ${options}`}`;
    }
    const file = current();
    out[VARIABLE] = JSON.stringify({ ...settings, ...(typeof file === "string" ? { file } : {}) });
    return out;
  };
  const recordArguments = (command, args, cwd) => {
    try {
      const base = typeof cwd === "string" ? cwd : process.cwd();
      for (const arg of [command, ...(Array.isArray(args) ? args : [])]) {
        if (typeof arg !== "string" || arg.startsWith("-") || !/[/\\.]/.test(arg)) continue;
        const abs = path.resolve(base, arg);
        if (!kept(abs)) continue;
        if (statSync(abs, { throwIfNoEntry: false })?.isFile()) record("f", abs);
      }
    } catch {
      // never the test's failure
    }
  };

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
      try {
        // spawnSync(command, [args], [options]), execFileSync(file, [args], [options]), execSync(command, [options])
        const listed = Array.isArray(args[1]) || (args[1] == null && args.length > 2);
        const at = name !== "execSync" && listed ? 2 : 1;
        while (args.length < at) args.push(undefined);
        const options = args[at] !== null && typeof args[at] === "object" ? args[at] : {};
        args[at] = { ...options, env: injected(options.env ?? process.env) };
        const list = Array.isArray(args[1]) ? args[1] : [];
        if (name !== "execSync") recordArguments(args[0], list, args[at].cwd);
      } catch {
        // never the test's failure
      }
      return original.apply(this, args);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    childProcess[name] = wrapped;
  }

  // Worker threads load `--require` from their env's NODE_OPTIONS; the env carries the test file.
  const Worker = workerThreads.Worker;
  workerThreads.Worker = class Worker_ extends Worker {
    constructor(filename, options) {
      let next = options;
      try {
        if (options?.env !== workerThreads.SHARE_ENV) {
          next = { ...options, env: injected(options?.env ?? process.env) };
        }
        if (typeof filename === "string" && options?.eval !== true) record("f", filename);
        else if (filename instanceof URL) record("f", filename);
      } catch {
        next = options;
      }
      super(filename, next);
    }
  };
  Object.defineProperty(workerThreads.Worker, "name", { value: "Worker" });

  module_.syncBuiltinESMExports();

  if (typeof module_.registerHooks === "function") {
    module_.registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (typeof resolved?.url === "string" && resolved.url.startsWith("file:")) {
          try {
            record("f", new URL(resolved.url.replace(/[?#].*$/, "")));
          } catch {
            // never the test's failure
          }
        }
        return resolved;
      },
    });
  }

  // The entry point of a child `node script.mjs`; a thread's argv is its parent's.
  if (workerThreads.isMainThread && typeof process.argv[1] === "string") {
    record("f", process.argv[1]);
  }

  process.on("exit", flush);
}
