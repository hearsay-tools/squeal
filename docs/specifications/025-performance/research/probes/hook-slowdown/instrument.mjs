// Throwaway preload (row 025-26). Counts executed SQLite statements and sync file calls of one
// Node process and writes them to $PROBE_COUNTS/<pid>.json at exit. Loaded with
// NODE_OPTIONS=--import=<this file> on single hook and `squeal status` calls only.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";

const counts = { argv: process.argv.slice(1), sql: {}, fs: {} };
const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql) {
  const stmt = prepare.call(this, sql);
  for (const method of ["get", "all", "run", "iterate"]) {
    const fn = stmt[method];
    stmt[method] = function (...args) {
      const key = `${method} ${norm(sql)}`;
      counts.sql[key] = (counts.sql[key] ?? 0) + 1;
      return fn.apply(this, args);
    };
  }
  return stmt;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  const key = `exec ${norm(sql)}`;
  counts.sql[key] = (counts.sql[key] ?? 0) + 1;
  return exec.call(this, sql);
};
const real = {};
for (const key of ["readFileSync", "statSync", "lstatSync", "existsSync", "readdirSync", "openSync"]) {
  const fn = (real[key] = fs[key]);
  const wrapped = function (...args) {
    const name = `${key} ${String(args[0])}`;
    counts.fs[name] = (counts.fs[name] ?? 0) + 1;
    return fn.apply(this, args);
  };
  Object.assign(wrapped, fn);
  fs[key] = wrapped;
}
syncBuiltinESMExports();
process.on("exit", () => {
  const dir = process.env.PROBE_COUNTS;
  if (dir) fs.writeFileSync(`${dir}/${process.pid}.json`, JSON.stringify(counts));
});
