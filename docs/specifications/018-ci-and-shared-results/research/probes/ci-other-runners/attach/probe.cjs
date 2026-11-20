// Throwaway: logs which process loads this preload, its argv, and module loads with registerHooks.
"use strict";
const fs = require("node:fs");
const m = require("node:module");
const { isMainThread, isInternalThread } = require("node:worker_threads");
const out = process.env.PROBE_OUT;
if (out && !isInternalThread) {
  const line = (o) => fs.appendFileSync(out, JSON.stringify({ pid: process.pid, ...o }) + "\n");
  line({ kind: "start", main: isMainThread, argv: process.argv.slice(1), execArgv: process.execArgv, ctx: process.env.NODE_TEST_CONTEXT ?? null });
  if (typeof m.registerHooks === "function") {
    m.registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.startsWith("file:") && r.url.includes("/fixture/")) line({ kind: "load", url: r.url.replace(/^.*\/fixture\//, ""), parent: (ctx.parentURL ?? "").replace(/^.*\/fixture\//, "") }); return r; } });
  }
}
