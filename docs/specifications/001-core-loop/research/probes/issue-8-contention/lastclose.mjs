// Throwaway: grows the WAL of a disposable store by <mb> MB that no checkpoint
// can backfill (a second connection pins an old snapshot meanwhile), drops the
// pin, then closes the last connection, so SQLite checkpoints the whole WAL and
// deletes it under an EXCLUSIVE lock on the database file. Prints when the
// close starts and how long it took. With `crash` it SIGKILLs itself instead,
// so the next opener runs WAL recovery under an exclusive lock.
// Usage: node lastclose.mjs <store.sqlite> <mb> <delay-ms> [crash]
import { DatabaseSync } from "node:sqlite";
const [file, mb, delay, crash] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), process.argv[5] === "crash"];
if (!/\/tmp\//.test(file)) throw new Error(`refusing a store outside /tmp: ${file}`);
const pin = new DatabaseSync(file);
pin.exec("BEGIN"); pin.prepare("SELECT count(*) FROM meta").get();
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL");
const blob = "x".repeat(64 * 1024);
const insert = db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)");
for (let i = 0; i < mb * 16; i++) { db.exec("BEGIN IMMEDIATE"); insert.run(`probe.big.${i}`, blob + i); db.exec("COMMIT"); }
pin.exec("COMMIT"); pin.close();
console.log(`wal ready (${mb} MB written)`);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
if (crash) { console.log(`killed with the WAL in place at ${new Date().toISOString()}`); process.kill(process.pid, "SIGKILL"); }
const t0 = performance.now();
console.log(`last close starts at ${new Date().toISOString()}`);
db.close();
console.log(`last close took ${Math.round(performance.now() - t0)} ms`);
