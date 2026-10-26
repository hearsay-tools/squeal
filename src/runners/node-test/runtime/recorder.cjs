// Squeal's module recorder (spec 003 D5; task 003-28). Loaded as the first `--require` of a test
// file's process, and first in its `NODE_OPTIONS` when that holds a `--require`, so it is installed
// before every project preload: Node runs all `--require` preloads before any `--import`; for a slow
// project it is in `NODE_OPTIONS` always, so processes the test spawns record too (004 D5). CommonJS,
// so it loads synchronously on any Node; it runs inside the project's Node and requires only Node
// built-ins. Appends one `{"parent","url","specifier"[,"preload"]}` line per resolved import or require to
// `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`. A synchronous `module.registerHooks` resolve hook, since
// `module.register` misses `require` (research, module-graph 2). Without the variable, or on a Node
// without `registerHooks` (before 22.15), it records nothing.
//
// Preload phase (row 003-39, 004 review S1). Every edge resolved before the main thread's entry
// point carries `"preload":true`, so a preload's `createRequire(<package.json>)` load, whose parent
// is no loaded module, stays with the preloads. The entry is the first load with no parent whose
// specifier is absolute (Node passes the main script as a path or `file:` URL); a `--require`
// written as an absolute path ends the phase early, so its orphan loads join the test file as
// before. A main thread with no script (`-e`, stdin) marks nothing.
//
// Only the project's own startup (row 003-40, 004 re-review S2, S3). A worker thread marks nothing,
// so what an `eval` Worker loads is the test file's. The process whose phase ends sets
// `SQUEAL_NODE_TEST_STARTED` to this run's graph prefix before any test code runs, so a process the
// test spawns inherits it and marks nothing, its own `--require` included; the `node --test` parent
// resolves no entry and leaves it unset for the test file's process. Tied to the prefix, so a
// nested run, with a log directory of its own, is not mistaken for a spawned child.
//
// Not in Node's internal threads (task 003-30, review wave 2.6 S1). With an async loader (`--loader`,
// or `module.register`), Node starts a hooks thread that runs every `--require` preload too; on Node
// 22 a synchronous hook there reaches `Hooks.resolveSync`, which throws ERR_METHOD_NOT_IMPLEMENTED,
// and the process dies (`initializeHooks` in `lib/internal/modules/esm/utils.js`, v22.23.3). The
// test's own threads record as before; what the hooks thread loads, the loader's modules, is not
// recorded on any Node. `isInternalThread` exists from 22.14, before `registerHooks`.
//
// Coverage (spec 015 D8, row 015-86). With coverage on, the run sets `NODE_V8_COVERAGE` and
// `SQUEAL_NODE_TEST_COVERAGE` to one directory per test file. Node reads `NODE_V8_COVERAGE` at
// startup, so the test file's own process (the runner sets `NODE_TEST_CONTEXT` there, never in the
// `node --test` parent) deletes both: it keeps its own coverage, a process the test spawns or a
// thread it starts writes none, and a test cannot read the variable. Its main thread names its pid
// in the directory, so Squeal reads that process's file alone. A project's own `NODE_V8_COVERAGE`
// stays: only Squeal's directory is deleted. `NODE_V8_COVERAGE` goes as the main script loads, after
// every preload: a loader that reads it as it starts keeps the text it read in its maps, as tsx does
// (review 0.1.358 B1). Where the main script cannot be seen, it goes now, and such maps are `unread`.
//
// Directory creates and removes (spec 016 D4, the written-directory bound). `mkdir`, `mkdtemp`,
// `rm`, `rmdir` and both ends of `rename`, sync, callback and promise forms, append one
// `{"written"}` line per absolute path, so a git-ignored module the run loads below a directory
// it made is its own scratch. No file write is recorded: a module the run wrote and then loaded
// keys the file as before.
"use strict";
const fs = require("node:fs");
const module_ = require("node:module");
const { isAbsolute, resolve } = require("node:path");
const { fileURLToPath } = require("node:url");
const { isInternalThread, isMainThread } = require("node:worker_threads");

const { appendFileSync } = fs;

const coverage = process.env.NODE_TEST_CONTEXT && process.env.SQUEAL_NODE_TEST_COVERAGE;
if (coverage && !isInternalThread) {
  delete process.env.SQUEAL_NODE_TEST_COVERAGE;
  // A write that fails leaves no pid named, so the file gets no record; never the test's failure.
  if (isMainThread) fs.writeFile(`${coverage}/own-${process.pid}`, "", () => {});
}
const hideCoverage = () => {
  if (coverage && !isInternalThread && process.env.NODE_V8_COVERAGE === coverage) {
    delete process.env.NODE_V8_COVERAGE;
  }
};

