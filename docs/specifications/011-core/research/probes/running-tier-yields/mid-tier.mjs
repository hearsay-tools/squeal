// THROWAWAY probe (011-core/research/running-tier-yields.md, row 001-381). Read-only replay of
// cezar's store copy and the named waits extracted from agent transcripts (waits.mjs).
// Q3: how often a revision or a named wait lands while a fast Vitest tier of the same worktree
// runs. Q4: time to the named file's verdict under leave, cancel and the recommended rule.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const STORE = process.argv[2] ?? "/tmp/r381/cezar-store.sqlite";
const WAITS = process.argv[3] ?? "/tmp/r381/waits.json";
const db = new DatabaseSync(STORE, { readOnly: true });
const NODE_TEST = new Set(["test:unit", "root:test:unit"]);
const slow = (p) => /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/.test(p);
const vitestFast = (f) => !NODE_TEST.has(f.project) && !slow(f.path);
// Files whose change recreates the shared Vitest instance (config files, globalSetup closures;
// `recreateTriggers`). Cezar's: the configs, and e2e's globalSetup and what it imports.
const RECREATE = /(^|\/)vitest\.config\.[cm]?[jt]s$|^packages\/web\/e2e\/(environment|workspace-registry|agent-browser)\.ts$|^\.ai\/scripts\/resolve-browser-launch\.mjs$|(^|\/)package\.json$|^pnpm-lock\.yaml$/;
const id = (f) => `${f.project}\0${f.path}`;

// Closures (current, so approximate for older revisions).
const byPath = new Map(); // path -> Set(file id)
const testFiles = [];
for (const t of db.prepare("select project, path, closure_paths from test_files").all()) {
  const f = { project: t.project, path: t.path };
  if (!vitestFast(f)) continue;
  testFiles.push(f);
  for (const p of [t.path, ...JSON.parse(t.closure_paths)]) {
    if (!byPath.has(p)) byPath.set(p, new Set());
    byPath.get(p).add(id(f));
  }
}
const reach = (changes) => {
  const out = new Set();
  for (const c of changes) for (const f of byPath.get(c.path) ?? []) out.add(f);
  return out;
};

// Fast Vitest runs with their report.
const runs = [];
for (const r of db.prepare("select id, worktree_id wt, revision, test_files, checkpoint_id, log_dir, started_at s, ended_at e, end_state from runs where ended_at is not null order by started_at").all()) {
  const files = JSON.parse(r.test_files);
  if (!files.length || !vitestFast(files[0])) continue;
  let rep = null;
  const p = `${r.log_dir}/report.json`;
  if (existsSync(p)) try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch {}
  const dur = new Map((rep?.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000]));
  runs.push({
    id: r.id, wt: r.wt, revision: r.revision, s: r.s, e: r.e, end: r.end_state, cp: r.checkpoint_id !== null,
    files: files.map(id), dur, completed: new Set((rep?.completedFiles ?? []).map(id)),
    cancelled: /cancel/i.test(rep?.failure ?? ""), report: rep !== null,
  });
}
const runsOf = new Map();
for (const r of runs) { if (!runsOf.has(r.wt)) runsOf.set(r.wt, []); runsOf.get(r.wt).push(r); }
const inFlight = (wt, t) => (runsOf.get(wt) ?? []).find((r) => r.s <= t && t < r.e);
const revsOf = new Map();
for (const r of db.prepare("select worktree_id wt, number, created_at t, changes from revisions order by created_at").all()) {
  if (!revsOf.has(r.wt)) revsOf.set(r.wt, []);
  revsOf.get(r.wt).push({ number: r.number, t: r.t, changes: JSON.parse(r.changes) });
}
const roots = db.prepare("select id, root from worktrees").all().sort((a, b) => b.root.length - a.root.length);
const span = { from: Math.min(...runs.map((r) => r.s)), to: Math.max(...runs.map((r) => r.e)) };

