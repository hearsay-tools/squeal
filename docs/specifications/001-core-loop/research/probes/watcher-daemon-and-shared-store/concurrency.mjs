// THROWAWAY PROBE. Not product code. See README.md.
// Several writer processes (daemons) and reader processes (hook scripts) hit one store at once.
// Usage: node concurrency.mjs <sqlite|json-lock|json-nolock> [writers] [readers]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [, , kind, W = '4', R = '4', role, idx] = process.argv;
const TX = 200, ROWS = 50, READ_MS = 4000;
const pct = (a, p) => (a.length ? +a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : null);
const now = () => Number(process.hrtime.bigint()) / 1e6;

if (!role) {
  const procs = [];
  const run = (r, i) => new Promise((res) => {
    const p = spawn(process.execPath, ['concurrency.mjs', kind, W, R, r, String(i)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; p.stdout.on('data', (d) => (s += d)); p.on('close', () => res(JSON.parse(s)));
  });
  for (let i = 0; i < +W; i++) procs.push(run('writer', i));
  for (let i = 0; i < +R; i++) procs.push(run('reader', i));
  const out = await Promise.all(procs);
  const w = out.filter((o) => o.role === 'writer'), r = out.filter((o) => o.role === 'reader');
  let finalRows = null;
  if (kind === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync('tmp/store.db');
    finalRows = db.prepare("SELECT count(*) n FROM worktree_state WHERE worktree LIKE 'w-%'").get().n;
    db.close();
  } else {
    const j = JSON.parse(fs.readFileSync('tmp/store.json', 'utf8'));
    finalRows = Object.keys(j.worktrees).filter((k) => k.startsWith('w-')).reduce((n, k) => n + Object.keys(j.worktrees[k]).length, 0);
  }
  console.log(JSON.stringify({
    kind, writers: +W, readers: +R, expectedRows: +W * TX * ROWS, finalRows,
    writerTxP50: pct(w.flatMap((o) => o.lat), 0.5), writerTxP99: pct(w.flatMap((o) => o.lat), 0.99),
    writerErrors: w.reduce((n, o) => n + o.errors, 0), writerSample: w[0]?.errSample,
    reads: r.reduce((n, o) => n + o.lat.length, 0), readP50: pct(r.flatMap((o) => o.lat), 0.5), readP99: pct(r.flatMap((o) => o.lat), 0.99),
    readErrors: r.reduce((n, o) => n + o.errors, 0), readSample: r.find((o) => o.errSample)?.errSample,
  }));
  process.exit(0);
}

const lat = []; let errors = 0, errSample;
const fail = (e) => { errors++; errSample ??= String(e.code ?? '') + ' ' + String(e.message).slice(0, 80); };

if (kind === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  if (role === 'writer') {
    const db = new DatabaseSync('tmp/store.db', { timeout: 5000 });
    db.exec('PRAGMA synchronous=NORMAL');
    const up = db.prepare('INSERT OR REPLACE INTO worktree_state VALUES (?,?,?)');
    for (let t = 0; t < TX; t++) {
      const t0 = now();
      try {
        db.exec('BEGIN IMMEDIATE');
        for (let k = 0; k < ROWS; k++) up.run(`w-${idx}`, `check-${t}-${k}`, `fp-${t}`);
        db.exec('COMMIT');
      } catch (e) { fail(e); try { db.exec('ROLLBACK'); } catch {} }
      lat.push(now() - t0);
    }
  } else {
    const end = now() + READ_MS;
    while (now() < end) {
      const t0 = now();
      try {
        const db = new DatabaseSync('tmp/store.db', { readOnly: true, timeout: 50 });
        db.prepare("SELECT count(*) n FROM worktree_state WHERE worktree = 'wt1'").get();
        db.close();
      } catch (e) { fail(e); }
      lat.push(now() - t0);
    }
  }
} else {
  const locked = kind === 'json-lock';
  const lock = () => { for (;;) { try { return fs.openSync('tmp/store.lock', 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; } } };
  if (role === 'writer') {
    for (let t = 0; t < TX; t++) {
      const t0 = now();
      let fd;
      try {
        if (locked) fd = lock();
        const j = JSON.parse(fs.readFileSync('tmp/store.json', 'utf8'));
        const mine = (j.worktrees[`w-${idx}`] ??= {});
        for (let k = 0; k < ROWS; k++) mine[`check-${t}-${k}`] = `fp-${t}`;
        const tmp = `tmp/store.json.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(j));
        fs.renameSync(tmp, 'tmp/store.json');
      } catch (e) { fail(e); }
      if (locked) { fs.closeSync(fd); fs.unlinkSync('tmp/store.lock'); }
      lat.push(now() - t0);
    }
  } else {
    const end = now() + READ_MS;
    while (now() < end) {
      const t0 = now();
      try { JSON.parse(fs.readFileSync('tmp/store.json', 'utf8')).worktrees.wt1; } catch (e) { fail(e); }
      lat.push(now() - t0);
    }
  }
}
process.stdout.write(JSON.stringify({ role, lat, errors, errSample }));
