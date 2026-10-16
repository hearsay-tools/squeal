// Issue 12 probe (throwaway): hold a write lock on a Squeal store for <ms>,
// as another worktree's daemon storing a long transaction would. WAL readers proceed.
import { DatabaseSync } from "node:sqlite";
const [path, ms] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("BEGIN IMMEDIATE");
console.log(`${new Date().toISOString().slice(11, 19)} holder: write lock taken for ${ms} ms`);
const until = Date.now() + Number(ms);
while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
db.exec("COMMIT");
console.log(`${new Date().toISOString().slice(11, 19)} holder: released`);
