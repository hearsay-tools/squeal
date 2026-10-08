// Squeal's module recorder (spec 003 D5; task 003-28). Loaded as the first `--require` of a test
// file's process, and first in its `NODE_OPTIONS` when that holds a `--require`, so it is installed
// before every project preload: Node runs all `--require` preloads before any `--import`. CommonJS,
// so it loads synchronously on any Node; it runs inside the project's Node and requires only Node
// built-ins. Appends one `{"parent","url"}` line per resolved import or require to
// `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`. A synchronous `module.registerHooks` resolve hook, since
// `module.register` misses `require` (research, module-graph 2). Without the variable, or on a Node
// without `registerHooks` (before 22.15), it records nothing.
"use strict";
const { appendFileSync } = require("node:fs");
const module_ = require("node:module");

const prefix = process.env.SQUEAL_NODE_TEST_GRAPH;
if (prefix && typeof module_.registerHooks === "function") {
  const file = `${prefix}-${process.pid}.ndjson`;
  const seen = new Set();
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const parent = context.parentURL ?? null;
      const key = `${parent}\n${resolved.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        // written at once, so a process killed at the deadline keeps what it loaded
        appendFileSync(file, `${JSON.stringify({ parent, url: resolved.url })}\n`);
      }
      return resolved;
    },
  });
}
