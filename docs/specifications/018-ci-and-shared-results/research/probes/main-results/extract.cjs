// main-results probe (throwaway): one JSON line per ended file run of one project since FROM, from a store copy and a
// copy of its runs' report.json files, read only.
// Usage: node extract.cjs <store copy> <runs copy> <fromISO> <exclude worktree root substring> > runs.jsonl
// Each line: run id, worktree, start/end, tier kind, the file, its seconds (report.json fileDurations; else the
// stored durations of the run's surviving rows), and the run's commit and dirty flag: from the revision row when it
// still exists, else from any surviving `results` row of the run (a run runs at one revision).
// Tier kind (the run row does not record it): `baseline` and `run-all` from the checkpoint; with no checkpoint,
// `edit` when it is the first run of its worktree and revision and lists at most 4 files (load-slowdown.md's rule),
// else `background` (catch-up after a HEAD move, and backlog).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, logs, fromIso, exclude] = process.argv;
const T0 = Date.parse(fromIso);
const db = new DatabaseSync(storePath, { readOnly: true });
const roots = new Map(db.prepare("select id, root from worktrees").all().map((w) => [w.id, w.root]));
const cps = new Map(db.prepare("select id, kind from checkpoints").all().map((c) => [c.id, c.kind]));
const rev = db.prepare("select head, dirty, trigger from revisions where worktree_id = ? and number = ?");
const rowsOfRun = db.prepare("select r.commit_sha, r.dirty, r.duration_ms, c.project, c.test_path from results r join checks c on c.id = r.check_id where r.run_id = ?");
const firstOfRev = new Set();
const runs = db.prepare("select * from runs where ended_at is not null and started_at >= ? order by started_at").all(T0);
const sum = { runs: 0, excluded: 0, noReport: 0 };
for (const r of runs) {
  const root = roots.get(r.worktree_id) ?? null;
  if (exclude && root && root.includes(exclude)) { sum.excluded++; continue; }
  sum.runs++;
  const files = JSON.parse(r.test_files);
  const wr = r.worktree_id + "\0" + r.revision;
  let kind = r.checkpoint_id ? cps.get(r.checkpoint_id) ?? "gone" : null;
  if (kind === null) kind = !firstOfRev.has(wr) && files.length <= 4 ? "edit" : "background";
  firstOfRev.add(wr);
  let rep = null;
  try { rep = JSON.parse(fs.readFileSync(`${logs}/${r.log_dir.split("/").pop()}/report.json`, "utf8")).report; } catch { sum.noReport++; }
  const rows = rowsOfRun.all(r.id);
  const v = rev.get(r.worktree_id, r.revision);
  let commit = v?.head ?? null, dirty = v ? v.dirty : null, src = v ? "revision" : null;
  if (commit === null && rows.length > 0) { commit = rows[0].commit_sha; dirty = rows[0].dirty; src = "results"; }
  const dur = new Map();
  for (const d of rep?.fileDurations ?? []) dur.set(d.testFile.project + "\0" + d.testFile.path, d.durationMs / 1000);
  if (rep === null) for (const x of rows) { const k = x.project + "\0" + x.test_path; dur.set(k, (dur.get(k) ?? 0) + x.duration_ms / 1000); }
  for (const [file, sec] of dur) {
    process.stdout.write(JSON.stringify({ run: r.id, W: r.worktree_id, main: root !== null && !root.includes("/.ai/cezar/worktrees/"), rs: r.started_at, re: r.ended_at, kind, n: files.length, file, sec, commit, dirty, src, rev: r.revision }) + "\n");
  }
}
process.stderr.write(JSON.stringify(sum) + "\n");
