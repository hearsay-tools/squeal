#!/usr/bin/env node
// Ages a benchmark store: adds `rounds` rounds of history, as if every test
// file of the project had changed content `rounds` times in the last 7 days.
// Run it only while no daemon has the store open.
//
// Usage: node age-store.mjs <store.sqlite> <rounds> <project root>
//
// Each round gives every test file a new content key and adds, at that key:
//   - one `results` row per check of the file, copied from the file's newest result;
//   - one `loaded_modules` row whose list holds about 46 KB of JSON, the
//     average row in Squeal's own store (2026-11-20: 510 modules, 46 KB);
//   - one `runs` row per 8 test files (the real store's ratio).
// Timestamps fall between 7 days and 2 hours ago, older than every real row,
// so a "newest result" or "newest list" read still finds the real one.
// The rows belong to 19 made-up worktrees, as the real store held 19.
//
// Shape measured on Squeal's own store (7.2 GB, 2026-11-20): loaded_modules
// 5.9 GB (163k rows), results 1.0 GB with indexes (1.74M rows), known_states,
// file_hashes and the rest 0.3 GB. 326 rounds of the 500-file project give
// the same loaded_modules row count; 70 rounds give the same rows per test
// file, scaled to 500 test files.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [store, roundsArg, root] = process.argv.slice(2);
if (!store || !roundsArg || !root) {
  console.error("usage: age-store.mjs <store.sqlite> <rounds> <project root>");
  process.exit(2);
}
const rounds = Number(roundsArg);
const t0 = performance.now();
const db = new DatabaseSync(store);
db.exec("PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;");
db.exec(`CREATE TABLE IF NOT EXISTS loaded_modules (
  project TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL, modules TEXT NOT NULL,
  PRIMARY KEY (project, path, key)
) STRICT, WITHOUT ROWID;`);

const now = Date.now();
const DAY = 86_400_000;
const time = () => Math.floor(now - 2 * 3_600_000 - Math.random() * (7 * DAY - 2 * 3_600_000));
const hex = (bytes) => randomBytes(bytes).toString("hex");
const worktrees = Array.from({ length: 19 }, () => hex(8));

// The newest result of every check, grouped by test file.
const templates = db
  .prepare(
    `SELECT r.*, c.project AS c_project, c.test_path AS c_path FROM results r JOIN checks c ON c.id = r.check_id
     WHERE r.recorded_at = (SELECT MAX(recorded_at) FROM results WHERE check_id = r.check_id)`,
  )
  .all();
const byFile = new Map();
for (const t of templates) {
  const id = `${t.c_project}\0${t.c_path}`;
  if (!byFile.has(id)) byFile.set(id, []);
  byFile.get(id).push(t);
}
const files = [...byFile.keys()];
if (files.length === 0) throw new Error("no results to copy: run `squeal run --all` first");

// A pool of module lists of real-store size, from the project's own paths.
const paths = execFileSync("git", ["ls-files", "*.ts"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .sort();
const listSize = Math.min(paths.length, 700);
const pool = Array.from({ length: 32 }, () => {
  const chosen = new Set();
  while (chosen.size < listSize) chosen.add(paths[Math.floor(Math.random() * paths.length)]);
  return JSON.stringify([...chosen].sort().map((path) => ({ path, hash: hex(20) })));
});

const runTemplate = db.prepare("SELECT * FROM runs LIMIT 1").get();
const resultCols = Object.keys(templates[0]).filter((c) => !c.startsWith("c_"));
const insertResult = db.prepare(
  `INSERT INTO results (${resultCols.join(",")}) VALUES (${resultCols.map((c) => `:${c}`).join(",")})`,
);
const insertList = db.prepare(
  "INSERT INTO loaded_modules (project, path, key, recorded_at, modules) VALUES (?, ?, ?, ?, ?)",
);
const runCols = Object.keys(runTemplate);
const insertRun = db.prepare(
  `INSERT INTO runs (${runCols.join(",")}) VALUES (${runCols.map((c) => `:${c}`).join(",")})`,
);

let resultsAdded = 0;
let listsAdded = 0;
let runsAdded = 0;
for (let r = 0; r < rounds; r++) {
  db.exec("BEGIN");
  let runId = null;
  let runTime = 0;
  let worktree = worktrees[0];
  for (const [i, file] of files.entries()) {
    if (i % 8 === 0) {
      runId = randomUUID();
      runTime = time();
      worktree = worktrees[Math.floor(Math.random() * worktrees.length)];
      insertRun.run({
        ...runTemplate,
        id: runId,
        worktree_id: worktree,
        revision: r + 1,
        checkpoint_id: null,
        log_dir: `/aged/${runId}`,
        started_at: runTime,
        ended_at: runTime + 5000,
      });
      runsAdded++;
    }
    const key = hex(32);
    const at = runTime + Math.floor(Math.random() * 5000);
    for (const t of byFile.get(file)) {
      const row = Object.fromEntries(resultCols.map((c) => [c, t[c]]));
      insertResult.run({
        ...row,
        key,
        worktree_id: worktree,
        revision: r + 1,
        run_id: runId,
        recorded_at: at,
        last_used_at: at,
      });
      resultsAdded++;
    }
    const [project, path] = file.split("\0");
    insertList.run(project, path, key, at, pool[Math.floor(Math.random() * pool.length)]);
    listsAdded++;
  }
  db.exec("COMMIT");
}
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log(
  JSON.stringify({
    rounds,
    testFiles: files.length,
    resultsAdded,
    listsAdded,
    runsAdded,
    listBytes: pool[0].length,
    storeBytes: statSync(store).size,
    ms: Math.round(performance.now() - t0),
  }),
);
