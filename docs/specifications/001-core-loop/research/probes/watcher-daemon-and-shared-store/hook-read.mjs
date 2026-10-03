// THROWAWAY PROBE. Not product code. See README.md.
// Simulates a hook script: cold process, read current failures for one worktree, print JSON, exit.
const mode = process.argv[2];
let out;
if (mode === 'baseline') {
  out = {};
} else if (mode === 'node-sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync('tmp/store.db', { readOnly: true, timeout: 50 });
  out = db.prepare(`SELECT r.check_id, r.state, r.revision, r.message FROM worktree_state w
    JOIN result r ON r.check_id = w.check_id AND r.fingerprint = w.fingerprint
    WHERE w.worktree = ? AND r.state = 'fail'`).all('wt1');
  db.close();
} else if (mode === 'better-sqlite3') {
  const { default: D } = await import('better-sqlite3');
  const db = new D('tmp/store.db', { readonly: true, timeout: 50 });
  out = db.prepare(`SELECT r.check_id, r.state, r.revision, r.message FROM worktree_state w
    JOIN result r ON r.check_id = w.check_id AND r.fingerprint = w.fingerprint
    WHERE w.worktree = ? AND r.state = 'fail'`).all('wt1');
  db.close();
} else if (mode === 'json') {
  const fs = await import('node:fs');
  const all = JSON.parse(fs.readFileSync('tmp/store.json', 'utf8'));
  out = Object.entries(all.worktrees.wt1).filter(([, v]) => v.state === 'fail');
}
process.stdout.write(JSON.stringify({ n: Array.isArray(out) ? out.length : 0 }) + '\n');
