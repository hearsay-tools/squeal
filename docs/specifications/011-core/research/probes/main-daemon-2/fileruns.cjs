// 011-300 probe (throwaway): every file run that started in the window, with its trigger shape.
// Usage: node fileruns.cjs <store copy> <fromISO> <toISO> > fileruns.jsonl
// From 011-299's firsts.cjs, widened to all runs. Per (run, file): recorded seconds (report.json fileDurations;
// without a report the stored durations), whether it ended, the commit and dirty flag of its rows (or of the run's
// other rows), the worktree, whether the worktree is the main checkout, and the run's checkpoint kind:
// "first" (the worktree's first baseline), "restart" (a later baseline), "run-all", or "none".
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, fromIso, toIso] = process.argv;
const T0 = Date.parse(fromIso), T1 = Date.parse(toIso);
const db = new DatabaseSync(storePath, { readOnly: true });
const fid = (f) => f.project + "\0" + f.path;
const rowsOfRun = db.prepare("select r.commit_sha, r.dirty, r.revision, r.duration_ms, c.project, c.test_path from results r join checks c on c.id = r.check_id where r.run_id = ?");
const main = new Set(db.prepare("select id from worktrees where is_main = 1").all().map((w) => w.id));
const cpKind = new Map();
const seen = new Set();
for (const c of db.prepare("select id, worktree_id, kind, started_at from checkpoints order by started_at").all()) {
  if (c.kind === "baseline") { cpKind.set(c.id, { kind: seen.has(c.worktree_id) ? "restart" : "first", T: c.started_at }); seen.add(c.worktree_id); }
  else cpKind.set(c.id, { kind: c.kind, T: c.started_at });
}
const revHead = db.prepare("select head, dirty from revisions where worktree_id = ? and number = ?");
for (const r of db.prepare("select * from runs where started_at >= ? and started_at < ? order by started_at").all(T0, T1)) {
  let rep = null;
  try { rep = JSON.parse(fs.readFileSync(r.log_dir + "/report.json", "utf8")).report; } catch {}
  const dur = new Map((rep?.fileDurations ?? []).map((d) => [fid(d.testFile), d.durationMs / 1000]));
  const rows = new Map();
  for (const x of rowsOfRun.all(r.id)) { const k = x.project + "\0" + x.test_path; (rows.get(k) ?? rows.set(k, []).get(k)).push(x); }
  if (rep === null) for (const [k, rs] of rows) dur.set(k, rs.reduce((s, x) => s + x.duration_ms, 0) / 1000);
  let commit = null, dirty = null;
  for (const rs of rows.values()) { commit = rs[0].commit_sha; dirty = rs[0].dirty; break; }
  if (commit === null) { const h = revHead.get(r.worktree_id, r.revision); if (h) { commit = h.head; dirty = h.dirty; } }
  const cp = r.checkpoint_id ? cpKind.get(r.checkpoint_id) : null;
  for (const f of JSON.parse(r.test_files)) {
    const k = fid(f), rs = rows.get(k) ?? [];
    console.log(JSON.stringify({ run: r.id, W: r.worktree_id, main: main.has(r.worktree_id), cp: r.checkpoint_id, kind: cp?.kind ?? "none", T: cp?.T ?? null,
      rs: r.started_at, re: r.ended_at, file: k, ended: dur.has(k), sec: dur.get(k) ?? 0,
      commit: rs[0]?.commit_sha ?? commit, dirty: rs[0]?.dirty ?? dirty }));
  }
}