// The run's fixed cost: its wall minus its longest file (start-up, transform, the post-run checks).
const overhead = (r) => Math.max(0, (r.e - r.s) / 1000 - Math.max(0, ...r.dur.values()));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const stats = (xs) => xs.length ? { n: xs.length, p50: +q(xs, 0.5).toFixed(1), p90: +q(xs, 0.9).toFixed(1), max: +Math.max(...xs).toFixed(1), sum: +xs.reduce((a, b) => a + b, 0).toFixed(0) } : { n: 0 };
// What a cancel at `t` keeps and throws away, all files of a tier of at most W files started at s.
function cancelAt(r, t, W = 23) {
  const el = (t - r.s) / 1000;
  let kept = 0, lost = 0, lostWork = 0;
  const started = r.files.length <= W;
  for (const f of r.files) {
    const d = r.dur.get(f);
    if (d !== undefined && started && d <= el) kept++;
    else { lost++; lostWork += started ? el : 0; }
  }
  return { kept, lost, lostWork };
}

// ---- Q3a: revisions landing mid-tier ----
const revEvents = [];
for (const [wt, revs] of revsOf) for (const v of revs) {
  const r = inFlight(wt, v.t);
  if (!r) continue;
  const reached = reach(v.changes);
  const recreate = v.changes.some((c) => RECREATE.test(c.path));
  const supersedes = r.files.filter((f) => reached.has(f)).length;
  const keyed = v.changes.filter((c) => byPath.has(c.path)).length;
  revEvents.push({
    wt: wt.slice(0, 8), rev: v.number, at: new Date(v.t).toISOString(), run: r.id.slice(0, 8), tierFiles: r.files.length,
    reaches: reached.size, supersedes, unfinishedSuperseded: r.files.filter((f) => reached.has(f) && !((r.dur.get(f) ?? Infinity) <= (v.t - r.s) / 1000)).length,
    recreate, catchUp: keyed >= 10, cancelledToday: r.cancelled, residualS: (r.e - v.t) / 1000, elapsedS: (v.t - r.s) / 1000,
    ...cancelAt(r, v.t),
  });
}

