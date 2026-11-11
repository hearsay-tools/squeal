// Throwaway (row 021-06). One JSON line per ended run of one project, from a store copy and a copy of its runs'
// report.json files, read only. As 011 probes/load-slowdown/extract-runs.mjs, plus the run's picked files (`test_files`)
// so the replay can tell when a later revision made a queued file stale.
// Usage: node extract.mjs <project> <store copy> <runs copy> >> runs.jsonl
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , project, path, logs] = process.argv;
const db = new DatabaseSync(path, { readOnly: true });
const roots = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const cps = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const key = (f) => (f.project ? f.project + ":" : "") + f.path;
for (const r of db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL ORDER BY started_at").iterate()) {
  let rep = null;
  try { rep = JSON.parse(readFileSync(`${logs}/${r.log_dir.split("/").pop()}/report.json`, "utf8")).report; } catch { /* no report */ }
  const picked = JSON.parse(r.test_files).map(key);
  console.log(JSON.stringify({
    project, id: r.id, wt: r.worktree_id, root: roots.get(r.worktree_id) ?? null, revision: r.revision,
    cp: r.checkpoint_id ? cps.get(r.checkpoint_id) ?? "gone" : null, start: r.started_at, end: r.ended_at, state: r.end_state,
    picked, report: !!rep, failure: rep?.failure ? 1 : 0,
    files: (rep?.fileDurations ?? []).map((d) => [key(d.testFile), Math.round(d.durationMs)]),
  }));
}
