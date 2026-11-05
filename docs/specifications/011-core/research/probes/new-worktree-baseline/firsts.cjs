// 011-299 probe (throwaway): every file run of a worktree's first baseline in the window.
// Usage: node firsts.cjs <store copy> <fromISO> <toISO> > firsts.jsonl
// A first baseline is the worktree's first `baseline` checkpoint in the store (as load-split's baseline.cjs).
// One line per (run of that checkpoint, file): recorded seconds (report.json fileDurations; node:test runs keep
// none: the stored durations), whether the file ended, the keys and commit the run left in `results`.
// A last line {summary} counts baselines, files listed and baselines that listed none.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, fromIso, toIso] = process.argv;
const T0 = Date.parse(fromIso), T1 = Date.parse(toIso);
const db = new DatabaseSync(storePath, { readOnly: true });
const fid = (f) => f.project + "\0" + f.path;
const rowsOfRun = db.prepare("select r.key, r.commit_sha, r.dirty, r.revision, r.recorded_at, r.duration_ms, r.outcome, c.project, c.test_path from results r join checks c on c.id = r.check_id where r.run_id = ?");
const runsOf = db.prepare("select * from runs where checkpoint_id = ? order by started_at");
const live = new Set(db.prepare("select id from worktrees").all().map((w) => w.id));
const cps = db.prepare("select * from checkpoints where kind = 'baseline' order by started_at").all();
const seen = new Set();
const sum = { baselines: 0, listed: 0, listedNone: 0, ends: {} };
for (const c of cps) {
  const first = !seen.has(c.worktree_id); seen.add(c.worktree_id);
  if (!first || c.started_at < T0 || c.started_at >= T1) continue;
  const listed = JSON.parse(c.test_files);
  sum.baselines++; sum.listed += listed.length; if (listed.length === 0) sum.listedNone++;
  sum.ends[c.end_state] = (sum.ends[c.end_state] ?? 0) + 1;
  for (const r of runsOf.all(c.id)) {
    let rep = null;
    try { rep = JSON.parse(fs.readFileSync(r.log_dir + "/report.json", "utf8")).report; } catch {}
    const dur = new Map((rep?.fileDurations ?? []).map((d) => [fid(d.testFile), d.durationMs / 1000]));
    const rows = new Map();
    for (const x of rowsOfRun.all(r.id)) { const k = x.project + "\0" + x.test_path; (rows.get(k) ?? rows.set(k, []).get(k)).push(x); }
    if (rep === null) for (const [k, rs] of rows) dur.set(k, rs.reduce((s, x) => s + x.duration_ms, 0) / 1000);
    // the run's commit, from any of its rows
    let commit = null, dirty = null;
    for (const rs of rows.values()) { commit = rs[0].commit_sha; dirty = rs[0].dirty; break; }
    for (const f of JSON.parse(r.test_files)) {
      const k = fid(f), rs = rows.get(k) ?? [];
      console.log(JSON.stringify({ ck: c.id, W: c.worktree_id, live: live.has(c.worktree_id), T: c.started_at, ckEnd: c.end_state,
        run: r.id, rs: r.started_at, re: r.ended_at, runEnd: rep?.end ?? r.end_state, file: k, ended: dur.has(k), sec: dur.get(k) ?? 0,
        keys: [...new Set(rs.map((x) => x.key))], fail: rs.some((x) => x.outcome === "fail"), commit: rs[0]?.commit_sha ?? null,
        dirty: rs[0]?.dirty ?? null, rev: rs[0]?.revision ?? r.revision, ckRev: c.revision, runCommit: commit, runDirty: dirty }));
    }
  }
}
console.log(JSON.stringify({ summary: sum }));