// ---- Q3b: named waits landing mid-tier ----
const waits = JSON.parse(readFileSync(WAITS, "utf8"));
const known = new Set(testFiles.map((f) => f.path));
const expand = (p) => { // braces, then globs, against the listed fast Vitest files
  const m = /^(.*)\{([^}]*)\}(.*)$/.exec(p);
  if (m) return m[2].split(",").flatMap((x) => expand(m[1] + x + m[3]));
  if (!p.includes("*")) return [p];
  const re = new RegExp("^" + p.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
  return [...known].filter((k) => re.test(k));
};
const failBefore = db.prepare("select count(*) n from results r join checks c on c.id = r.check_id where r.worktree_id = ? and c.test_path = ? and r.outcome = 'fail' and r.recorded_at < ?");
const lastKnown = (f, before) => { // the file's duration in its latest run that ended before `before`, any worktree
  let best = null;
  for (const r of runs) if (r.e < before && r.dur.has(f) && (best === null || r.e > best.e)) best = r;
  return best?.dur.get(f) ?? null;
};
const episodes = new Map();
let namedFast = 0, namedFastMidTier = 0, allRunning = 0;
for (const w of waits) {
  if (!w.cwd || !w.paths.length) continue;
  const root = roots.find((x) => w.cwd === x.root || w.cwd.startsWith(x.root + "/"));
  if (!root || w.at < span.from || w.at > span.to) continue;
  const sub = w.cwd.slice(root.root.length + 1);
  const paths = [...new Set(w.paths.flatMap(expand).map((p) => (known.has(p) || !sub ? p : `${sub}/${p}`)).filter((p) => known.has(p)))];
  if (!paths.length) continue;
  namedFast++;
  const r = inFlight(root.id, w.at);
  if (!r) continue;
  namedFastMidTier++;
  const blocked = [];
  for (const path of paths) {
    if (r.files.some((f) => f.endsWith("\0" + path))) continue;
    const fid = r.files.length ? null : null;
    const mine = (runsOf.get(root.id) ?? []).filter((x) => x.s >= w.at && x.files.some((f) => f.endsWith("\0" + path)));
    const next = mine[0];
    if (!next || next.s < r.e - 1000 || next.s - w.at > 1800_000) continue;
    // Pending at the wait: no revision between the wait and its run re-keyed it.
    const rekeyed = (revsOf.get(root.id) ?? []).some((v) => v.t > w.at && v.t < next.s && v.changes.some((c) => [...(byPath.get(c.path) ?? [])].some((f) => f.endsWith("\0" + path))));
    if (rekeyed) continue;
    const done = mine.find((x) => [...x.completed].some((f) => f.endsWith("\0" + path))) ?? next;
    const f = done.files.find((x) => x.endsWith("\0" + path));
    blocked.push({ path, next, done, own: done.dur.get(f) ?? null, overhead: overhead(done), failing: failBefore.get(root.id, path, w.at).n > 0 });
  }
  if (!blocked.length) { allRunning++; continue; }
  const key = `${root.id}\0${r.id}`;
  const ep = episodes.get(key) ?? { wt: root.id.slice(0, 8), run: r.id.slice(0, 8), r, t0: w.at, waits: 0, src: w.src, files: new Map() };
  ep.waits++;
  for (const b of blocked) if (!ep.files.has(b.path)) ep.files.set(b.path, { ...b, t: w.at });
  episodes.set(key, ep);
}
const CANCEL_S = 3.1; // recorded cancel to run end, p50 (cancels.mjs)
const eps = [...episodes.values()].map((e) => {
  const files = [...e.files.values()];
  const first = files.reduce((a, b) => (a.done.e <= b.done.e ? a : b));
  const own = Math.min(...files.map((b) => (b.own ?? 0) + b.overhead));
  const el = (e.t0 - e.r.s) / 1000;
  const est = Math.max(0, ...e.r.files.map((f) => (lastKnown(f, e.r.s) ?? 0) - el));
  return {
    wt: e.wt, run: e.run, at: new Date(e.t0).toISOString(), waits: e.waits, src: e.src, tierFiles: e.r.files.length,
    named: files.length, failing: files.some((b) => b.failing), firstFile: first.path.split("/").pop(),
    behindS: (e.r.e - e.t0) / 1000, todayS: (first.done.e - e.t0) / 1000, cancelS: CANCEL_S + own,
    estRemainingS: est, superseded: false, cut: cancelAt(e.r, e.t0),
  };
});
// ---- Fairness: how many consecutive runs of one file a cancel-on-every-event rule would cut ----
const cuts = new Map(); // file at worktree -> list of runs, each hit (true) or not
for (const r of runs) {
  const hits = revEvents.some((v) => v.run === r.id.slice(0, 8) && (v.reaches > 0 || v.recreate)) ||
    eps.some((e) => e.run === r.id.slice(0, 8));
  for (const f of r.files) {
    const k = `${r.wt}\0${f}`;
    if (!cuts.has(k)) cuts.set(k, []);
    cuts.get(k).push(hits);
  }
}
const streaks = [];
for (const seq of cuts.values()) { let n = 0; for (const h of seq) { if (h) n++; else { if (n) streaks.push(n); n = 0; } } if (n) streaks.push(n); }

