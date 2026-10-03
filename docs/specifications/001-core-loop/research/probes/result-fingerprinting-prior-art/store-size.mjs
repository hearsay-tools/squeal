// Throwaway probe. Size of a SQLite result store for 5,000 tests and 50 revisions/day.
// Model (assumptions, not measurements): 500 test files x 10 tests; each revision
// changes the closure key of 10% of test files (50 files, 500 tests); 2% of results
// fail and carry ~2 KB of message+stack; closures average 300 files.
// Usage: node store-size.mjs <days> <per-key|latest>
//   per-key: store (path, oid) closure members for every key ever seen.
//   latest:  store closure path list only for the newest key of each test file.
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { rmSync, statSync } from 'node:fs'

const days = Number(process.argv[2] ?? 30)
const mode = process.argv[3] ?? 'per-key'
const file = '/tmp/squeal-store-probe.db'
rmSync(file, { force: true })
const db = new DatabaseSync(file)
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE path (id INTEGER PRIMARY KEY, path TEXT UNIQUE);
  CREATE TABLE closure (test_file INTEGER, key BLOB, PRIMARY KEY (test_file, key)) WITHOUT ROWID;
  CREATE TABLE closure_member (key BLOB, path INTEGER, oid BLOB, PRIMARY KEY (key, path)) WITHOUT ROWID;
  CREATE TABLE result (test INTEGER, key BLOB, state INTEGER, duration_ms INTEGER,
    revision INTEGER, worktree INTEGER, commit_sha BLOB, at INTEGER, fail_fp BLOB, message TEXT,
    PRIMARY KEY (test, key)) WITHOUT ROWID;`)
const insPath = db.prepare('INSERT INTO path (id, path) VALUES (?, ?)')
const insClosure = db.prepare('INSERT INTO closure VALUES (?, ?)')
const insMember = db.prepare('INSERT OR IGNORE INTO closure_member VALUES (?, ?, ?)')
const insResult = db.prepare('INSERT OR REPLACE INTO result VALUES (?,?,?,?,?,?,?,?,?,?)')
const msg = 'AssertionError: expected 401 to be 500\n' + '    at Object.<anonymous> (src/auth/login.test.ts:42:17)\n'.repeat(35)

db.exec('BEGIN'); for (let i = 0; i < 5000; i++) insPath.run(i, `packages/pkg-${i % 40}/src/module-${i}.ts`); db.exec('COMMIT')
let rev = 0
const record = (tf, withClosure) => {
  const key = randomBytes(32)
  insClosure.run(tf, key)
  if (mode === 'latest') db.prepare('DELETE FROM closure_member WHERE key IN (SELECT key FROM closure WHERE test_file = ? AND key <> ?)').run(tf, key)
  if (withClosure) for (let j = 0; j < 300; j++) insMember.run(key, (tf * 7 + j * 13) % 5000, mode === 'latest' ? null : randomBytes(20))
  for (let t = 0; t < 10; t++) {
    const fail = Math.random() < 0.02
    insResult.run(tf * 10 + t, key, fail ? 1 : 0, 40, rev, 1, randomBytes(20), Date.now(),
      fail ? randomBytes(16) : null, fail ? msg : null)
  }
}
db.exec('BEGIN'); for (let tf = 0; tf < 500; tf++) record(tf, true); db.exec('COMMIT')
const report = (label) => {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const rows = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c
  console.log(`${label}: ${(statSync(file).size / 1e6).toFixed(1)} MB, results=${rows('result')}, closures=${rows('closure')}, closure_members=${rows('closure_member')}`)
}
report('baseline (1 full run)')
for (let d = 0; d < days; d++) {
  db.exec('BEGIN')
  for (let r = 0; r < 50; r++, rev++) for (let k = 0; k < 50; k++) record(Math.floor(Math.random() * 500), true)
  db.exec('COMMIT')
  if (d === 0 || d === days - 1) report(`after ${d + 1} day(s), mode=${mode}`)
}
// Prune: keep only the newest key per test file (plus anything a live worktree pins; none here).
db.exec(`
  CREATE TEMP TABLE keep AS SELECT test_file, key FROM closure c
    WHERE key = (SELECT r.key FROM result r WHERE r.test = c.test_file * 10 ORDER BY r.revision DESC, r.at DESC LIMIT 1);
  DELETE FROM result WHERE key NOT IN (SELECT key FROM keep);
  DELETE FROM closure_member WHERE key NOT IN (SELECT key FROM keep);
  DELETE FROM closure WHERE key NOT IN (SELECT key FROM keep);
  VACUUM;`)
report('after pruning to newest key per test file')
