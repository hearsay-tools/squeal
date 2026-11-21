// Probe for row 011-425: logs every access to <ROOT>/package.json with the
// process and the caller's stack. Loaded by NODE_OPTIONS=--require.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const ROOT = process.env.TRACE_ROOT;
const LOG = process.env.TRACE_LOG;
if (ROOT && LOG) {
  const target = path.join(ROOT, "package.json");
  const append = fs.appendFileSync;
  const toPath = (p) =>
    typeof p === "string"
      ? path.resolve(p)
      : p instanceof URL
        ? require("node:url").fileURLToPath(p)
        : Buffer.isBuffer(p)
          ? path.resolve(p.toString())
          : null;
  let busy = false;
  const log = (fn, p) => {
    if (busy) return;
    busy = true;
    try {
      if (toPath(p) !== target) return;
      const stack = (new Error().stack || "")
        .split("\n")
        .slice(3, 12)
        .map((s) => s.trim())
        .filter((s) => !s.includes("tracer.cjs") && !s.includes("/observe/fs.cjs"));
      append(
        LOG,
        JSON.stringify({
          test: process.env.TRACE_TEST,
          pid: process.pid,
          worker: process.env.VITEST_WORKER_ID !== undefined && process.env.VITEST_POOL_ID !== undefined,
          argv: process.argv.slice(1, 3),
          fn,
          stack,
        }) + "\n",
      );
    } catch {
    } finally {
      busy = false;
    }
  };
  const wrap = (obj, name, label) => {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (p, ...rest) {
      log(label ?? name, p);
      return orig.call(this, p, ...rest);
    };
  };
  for (const n of [
    "readFileSync", "readFile", "openSync", "open", "copyFileSync", "copyFile", "cpSync",
    "statSync", "stat", "lstatSync", "existsSync", "accessSync", "createReadStream",
  ])
    wrap(fs, n);
  for (const n of ["readFile", "open", "copyFile", "stat", "access", "cp"]) wrap(fs.promises, n, `promises.${n}`);
  syncBuiltinESMExports();
}
