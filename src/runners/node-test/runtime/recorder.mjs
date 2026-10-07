// Squeal's module recorder (spec 003 D5). Loaded as the first `--import` of a test file's
// process, so it also sees what the project's preloads import; runs inside the project's Node
// and imports only Node built-ins. Appends one `{"parent","url"}` line per resolved import to
// `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`. A synchronous `module.registerHooks` resolve hook,
// since `module.register` misses `require` (research, module-graph 2). Without the variable, or
// on a Node without `registerHooks` (before 22.15), it records nothing.
import { appendFileSync } from "node:fs";
import module from "node:module";

const prefix = process.env.SQUEAL_NODE_TEST_GRAPH;
if (prefix && typeof module.registerHooks === "function") {
  const file = `${prefix}-${process.pid}.ndjson`;
  const seen = new Set();
  module.registerHooks({
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