const out = { span: { from: new Date(span.from).toISOString(), to: new Date(span.to).toISOString() }, runs: runs.length, revEvents, episodes: eps, streaks };
writeFileSync("/tmp/r381/mid-tier.json", JSON.stringify(out, null, 1));
const wall = runs.map((r) => (r.e - r.s) / 1000);
console.log(`span ${out.span.from} .. ${out.span.to}; fast Vitest runs ${runs.length} (${runs.filter((r) => r.report).length} with a report), worktrees ${runsOf.size}; run wall ${JSON.stringify(stats(wall))}`);
console.log(`runs over 60 s: ${wall.filter((x) => x > 60).length}, over 300 s: ${wall.filter((x) => x > 300).length}; Vitest-lane time in runs over 60 s: ${wall.filter((x) => x > 60).reduce((a, b) => a + b, 0).toFixed(0)} of ${wall.reduce((a, b) => a + b, 0).toFixed(0)} s`);
const cls = (name, xs) => console.log(`${name}: ${xs.length}; cancelled today ${xs.filter((v) => v.cancelledToday).length}; residual (tier end - event) of the uncancelled ${JSON.stringify(stats(xs.filter((v) => !v.cancelledToday).map((v) => v.residualS)))}`);
const reaching = revEvents.filter((v) => v.reaches > 0 || v.recreate);
console.log(`revisions during a fast Vitest tier: ${revEvents.length}, reaching a fast Vitest file or recreating: ${reaching.length}; tiers hit ${new Set(reaching.map((v) => v.run)).size} of ${runs.length}`);
cls(" (b) supersedes a file of the tier", reaching.filter((v) => v.supersedes > 0));
cls("     of which every unfinished file superseded", reaching.filter((v) => v.supersedes > 0 && v.unfinishedSuperseded === v.lost));
cls(" (a) reaches only other files", reaching.filter((v) => v.supersedes === 0 && !v.recreate));
cls(" (c') recreates the instance", reaching.filter((v) => v.recreate));
cls("     catch-up revisions among them", reaching.filter((v) => v.catchUp));
const unc = reaching.filter((v) => !v.cancelledToday);
console.log(`a cancel at each uncancelled event: keeps ${unc.reduce((a, v) => a + v.kept, 0)} files, cuts ${unc.reduce((a, v) => a + v.lost, 0)}, throws away ${unc.reduce((a, v) => a + v.lostWork, 0).toFixed(0)} file-seconds`);
console.log(`named waits on a fast Vitest file in the span: ${namedFast}; asked while a fast tier ran: ${namedFastMidTier}; with no named file blocked by it: ${allRunning}`);
for (const [name, xs] of [["all", eps], ["tier of <= 4 files", eps.filter((e) => e.tierFiles <= 4)], ["tier of > 4 files", eps.filter((e) => e.tierFiles > 4)], ["a named file failing before", eps.filter((e) => e.failing)]]) {
  console.log(`episodes ${name}: ${xs.length} (waits ${xs.reduce((a, e) => a + e.waits, 0)})`);
  console.log(`  behind the tier ${JSON.stringify(stats(xs.map((e) => e.behindS)))}`);
  console.log(`  first named verdict today ${JSON.stringify(stats(xs.map((e) => e.todayS)))}`);
  console.log(`  first named verdict under cancel ${JSON.stringify(stats(xs.map((e) => e.cancelS)))}`);
  const small = xs.filter((e) => e.tierFiles <= 4);
  console.log(`  cancel at the first wait (tiers <= 4 files): cuts ${small.reduce((a, e) => a + e.cut.lost, 0)} files, ${small.reduce((a, e) => a + e.cut.lostWork, 0).toFixed(0)} file-seconds; keeps ${small.reduce((a, e) => a + e.cut.kept, 0)}`);
}
console.log(`fairness: consecutive runs of one file hit by an event: ${JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k + (k === 5 ? "+" : ""), streaks.filter((s) => (k === 5 ? s >= 5 : s === k)).length])))}`);

