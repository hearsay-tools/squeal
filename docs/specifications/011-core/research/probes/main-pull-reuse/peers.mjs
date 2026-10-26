// Throwaway, read-only. For every other worktree, count test files whose closure file hashes
// equal main's (per file_hashes) and whether the stored current keys are equal too.
// Usage: node peers.mjs <store.sqlite> <main worktree id>
import { DatabaseSync } from 'node:sqlite';
const [store, main] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const hashes = (w) => new Map(db.prepare(`select path, hash from file_hashes where worktree_id=?`).all(w).map((r) => [r.path, r.hash]));
const keys = (w) => new Map(db.prepare(`select project||char(0)||path id, key, revision, pending from test_file_keys where worktree_id=?`).all(w).map((r) => [r.id, r]));
const closures = new Map(db.prepare(`select project||char(0)||path id, closure_paths from test_files`).all().map((r) => [r.id, JSON.parse(r.closure_paths)]));
const mh = hashes(main), mk = keys(main);
const wts = db.prepare(`select w.id, w.root, w.daemon_version v, (select max(number) from revisions where worktree_id=w.id) rev,
  (select head from revisions r where r.worktree_id=w.id order by number desc limit 1) head from worktrees w where w.id<>?`).all(main);
for (const w of wts) {
  const wh = hashes(w.id), wk = keys(w.id);
  if (!wk.size) continue;
  const t = { sameContentSameKey: 0, sameContentDiffKey: 0, diffContentSameKey: 0, diffContentDiffKey: 0, byProject: {} };
  for (const [id, m] of mk) {
    const o = wk.get(id); if (!o || !o.key) continue;
    const cl = closures.get(id) ?? [];
    const same = cl.every((p) => mh.get(p) !== undefined && mh.get(p) === wh.get(p));
    const sk = o.key === m.key;
    const k = (same ? 'sameContent' : 'diffContent') + (sk ? 'SameKey' : 'DiffKey');
    t[k]++;
    if (same && !sk) { const p = id.split('\0')[0]; t.byProject[p] = (t.byProject[p] ?? 0) + 1; }
  }
  console.log(JSON.stringify({ id: w.id, root: w.root.replace(/.*\//, ''), v: w.v, rev: w.rev, head: w.head?.slice(0, 9), ...t }));
}
