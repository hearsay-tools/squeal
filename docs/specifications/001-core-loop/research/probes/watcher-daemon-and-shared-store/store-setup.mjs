// THROWAWAY PROBE. Not product code. See README.md.
// Creates tmp/store.db (SQLite, WAL) and tmp/store.json with N check rows, to compare hook-read latency.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const N = Number(process.argv[2] ?? 5000);
fs.mkdirSync('tmp', { recursive: true });
for (const f of ['tmp/store.db', 'tmp/store.db-wal', 'tmp/store.db-shm']) fs.rmSync(f, { force: true });
const db = new DatabaseSync('tmp/store.db');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
  CREATE TABLE result(check_id TEXT, fingerprint TEXT, state TEXT, revision INTEGER, duration_ms INTEGER, message TEXT,
    PRIMARY KEY(check_id, fingerprint));
  CREATE TABLE worktree_state(worktree TEXT, check_id TEXT, fingerprint TEXT, PRIMARY KEY(worktree, check_id));
  CREATE INDEX result_state ON result(state);`);
const ins = db.prepare('INSERT INTO result VALUES (?,?,?,?,?,?)');
const ws = db.prepare('INSERT INTO worktree_state VALUES (?,?,?)');
const json = {};
db.exec('BEGIN');
for (let i = 0; i < N; i++) {
  const id = `tests/mod${i % 200}/file${i % 50}.test.ts > suite > case ${i}`;
  const st = i % 97 === 0 ? 'fail' : 'pass';
  const msg = st === 'fail' ? 'AssertionError: expected 401 to be 500 '.repeat(5) : null;
  ins.run(id, `fp${i}`, st, 100 + (i % 7), i % 300, msg);
  for (const wt of ['main', 'wt1', 'wt2']) ws.run(wt, id, `fp${i}`);
  json[id] = { fingerprint: `fp${i}`, state: st, revision: 100 + (i % 7), durationMs: i % 300, message: msg };
}
db.exec('COMMIT');
db.close();
fs.writeFileSync('tmp/store.json', JSON.stringify({ version: 1, worktrees: { main: json, wt1: json, wt2: json } }));
console.log('db bytes', fs.statSync('tmp/store.db').size + (fs.existsSync('tmp/store.db-wal') ? fs.statSync('tmp/store.db-wal').size : 0), 'json bytes', fs.statSync('tmp/store.json').size);
