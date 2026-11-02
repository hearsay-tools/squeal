// Throwaway (019-01): per project, the runs and runner wall time in a store,
// opened read-only, split by edit-driven (no checkpoint) and checkpoint runs,
// plus failing results per project. Usage: node aggregate.mjs <store.sqlite> [days]
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const days = Number(process.argv[3] ?? 7);
const since = Date.now() - days * 86400000;
const rows = db.prepare("SELECT test_files, started_at, ended_at, end_state, checkpoint_id FROM runs WHERE started_at >= ?").all(since);
const per = {}; let mixed = 0;
for (const r of rows) {
  const files = JSON.parse(r.test_files);
  const projects = [...new Set(files.map((f) => f.project))];
  if (projects.length > 1) mixed++;
  const p = projects.join("+");
  const k = r.checkpoint_id === null ? "edit" : "checkpoint";
  const e = (per[p] ??= { edit: { runs: 0, files: 0, wallS: 0 }, checkpoint: { runs: 0, files: 0, wallS: 0 } })[k];
  e.runs++; e.files += files.length;
  if (r.ended_at !== null) e.wallS += (r.ended_at - r.started_at) / 1000;
}
const out = Object.entries(per).map(([p, v]) => ({ project: p, editRuns: v.edit.runs, editFileRuns: v.edit.files, editWallS: Math.round(v.edit.wallS), ckptRuns: v.checkpoint.runs, ckptFileRuns: v.checkpoint.files, ckptWallS: Math.round(v.checkpoint.wallS) }));
out.sort((a, b) => b.editWallS - a.editWallS);
console.log(`runs since ${new Date(since).toISOString()}: ${rows.length}; runs mixing projects: ${mixed}`);
console.table(out);
const fails = db.prepare(`SELECT c.project, count(*) n, count(DISTINCT r.check_id || ':' || coalesce(r.fingerprint,'')) distinct_failures,
  count(DISTINCT r.worktree_id) worktrees FROM results r JOIN checks c ON c.id = r.check_id
  WHERE r.outcome = 'fail' AND c.kind = 'test' AND r.recorded_at >= ? GROUP BY c.project ORDER BY n DESC`);
try { console.table(fails.all(since)); } catch (e) { console.log("fail query:", e.message); }
