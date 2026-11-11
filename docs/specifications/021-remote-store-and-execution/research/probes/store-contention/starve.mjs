// Throwaway (row 021-03). SQLite's busy handler polls (sleeps 1..100 ms and
// retries); it keeps no queue. This measures how often a one-shot writer with
// busy timeout T gets BEGIN IMMEDIATE while other processes take the write
// lock over and over. Scratch database under $TMPDIR only.
// Usage: node starve.mjs <holders> <hold ms> <gap ms> <timeouts csv> <tries>
//   (child mode: node starve.mjs hold <db> <hold ms> <gap ms> <seconds>)
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (process.argv[2] === "hold") {
  const [, , , db, hold, gap, secs] = process.argv;
  const c = new DatabaseSync(db);
  c.exec("PRAGMA busy_timeout = 60000");
  const end = Date.now() + Number(secs) * 1000;
  while (Date.now() < end) {
    c.exec("BEGIN IMMEDIATE"); c.exec("INSERT INTO t VALUES (1)"); sleep(Number(hold)); c.exec("COMMIT");
    sleep(Number(gap));
  }
  process.exit(0);
}
const [holders, hold, gap, timeouts, tries] = process.argv.slice(2);
if (loadavg()[0] >= cpus().length) { console.log(JSON.stringify({ skipped: "load", load: loadavg()[0] })); process.exit(0); }
const db = join(process.env.TMPDIR ?? "/tmp", `starve-${process.pid}.sqlite`);
const setup = new DatabaseSync(db);
setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x)");
setup.close();
const secs = 5 + timeouts.split(",").reduce((a, t) => a + (Number(t) + 300) * Number(tries), 0) / 1000;
const kids = Array.from({ length: Number(holders) }, () => spawn(process.execPath, [new URL(import.meta.url).pathname, "hold", db, hold, gap, String(secs)], { stdio: "inherit" }));
sleep(1000);
const w = new DatabaseSync(db);
const out = { holders: Number(holders), holdMs: Number(hold), gapMs: Number(gap), load: loadavg()[0].toFixed(2), results: {} };
for (const t of timeouts.split(",").map(Number)) {
  w.exec(`PRAGMA busy_timeout = ${t}`);
  let ok = 0; const waits = [];
  for (let i = 0; i < Number(tries); i++) {
    const s = Date.now();
    try { w.exec("BEGIN IMMEDIATE"); w.exec("COMMIT"); ok++; waits.push(Date.now() - s); } catch { /* busy */ }
    sleep(150 + Math.floor(Math.random() * 150));
  }
  waits.sort((a, b) => a - b);
  out.results[`${t}ms`] = { ok: `${ok}/${tries}`, p50: waits[waits.length >> 1] ?? null, max: waits.at(-1) ?? null };
}
w.close();
for (const k of kids) k.kill();
out.loadAfter = loadavg()[0].toFixed(2);
console.log(JSON.stringify(out));
for (const s of ["", "-wal", "-shm"]) rmSync(db + s, { force: true });
