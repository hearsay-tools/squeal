// Throwaway: one daemon-like churn connection on a disposable store for <ms>.
//   writer: BEGIN IMMEDIATE, ~<mb> MB of rows, hold, COMMIT, rest, repeat
//   reader: PRAGMA integrity_check in a loop (a daemon start's long read, D12)
// Usage: node churn.mjs <store.sqlite> writer|reader <ms> [mb]
import { DatabaseSync } from "node:sqlite";
const [file, role, ms, mb] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5] ?? 4)];
if (!/\/tmp\//.test(file)) throw new Error(`refusing a store outside /tmp: ${file}`);
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL");
const end = Date.now() + ms;
const sleep = (t) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, t);
const blob = "y".repeat(16 * 1024);
const insert = db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)");
let n = 0, txns = 0, busy = 0;
while (Date.now() < end) {
  try {
    if (role === "writer") {
      db.exec("BEGIN IMMEDIATE");
      for (let i = 0; i < mb * 64; i++) insert.run(`churn.${process.pid}.${n++ % 20000}`, blob);
      sleep(200 + Math.random() * 600);
      db.exec("COMMIT");
      sleep(Math.random() * 200);
    } else {
      db.prepare("PRAGMA integrity_check").all();
    }
    txns++;
  } catch (e) { busy++; try { db.exec("ROLLBACK"); } catch {} }
}
console.log(`${role} ${process.pid}: ${txns} transactions, ${busy} errors`);
db.close();
