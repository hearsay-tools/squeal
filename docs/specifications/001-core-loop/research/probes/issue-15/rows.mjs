// Throwaway: the stored `results` rows of the probe's check, read-only.
// Usage: node rows.mjs <store.sqlite> [marker]
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const roots = Object.fromEntries(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const rows = db
  .prepare(
    `SELECT r.key, r.worktree_id, r.run_id, r.recorded_at FROM results r JOIN checks c ON c.id = r.check_id
     WHERE c.kind = 'test' ORDER BY r.recorded_at`,
  )
  .all();
console.log(`${rows.length} rows in results for the test check (one per key)`);
for (const r of rows)
  console.log(`${r.key.slice(0, 12)} ${roots[r.worktree_id]?.split("/").at(-1)} run=${r.run_id.slice(0, 8)} at=${r.recorded_at}`);

// What else of A's run the store keeps once its row is gone.
const [marker] = process.argv.slice(3);
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'failure-producers:%'").all())
  console.log(`meta ${m.key}: ${m.value}`);
const runIds = rows.map((r) => r.run_id);
for (const run of db.prepare("SELECT * FROM runs").all())
  if (!runIds.includes(run.id) && run.worktree_id !== undefined)
    console.log(`run with no stored test result: ${run.id} worktree=${roots[run.worktree_id]?.split("/").at(-1)} logDir=${run.log_dir}`);
if (marker !== undefined) {
  const texts = db.prepare("SELECT id FROM failure_texts WHERE errors LIKE ?").all(`%${marker}%`);
  console.log(`failure_texts rows carrying ${marker}: ${texts.length}`);
}
