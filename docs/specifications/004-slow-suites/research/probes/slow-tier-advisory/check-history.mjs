// Throwaway, read-only: one test file's results, transitions and runs in a Squeal store,
// for worktrees whose root matches a pattern. Opens the store readOnly.
// Usage: node check-history.mjs <store.sqlite> <test-path-substring> [worktree-root-substring]
import { DatabaseSync } from "node:sqlite";

const [store, test, wt = ""] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(5, 19).replace("T", " ") : "-");
const wts = db.prepare("SELECT id, root FROM worktrees WHERE root LIKE ?").all(`%${wt}%`);
const ids = new Map(wts.map((w) => [w.id, w.root.split("/").pop()]));
const checks = db.prepare("SELECT id, project, test_path, kind, full_name FROM checks WHERE test_path LIKE ?").all(`%${test}%`);
for (const c of checks) {
  console.log(`\n# ${c.id} [${c.project}] ${c.test_path} > ${c.full_name} (${c.kind})`);
  for (const r of db.prepare("SELECT outcome, revision, worktree_id, recorded_at, duration_ms, key, run_id FROM results WHERE check_id = ? ORDER BY recorded_at").all(c.id))
    if (ids.has(r.worktree_id)) console.log(`  result ${iso(r.recorded_at)} ${ids.get(r.worktree_id)} r${r.revision} ${r.outcome} ${Math.round(r.duration_ms)}ms key=${r.key.slice(0, 10)} run=${r.run_id.slice(0, 8)}`);
  for (const t of db.prepare("SELECT kind, from_outcome, to_outcome, revision, at, worktree_id FROM transitions WHERE check_id = ? ORDER BY at").all(c.id))
    if (ids.has(t.worktree_id)) console.log(`  transition ${iso(t.at)} ${ids.get(t.worktree_id)} r${t.revision} ${t.kind} ${t.from_outcome} -> ${t.to_outcome}`);
  for (const k of db.prepare("SELECT outcome, validity, observed_at, origin_kind, worktree_id FROM known_states WHERE check_id = ?").all(c.id))
    if (ids.has(k.worktree_id)) console.log(`  known ${ids.get(k.worktree_id)} ${k.outcome} ${k.validity} observed ${iso(k.observed_at)} origin=${k.origin_kind}`);
}
