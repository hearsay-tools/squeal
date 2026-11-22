#!/usr/bin/env node
// Builds a store shaped like the bench's aged store (bench/age-store.mjs, 326
// rounds with lists): per round, 500 `loaded_modules` lists of 46 KB and
// 5,300 small `results` rows, written in turn, so the lists' pages sit between
// result pages as in the aged store. auto_vacuum = INCREMENTAL as `open.ts`
// sets on a new file; built with no journal, then switched to WAL.
//
// Usage: node build-store.mjs <store.sqlite> <rounds>
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [path, roundsArg] = process.argv.slice(2);
const rounds = Number(roundsArg);
if (!path || !(rounds > 0)) throw new Error("usage: build-store.mjs <store.sqlite> <rounds>");
const db = new DatabaseSync(path);
db.exec("PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
db.exec(`CREATE TABLE results (id INTEGER PRIMARY KEY, check_id INTEGER NOT NULL, key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE INDEX results_check ON results (check_id, recorded_at);
CREATE TABLE loaded_modules (project TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL, modules TEXT NOT NULL, PRIMARY KEY (project, path, key)) STRICT, WITHOUT ROWID;
CREATE TABLE writer_probe (id INTEGER PRIMARY KEY, at INTEGER NOT NULL);`);
const list = db.prepare("INSERT INTO loaded_modules VALUES ('p', ?, ?, ?, ?)");
const result = db.prepare("INSERT INTO results (check_id, key, recorded_at, body) VALUES (?, ?, ?, ?)");
const t0 = performance.now();
for (let r = 0; r < rounds; r++) {
  db.exec("BEGIN");
  for (let f = 0; f < 500; f++) {
    const key = randomBytes(16).toString("hex");
    list.run(`test/file-${f}.test.ts`, key, Date.now(), randomBytes(23_000).toString("hex"));
    for (let c = 0; c < 11; c++) result.run(f * 11 + c, key, Date.now(), randomBytes(90).toString("hex"));
  }
  db.exec("COMMIT");
  if (r % 20 === 0) console.log(`round ${r} ${Math.round(performance.now() - t0)} ms`);
}
db.exec("PRAGMA journal_mode = WAL");
const pages = db.prepare("PRAGMA page_count").get().page_count;
console.log(JSON.stringify({ rounds, pages, bytes: pages * 4096, ms: Math.round(performance.now() - t0) }));
db.close();
