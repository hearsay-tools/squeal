#!/usr/bin/env node
// Another writer on the store, as a hook or a second daemon: every 20 ms one
// `BEGIN IMMEDIATE`, one small insert, `COMMIT`, with the connection settings
// `open.ts` gives every opener (default wal_autocheckpoint of 1,000 pages).
// Writes one JSON line per transaction: when, the wait for the lock, the
// commit. It measures how long the prune keeps others from writing.
//
// Usage: node other-writer.mjs <store.sqlite> <out.jsonl> <seconds>
import { appendFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [path, out, secondsArg] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;");
db.exec(`PRAGMA journal_size_limit = ${64 * 1024 * 1024}`);
const insert = db.prepare("INSERT INTO writer_probe (at) VALUES (?)");
const end = Date.now() + Number(secondsArg) * 1000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let lines = [];
while (Date.now() < end) {
  sleep(20);
  const t0 = performance.now();
  db.exec("BEGIN IMMEDIATE");
  const t1 = performance.now();
  insert.run(Date.now());
  db.exec("COMMIT");
  const t2 = performance.now();
  lines.push(JSON.stringify({ at: Date.now(), wait: +(t1 - t0).toFixed(2), commit: +(t2 - t1).toFixed(2) }));
  if (lines.length >= 200) {
    appendFileSync(out, `${lines.join("\n")}\n`);
    lines = [];
  }
}
if (lines.length > 0) appendFileSync(out, `${lines.join("\n")}\n`);
db.close();
