// One JSON line per run of one project, from a store copy and a copy of its runs' report.json files, read only.
// Usage: node extract-runs.mjs <project name> <store copy> <runs copy> >> runs.jsonl
// Each line: the run's times, worktree, checkpoint kind, revision facts (when the revision row still exists),
// and each completed file's module duration from report.json (src/runners/vitest/reporter.ts, moduleDuration).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , project, path, logs] = process.argv;
const db = new DatabaseSync(path, { readOnly: true });
const roots = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const cps = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const rev = db.prepare("SELECT head, dirty, trigger, created_at FROM revisions WHERE worktree_id = ? AND number = ?");
const prevRev = db.prepare("SELECT max(created_at) t FROM revisions WHERE worktree_id = ? AND number <= ?");
for (const r of db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL ORDER BY started_at").all()) {
  let rep = null;
  try { rep = JSON.parse(readFileSync(`${logs}/${r.log_dir.split("/").pop()}/report.json`, "utf8")).report; } catch { /* no report */ }
  const v = rev.get(r.worktree_id, r.revision);
  const files = JSON.parse(r.test_files);
  console.log(JSON.stringify({
    project, id: r.id, wt: r.worktree_id, root: roots.get(r.worktree_id) ?? null, revision: r.revision,
    head: v?.head ?? null, dirty: v ? v.dirty : null, trigger: v?.trigger ?? null, revAt: v?.created_at ?? null,
    cp: r.checkpoint_id ? cps.get(r.checkpoint_id) ?? "gone" : null, start: r.started_at, end: r.ended_at, state: r.end_state,
    picked: files.length, report: !!rep, failure: rep?.failure ? String(rep.failure).split("\n")[0].slice(0, 120) : null,
    files: (rep?.fileDurations ?? []).map((d) => [(d.testFile.project ? d.testFile.project + ":" : "") + d.testFile.path, Math.round(d.durationMs)]),
  }));
}