const prefix = process.env.SQUEAL_NODE_TEST_GRAPH;
const STARTED = "SQUEAL_NODE_TEST_STARTED";
const graphed = prefix && typeof module_.registerHooks === "function" && !isInternalThread;
let preload =
  graphed && isMainThread && (process.argv[1] ?? "") !== "" && process.env[STARTED] !== prefix;
// The main script is known by `argv[1]`, not by the preload phase's end (review 0.1.358 R2): a
// preload's own parentless load ends that phase, as tsx's `import "#cjs-loader"` does on Node 22.19
// before tsx starts its hooks thread, and a `--require` by absolute path ends it in the `node --test`
// parent, whose STARTED the test file's process inherits.
let main =
  coverage && graphed && isMainThread && process.argv[1] ? mainPaths(process.argv[1]) : null;
if (main === null) hideCoverage();
if (graphed) {
  const file = `${prefix}-${process.pid}.ndjson`;
  const seen = new Set();
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const parent = context.parentURL ?? null;
      if (preload && parent === null && (specifier.startsWith("file:") || isAbsolute(specifier))) {
        preload = false;
        process.env[STARTED] = prefix;
      }
      if (main !== null && parent === null && resolved.url.startsWith("file:")) {
        if (main.has(fileURLToPath(resolved.url))) {
          main = null;
          hideCoverage();
        }
      }
      const key = `${parent}\n${resolved.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        const edge = { parent, url: resolved.url, specifier, ...(preload && { preload }) };
        // written at once, so a process killed at the deadline keeps what it loaded
        appendFileSync(file, `${JSON.stringify(edge)}\n`);
      }
      return resolved;
    },
  });
  recordDirectories(file);
}

/** The paths the main script resolves to: as given, and real, as Node runs it without `--preserve-symlinks-main`. */
function mainPaths(script) {
  const paths = new Set([resolve(script)]);
  try {
    paths.add(fs.realpathSync(script));
  } catch {
    // no such file, as when Node adds the extension: only the path as given matches
  }
  return paths;
}

/** Wraps `fs` and `fs.promises` so each directory create or remove appends its path to `file`. */
function recordDirectories(file) {
  const written = new Set();
  const record = (p) => {
    try {
      // a repeated absolute path costs one lookup
      if (typeof p === "string" && isAbsolute(p) && written.has(p)) return;
      const path = typeof p === "string" ? resolve(p) : p instanceof URL ? fileURLToPath(p) : null;
      if (path === null || written.has(path)) return;
      written.add(path);
      appendFileSync(file, `${JSON.stringify({ written: path })}\n`);
    } catch {
      // never the test's failure
    }
  };
  const replace = (target, name, make) => {
    const original = target[name];
    if (typeof original !== "function") return;
    const wrapped = make(original);
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapped;
  };
  /** Records the paths at `at` before the call. */
  const before = (target, name, at) =>
    replace(
      target,
      name,
      (original) =>
        function (...args) {
          for (const i of at) record(args[i]);
          return original.apply(this, args);
        },
    );
  /** `mkdtemp` names the directory it made only in its result. */
  const created = (target, name) =>
    replace(
      target,
      name,
      (original) =>
        function (...args) {
          if (target === fs.promises) {
            const result = original.apply(this, args);
            result.then?.(record, () => {});
            return result;
          }
          if (name === "mkdtempSync") {
            const dir = original.apply(this, args);
            record(dir);
            return dir;
          }
          const at = args.length - 1;
          const callback = args[at];
          if (typeof callback === "function") {
            args[at] = function (...results) {
              if (!results[0]) record(results[1]);
              return callback.apply(this, results);
            };
          }
          return original.apply(this, args);
        },
    );
  for (const target of [fs, fs.promises]) {
    for (const name of ["mkdir", "mkdirSync", "rm", "rmSync", "rmdir", "rmdirSync"]) {
      before(target, name, [0]);
    }
    for (const name of ["rename", "renameSync"]) before(target, name, [0, 1]);
    for (const name of ["mkdtemp", "mkdtempSync"]) created(target, name);
  }
  // so `import { mkdirSync } from "node:fs"` reaches the wrappers too
  module_.syncBuiltinESMExports();
}