// ---- The yield rule: cancel free when every unfinished file is superseded; else yield to queued
// edit work or a promoted file only when the tier's estimated remainder exceeds YIELD_S and no file
// of it was cut by a yield since its last completed run (each file cut at most once per key). ----
for (const [YIELD_S, OVERDUE] of [[0, false], [15, false], [30, false], [60, false], [120, false], [30, true], [60, true]]) {
  const cutOnce = new Set(); // `${wt}\0${file}` cut by a yield and not yet run to its end
  const events = [
    ...revEvents.filter((v) => v.reaches > 0 || v.recreate).map((v) => ({ kind: "rev", t: Date.parse(v.at), v })),
    ...eps.map((e) => ({ kind: "named", t: Date.parse(e.at), e })),
  ].sort((a, b) => a.t - b.t);
  const byId = new Map(runs.map((r) => [r.id.slice(0, 8), r]));
  const cancelled = new Set();
  let freeCuts = 0, yieldCuts = 0, refused = 0, filesCut = 0, lostWork = 0;
  const revWait = [], namedWait = [], namedToday = [];
  for (const ev of events) {
    const r = byId.get(ev.kind === "rev" ? ev.v.run : ev.e.run);
    const today = ev.kind === "rev" ? ev.v.residualS : ev.e.behindS;
    if (cancelled.has(r.id) || (ev.kind === "rev" && ev.v.cancelledToday)) { // already gone
      (ev.kind === "rev" ? revWait : namedWait).push(ev.kind === "rev" && ev.v.cancelledToday ? Math.min(today, CANCEL_S) : CANCEL_S);
      continue;
    }
    const el = (ev.t - r.s) / 1000;
    const unfinished = r.files.filter((f) => !((r.dur.get(f) ?? Infinity) <= el));
    const free = ev.kind === "rev" && ev.v.supersedes > 0 && ev.v.unfinishedSuperseded === ev.v.lost;
    const est = Math.max(0, ...unfinished.map((f) => { const d = lastKnown(f, r.s); return d === null || (OVERDUE && d <= el) ? (OVERDUE ? Infinity : 0) : d - el; }));
    const fair = !unfinished.some((f) => cutOnce.has(`${r.wt}\0${f}`));
    const go = free || (est > YIELD_S && fair);
    if (!go) { if (est > YIELD_S) refused++; (ev.kind === "rev" ? revWait : namedWait).push(today); continue; }
    cancelled.add(r.id);
    if (free) freeCuts++; else yieldCuts++;
    const c = cancelAt(r, ev.t);
    filesCut += c.lost;
    if (!free) { lostWork += c.lostWork; for (const f of unfinished) cutOnce.add(`${r.wt}\0${f}`); }
    (ev.kind === "rev" ? revWait : namedWait).push(Math.min(today, CANCEL_S));
  }
  // A file's cut mark ends when a later run of it ends uncut: approximated by the next run (not modelled).
  console.log(`YIELD_S ${YIELD_S}${OVERDUE ? " (unknown or overdue counts long)" : ""}: free cancels ${freeCuts}, yields ${yieldCuts}, refused by fairness ${refused}; files cut ${filesCut}, lost file-seconds (yields only) ${lostWork.toFixed(0)}`);
  console.log(`  edit's wait for the tier ${JSON.stringify(stats(revWait))}; named wait behind the tier ${JSON.stringify(stats(namedWait))}`);
}
const gaps = eps.map((e) => e.todayS - e.behindS);
console.log(`named episodes: after the tier until the first named verdict ${JSON.stringify(stats(gaps))}`);
console.log(`today, leave: behind ${JSON.stringify(stats(eps.map((e) => e.behindS)))}`);

