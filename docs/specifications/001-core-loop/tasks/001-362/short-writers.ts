/*
 * Task 001-362 probe: can short writers, as Squeal's are (each waits in
 * SQLite's busy handler, then holds the lock briefly), keep a start's
 * `BEGIN IMMEDIATE` out? `<writers>` child processes write back to back,
 * each holding `<holdMs>` and pausing `<pauseMs>`; a waiter with a 120 s
 * busy timeout takes the lock `<waits>` times and prints how long each
 * took. Run as
 * `node --import tsx short-writers.ts <dir> <writers> <holdMs> <pauseMs> <waits>`.
 * Touches only `<dir>`.
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [dir, writers, hold, pause, waits, child] = process.argv.slice(2);
if (dir === undefined || writers === undefined || hold === undefined || pause === undefined || waits === undefined) {
  throw new Error("usage: short-writers.ts <dir> <writers> <holdMs> <pauseMs> <waits>");
}
const database = join(dir, "short.sqlite");
if (child !== undefined) {
  const db = new DatabaseSync(database);
  db.exec("PRAGMA busy_timeout = 60000");
  for (;;) {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(child, String(Date.now()));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(hold));
    db.exec("COMMIT");
    await sleep(Number(pause));
  }
}
const db = new DatabaseSync(database);
db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
db.exec("PRAGMA busy_timeout = 120000");
const kids = Array.from({ length: Number(writers) }, (_, i) =>
  spawn(process.execPath, [...process.execArgv, process.argv[1] as string, dir, writers, hold, pause, waits, String(i)], {
    stdio: ["ignore", "ignore", "inherit"],
  }),
);
await sleep(2_000);
const took: number[] = [];
for (let i = 0; i < Number(waits); i++) {
  const began = Date.now();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("COMMIT");
    took.push(Date.now() - began);
  } catch (error) {
    took.push(-(Date.now() - began));
    console.log(`wait ${i + 1} failed after ${Date.now() - began} ms: ${String(error)}`);
  }
  await sleep(500);
}
for (const kid of kids) kid.kill("SIGKILL");
const sorted = [...took].sort((a, b) => a - b);
console.log(`${writers} writers, hold ${hold} ms, pause ${pause} ms: waits (ms) ${took.join(" ")}`);
console.log(`median ${sorted[Math.floor(sorted.length / 2)]} ms, longest ${sorted.at(-1)} ms`);
