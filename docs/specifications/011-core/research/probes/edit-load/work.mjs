// 011-143 probe (throwaway): split a store copy's test work by what caused it.
// Usage: node work.mjs <store copy> <unused> <hours> [tierSize=4] [slowRegex]
// Work unit: file-seconds = each ended file's reported duration (report.json fileDurations);
// a file that never ended counts the run's wall time, at most 4 such files per run.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , storePath, runsDir, hours = "72", tierArg = "4", slowArg] = process.argv;
const tierSize = Number(tierArg);
const slowRe = slowArg ? new RegExp(slowArg) : null;
const db = new DatabaseSync(storePath, { readOnly: true });
const end = db.prepare("SELECT max(started_at) m FROM runs").get().m;
const since = end - Number(hours) * 3600_000;
const runs = db.prepare("SELECT * FROM runs WHERE started_at >= ? AND ended_at IS NOT NULL ORDER BY started_at").all(since);
const closures = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) closures.set(t.project + "\0" + t.path, new Set(JSON.parse(t.closure_paths)));
const revs = new Map(); // worktree -> [rev]
for (const r of db.prepare("SELECT worktree_id, number, created_at, head, dirty, trigger, changes FROM revisions ORDER BY worktree_id, number").all()) {
  r.paths = JSON.parse(r.changes).map((c) => c.path);
  (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const revOf = (w, n) => (revs.get(w) ?? []).find((r) => r.number === n);
const keptOf = db.prepare("SELECT DISTINCT c.project p, c.test_path t FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ?");
const durOf = db.prepare("SELECT c.project p, c.test_path t, sum(r.duration_ms) d FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? GROUP BY 1, 2");
const key = (f) => f.project + "\0" + f.path;
const lastRun = new Map(); // worktree\0file -> {run, failed, endedAt}
const doneAtHead = new Map(); // head\0file -> worktree of first clean completion
// transitions a run's results caused: same worktree and test file, recorded within 15 s after the run ended
const transOf = db.prepare(`SELECT t.from_outcome f, t.to_outcome o, c.project p, c.test_path tp FROM transitions t JOIN checks c ON c.id = t.check_id
  WHERE t.worktree_id = ? AND t.at >= ? AND t.at <= ?`);
const found = {};
const totals = {}; const add = (k, v) => (totals[k] = (totals[k] ?? 0) + v);
const cross = {};
let missingReports = 0;
for (const run of runs) {
  let rep;
  const files = JSON.parse(run.test_files);
  const wall = (run.ended_at - run.started_at) / 1000;
  let dur;
  try {
    rep = JSON.parse(readFileSync(`${run.log_dir}/report.json`, "utf8")).report;
    dur = new Map(Object.values(rep.fileDurations ?? {}).map((d) => [key(d.testFile), d.durationMs / 1000]));
  } catch {
    // node:test and pytest runs keep no report.json: stored check durations per file,
    // and a file with none takes its share of the run's wall time over at most 4 workers.
    missingReports++;
    rep = { end: run.end_state, failure: run.end_state === "completed" ? null : run.end_state };
    dur = new Map();
    for (const r of durOf.all(run.id)) dur.set(r.p + "\0" + r.t, r.d / 1000);
    for (const f of files) if (!dur.has(key(f))) dur.set(key(f), (wall * Math.min(files.length, 4)) / files.length);
  }
  const failedFiles = new Set((rep.results ?? []).filter((r) => r.outcome === "fail").map((r) => key(r.check)));
  for (const e of rep.fileErrors ?? []) if (e?.testFile) failedFiles.add(key(e.testFile));
  const kept = new Set(keptOf.all(run.id).map((r) => r.p + "\0" + r.t));
  const rev = revOf(run.worktree_id, run.revision);
  const cause = rep.failure ? String(rep.failure).replace(/\(.*$/s, "").slice(0, 60) : rep.end;
  const trans = transOf.all(run.worktree_id, run.started_at, run.ended_at + 15_000);
  const flips = new Map();
  for (const t of trans) {
    const kind = t.o === "fail" && t.f !== "fail" ? "toFail" : t.f === "fail" && t.o === "pass" ? "toPass" : null;
    if (kind) { const k2 = t.p + "\0" + t.tp; (flips.get(k2) ?? flips.set(k2, new Set()).get(k2)).add(kind); }
  }
  let unended = 0;
  for (const f of files) {
    const k = key(f);
    let w = dur.get(k);
    if (w === undefined) w = unended++ < 4 ? wall : 0;
    // what caused the file to run
    let cls;
    const prev = lastRun.get(run.worktree_id + "\0" + k);
    const between = (revs.get(run.worktree_id) ?? []).filter((r) => prev && r.created_at > prev.endedAt && r.created_at <= run.started_at);
    const clo = closures.get(k);
    const touches = (r) => r.paths.some((p) => p === f.path || clo?.has(p));
    if (slowRe?.test(f.path)) cls = "slow";
    else if (run.checkpoint_id) cls = "checkpoint";
    else if (prev?.failed && run.started_at - prev.endedAt < 1800_000 && !between.some(touches)) cls = "rerun";
    else if (files.length <= tierSize) cls = "edit-route";
    else {
      const ws = (revs.get(run.worktree_id) ?? []).filter((r) => r.number <= run.revision).reverse();
      const by = ws.find((r) => r.trigger === "start" || touches(r));
      cls = !ws.length ? "backlog-unknown-cause" : !by ? "backlog-other" : by.trigger === "start" ? "baseline" : by.paths.length >= 10 || by.trigger !== "watch" ? "catchup-pull" : "catchup-edit";
    }
    const stored = kept.has(k);
    for (const kind of flips.get(k) ?? []) { found[cls] ??= {}; found[cls][kind] = (found[cls][kind] ?? 0) + 1; }
    const fate = stored ? "stored" : dur.has(k) ? `ended-not-stored:${cause}` : `not-ended:${cause}`;
    add(`class:${cls}`, w); add(`fate:${stored ? "stored" : "not-stored"}`, w); add(`fateDetail:${fate}`, w);
    (cross[cls] ??= {}); cross[cls][stored ? "stored" : "notStored"] = (cross[cls][stored ? "stored" : "notStored"] ?? 0) + w;
    // same file at the same clean commit already completed in another worktree (inferred same key)
    if (rev && rev.dirty === 0 && dur.has(k)) {
      const hk = rev.head + "\0" + k; const first = doneAtHead.get(hk);
      if (first && first !== run.worktree_id) add("dupCleanSameHeadOtherWorktree", w);
      else if (!first) doneAtHead.set(hk, run.worktree_id);
    }
    add("total", w); add("fileRuns", 1);
    lastRun.set(run.worktree_id + "\0" + k, { failed: failedFiles.has(k), endedAt: run.ended_at });
  }
}
// worktree activity hours: per worktree, clusters of revisions and runs with gaps <= 15 min, plus 5 min each
const events = new Map();
for (const [w, list] of revs) for (const r of list) if (r.created_at >= since) (events.get(w) ?? events.set(w, []).get(w)).push(r.created_at);
for (const r of runs) (events.get(r.worktree_id) ?? events.set(r.worktree_id, []).get(r.worktree_id)).push(r.started_at, r.ended_at);
let activeMs = 0;
for (const [, ts] of events) {
  ts.sort((x, y) => x - y);
  let a = ts[0], b = ts[0];
  for (const t of ts.slice(1)) { if (t - b > 900_000) { activeMs += b - a + 300_000; a = t; } b = t; }
  activeMs += b - a + 300_000;
}
// agent hours: per worktree, clusters of watch revisions with gaps <= 15 min, plus 5 min each
let agentMs = 0; let activeWorktrees = 0;
for (const [, list] of revs) {
  const ts = list.filter((r) => r.trigger === "watch" && r.created_at >= since && r.created_at <= end).map((r) => r.created_at);
  if (!ts.length) continue; activeWorktrees++;
  let a = ts[0], b = ts[0];
  for (const t of ts.slice(1)) { if (t - b > 900_000) { agentMs += b - a + 300_000; a = t; } b = t; }
  agentMs += b - a + 300_000;
}
const round = (o) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : round(v)]));
console.log(JSON.stringify({ storePath, window: { from: new Date(since).toISOString(), to: new Date(end).toISOString() }, runs: runs.length, missingReports, activeWorktrees, agentHours: +(agentMs / 3600_000).toFixed(1), worktreesWithRuns: events.size, activeWorktreeHours: +(activeMs / 3600_000).toFixed(1), fileSeconds: round(totals), byClass: round(cross), filesWithTransition: found }, null, 1));
