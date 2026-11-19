// Throwaway (row 021-19). One JSON line per ended run since <from ISO> of one
// project, as ../../cpu-budget/extract.mjs, plus the revision's creation time
// and trigger. The store's rows are copied in one read transaction of a
// read-only connection (a consistent snapshot; no write lock, no copy of the
// 6 GB file); each run's report.json is read in place, read-only.
// Usage: node extract.mjs <project> <store> <runs dir> <from ISO> >> runs.jsonl
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , project, path, logs, fromIso] = process.argv;
const from = Date.parse(fromIso);
const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
db.exec("BEGIN");
const roots = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const cps = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const rev = db.prepare("SELECT trigger, created_at FROM revisions WHERE worktree_id = ? AND number = ?");
const rows = db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL AND started_at >= ? ORDER BY started_at").all(from)
  .map((r) => ({ r, v: rev.get(r.worktree_id, r.revision) }));
db.exec("COMMIT");
db.close();
const key = (f) => (f.project ? f.project + ":" : "") + f.path;
for (const { r, v } of rows) {
  let rep = null;
  try { rep = JSON.parse(readFileSync(`${logs}/${r.log_dir.split("/").pop()}/report.json`, "utf8")).report; } catch { /* no report */ }
  console.log(JSON.stringify({
    project, id: r.id, wt: r.worktree_id, root: roots.get(r.worktree_id) ?? null, revision: r.revision,
    trigger: v?.trigger ?? null, revAt: v?.created_at ?? null,
    cp: r.checkpoint_id ? cps.get(r.checkpoint_id) ?? "gone" : null, start: r.started_at, end: r.ended_at, state: r.end_state,
    picked: JSON.parse(r.test_files).map(key), report: !!rep, failure: rep?.failure ? 1 : 0,
    files: (rep?.fileDurations ?? []).map((d) => [key(d.testFile), Math.round(d.durationMs)]),
  }));
}
