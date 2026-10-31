// Throwaway probe (018-03). Writes one results document per worktree row of a
// COPIED store (read-only): the worktree's keyed test files, each key with its
// checks' kind, name, outcome, duration and failure id, sorted. These stand in
// for "the results of one main commit" in git-ref.sh.
// Usage: node export-sets.mjs <copy/store.sqlite> <out-dir>
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
const [, , file, out] = process.argv;
mkdirSync(out, { recursive: true });
const db = new DatabaseSync(file, { readOnly: true });
const wts = db.prepare(`SELECT k.worktree_id, COUNT(*) n, MAX(w.registered_at) at FROM test_file_keys k
  JOIN worktrees w ON w.id = k.worktree_id WHERE k.key IS NOT NULL GROUP BY k.worktree_id
  HAVING n >= 1000 ORDER BY at`).all();
const keysOf = db.prepare("SELECT project, path, key FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL ORDER BY project, path");
const rows = db.prepare(`SELECT c.kind, c.full_name, r.outcome, r.duration_ms, r.failure_id FROM results r
  JOIN checks c ON c.id = r.check_id WHERE r.key = ? ORDER BY c.kind, c.full_name`);
let i = 0;
for (const w of wts) {
  const doc = {};
  for (const k of keysOf.all(w.worktree_id)) {
    const r = rows.all(k.key);
    if (r.length) doc[k.key] = r.map((x) => [x.kind, x.full_name, x.outcome, Math.round(x.duration_ms), x.failure_id]);
  }
  writeFileSync(`${out}/${String(i++).padStart(2, "0")}.json`, JSON.stringify(doc, null, 0).replace(/\],"/g, '],\n"'));
}
console.log(JSON.stringify({ sets: i }));
