// One JSON line per ended run of one project, from a store copy and a copy of its runs' report.json files, read only.
// Usage: node extract.mjs <project> <store copy> <runs copy> >> runs.jsonl
// Adds to ../load-slowdown/extract-runs.mjs: per completed file, the surviving result rows of this run for that file
// (key, max last_used_at, recorded_at), and how many OTHER worktrees hold that key now (test_file_keys).
// Also one {"wt": ...} line per worktree with its root and last heartbeat.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , project, path, logs] = process.argv;
const db = new DatabaseSync(path, { readOnly: true });
const wts = db.prepare("SELECT id, root, is_main, registered_at, daemon_started_at, daemon_heartbeat_at FROM worktrees").all();
const roots = new Map(wts.map((w) => [w.id, w.root]));
for (const w of wts) console.log(JSON.stringify({ project, worktree: w }));
const cps = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const rev = db.prepare("SELECT head, dirty, trigger, created_at FROM revisions WHERE worktree_id = ? AND number = ?");
// Surviving result rows by run and file.
const byRun = new Map();
for (const r of db.prepare(`SELECT r.run_id, c.project p, c.test_path f, r.key, max(r.last_used_at) lu, min(r.recorded_at) rec,
    sum(r.outcome = 'fail') fails FROM results r JOIN checks c ON c.id = r.check_id GROUP BY r.run_id, c.project, c.test_path, r.key`).iterate()) {
  let m = byRun.get(r.run_id);
  if (!m) byRun.set(r.run_id, (m = new Map()));
  m.set((r.p ? r.p + ":" : "") + r.f, [r.key, r.lu, r.rec, r.fails]);
}
const holders = new Map();
for (const k of db.prepare("SELECT worktree_id w, key FROM test_file_keys WHERE key IS NOT NULL").iterate()) {
  let s = holders.get(k.key);
  if (!s) holders.set(k.key, (s = new Set()));
  s.add(k.w);
}
for (const r of db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL ORDER BY started_at").iterate()) {
  let rep = null;
  try { rep = JSON.parse(readFileSync(`${logs}/${r.log_dir.split("/").pop()}/report.json`, "utf8")).report; } catch { /* none */ }
  const v = rev.get(r.worktree_id, r.revision);
  const rows = byRun.get(r.id) ?? new Map();
  const files = (rep?.fileDurations ?? []).map((d) => {
    const id = (d.testFile.project ? d.testFile.project + ":" : "") + d.testFile.path;
    const row = rows.get(id);
    const others = row ? [...(holders.get(row[0]) ?? [])].filter((w) => w !== r.worktree_id).length : null;
    return [id, Math.round(d.durationMs), row ? row[1] : null, row ? row[2] : null, row ? row[3] : null, others];
  });
  console.log(JSON.stringify({
    project, id: r.id, wt: r.worktree_id, root: roots.get(r.worktree_id) ?? null, revision: r.revision,
    trigger: v?.trigger ?? null, cp: r.checkpoint_id ? cps.get(r.checkpoint_id) ?? "gone" : null,
    start: r.started_at, end: r.ended_at, state: r.end_state, picked: JSON.parse(r.test_files).length, report: !!rep,
    failure: rep?.failure ? String(rep.failure).split("\n")[0].slice(0, 120) : null, files,
  }));
}
