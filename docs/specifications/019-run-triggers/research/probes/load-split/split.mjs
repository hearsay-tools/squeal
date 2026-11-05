// 019-46 probe (throwaway): split a store copy's test work in a fixed window by what started it.
// Usage: node split.mjs <store copy> <squeal.config.json> <turns.json> <fromISO> <toISO> [slowRegex] > out.json
// Work unit, as edit-load.md finding 2: recorded file-seconds (report.json fileDurations; node:test and pytest
// runs keep no report.json: stored durations, else a share of the run's wall time over at most 4 workers);
// a file that never ended counts the run's wall time, at most 4 such files per run (upper bound).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
const [, , storePath, configPath, turnsPath, fromIso, toIso, slowArg] = process.argv;
const T0 = Date.parse(fromIso), T1 = Date.parse(toIso);
const QUIET = 120_000; // CATCHUP_QUIET_MS, src/core/scheduler/quiet.ts
const slowRe = slowArg ? new RegExp(slowArg) : null;
const config = JSON.parse(readFileSync(configPath, "utf8"));
const tierSize = config.runner?.tierSize ?? 4;
const inputs = Object.entries(config.inputs ?? {}); // test glob -> input globs
const turns = JSON.parse(readFileSync(turnsPath, "utf8")).worktrees;
const db = new DatabaseSync(storePath, { readOnly: true });
const runs = db.prepare(`SELECT r.*, c.kind ck FROM runs r LEFT JOIN checkpoints c ON c.id = r.checkpoint_id
  WHERE r.started_at >= ? AND r.started_at < ? AND r.ended_at IS NOT NULL ORDER BY r.started_at`).all(T0, T1);
