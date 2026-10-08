// Squeal's runtime-input recorder (spec 001 D3, D4; task 001-132; research
// observed-runtime-inputs F1). Loaded as a `--require` preload through
// `NODE_OPTIONS`, in every Vitest worker and in every process and thread a test
// starts. CommonJS, so it loads synchronously on any Node; it requires only Node
// built-ins.
//
// Records, per test file, the worktree paths a process reads, stats, lists,
// loads or executes, and the ones it writes: the `fs` calls (`fs.cjs`), the
// modules Node resolves (`module.registerHooks`), its own entry point, and the
// existing files named by a spawn's arguments. A path reached through a symlink
// is recorded with its target too, when the target is kept (task 001-135):
// the link's spelling and the bytes read both key the file. Never changes a
// call's arguments or result, except the env of a child: at every valid spawn,
// sync or async, and every Worker, it puts `--require <this file>` into the
// child's `NODE_OPTIONS` and its settings into `SQUEAL_OBSERVE`, whatever env
// the caller passed (`env: {}` too), so grandchildren are recorded
// (`spawn.cjs`). Any error of its own is swallowed.
//
// Settings, `SQUEAL_OBSERVE`, JSON: `out` the directory written to, `root` the
// worktree, `skip` absolute prefixes never recorded (Squeal's and Vitest's temp
// directories), `file` the test file a child or thread works for. A Vitest worker
// attributes by `__vitest_worker__.filepath` instead, a `SHARE_ENV` thread by
// its environment data. Kept only: paths under `root`, outside `node_modules`
// and `.git`, outside `skip`, while a test file is known.
//
// Batched: each new path waits in memory, and one append per event-loop turn
// that found any (and one at exit) writes them as a line
// `{"t":file,"f":[...],"l":[...],"w":[...]}` to `<out>/<pid>-<thread>.ndjson`:
// `f` read, stat'ed, loaded or executed, `l` listed, `w` written. Not only at
// exit: Vitest stops a fork with SIGTERM and a thread with `terminate()`, and
// neither runs an exit hook. Also at once before a process or thread sends a
// message (`process.send`, `MessagePort.postMessage`): a parent that stops it
// on that message, as Vitest does after a file's results, stops it before the
// next turn.
//
// Not in Node's internal threads: a synchronous resolve hook in an async
// loader's hooks thread kills the process on Node 22 (003-30).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const module_ = require("node:module");
const workerThreads = require("node:worker_threads");
const { fileURLToPath } = require("node:url");
const { wrapFs } = require("./fs.cjs");
const { threadFile, wrapChildren } = require("./spawn.cjs");

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
  const { appendFileSync } = fs;
  const realpath = fs.realpathSync.native;
  const realSetImmediate = setImmediate;
  const root = settings.root.endsWith(path.sep) ? settings.root : settings.root + path.sep;
  let realRoot = root;
  try {
    realRoot = realpath(root) + path.sep;
  } catch {
    // a root that is gone records nothing anyway
  }
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

  const current = () => globalThis.__vitest_worker__?.filepath ?? settings.file ?? threadFile();

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
  const scoped = (p) => {
    const abs = toPath(p);
    return abs !== null && kept(abs) ? abs : null;
  };

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

  /** Adds `abs` under `file`; false when it was already there. */
  const add = (file, kind, abs) => {
    let known = seen.get(file);
    if (known === undefined) {
      known = { f: new Set(), l: new Set(), w: new Set() };
      seen.set(file, known);
    }
    if (known[kind].has(abs)) return false;
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
    return true;
  };

  /** Records `p`, and the kept target of any symlink on its way; `real` when it is one already. */
  const record = (kind, p, real = false) => {
    try {
      const file = current();
      if (typeof file !== "string") return;
      const abs = scoped(p);
      if (abs === null || !add(file, kind, abs) || real) return;
      let target;
      try {
        target = realpath(abs);
      } catch {
        return;
      }
      if (realRoot !== root && target.startsWith(realRoot)) {
        target = root + target.slice(realRoot.length);
      }
      if (target !== abs && kept(target)) add(file, kind, target);
    } catch {
      // never the test's failure
    }
  };

  wrapFs({ scoped, record });
  wrapChildren({ current, record, scoped, self: SELF, variable: VARIABLE, settings });

  module_.syncBuiltinESMExports();

  if (typeof module_.registerHooks === "function") {
    module_.registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (typeof resolved?.url === "string" && resolved.url.startsWith("file:")) {
          try {
            // Node resolves through symlinks already
            record("f", new URL(resolved.url.replace(/[?#].*$/, "")), true);
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
  const flushBefore = (target, name) => {
    const original = target?.[name];
    if (typeof original !== "function") return;
    const wrapped = function (...args) {
      try {
        flush();
      } catch {
        // never the test's failure
      }
      return original.apply(this, args);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapped;
  };
  flushBefore(workerThreads.MessagePort?.prototype, "postMessage");
  flushBefore(process, "send");
}
