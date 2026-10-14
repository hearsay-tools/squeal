// Defect 1's hypothesis without Pi: a worker thread takes the waiter lock the way
// src/core/waiter-lock/waiter-lock.ts does (an exclusive SQLite lock) and is terminated while
// holding it, as session_shutdown(reload) stops the delivery host. Can a new connection in the
// same process lock the file afterwards? And from another process?
// Usage: node lock-probe.mjs <scratch dir>
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

const path = join(process.argv[2], "waiter-probe.sqlite");
const lock = () => {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
};
const other = () =>
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path)});
    try { db.exec("PRAGMA busy_timeout = 0"); db.exec("PRAGMA locking_mode = EXCLUSIVE"); db.exec("BEGIN EXCLUSIVE"); console.log("locked"); }
    catch (e) { console.log("refused: " + e.message); }`]).toString().trim();

const worker = new Worker(`
  const { DatabaseSync } = require("node:sqlite");
  const { parentPort } = require("node:worker_threads");
  const db = new DatabaseSync(${JSON.stringify(path)});
  db.exec("PRAGMA busy_timeout = 0"); db.exec("PRAGMA locking_mode = EXCLUSIVE"); db.exec("BEGIN EXCLUSIVE");
  parentPort.postMessage("held");
  setInterval(() => {}, 1000);`, { eval: true });
await new Promise((resolve) => worker.once("message", resolve));
console.log("while the worker holds it, same process:", lock() === null ? "refused" : "locked");
await worker.terminate();
const again = lock();
console.log("after terminate, same process:", again === null ? "refused" : "locked");
console.log("after terminate, another process:", other());
again?.close();
