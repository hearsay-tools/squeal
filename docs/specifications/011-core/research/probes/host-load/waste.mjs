// What the runs of one project stored, from a store copy and a run-log snapshot taken with it, read only.
// Usage: node waste.mjs <store copy> <hours> <runs snapshot> [end, ISO time; default now]
// Row 011-155 (research/stored-nothing.md finding 1): a file a run picked is stored at run end when the run
// still holds a result of it, or when its report completed it in a worktree removed since, because the prune
// deletes a removed worktree's results unless a live worktree holds the key (001 D8, src/core/store/prune.ts).
// Every other picked file stored nothing. Counted in files (C3) and in recorded seconds (stored-nothing.md, Units).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , path, hours = "24", logs, endArg] = process.argv;
if (!logs) throw new Error("usage: waste.mjs <store copy> <hours> <runs snapshot> [end]");
const db = new DatabaseSync(path, { readOnly: true });
const end = endArg ? Date.parse(endArg) : Date.now();
const since = end - Number(hours) * 3600_000;
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((w) => w.id));
const runs = db.prepare("SELECT * FROM runs WHERE started_at >= ? AND started_at <= ? AND ended_at IS NOT NULL").all(since, end);
const storedOf = db.prepare("SELECT c.project p, c.test_path t, sum(r.duration_ms) d FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? GROUP BY 1, 2");
const read = (run, name) => { try { return readFileSync(`${logs}/${run.log_dir.split("/").pop()}/${name}`, "utf8"); } catch { return null; } };
// Row 011-138 (tasks/011-138/notes.md): a file a cancelled run picked that its vitest.log never names did not start.
// The labels a log names, by a module end, a test line or a console line (src/core/run-log.ts), and those it ended.
const namedIn = (text) => {
  const named = new Set(), ended = new Set();
  for (const line of text.split("\n")) {
    let m;
    if ((m = /^MODULE \S+ (.+)$/.exec(line))) { named.add(m[1]); ended.add(m[1]); }
    else if ((m = /^(?:PASS|FAIL|SKIP) (.+?) > /.exec(line))) named.add(m[1]);
    else if ((m = /^\[\w+\] ("(?:[^"\\]|\\.)*"|.+?): /.exec(line))) named.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1]);
  }
  return { named, ended };
};
const label = (k) => { const [p, f] = k.split("\0"); return p ? `[${p}] ${f}` : f; };
// Each worktree's runs in the copy, by start: a never-started file is handed over when a later one picked it.
const byWorktree = new Map();
for (const r of db.prepare("SELECT worktree_id w, started_at s, test_files f FROM runs ORDER BY started_at").all()) {
  const list = byWorktree.get(r.w) ?? []; byWorktree.set(r.w, list); list.push(r);
}
const picksOf = (r) => (r.picks ??= new Set(JSON.parse(r.f).map((f) => f.project + "\0" + f.path)));
const pickedLater = (run, k) => (byWorktree.get(run.worktree_id) ?? []).some((r) => r.s > run.started_at && picksOf(r).has(k));
const tally = () => Object.fromEntries(["all", "live", "removed"].map((s) => [s, { files: [0, 0, 0], secs: [0, 0, 0], never: [0, 0] }]));
const t = tally(), cp = tally(), bySize = {}, cancelled = {};
const removed = new Set();
let wall = 0, wallZero = 0, zeroRuns = 0, noReport = 0, cpRuns = 0;
const lc = [0, 0, 0, 0]; // live worktrees: completed files and seconds, then those that stored nothing
for (const run of runs) {
  const id = (f) => f.project + "\0" + f.path;
  const files = JSON.parse(run.test_files).map(id);
  const scope = live.has(run.worktree_id) ? "live" : "removed";
  if (scope === "removed") removed.add(run.worktree_id);
  const text = read(run, "report.json");
  const rep = text && JSON.parse(text).report;
  if (!rep) noReport++;
  const stored = new Map(storedOf.all(run.id).map((r) => [r.p + "\0" + r.t, r.d / 1000]));
  const completed = new Set((rep?.completedFiles ?? []).map(id));
  const withheld = new Set((rep?.withheld ?? []).map(id));
  const withheldRun = /may have executed bytes/.test(String(rep?.failure ?? ""));
  const recorded = new Map((rep?.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000]));
  const w = (run.ended_at - run.started_at) / 1000;
  let log;
  // A file with no recorded duration: no report, a share of the wall over at most 4 workers; a file the run
  // cut, the wall when its log names it, else 0 (fate.mjs's upper bound).
  const secsOf = (k) => recorded.get(k) ?? (!rep ? stored.get(k) ?? (w * Math.min(files.length, 4)) / files.length
    : (log ??= read(run, "vitest.log") ?? "").includes(" " + k.split("\0")[1]) ? w : 0);
  const b = files.length >= 100 ? "100+" : files.length >= 10 ? "10-99" : files.length >= 2 ? "2-9" : "1";
  const size = (bySize[b] ??= { runs: 0, files: 0, kept: 0, wall: 0, zero: 0 });
  // A cancelled run's cause is its failure's first line; a run with no vitest.log counts every file as started.
  const cause = /^run cancelled/.test(String(rep?.failure ?? "")) ? rep.failure.split("\n")[0].replace(/; workers did not stop$/, "") : null;
  const c = cause && (cancelled[cause] ??= { runs: 0, withoutLog: 0, picked: 0, neverEnded: 0, neverStarted: 0, handedOver: 0 });
  const vlog = cause && (log ??= read(run, "vitest.log") ?? "") !== "" ? namedIn(log) : null;
  if (c) { c.runs++; c.picked += files.length; if (!vlog) c.withoutLog++; }
  let kept = 0;
  for (const k of files) {
    const f = stored.has(k) ? 0 : scope === "removed" && completed.has(k) && !withheld.has(k) && !withheldRun ? 1 : 2;
    const s = secsOf(k);
    const ns = vlog && !vlog.named.has(label(k)) ? 1 : 0, ho = ns && pickedLater(run, k) ? 1 : 0;
    if (vlog) { c.neverEnded += vlog.ended.has(label(k)) ? 0 : 1; c.neverStarted += ns; c.handedOver += ho; }
    for (const into of run.checkpoint_id ? [t, cp] : [t]) for (const sc of ["all", scope]) {
      into[sc].files[f]++; into[sc].secs[f] += s; into[sc].never[0] += ns; into[sc].never[1] += ho;
    }
    if (f < 2) kept++;
    if (scope === "live" && completed.has(k)) { lc[0]++; lc[1] += s; if (f === 2) { lc[2]++; lc[3] += s; } }
  }
  wall += w; size.runs++; size.files += files.length; size.kept += kept; size.wall += w;
  if (kept === 0) { zeroRuns++; wallZero += w; size.zero++; }
  if (run.checkpoint_id) cpRuns++;
}
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
// keptShare (C3): stored at run end, of picked. keptShareNow: the results that still exist, the count before 011-155.
// In files, beside it (011-138): keptShareStarted, the same with never-started handed-over files out of picked.
const shares = (v, never) => {
  const n = v[0] + v[1] + v[2], r = (x) => Math.round(x);
  return { picked: r(n), storedNow: r(v[0]), prunedWithWorktree: r(v[1]), storedNothing: r(v[2]), keptShare: pct(v[0] + v[1], n),
    ...(never && { neverStarted: never[0], handedOver: never[1], keptShareStarted: pct(v[0] + v[1], n - never[1]) }),
    keptShareNow: pct(v[0], n), prunedShare: pct(v[1], n), nothingShare: pct(v[2], n) };
};
const table = (x) => Object.fromEntries(Object.entries(x).map(([s, e]) => [s, { files: shares(e.files, e.never), recordedSeconds: shares(e.secs) }]));
console.log(JSON.stringify({
  from: new Date(since).toISOString(), to: new Date(end).toISOString(), runs: runs.length, runsWithoutReport: noReport,
  removedWorktrees: removed.size,
  ...table(t),
  // The prune share counts every completed file of a removed worktree; in live worktrees this share of
  // completed files stored nothing (inputs changed, replaced), so the prune share may count that much too many.
  liveCompletedStoredNothing: { files: pct(lc[2], lc[0]), recordedSeconds: pct(lc[3], lc[1]) },
  runWallHours: +(wall / 3600).toFixed(1), runsThatStoredNothing: zeroRuns, wallHoursOfThem: +(wallZero / 3600).toFixed(1), zeroShareOfWall: pct(wallZero, wall),
  checkpointRuns: cpRuns, checkpoint: table(cp).all,
  // Per cancel cause, all runs: neverEnded, no module end in the log; neverStarted, not named in it at all.
  cancelled,
  bySize: Object.fromEntries(Object.entries(bySize).map(([b, e]) => [b, { ...e, wall: Math.round(e.wall), keptShare: pct(e.kept, e.files) }])),
}, null, 1));
