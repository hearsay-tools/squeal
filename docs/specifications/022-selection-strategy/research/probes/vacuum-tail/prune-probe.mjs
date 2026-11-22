#!/usr/bin/env node
// Runs the real prune code of row 022-08 (`emptyLoadedModules`, then the
// shared `vacuum`) on a store and times, inside each write transaction, every
// `incremental_vacuum` step, every list `DELETE` and the `COMMIT`, and reads
// the wal-index before and after the commit to see whether SQLite ran a WAL
// checkpoint inside it (nBackfill moved, or the WAL restarted).
// A `wal_checkpoint` the code runs itself (row 022-08r's checkpoint slice)
// is timed as its own record. After each slice the probe pauses as the
// daemon's driver does (`turnGapMs`: as long as the slice, at least 10 ms).
//
// Bundled with esbuild (README.md), since it imports the TypeScript sources.
//
// Usage: node prune-probe.bundle.mjs <store.sqlite> <out.jsonl> <list-minutes> <vacuum-minutes>
//          [--no-pause] [--checkpoint slice]
// --checkpoint slice (first run only, before the repair existed): this
// connection runs no automatic checkpoint, and the probe runs a
// `wal_checkpoint(PASSIVE)` after each write slice, timed
import { appendFileSync, openSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Connection } from "../../../../../../src/core/store/connection.js";
import { emptyLoadedModules } from "../../../../../../src/core/store/loaded-modules.js";
import { JOURNAL_SIZE_LIMIT_BYTES } from "../../../../../../src/core/store/open.js";
import { vacuum } from "../../../../../../src/core/store/prune-vacuum.js";
import { turnGapMs } from "../../../../../../src/core/store/write-turns.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args.splice(i, 2)[1];
};
const checkpoint = flag("--checkpoint", "auto");
const pause = !args.includes("--no-pause");
if (!pause) args.splice(args.indexOf("--no-pause"), 1);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const [path, out, listMinutes, vacuumMinutes] = args;

const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
if (checkpoint === "slice") db.exec("PRAGMA wal_autocheckpoint = 0");
db.prepare("SELECT count(*) FROM writer_probe").get();
// Kept open to the end: closing any descriptor of the -shm file drops this
// process's POSIX locks on it (src/core/store/long-write.ts).
const shmFd = openSync(`${path}-shm`, "r");
const shm = () => {
  const b = Buffer.alloc(100);
  readSync(shmFd, b, 0, 100, 0);
  return { mx: b.readUInt32LE(16), backfill: b.readUInt32LE(96) };
};

let lines = [];
const record = (r) => {
  lines.push(JSON.stringify(r));
  if (lines.length >= 100) flush();
};
const flush = () => {
  if (lines.length > 0) appendFileSync(out, `${lines.join("\n")}\n`);
  lines = [];
};

let tx = null;
let phase = "lists";
const round = (ms) => +ms.toFixed(2);
const exec = (sql) => {
  if (sql === "BEGIN IMMEDIATE") {
    const t0 = performance.now();
    db.exec(sql);
    tx = { start: performance.now(), wait: performance.now() - t0, ops: [], before: shm() };
    return;
  }
  if (sql === "COMMIT" && tx !== null) {
    const pre = shm();
    const t0 = performance.now();
    db.exec(sql);
    const t1 = performance.now();
    const post = shm();
    record({
      at: Date.now(),
      phase,
      kind: tx.ops.length === 0 ? "empty" : tx.ops[0].op,
      hold: round(t1 - tx.start),
      wait: round(tx.wait),
      work: round(t0 - tx.start),
      commit: round(t1 - t0),
      ops: tx.ops.map((o) => round(o.ms)),
      frames: post.mx >= tx.before.mx ? post.mx - tx.before.mx : null,
      walBefore: tx.before.mx,
      checkpointed: post.backfill !== pre.backfill || post.mx < pre.mx,
      backfill: [pre.backfill, post.backfill],
    });
    tx = null;
    return;
  }
  if (sql.startsWith("PRAGMA incremental_vacuum") && tx !== null) {
    const t0 = performance.now();
    db.exec(sql);
    tx.ops.push({ op: "vacuum", ms: performance.now() - t0 });
    return;
  }
  db.exec(sql);
};
const prepare = (sql) => {
  const statement = db.prepare(sql);
  if (sql.startsWith("PRAGMA wal_checkpoint")) {
    return new Proxy(statement, {
      get(target, prop) {
        if (prop !== "get") return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
        return (...params) => {
          const pre = shm();
          const t0 = performance.now();
          const row = target.get(...params);
          const post = shm();
          record({
            at: Date.now(),
            phase,
            kind: "checkpoint",
            hold: 0,
            ms: round(performance.now() - t0),
            walBefore: pre.mx,
            backfill: [pre.backfill, post.backfill],
            result: { ...row },
          });
          return row;
        };
      },
    });
  }
  if (!sql.trimStart().startsWith("DELETE")) return statement;
  return new Proxy(statement, {
    get(target, prop) {
      if (prop !== "run") return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
      return (...params) => {
        const t0 = performance.now();
        const result = target.run(...params);
        tx?.ops.push({ op: "delete", ms: performance.now() - t0, rows: result.changes });
        return result;
      };
    },
  });
};
const traced = new Proxy(db, {
  get(target, prop) {
    if (prop === "exec") return exec;
    if (prop === "prepare") return prepare;
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const conn = new Connection(traced);

function drive(gen, minutes) {
  const end = performance.now() + Number(minutes) * 60_000;
  let slices = 0;
  for (const slice of gen) {
    const writesBefore = lines.length;
    const t0 = performance.now();
    slice();
    const ms = performance.now() - t0;
    slices++;
    if (checkpoint === "slice" && lines.length !== writesBefore) {
      const pre = shm();
      const t0 = performance.now();
      const row = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
      record({
        at: Date.now(),
        phase,
        kind: "checkpoint",
        hold: 0,
        ms: round(performance.now() - t0),
        walBefore: pre.mx,
        result: row,
      });
    }
    if (pause) sleep(turnGapMs(ms));
    if (performance.now() > end) return { slices, done: false };
  }
  return { slices, done: true };
}

const free = () => Number(db.prepare("PRAGMA freelist_count").get().freelist_count);
const t0 = performance.now();
const lists = drive(emptyLoadedModules(conn), listMinutes);
flush();
const afterLists = { ...lists, ms: Math.round(performance.now() - t0), free: free() };
console.log(JSON.stringify({ afterLists }));
phase = "vacuum";
const t1 = performance.now();
const vac = drive(vacuum(conn), vacuumMinutes);
flush();
console.log(JSON.stringify({ afterVacuum: { ...vac, ms: Math.round(performance.now() - t1), free: free() } }));
db.close();
