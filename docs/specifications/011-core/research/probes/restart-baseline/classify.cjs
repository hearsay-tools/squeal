// 011-298 probe (throwaway): why each file a restart baseline ran missed its lookup.
// Usage: node classify.cjs <store copy> <fromISO> <toISO> > out.jsonl
// A restart baseline is a `baseline` checkpoint of a worktree that had an earlier one (as load-split's baseline.cjs).
// Per file it ran: recorded seconds (report.json fileDurations; node:test runs keep none: the stored durations),
// the key the restart stored, and the worktree's newest earlier run of the file with what it left in `results`.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, fromIso, toIso] = process.argv;
const T0 = Date.parse(fromIso), T1 = Date.parse(toIso);
const db = new DatabaseSync(storePath, { readOnly: true });
const fid = (f) => f.project + "\0" + f.path;
const checksOf = new Map();
for (const c of db.prepare("select id, project, test_path from checks").all()) {
  const k = c.project + "\0" + c.test_path; (checksOf.get(k) ?? checksOf.set(k, []).get(k)).push(c.id);
}
const runsByWt = new Map();
for (const r of db.prepare("select id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at, ended_at, end_state from runs order by started_at").all()) {
  r.files = new Set(JSON.parse(r.test_files).map(fid));
  (runsByWt.get(r.worktree_id) ?? runsByWt.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const repCache = new Map();
const rowsOfRun = db.prepare("select r.check_id, r.key, r.commit_sha, r.dirty, r.recorded_at, r.worktree_id, r.duration_ms, c.project, c.test_path from results r join checks c on c.id = r.check_id where r.run_id = ?");
const report = (run) => {
  if (repCache.has(run.id)) return repCache.get(run.id);
  let v;
  try {
    const rep = JSON.parse(fs.readFileSync(run.log_dir + "/report.json", "utf8")).report;
    v = { has: true, end: rep.end, failure: rep.failure ? String(rep.failure).split("\n")[0].slice(0, 80) : null,
      dur: new Map((rep.fileDurations ?? []).map((d) => [fid(d.testFile), d.durationMs / 1000])),
      done: new Set((rep.completedFiles ?? []).map(fid)) };
  } catch { v = { has: false, end: run.end_state, failure: null, dur: new Map(), done: null }; }
  v.rows = new Map();
  for (const x of rowsOfRun.all(run.id)) { const k = x.project + "\0" + x.test_path; (v.rows.get(k) ?? v.rows.set(k, []).get(k)).push(x); }
  if (!v.has) for (const [k, rs] of v.rows) v.dur.set(k, rs.reduce((s, x) => s + x.duration_ms, 0) / 1000);
  repCache.set(run.id, v); return v;
};
const rowsAfter = db.prepare("select key, run_id, worktree_id, recorded_at from results where check_id = ? and recorded_at > ?");
const cps = db.prepare("select * from checkpoints where kind = 'baseline' order by started_at").all();
const prevOf = new Map(); const seen = new Map();
for (const c of cps) { c.prev = seen.get(c.worktree_id) ?? null; seen.set(c.worktree_id, c); }
for (const c of cps) {
  if (c.prev === null || c.started_at < T0 || c.started_at >= T1) continue;
  const W = c.worktree_id, T = c.started_at;
  const wruns = runsByWt.get(W) ?? [];
  const mine = wruns.filter((r) => r.checkpoint_id === c.id);
  const before = wruns.filter((r) => r.started_at < T);
  const lastBefore = before.at(-1) ?? null;
  // the newest commit W recorded before T, from any surviving row of its runs
  let prevCommit = null;
  for (let i = before.length - 1; i >= 0 && prevCommit === null; i--) {
    const rep = report(before[i]); for (const rs of rep.rows.values()) { prevCommit = { sha: rs[0].commit_sha, dirty: rs[0].dirty }; break; }
  }
  const files = JSON.parse(c.test_files);
  for (const f of files) {
    const k = fid(f);
    let sec = 0, ran = false, ended = false, newRows = [];
    for (const r of mine) if (r.files.has(k)) { ran = true; const rep = report(r); if (rep.dur.has(k)) { ended = true; sec += rep.dur.get(k); } newRows.push(...(rep.rows.get(k) ?? [])); }
    const newKeys = [...new Set(newRows.map((x) => x.key))];
    const r1 = [...before].reverse().find((r) => r.files.has(k)) ?? null;
    let prior = null;
    if (r1) {
      const rep = report(r1);
      const rows = rep.rows.get(k) ?? [];
      const completed = rep.done ? rep.done.has(k) : rep.dur.has(k);
      let after = null;
      if (completed && rows.length === 0) {
        const cid = (checksOf.get(k) ?? [])[0];
        if (cid !== undefined) after = rowsAfter.all(cid, r1.ended_at ?? r1.started_at).map((x) => ({ key: x.key, sameWt: x.worktree_id === W, mine: mine.some((m) => m.id === x.run_id), at: x.recorded_at }));
      }
      prior = { run: r1.id, inPrev: r1.started_at >= c.prev.started_at, ck: r1.checkpoint_id === c.prev.id ? "prevBaseline" : r1.checkpoint_id ? "otherCk" : null,
        startedAgo: T - r1.started_at, endState: r1.end_state, end: rep.end, failure: rep.failure, completed, ended: rep.dur.has(k),
        keys: [...new Set(rows.map((x) => x.key))], commit: rows[0]?.commit_sha ?? null, dirty: rows[0]?.dirty ?? null, after,
        endedBeforeT: r1.ended_at !== null && r1.ended_at <= T, endedAfterT: r1.ended_at !== null && r1.ended_at > T };
    }
    const anyBefore = (checksOf.get(k) ?? []).length > 0;
    console.log(JSON.stringify({ ck: c.id, W, T, prevT: c.prev.started_at, gapLastRun: lastBefore ? T - (lastBefore.ended_at ?? lastBefore.started_at) : null,
      ckEnd: c.end_state, file: k, ran, ended, sec, newKeys, newCommit: newRows[0]?.commit_sha ?? null, newDirty: newRows[0]?.dirty ?? null,
      prevCommit, prior, hasChecks: anyBefore }));
  }
}
