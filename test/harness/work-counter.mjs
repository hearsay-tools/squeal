// Row 025-28: a preload that counts the work of one Node process, loaded with
// NODE_OPTIONS=--import=<this file>. It counts executed `node:sqlite` statements and sync
// `fs` calls, keyed by statement text and by call and path, and writes them to
// $SQUEAL_WORK_COUNTS/<pid>.json at exit. The counter of `research/probes/hook-slowdown/`
// (row 025-26), so its counts compare with that research's, but for one change: a file call
// Node's own code makes is not counted. Node 24 and 26 load the entry script through `fs`,
// Node 22's `rmSync` calls `lstatSync`; neither is work of Squeal's, and each differs by
// Node version.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";

const counts = { argv: process.argv.slice(1), sql: {}, fs: {} };
const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const add = (table, key) => {
  table[key] = (table[key] ?? 0) + 1;
};
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql) {
  const stmt = prepare.call(this, sql);
  for (const method of ["get", "all", "run", "iterate"]) {
    const fn = stmt[method];
    stmt[method] = function (...args) {
      add(counts.sql, `${method} ${norm(sql)}`);
      return fn.apply(this, args);
    };
  }
  return stmt;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  add(counts.sql, `exec ${norm(sql)}`);
  return exec.call(this, sql);
};
/** Whether the call two frames up, the wrapper's caller, is Node's own code. */
const fromNode = (stack) => /^\s*at (?:.*\()?node:/.test(stack?.split("\n")[2] ?? "");
for (const key of [
  "readFileSync",
  "statSync",
  "lstatSync",
  "existsSync",
  "readdirSync",
  "openSync",
]) {
  const fn = fs[key];
  const wrapped = function (...args) {
    if (!fromNode(new Error().stack)) add(counts.fs, `${key} ${String(args[0])}`);
    return fn.apply(this, args);
  };
  Object.assign(wrapped, fn);
  fs[key] = wrapped;
}
syncBuiltinESMExports();
const out = process.env.SQUEAL_WORK_COUNTS;
process.on("exit", () => {
  if (out) fs.writeFileSync(`${out}/${process.pid}.json`, JSON.stringify(counts));
});
