// 011-148 probe (throwaway): what became of every file a run held, and which rule kept its result out of the store.
// Usage: node fate.mjs <store copy> <hours> <out.jsonl> [slowRegex|''] [run-log snapshot dir]
// Reads a store copy and the run logs (report.json, vitest.log) in place, read only. One JSON line per file run.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
const [, , storePath, hoursArg = "72", outPath, slowArg, logsDir] = process.argv;
// logsDir: a snapshot of <common-dir>/squeal/runs taken with the store copy (the live daemons prune logs).
const logOf = (run) => (logsDir ? logsDir + "/" + run.log_dir.split("/").pop() : run.log_dir);
const slowRe = slowArg ? new RegExp(slowArg) : null;
const db = new DatabaseSync(storePath, { readOnly: true });
const end = db.prepare("SELECT max(started_at) m FROM runs").get().m;
const since = end - Number(hoursArg) * 3600_000;
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((r) => r.id));
const allRuns = db.prepare("SELECT * FROM runs WHERE ended_at IS NOT NULL ORDER BY started_at").all();
const runById = new Map(allRuns.map((r) => [r.id, r]));
for (const r of allRuns) r.files = JSON.parse(r.test_files).map((f) => f.project + "\0" + f.path);
const runs = allRuns.filter((r) => r.started_at >= since);
const ckKind = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const closures = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all())
  closures.set(t.project + "\0" + t.path, new Set(JSON.parse(t.closure_paths)));