// ---- After the tier: what ran between the blocking tier's end and the named file's run ----
const waitsBy = new Map();
for (const w of waits) { if (!w.cwd) continue; const root = roots.find((x) => w.cwd === x.root || w.cwd.startsWith(x.root + "/")); if (!root) continue; if (!waitsBy.has(root.id)) waitsBy.set(root.id, []); waitsBy.get(root.id).push(w); }
const after = [];
for (const e of episodes.values()) {
  const files = [...e.files.values()];
  const first = files.reduce((a, b) => (a.done.e <= b.done.e ? a : b));
  const between = (runsOf.get(e.r.wt) ?? []).filter((x) => x.s >= e.r.e - 1000 && x.s < first.next.s);
  // Was a named wait open at the tier boundary (promotion lives only while a wait is open)?
  const open = (waitsBy.get(e.r.wt) ?? []).some((w) => w.at <= e.r.e && w.at + w.ms >= e.r.e);
  after.push({ runsBetween: between.length, wallBetween: between.reduce((a, x) => a + (x.e - x.s) / 1000, 0), promotedAtBoundary: open, nextIsNamed: between.length === 0, timedOutBetween: between.filter((x) => x.end === "timed-out").length, rerunsOfNamed: first.done !== first.next });
}
console.log(`after the tier: next run is the named file's in ${after.filter((a) => a.nextIsNamed).length} of ${after.length}; a wait open at the boundary in ${after.filter((a) => a.promotedAtBoundary).length}; next is named when open ${after.filter((a) => a.promotedAtBoundary && a.nextIsNamed).length}, when not open ${after.filter((a) => !a.promotedAtBoundary && a.nextIsNamed).length} of ${after.filter((a) => !a.promotedAtBoundary).length}`);
console.log(`  runs between ${JSON.stringify(stats(after.map((a) => a.runsBetween)))}; their wall ${JSON.stringify(stats(after.map((a) => a.wallBetween)))}; timed-out runs between ${after.reduce((s, a) => s + a.timedOutBetween, 0)}; named file needed a later run ${after.filter((a) => a.rerunsOfNamed).length}`);
{
  const start = [], ownRun = [];
  for (const e of episodes.values()) {
    const files = [...e.files.values()];
    const first = files.reduce((a, b) => (a.done.e <= b.done.e ? a : b));
    start.push((first.next.s - e.r.e) / 1000);
    ownRun.push((first.done.e - first.next.s) / 1000);
  }
  console.log(`  tier end to the named file's run start ${JSON.stringify(stats(start))}; that run's start to its end ${JSON.stringify(stats(ownRun))}`);
}
{
  const YIELD_S = 30;
  const byId = new Map(runs.map((r) => [r.id.slice(0, 8), r]));
  const why = { yielded: 0, estLow: 0, estUnknown: 0, short: 0 };
  for (const e of eps) {
    if (e.behindS <= YIELD_S) { why.short++; continue; }
    const r = byId.get(e.run), t = Date.parse(e.at), el = (t - r.s) / 1000;
    const unfinished = r.files.filter((f) => !((r.dur.get(f) ?? Infinity) <= el));
    const known = unfinished.map((f) => lastKnown(f, r.s));
    const est = Math.max(0, ...known.map((d) => (d ?? 0) - el));
    if (est > YIELD_S) why.yielded++;
    else if (known.every((d) => d === null)) why.estUnknown++;
    else why.estLow++;
  }
  console.log(`named episodes at YIELD_S 30: ${JSON.stringify(why)}`);
}
{
  const today = revEvents.filter((v) => v.reaches > 0 || v.recreate).map((v) => (v.cancelledToday ? Math.min(v.residualS, CANCEL_S) : v.residualS));
  console.log(`LEAVE (today): edit's wait for the tier ${JSON.stringify(stats(today))}; named wait behind the tier ${JSON.stringify(stats(eps.map((e) => e.behindS)))}`);
  const all = revEvents.filter((v) => v.reaches > 0 || v.recreate);
  console.log(`CANCEL ALWAYS: files cut ${all.filter((v) => !v.cancelledToday).reduce((a, v) => a + v.lost, 0) + eps.reduce((a, e) => a + e.cut.lost, 0)}, lost file-seconds ${(all.filter((v) => !v.cancelledToday).reduce((a, v) => a + v.lostWork, 0) + eps.reduce((a, e) => a + e.cut.lostWork, 0)).toFixed(0)} (upper bound: a tier cancelled once is counted at every event)`);
  for (const e of eps.filter((e) => ["5022c74c", "c12ea906"].includes(e.wt) || e.at.startsWith("2026-10-20T22:5") || e.at.startsWith("2026-10-20T23:0"))) console.log("incident episode", JSON.stringify(e));
}
