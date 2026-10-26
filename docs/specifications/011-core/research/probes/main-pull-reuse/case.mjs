// Throwaway, read-only. One test file's closure hashes and keys in main and one other worktree.
// Usage: node case.mjs <store.sqlite> <main id> <other id> <project> [limit]
import { DatabaseSync } from 'node:sqlite';
const [store, main, other, project, limit = '3'] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const h = db.prepare(`select hash from file_hashes where worktree_id=? and path=?`);
const k = db.prepare(`select key, revision, pending from test_file_keys where worktree_id=? and project=? and path=?`);
let shown = 0;
for (const { path, closure_paths } of db.prepare(`select path, closure_paths from test_files where project=?`).all(project)) {
  const cl = JSON.parse(closure_paths);
  const km = k.get(main, project, path), ko = k.get(other, project, path);
  if (!km || !ko || km.key === ko.key) continue;
  const rows = cl.map((p) => [p, h.get(main, p)?.hash?.slice(0, 8) ?? '-', h.get(other, p)?.hash?.slice(0, 8) ?? '-']);
  if (rows.some(([, a, b]) => a !== b)) continue;
  console.log(path, JSON.stringify({ km: km.key.slice(0, 8), ko: ko.key.slice(0, 8), revO: ko.revision, pendO: ko.pending }), rows.length, 'paths', JSON.stringify(rows.slice(0, 6)));
  if (++shown >= Number(limit)) break;
}
