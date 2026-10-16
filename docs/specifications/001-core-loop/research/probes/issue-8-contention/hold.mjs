// Throwaway: holds one kind of lock on a disposable store for <ms>, printing
// "held <mode>" once it has it and "released" after. Never point it at a live store.
// Usage: node hold.mjs <store.sqlite> <mode> <ms>
//   immediate  BEGIN IMMEDIATE + one write   (a daemon's normal WAL write, D8)
//   exclusive  BEGIN EXCLUSIVE + one write   (in WAL the same as immediate)
//   lockmode   PRAGMA locking_mode=EXCLUSIVE + a write (exclusive file lock)
import { DatabaseSync } from "node:sqlite";
const [file, mode, ms] = [process.argv[2], process.argv[3], Number(process.argv[4])];
if (!/\/tmp\//.test(file)) throw new Error(`refusing a store outside /tmp: ${file}`);
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000");
const write = () => db.exec("INSERT OR REPLACE INTO meta(key, value) VALUES ('probe.hold', 'x')");
switch (mode) {
  case "immediate": db.exec("BEGIN IMMEDIATE"); write(); break;
  case "exclusive": db.exec("BEGIN EXCLUSIVE"); write(); break;
  case "lockmode": db.exec("PRAGMA locking_mode = EXCLUSIVE"); db.exec("BEGIN EXCLUSIVE"); write(); break;
  default: throw new Error(`unknown mode ${mode}`);
}
const t0 = performance.now();
console.log(`held ${mode} at ${new Date().toISOString()}`);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
db.exec("COMMIT");
if (mode === "lockmode") { db.exec("PRAGMA locking_mode = NORMAL"); db.prepare("SELECT 1 FROM meta").get(); }
console.log(`released after ${Math.round(performance.now() - t0)} ms at ${new Date().toISOString()}`);
db.close();
