// Throwaway, read-only: consecutive own runs of one slow file at different keys in one worktree,
// counted by the previous and next file outcome. Usage: node reruns.mjs <store.sqlite> <test_path LIKE>
import { DatabaseSync } from "node:sqlite";
const [store, like] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const wt = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root.replace(/.*\//, "").slice(0, 12)]));
const c = {}, perWt = {};
for (const f of db.prepare("SELECT id FROM checks WHERE kind = 'file' AND test_path LIKE ?").all(like)) {
  const rows = db.prepare("SELECT key, outcome, worktree_id w FROM results WHERE check_id = ? ORDER BY recorded_at").all(f.id);
  const last = new Map();
  for (const r of rows) {
    const p = last.get(r.w);
    if (p && p.key !== r.key) {
      const k = `${p.outcome}->${r.outcome}`;
      c[k] = (c[k] ?? 0) + 1;
      perWt[wt.get(r.w)] = (perWt[wt.get(r.w)] ?? 0) + 1;
    }
    last.set(r.w, r);
  }
}
console.log(JSON.stringify({ byOutcome: c, byWorktree: perWt }));