const closures = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) closures.set(t.project + "\0" + t.path, new Set(JSON.parse(t.closure_paths)));
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id, number, created_at, head, trigger, changes FROM revisions ORDER BY worktree_id, number").all()) {
  r.paths = JSON.parse(r.changes).map((c) => c.path);
  (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const keptOf = db.prepare("SELECT DISTINCT c.project p, c.test_path t FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ?");
const durOf = db.prepare("SELECT c.project p, c.test_path t, sum(r.duration_ms) d FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? GROUP BY 1, 2");
const transOf = db.prepare(`SELECT t.from_outcome f, t.to_outcome o, t.at, c.project p, c.test_path tp FROM transitions t JOIN checks c ON c.id = t.check_id
  WHERE t.worktree_id = ? AND t.at >= ? AND t.at <= ?`);
const key = (f) => f.project + "\0" + f.path;
const inputGlobsOf = new Map();
const declared = (f) => {
  if (!inputGlobsOf.has(f.path)) inputGlobsOf.set(f.path, inputs.filter(([g]) => matchesGlob(f.path, g)).flatMap(([, ins]) => ins));
  return inputGlobsOf.get(f.path);
};
// first run start per worktree and revision: the revision-time proxy where the store kept no revision
const firstAt = new Map();
for (const r of runs) { const k = r.worktree_id + "\0" + r.revision; if (!firstAt.has(k)) firstAt.set(k, r.started_at); }
const firstRevOf = new Map(); for (const r of runs) if (!firstRevOf.has(r.worktree_id)) firstRevOf.set(r.worktree_id, r.revision);
const nextAfter = (arr, t) => { for (const x of arr) if (x > t) return x; return null; };
const S = {}; const add = (path, v) => { let o = S; for (const k of path.slice(0, -1)) o = o[k] ??= {}; const l = path.at(-1); o[l] = (o[l] ?? 0) + v; };
const found = []; // transitions: {cls, kind, file, delayFromEdit}
const fileRuns = []; // per file run, for later passes
for (const run of runs) {
  const files = JSON.parse(run.test_files);
  const wall = (run.ended_at - run.started_at) / 1000;
  let rep, dur, report = true;
  try {
    rep = JSON.parse(readFileSync(`${run.log_dir}/report.json`, "utf8")).report;
    dur = new Map(Object.values(rep.fileDurations ?? {}).map((d) => [key(d.testFile), d.durationMs / 1000]));
  } catch {
    report = false;
    rep = { end: run.end_state, failure: run.end_state === "completed" ? null : run.end_state };
    dur = new Map();
    for (const r of durOf.all(run.id)) dur.set(r.p + "\0" + r.t, r.d / 1000);
    for (const f of files) if (!dur.has(key(f))) dur.set(key(f), (wall * Math.min(files.length, 4)) / files.length);
  }
  const kept = new Set(keptOf.all(run.id).map((r) => r.p + "\0" + r.t));
  const failedFiles = new Set((rep.results ?? []).filter((r) => r.outcome === "fail").map((r) => key(r.check)));
  const cause = rep.failure ? String(rep.failure).replace(/\(.*$/s, "").split("\n")[0].slice(0, 60) : rep.end;
  const flips = new Map();
  for (const t of transOf.all(run.worktree_id, run.started_at, run.ended_at + 15_000)) {
    const kind = t.o === "fail" && t.f !== "fail" ? "toFail" : t.f === "fail" && t.o === "pass" ? "toPass" : null;
    if (kind) { const k2 = t.p + "\0" + t.tp; if (!flips.has(k2)) flips.set(k2, { kind, at: t.at }); }
  }
  const wrevs = revs.get(run.worktree_id) ?? [];
  const known = wrevs.length > 0;
  const latest = [...wrevs].reverse().find((r) => r.created_at <= run.started_at) ?? null;
  const proxyAt = firstAt.get(run.worktree_id + "\0" + run.revision);
  let unended = 0;
  const stored0 = (k) => kept.has(k);
  for (const f of files) {
    const k = key(f);
    let w = dur.get(k); const ended = w !== undefined;
    if (w === undefined) w = unended++ < 4 ? wall : 0;
    const runner = report ? (f.project ? `vitest:${f.project}` : "vitest") : `slots:${f.project || "?"}`;
    const group = slowRe?.test(f.path) ? "slow" : "tests";
    let cls, by = null, sub = "";
    const clo = closures.get(k); const ins = declared(f);
    const touches = (r) => r.paths.some((p) => p === f.path || clo?.has(p) || ins.some((g) => matchesGlob(p, g)));
    if (run.ck) cls = `checkpoint:${run.ck}`;
    else if (group === "slow") cls = "slow";
    else if (known) {
      const ws = wrevs.filter((r) => r.number <= run.revision).reverse();
      by = ws.find((r) => r.trigger === "start" || touches(r)) ?? null;
      if (!by) cls = "backlog-other";
      else if (by.trigger === "start") cls = "baseline";
      else if (by.paths.length >= 10 || by.trigger !== "watch") cls = "catchup-pull";
      else if (by.paths.includes(f.path) || run.started_at - by.created_at < QUIET) cls = "edit-route";
      else { cls = "catchup-edit"; sub = latest && run.started_at - latest.created_at < QUIET ? "riding" : "quiet"; }
    } else {
      // path-free proxy: the first run at a revision stands for its time
      const gap = run.started_at - proxyAt;
      if (run.revision === firstRevOf.get(run.worktree_id) && gap >= QUIET) cls = "proxy:start-backlog";
      else cls = gap < QUIET ? "proxy:edit-window" : "proxy:after-quiet";
    }
    const pgap = run.started_at - proxyAt;
    const proxyCls = run.ck ? cls : group === "slow" ? "slow" : run.revision === firstRevOf.get(run.worktree_id) && pgap >= QUIET ? "proxy:start-backlog" : pgap < QUIET ? "proxy:edit-window" : "proxy:after-quiet";
    if (known) add(["confusion", cls, proxyCls], w);
    const shape = run.ck ? cls : group === "slow" ? "slow" : files.length <= tierSize ? "run<=tierSize" : "run>tierSize";
    if (known) add(["shapeVsExact", cls, shape], w);
    add(["byShape", shape, stored0(k) ? "stored" : "notStored"], w);
    add(["fateByShape", kept.has(k) ? "stored" : ended ? `ended-not-stored:${cause}` : `not-ended:${cause}`, shape], w);
    add(["byKnown", known ? "known" : "removed"], w);
    add(["byWorktree", run.worktree_id + (known ? " known" : ""), cls.split(":")[0]], w);
    const stored = kept.has(k);
    const fate = stored ? "stored" : ended ? `ended-not-stored:${cause}` : `not-ended:${cause}`;
    add(["byClass", cls, stored ? "stored" : "notStored"], w);
    add(["byClassRunner", cls, runner], w);
    add(["byRunner", runner, stored ? "stored" : "notStored"], w);
    add(["fate", fate, cls.split(":")[0]], w);
    add(["total"], w); add(["fileRuns"], 1);
    if (sub) add(["catchupSub", sub], w);
    const fl = flips.get(k);
    if (fl) found.push({ cls, kind: fl.kind, w: run.worktree_id, file: f.path, at: fl.at, edit: by?.created_at ?? null });
    fileRuns.push({ w: run.worktree_id, k, path: f.path, cls, sec: w, stored, start: run.started_at, end: run.ended_at, edit: by?.created_at ?? null, rev: run.revision, runner, run: run.id, size: files.length });
  }
}
// pass 2: catch-up and the agent's turns (Stop = turn end; pause = no turn), commits = head moves of known revisions
const q4 = { catchupSec: 0, stopBeforeRun: 0, noStopBeforeRun: 0, noTranscript: 0, collapsedAtStop: 0, collapsedAtCommit: 0, notStored: 0, runDuringPause: 0 };
const byWF = new Map(); for (const r of fileRuns) (byWF.get(r.w + "\0" + r.k) ?? byWF.set(r.w + "\0" + r.k, []).get(r.w + "\0" + r.k)).push(r);
const heads = new Map(); for (const [w, list] of revs) { const hs = []; let h = null; for (const r of list) { if (h !== null && r.head !== h) hs.push(r.created_at); h = r.head; } heads.set(w, hs); }
const perEdit = new Map();
for (const r of fileRuns) {
  if (r.cls !== "catchup-edit" && r.cls !== "proxy:after-quiet") continue;
  const t = turns[r.w];
  const pseudoEdit = r.edit ?? firstAt.get(r.w + "\0" + r.rev);
  if (r.cls === "catchup-edit") { const ek = r.w + "\0" + r.edit; perEdit.set(ek, (perEdit.get(ek) ?? 0) + r.sec); }
  const tag = r.cls;
  add(["q4", tag, "sec"], r.sec);
  if (!r.stored) add(["q4", tag, "notStored"], r.sec);
  if (!t) { add(["q4", tag, "noTranscript"], r.sec); continue; }
  const stop = nextAfter(t.stops, pseudoEdit);
  if (stop !== null && stop <= r.start) add(["q4", tag, "stopBeforeRun"], r.sec);
  else add(["q4", tag, "noStopBeforeRun"], r.sec);
  // was the agent in a turn when the run started? (last start before run > last stop before run)
  const lastStart = [...t.starts].reverse().find((x) => x <= r.start) ?? 0, lastStop = [...t.stops].reverse().find((x) => x <= r.start) ?? 0;
  if (lastStop > lastStart) add(["q4", tag, "startedWhileIdle"], r.sec);
  // a later run of the same file in the worktree before the next Stop after this run: at Stop only one would run
  const later = (byWF.get(r.w + "\0" + r.k) ?? []).find((x) => x.start > r.start);
  const nextStop = nextAfter(t.stops, r.start);
  if (later && (nextStop === null || later.start < nextStop)) add(["q4", tag, "supersededBeforeStop"], r.sec);
  const hs = heads.get(r.w) ?? []; const nextCommit = nextAfter(hs, r.start);
  if (later && nextCommit !== null && later.start < nextCommit) add(["q4", tag, "supersededBeforeCommit"], r.sec);
  if (!hs.length) add(["q4", tag, "noCommitKnown"], r.sec);
}
const pe = [...perEdit.values()].sort((a, b) => a - b);
const editsKnown = [...revs.values()].flat().filter((r) => r.trigger === "watch" && r.paths.length < 10 && r.created_at >= T0 && r.created_at < T1).length;
const round = (o) => (typeof o === "number" ? Math.round(o) : Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, round(v)])));
// transitions found only in catch-up: delay from edit
const catchFound = found.filter((x) => x.cls === "catchup-edit").map((x) => ({ ...x, delayS: x.edit ? Math.round((x.at - x.edit) / 1000) : null }));
const foundBy = {}; for (const x of found) { foundBy[x.cls] ??= {}; foundBy[x.cls][x.kind] = (foundBy[x.cls][x.kind] ?? 0) + 1; }
// top files by recorded seconds (manual-group candidates)
const topF = new Map(); for (const r of fileRuns) { const o = topF.get(r.k) ?? { path: r.k.replace("\0", " "), sec: 0, n: 0, notStored: 0 }; o.sec += r.sec; o.n++; if (!r.stored) o.notStored += r.sec; topF.set(r.k, o); }
const top = [...topF.values()].sort((a, b) => b.sec - a.sec).slice(0, 25).map((o) => ({ ...o, sec: Math.round(o.sec), notStored: Math.round(o.notStored) }));
const prefix = new Map(); for (const r of fileRuns) { const p = r.path.split("/").slice(0, r.path.startsWith("packages/") ? 3 : 2).join("/"); prefix.set(p, (prefix.get(p) ?? 0) + r.sec); }
const prefixes = [...prefix].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, s]) => [p, Math.round(s)]);
const worktrees = new Set(runs.map((r) => r.worktree_id));
console.log(JSON.stringify({ storePath, window: [fromIso, toIso], runs: runs.length, worktrees: worktrees.size, worktreesWithRevisions: [...worktrees].filter((w) => revs.has(w)).length,
  editsKnown, catchupPerEdit: { edits: pe.length, sum: Math.round(pe.reduce((a, b) => a + b, 0)), p50: Math.round(pe[Math.floor(pe.length / 2)] ?? 0), p90: Math.round(pe[Math.floor(pe.length * 0.9)] ?? 0), max: Math.round(pe.at(-1) ?? 0) },
  ...round(S), found: foundBy, catchFound, top, prefixes, files: Object.fromEntries([...topF.values()].map((o) => [o.path, [Math.round(o.sec), Math.round(o.notStored), o.n]])) }, null, 1));