const ENV = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|package\.json|squeal\.config\.json|vitest\.config\.[cm]?[jt]s|vitest\.workspace\.[jt]s|tsconfig[^/]*\.json|\.npmrc|\.package-lock\.json|lock\.yaml|uv\.lock|pyproject\.toml)$/;
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id, number, created_at, head, dirty, trigger, changes FROM revisions ORDER BY worktree_id, number").all()) {
  r.paths = JSON.parse(r.changes).map((c) => c.path);
  r.env = r.paths.some((p) => ENV.test(p));
  (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const revOf = (w, n) => (revs.get(w) ?? []).find((r) => r.number === n);
const touches = (r, k) => {
  if (r.env) return true;
  const path = k.split("\0")[1];
  const clo = closures.get(k);
  return r.paths.some((p) => p === path || clo?.has(p));
};
// File-level results: what is stored now, and by which run.
const fileRows = new Map(); // file -> [{key, run_id, worktree_id, revision, recorded_at}]
const storedBy = new Map(); // run -> Set(file)
for (const r of db.prepare(`SELECT c.project p, c.test_path t, r.key, r.run_id, r.worktree_id, r.revision, r.recorded_at, r.outcome
    FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file'`).all()) {
  const k = r.p + "\0" + r.t;
  (fileRows.get(k) ?? fileRows.set(k, []).get(k)).push(r);
  (storedBy.get(r.run_id) ?? storedBy.set(r.run_id, new Set()).get(r.run_id)).add(k);
}
// Any check stored (a file whose file-level row was replaced but whose test rows stayed still stored at its key).
const anyStored = db.prepare("SELECT DISTINCT c.project p, c.test_path t FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ?");
const durOf = db.prepare("SELECT c.project p, c.test_path t, sum(r.duration_ms) d FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? GROUP BY 1, 2");
// Whether run a and run b ran file k at the same key (inferred from revisions).
function sameKey(a, b, k) {
  if (a.worktree_id === b.worktree_id) {
    const list = revs.get(a.worktree_id);
    if (!list) return null;
    const lo = Math.min(a.revision, b.revision), hi = Math.max(a.revision, b.revision);
    return !list.some((r) => r.number > lo && r.number <= hi && touches(r, k));
  }
  const ra = revOf(a.worktree_id, a.revision), rb = revOf(b.worktree_id, b.revision);
  if (!ra || !rb) return null;
  if (ra.dirty === 0 && rb.dirty === 0 && ra.head && ra.head === rb.head) return true;
  return null;
}
const runsOfFile = new Map(); // file -> runs (all, chronological)
for (const r of allRuns) for (const k of r.files) (runsOfFile.get(k) ?? runsOfFile.set(k, []).get(k)).push(r);
function failureKind(rep, run) {
  if (!rep) return "no-report:" + (run.end_state ?? "?");
  const f = rep.failure == null ? "" : String(typeof rep.failure === "object" ? JSON.stringify(rep.failure) : rep.failure);
  if (rep.end === "timed-out") return "timed-out";
  if (rep.end === "crashed") return "crashed";
  if (/changed an input of every file/.test(f)) return "cancel:supersession";
  if (/an edit arrived during a backlog tier/.test(f)) return "cancel:edit-during-backlog";
  if (/yielded/.test(f)) return "cancel:yield";
  if (/stepped down/.test(f)) return "cancel:step-down";
  if (/squeal stop/.test(f)) return "cancel:stop";
  if (/run cancelled/.test(f)) return "cancel:other";
  if (/global setup/.test(f)) return "global-setup";
  if (f) return "failure:" + f.slice(0, 40);
  return "completed";
}
// The worktree's key now (test_file_keys), and the file rows at each key.
const keyNow = new Map(db.prepare("SELECT worktree_id w, project p, path t, key FROM test_file_keys WHERE key IS NOT NULL").all().map((r) => [r.w + "\0" + r.p + "\0" + r.t, r.key]));
const rowAtKey = new Map();
for (const [k, rows] of fileRows) for (const r of rows) rowAtKey.set(k + "\0" + r.key, r);
// What caused a file to run (work.mjs's classes; checkpoints split into run --all and baseline).
const lastRun = new Map();
function classOf(run, k, ck, wl) {
  const path = k.split("\0")[1];
  const prev = lastRun.get(run.worktree_id + "\0" + k);
  const between = (wl ?? []).filter((r) => prev && r.created_at > prev.endedAt && r.created_at <= run.started_at);
  if (slowRe?.test(path)) return "slow";
  if (ck === "run-all") return "checkpoint-run-all";
  if (ck) return "checkpoint-" + ck;
  if (prev?.failed && run.started_at - prev.endedAt < 1800_000 && !between.some((r) => touches(r, k))) return "rerun";
  if (run.files.length <= 4) return "edit-route";
  const ws = (wl ?? []).filter((r) => r.number <= run.revision).reverse();
  const by = ws.find((r) => r.trigger === "start" || touches(r, k));
  return !ws.length ? "backlog-unknown-cause" : !by ? "backlog-other" : by.trigger === "start" ? "baseline" : by.paths.length >= 10 || by.trigger !== "watch" ? "catchup-pull" : "catchup-edit";
}
const out = [];
for (const run of runs) {
  let rep = null, log = "";
  try { rep = JSON.parse(readFileSync(`${logOf(run)}/report.json`, "utf8")).report; } catch {}
  try { log = readFileSync(`${logOf(run)}/vitest.log`, "utf8"); } catch {}
  const wall = (run.ended_at - run.started_at) / 1000;
  const fk = failureKind(rep, run);
  const withheldAll = rep && rep.failure && /may have executed bytes/.test(String(rep.failure));
  const withheld = new Set((rep?.withheld ?? []).map((f) => f.project + "\0" + f.path));
  const completed = new Set((rep?.completedFiles ?? []).map((f) => f.project + "\0" + f.path));
  const dur = new Map((rep?.fileDurations ?? []).map((d) => [d.testFile.project + "\0" + d.testFile.path, d.durationMs / 1000]));
  const kept = new Set(anyStored.all(run.id).map((r) => r.p + "\0" + r.t));
  if (!rep) for (const r of durOf.all(run.id)) { dur.set(r.p + "\0" + r.t, r.d / 1000); completed.add(r.p + "\0" + r.t); }
  const started = new Set();
  for (const m of log.matchAll(/^(?:PASS|FAIL|SKIP|TODO|MODULE \w+) (\S+)/gm)) started.add(m[1]);
  const wlist = revs.get(run.worktree_id);
  const ck = run.checkpoint_id ? ckKind.get(run.checkpoint_id) ?? "pruned" : null;
  const failedFiles = new Set((rep?.results ?? []).filter((r) => r.outcome === "fail").map((r) => r.check.project + "\0" + r.check.testPath));
  for (const e of rep?.fileErrors ?? []) if (e?.testFile) failedFiles.add(e.testFile.project + "\0" + e.testFile.path);
  for (const k of run.files) {
    const path = k.split("\0")[1];
    const ended = completed.has(k);
    const stored = kept.has(k);
    let secs = dur.get(k);
    let est = "recorded";
    if (secs === undefined) {
      // not ended: started files ran up to the wall; no report: share of the wall over at most 4 workers
      if (!rep) { secs = (wall * Math.min(run.files.length, 4)) / run.files.length; est = "wall-share"; }
      else if (started.has(path) || log.includes(" " + path)) { secs = wall; est = "wall-started"; }
      else { secs = 0; est = "not-started"; }
    }
    let fate;
    if (stored) fate = "stored";
    else if (!ended) fate = "not-ended:" + fk;
    else if (!live.has(run.worktree_id)) fate = "ended:worktree-removed";
    else if (withheld.has(k)) fate = "ended:withheld";
    else {
      const sup = (runsOfFile.get(k) ?? []).find((o) => o !== run && o.worktree_id === run.worktree_id && o.started_at > run.started_at && o.started_at < run.ended_at && o.revision > run.revision);
      const during = (wlist ?? []).filter((r) => r.number > run.revision && r.created_at >= run.started_at - 2000 && r.created_at <= run.ended_at + 3000 && touches(r, k));
      if (sup && during.length) fate = "ended:superseded";
      else if (during.length) fate = "ended:inputs-changed";
      else if (withheldAll) fate = "ended:withheld-run";
      else fate = "ended:no-rule-seen";
    }
    // a result at the same key afterwards (inferred key equality), and by whom
    let later = null;
    if (!stored) {
      for (const row of fileRows.get(k) ?? []) {
        if (row.recorded_at < run.started_at) continue;
        const o = runById.get(row.run_id);
        if (!o) continue;
        const s = sameKey(run, o, k);
        if (s) { later = { by: o.worktree_id === run.worktree_id ? "same-worktree" : "other-worktree", run: o.id, at: row.recorded_at, overlap: o.started_at < run.ended_at, ck: o.checkpoint_id ? ckKind.get(o.checkpoint_id) ?? "?" : null }; break; }
        if (s === null && !later) later = { by: "unknown-key", run: o.id, at: row.recorded_at };
      }
      if (later?.by === "unknown-key") later = { by: "unknown-key" };
    }
    // exact: the worktree's key now is the key the run had, when no later revision touched the file
    let atKeyNow = null;
    if (!stored && live.has(run.worktree_id) && wlist && !wlist.some((r) => r.number > run.revision && touches(r, k))) {
      const key = keyNow.get(run.worktree_id + "\0" + k);
      if (key) { const row = rowAtKey.get(k + "\0" + key); atKeyNow = row ? { run: row.run_id, w: row.worktree_id === run.worktree_id ? "same" : "other", at: row.recorded_at } : "none"; }
    }
    if (fate === "ended:no-rule-seen" && ((later && later.by !== "unknown-key") || (atKeyNow && atKeyNow !== "none" && atKeyNow.at > run.ended_at))) fate = "ended:replaced-same-key";
    const cls = classOf(run, k, ck, wlist);
    lastRun.set(run.worktree_id + "\0" + k, { failed: failedFiles.has(k), endedAt: run.ended_at });
    out.push({ run: run.id, w: run.worktree_id, live: live.has(run.worktree_id), rev: run.revision, start: run.started_at, endAt: run.ended_at, nfiles: run.files.length, ck, slow: !!slowRe?.test(path), file: k, secs, est, ended, stored, fate, later, atKeyNow, fk, cls });
  }
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const sum = {}; let total = 0;
for (const o of out) { total += o.secs; const key = o.fate + (o.stored ? "" : " | later=" + (o.later?.by ?? "none")); sum[key] ??= [0, 0]; sum[key][0] += o.secs; sum[key][1]++; }
console.log(JSON.stringify({ storePath, from: new Date(since).toISOString(), to: new Date(end).toISOString(), runs: runs.length, fileRuns: out.length, total: Math.round(total) }));
for (const [k, [s, n]] of Object.entries(sum).sort((a, b) => b[1][0] - a[1][0])) console.log(`${(100 * s / total).toFixed(1).padStart(5)}%  ${Math.round(s).toString().padStart(7)} s  ${String(n).padStart(6)}  ${k}`);
