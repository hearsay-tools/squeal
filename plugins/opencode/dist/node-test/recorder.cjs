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
"use strict";
const { appendFileSync } = require("node:fs");
const module_ = require("node:module");
const { isAbsolute } = require("node:path");
const { isInternalThread, isMainThread } = require("node:worker_threads");

const prefix = process.env.SQUEAL_NODE_TEST_GRAPH;
const STARTED = "SQUEAL_NODE_TEST_STARTED";
if (prefix && typeof module_.registerHooks === "function" && !isInternalThread) {
  const file = `${prefix}-${process.pid}.ndjson`;
  const seen = new Set();
  let preload = isMainThread && (process.argv[1] ?? "") !== "" && process.env[STARTED] !== prefix;
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const parent = context.parentURL ?? null;
      if (preload && parent === null && (specifier.startsWith("file:") || isAbsolute(specifier))) {
        preload = false;
        process.env[STARTED] = prefix;
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
}
