// Counts SQL calls with time and callers; fs reads with callers. Writes PROBE_LOG on exit.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { syncBuiltinESMExports } from "node:module";
const counts = { sql: {}, fs: {} };
const caller = () => {
  Error.stackTraceLimit = 60;
  const lines = new Error().stack.split("\n").slice(3).filter((l) => l.includes(".mjs") && !l.includes("instrument.mjs"));
  return lines.slice(0, Number(process.env.PROBE_DEPTH ?? 4)).map((l) => l.trim().replace(/^at /, "").replace(/ \(.*\/([^/]+\.mjs):(\d+):\d+\)/, "@$2")).join(" < ");
};
const RAW = process.env.PROBE_RAW ? new RegExp(process.env.PROBE_RAW) : null;
counts.raw = [];
const add = (bucket, key, ms) => {
  if (RAW && RAW.test(key)) { Error.stackTraceLimit = 80; counts.raw.push([key.slice(0, 60), new Error().stack.split("\n").slice(3).map((l) => l.trim().replace(/\(?file:.*\/([^/]+\.mjs):(\d+):\d+\)?/, "@$2")).filter((l) => !l.includes("instrument")).join(" < ")]); }
  const e = (bucket[key] ??= { n: 0, ms: 0, callers: {} });
  e.n++; e.ms += ms;
  const c = caller(); e.callers[c] = (e.callers[c] ?? 0) + 1;
};
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql) {
  const t0 = performance.now();
  const stmt = prepare.call(this, sql);
  add(counts.sql, "prepare " + sql.replace(/\s+/g, " ").trim().slice(0, 140), performance.now() - t0);
  for (const method of ["get", "all", "run", "iterate"]) {
    const fn = stmt[method];
    stmt[method] = function (...args) {
      const t = performance.now();
      const r = fn.apply(this, args);
      add(counts.sql, method + " " + sql.replace(/\s+/g, " ").trim().slice(0, 140), performance.now() - t);
      return r;
    };
  }
  return stmt;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  const t = performance.now();
  const r = exec.call(this, sql);
  add(counts.sql, "exec " + sql.replace(/\s+/g, " ").trim().slice(0, 140), performance.now() - t);
  return r;
};
for (const key of ["readFileSync", "statSync", "lstatSync", "existsSync", "realpathSync", "openSync", "readdirSync"]) {
  const fn = fs[key];
  const wrapped = function (...args) {
    const t = performance.now();
    try { return fn.apply(this, args); } finally { add(counts.fs, key + " " + String(args[0]), performance.now() - t); }
  };
  Object.assign(wrapped, fn);
  fs[key] = wrapped;
}
syncBuiltinESMExports();
process.on("exit", () =>
  fs.writeFileSync(process.env.PROBE_LOG, JSON.stringify({ afterLoad: performance.now() - globalThis.__sqLoaded, ...counts }, null, 1)),
);
