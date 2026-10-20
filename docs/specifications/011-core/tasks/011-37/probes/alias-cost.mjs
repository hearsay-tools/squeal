// Throwaway probe (011-37): what reading formats 13 to 17 as one costs a lookup.
//   node --no-warnings --experimental-strip-types --import ./register.mjs alias-cost.mjs <checkout> <scratch-dir>
// <checkout> is a throwaway worktree at a SHA; <scratch-dir> receives one SQLite file.
// Measures (1) the extra check keys a miss computes, by closure size, and (2) the
// store side: today's miss (`byKey`: UPDATE then SELECT), the extra formats' miss
// (one SELECT over an IN list), and a hit there copied under the current key
// (INSERT ... SELECT ... WHERE NOT EXISTS), on a store of cezar's order of size.
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const [root, scratch] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { keyFromSegments, encodeSegment } = await load("src/core/keys/check-key.ts");
const { MIGRATIONS } = await load("src/core/store/schema.ts");

const EXTRA = 4; // formats 13 to 16 read beside 17
const hex = (n) => randomBytes(n).toString("hex");
const time = (label, n, fn) => {
  for (let i = 0; i < Math.min(n, 50); i++) fn(i); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / n;
  console.log(`${label}\t${us.toFixed(1)} us each`);
  return us;
};

// 1. Keys. A segment is `path\0hash\0`; paths about 50 characters, blob ids 40.
console.log("## extra check keys per missed file");
const testFile = { project: "app", path: "test/a.test.ts" };
for (const size of [50, 300, 1000]) {
  const segments = Array.from({ length: size }, (_, i) =>
    encodeSegment(`packages/app/src/module-${String(i).padStart(4, "0")}/file.ts`, hex(20)),
  );
  const envs = Array.from({ length: EXTRA }, () => hex(32));
  time(`closure ${size} paths, ${EXTRA} formats`, 2000, () => {
    for (const env of envs) keyFromSegments(env, testFile, segments, "");
  });
}

// 2. Store. 20,000 keys of 10 checks each, 200,000 result rows.
console.log("## store, 20,000 keys x 10 checks");
const db = new DatabaseSync(join(scratch, "alias-cost.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
if (Number(db.prepare("PRAGMA user_version").get().user_version) === 0) {
  for (const migrate of MIGRATIONS) migrate(db);
}
const KEYS = 20_000;
const CHECKS = 10;
const keyOf = (i) => createHash("sha256").update(`key ${i}`).digest("hex");
if (db.prepare("SELECT COUNT(*) AS n FROM results").get().n === 0) {
  const check = db.prepare(
    "INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at) VALUES (?, ?, ?, ?, 0, ?)",
  );
  const row = db.prepare(
    `INSERT INTO results (check_id, key, outcome, duration_ms, fingerprint, failure_id, worktree_id,
       revision, commit_sha, dirty, run_id, recorded_at, last_used_at)
     VALUES (?, ?, 'pass', 5, NULL, NULL, 'w1', 1, NULL, 0, 'r1', ?, ?)`,
  );
  db.exec("BEGIN");
  for (let file = 0; file < 2_000; file++) {
    for (let c = 0; c < CHECKS; c++) {
      check.run("app", `test/f${file}.test.ts`, "test", `case ${c}`, 1);
    }
  }
  for (let k = 0; k < KEYS; k++) {
    const file = k % 2_000;
    for (let c = 0; c < CHECKS; c++) row.run(file * CHECKS + c + 1, keyOf(k), 1000 + k, 1000 + k);
  }
  db.exec("COMMIT");
}
console.log(`results rows\t${db.prepare("SELECT COUNT(*) AS n FROM results").get().n}`);

const update = db.prepare("UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?");
const select = db.prepare("SELECT * FROM results WHERE key = ?");
const placeholders = Array(EXTRA).fill("?").join(", ");
const newest = db.prepare(
  `SELECT key, MAX(recorded_at) AS at FROM results WHERE key IN (${placeholders})
   GROUP BY key ORDER BY at DESC LIMIT 1`,
);
const copy = db.prepare(
  `INSERT INTO results (check_id, key, outcome, duration_ms, location_path, location_line,
     location_column, fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id,
     recorded_at, last_used_at)
   SELECT check_id, ?, outcome, duration_ms, location_path, location_line, location_column,
     fingerprint, failure_id, worktree_id, revision, commit_sha, dirty, run_id, recorded_at, ?
   FROM results WHERE key = ? AND NOT EXISTS (SELECT 1 FROM results WHERE key = ?)`,
);

const missing = (i) => hex(32) + String(i);
time("today's miss: byKey (UPDATE, SELECT)", 2000, (i) => {
  const key = missing(i);
  update.run(9e12, key, 9e12);
  select.all(key);
});
time(`extra formats' miss: one SELECT over ${EXTRA} keys`, 2000, (i) => {
  newest.all(...Array.from({ length: EXTRA }, (_, j) => missing(i * EXTRA + j)));
});
let k = 0;
time(`hit at an extra format: SELECT, then copy ${CHECKS} rows (autocommit)`, 876, () => {
  const alias = keyOf(k++ % KEYS);
  const found = newest.all(alias, missing(1), missing(2), missing(3));
  const current = missing(k);
  copy.run(current, 9e12, found[0].key, current);
});
const t0 = process.hrtime.bigint();
db.exec("BEGIN");
for (let i = 0; i < 876; i++) {
  const alias = keyOf((k + i) % KEYS);
  const found = newest.all(alias, missing(1), missing(2), missing(3));
  const current = missing(1e6 + i);
  copy.run(current, 9e12, found[0].key, current);
}
db.exec("COMMIT");
console.log(
  `876 hits copied in one transaction\t${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)} ms`,
);
db.close();
