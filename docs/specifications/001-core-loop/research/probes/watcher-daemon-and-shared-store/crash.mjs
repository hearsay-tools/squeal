// THROWAWAY PROBE. Not product code. See README.md.
// SIGKILL a SQLite writer mid-stream N times; check integrity and that no transaction is half-applied.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const N = Number(process.argv[2] ?? 20);
if (process.argv[3] === 'child') {
  const db = new DatabaseSync('tmp/store.db', { timeout: 5000 });
  const up = db.prepare('INSERT OR REPLACE INTO worktree_state VALUES (?,?,?)');
  for (let t = 0; ; t++) {
    db.exec('BEGIN IMMEDIATE');
    for (let k = 0; k < 50; k++) up.run(`crash-${process.pid}`, `c-${t}-${k}`, 'fp');
    db.exec('COMMIT');
  }
}
const results = [];
for (let i = 0; i < N; i++) {
  const p = spawn(process.execPath, ['crash.mjs', String(N), 'child'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
  p.kill('SIGKILL');
  await new Promise((r) => p.on('close', r));
  const db = new DatabaseSync('tmp/store.db');
  const ok = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const n = db.prepare('SELECT count(*) n FROM worktree_state WHERE worktree = ?').get(`crash-${p.pid}`).n;
  db.close();
  results.push({ ok, rows: n, wholeTx: n % 50 === 0 });
}
console.log(JSON.stringify({ kills: N, allIntegrityOk: results.every((r) => r.ok === 'ok'), allWholeTx: results.every((r) => r.wholeTx), rowsSample: results.slice(0, 5).map((r) => r.rows) }));
