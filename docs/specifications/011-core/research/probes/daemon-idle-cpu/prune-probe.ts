// Throwaway probe (row 011-313). Runs the daemon's hourly prune (main store,
// then code store) against a COPY of a project's stores, and the presence
// and heartbeat reads, and prints per SQL statement: calls, wall ms, CPU ms,
// read calls and bytes (from /proc/self/io). Never point it at a live store.
// Usage (repo root): node_modules/.bin/tsx <this> <copyRoot> [passes]
//   <copyRoot>/.git/squeal/{store,code}.sqlite are the copies.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Connection } from "../../../../../../src/core/store/connection.js";
import { openStore, isStoreOpenFailure } from "../../../../../../src/core/store/open.js";
import { connectionOf } from "../../../../../../src/core/store/store.js";
import { prune } from "../../../../../../src/core/store/prune.js";
import { storePaths } from "../../../../../../src/core/store/paths.js";
import { pruneCodeStoreAfter } from "../../../../../../src/core/code/store/prune-main.js";

const [copyRoot, passesArg] = process.argv.slice(2);
const commonDir = `${copyRoot}/.git` as never;
const io = () => {
  const d: Record<string, number> = {};
  for (const l of readFileSync("/proc/self/io", "utf8").trim().split("\n")) {
    const [k, v] = l.split(":");
    d[k] = Number(v);
  }
  return d;
};
type Acc = { calls: number; ms: number; cpu: number; syscr: number; rchar: number };
let stats = new Map<string, Acc>();
const measure = <T>(label: string, fn: () => T): T => {
  const i0 = io(), c0 = process.cpuUsage(), t0 = performance.now();
  try {
    return fn();
  } finally {
    const i1 = io(), c1 = process.cpuUsage(c0), t1 = performance.now();
    const a = stats.get(label) ?? { calls: 0, ms: 0, cpu: 0, syscr: 0, rchar: 0 };
    a.calls++; a.ms += t1 - t0; a.cpu += (c1.user + c1.system) / 1000;
    a.syscr += i1.syscr - i0.syscr; a.rchar += i1.rchar - i0.rchar;
    stats.set(label, a);
  }
};
const short = (sql: string) => sql.replace(/\s+/g, " ").trim().slice(0, 150);
for (const m of ["run", "all", "get"] as const) {
  const orig = Connection.prototype[m] as (...a: unknown[]) => unknown;
  (Connection.prototype as Record<string, unknown>)[m] = function (this: Connection, sql: string, ...p: unknown[]) {
    return measure(short(sql), () => orig.call(this, sql, ...p));
  };
}
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql: string) {
  if (/^(BEGIN|COMMIT|RELEASE|SAVEPOINT|ROLLBACK)/.test(sql)) return exec.call(this, sql);
  return measure(short(sql), () => exec.call(this, sql));
};
const report = (title: string) => {
  const rows = [...stats].sort((a, b) => b[1].ms - a[1].ms);
  const tot = rows.reduce((s, [, a]) => ({ ms: s.ms + a.ms, cpu: s.cpu + a.cpu, syscr: s.syscr + a.syscr, rchar: s.rchar + a.rchar }), { ms: 0, cpu: 0, syscr: 0, rchar: 0 });
  console.log(`== ${title}: ${(tot.ms / 1000).toFixed(1)} s wall, ${(tot.cpu / 1000).toFixed(1)} s CPU, ${(tot.syscr / 1e6).toFixed(2)} M reads, ${(tot.rchar / 1e9).toFixed(2)} GB`);
  for (const [sql, a] of rows.slice(0, 14)) {
    console.log(`${(a.ms / 1000).toFixed(2).padStart(7)} s ${(a.cpu / 1000).toFixed(2).padStart(6)} s cpu ${String(a.calls).padStart(5)}x ${(a.syscr / 1e3).toFixed(0).padStart(7)} k reads ${(a.rchar / Math.max(1, a.syscr)).toFixed(0).padStart(5)} B/read | ${sql}`);
  }
  stats = new Map();
};

const store = openStore(commonDir);
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const policy = { complexity: { enabled: true }, store: { retentionDays: 7, maxSizeMb: null } } as never;
console.log("worktrees", store.worktrees.list().length);
for (let pass = 1; pass <= Number(passesArg ?? 2); pass++) {
  const r1 = prune(connectionOf(store), store.worktrees, storePaths(commonDir), { now: Date.now() as never, retentionDays: 7, maxSizeMb: null });
  report(`pass ${pass}: main store prune ${JSON.stringify(r1)}`);
  const r2 = pruneCodeStoreAfter(store, commonDir, policy, Date.now() as never);
  report(`pass ${pass}: code store prune ${JSON.stringify(r2)}`);
}
