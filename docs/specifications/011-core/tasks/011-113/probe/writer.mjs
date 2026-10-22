// A daemon-like writer: short BEGIN IMMEDIATE transactions, some held, some checkpoints and vacuums.
import { DatabaseSync } from "node:sqlite";
const [path, seconds, mode] = process.argv.slice(2);
const open = () => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 10000");
  db.prepare("PRAGMA user_version").get();
  db.prepare("PRAGMA journal_mode = WAL").get();
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
};
let db = open();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const end = Date.now() + Number(seconds) * 1000;
let n = 0;
const blob = (size) => Buffer.alloc(size, n & 0xff);
while (Date.now() < end) {
  n++;
  db.exec("BEGIN IMMEDIATE");
  for (let i = 0; i < 20; i++) db.prepare("INSERT OR REPLACE INTO t (k, v) VALUES (?, ?)").run((n * 20 + i) % 5000, blob(2000));
  if (n % 7 === 0) sleep(Math.random() * 20);
  db.exec("COMMIT");
  if (mode.includes("ckpt") && n % 50 === 0) {
    const kinds = ["PASSIVE", "FULL", "RESTART", "TRUNCATE"];
    try { db.prepare(`PRAGMA wal_checkpoint(${kinds[n / 50 % 4]})`).get(); } catch (e) { /* ignore */ }
  }
  if (mode.includes("vacuum") && n % 97 === 0) {
    db.exec("BEGIN IMMEDIATE");
    db.exec("DELETE FROM t WHERE k % 3 = 0");
    db.exec("COMMIT");
    db.exec("PRAGMA incremental_vacuum(512)");
  }
  if (mode.includes("reopen") && n % 5 === 0) {
    db.close();
    db = open();
  }
  if (mode.includes("churn") && n % 13 === 0) {
    const other = new DatabaseSync(path);
    other.exec("PRAGMA busy_timeout = 1000");
    other.prepare("SELECT count(*) FROM t").get();
    other.close();
  }
}
db.close();
