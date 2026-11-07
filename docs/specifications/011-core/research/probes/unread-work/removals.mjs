// Worktree removal times from copies of Cezar's task databases (runs.db), read only. One JSON line per task with a
// worktree: its path, created/finished times, the destroy request time and phase, the reclaim time, and whether the
// path exists now. Usage: node removals.mjs <runs.db copy>... > removals.jsonl
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
for (const path of process.argv.slice(2)) {
  const db = new DatabaseSync(path, { readOnly: true });
  for (const r of db.prepare("SELECT id, created_at, finished_at, status, worktree_path, data FROM runs WHERE worktree_path IS NOT NULL").iterate()) {
    let d = {};
    try { d = JSON.parse(r.data); } catch { /* none */ }
    const ms = (s) => (s ? Date.parse(s) : null);
    console.log(JSON.stringify({
      task: r.id, root: r.worktree_path, created: ms(r.created_at), finished: ms(r.finished_at), status: r.status,
      destroyAt: ms(d.delegation?.destroy?.requestedAt), destroyPhase: d.delegation?.destroy?.phase ?? null,
      reclaimedAt: ms(d.worktreeReclaimedAt), exists: existsSync(r.worktree_path),
    }));
  }
}
