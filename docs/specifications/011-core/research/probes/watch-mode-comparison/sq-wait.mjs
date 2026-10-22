// Passive Squeal timer (011-119): reads the scratch store every 100 ms, sends nothing to the daemon.
// Usage: node sq-wait.mjs <clone root> <edited path> <t0 epoch s> <timeout s> <test file>...
// Prints one JSON line: the edit's revision, when each named file was current at a key computed at or
// after it (pending null, a result stored at that key), its outcome, and when nothing was pending at all.
import { DatabaseSync } from 'node:sqlite';
const [root, edited, t0s, tos, ...files] = process.argv.slice(2);
const t0 = Number(t0s) * 1000, deadline = Date.now() + Number(tos) * 1000;
const db = new DatabaseSync(`${root}/.git/squeal/store.sqlite`, { readOnly: true });
db.exec('PRAGMA busy_timeout = 2000');
const wt = db.prepare('SELECT id FROM worktrees WHERE root = ?').get(root)?.id;
const rev = db.prepare(`SELECT number, created_at FROM revisions WHERE worktree_id = ? AND created_at >= ? AND changes LIKE ? ORDER BY number LIMIT 1`);
const key = db.prepare('SELECT key, revision, pending FROM test_file_keys WHERE worktree_id = ? AND path = ?');
const res = db.prepare(`SELECT r.outcome, r.recorded_at, r.run_id FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key = ? AND c.test_path = ?`);
const pend = db.prepare(`SELECT count(*) n FROM test_file_keys WHERE worktree_id = ? AND pending IS NOT NULL`);
const out = { rev: null, revAt: null, files: {}, idleAt: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (Date.now() < deadline) {
  try {
    if (out.rev === null) { const r = rev.get(wt, t0 - 2000, `%"${edited}"%`); if (r) { out.rev = r.number; out.revAt = r.created_at / 1000; } }
    if (out.rev !== null) {
      for (const f of files) {
        if (out.files[f]) continue;
        const k = key.get(wt, f);
        if (!k || k.key === null || k.pending !== null || k.revision < out.rev) continue;
        const rows = res.all(k.key, f);
        if (rows.length === 0) continue;
        out.files[f] = { at: Date.now() / 1000, outcome: rows.some((x) => x.outcome === 'fail') ? 'fail' : 'pass',
          storedAt: Math.max(...rows.map((x) => x.recorded_at)) / 1000, run: rows[0].run_id, keyRev: k.revision };
      }
      if (Object.keys(out.files).length === files.length && pend.get(wt).n === 0) { out.idleAt = Date.now() / 1000; break; }
    }
  } catch (e) { out.err = String(e); }
  await sleep(100);
}
console.log(JSON.stringify(out));
