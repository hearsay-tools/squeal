// 011-416 probe (throwaway): what a shorter catch-up quiet would have done to each recorded catch-up.
// Usage: node bursts.mjs <store copy> <runs snapshot> <squeal.config.json> <since ISO> <Q's> <N> [dump]
// Anchored on recorded runs, not on a modelled queue (sim.mjs overstates the queue: a file whose new key
// another worktree already stored does not run).
// 1. Revisions: watch revisions since <since> that reach a test file (closure, own path or declared input),
//    editor scratch only skipped. An "edit" has fewer than 10 keyed paths (CATCH_UP_KEYED_PATHS).
// 2. A recorded catch-up start: a run (no checkpoint) that starts 119 to 126 s after the last such revision.
//    Its episode: every run started from it until the next revision. F = the files those runs held,
//    p = their recorded file-seconds over the episode's wall (files at once).
// 3. Its burst: the revisions after the previous catch-up start (or the episode's 2 h before) up to 119 s
//    before it. The last one ended the quiet: under Q' the start comes 120 - Q' s sooner when the queue then
//    held more than N files. Each earlier gap g in [Q', 120) between two burst revisions starts catch-up
//    early under Q' (queue then more than N), for g - Q' s, until the next edit cancels it (backlog.ts:44).
//    Queue then = files of F the burst's revisions up to that one reached, plus files of F no burst revision
//    reached (left from before). Of the early work T x p file-s, the share rho of F that later burst
//    revisions re-key is wasted; the rest is kept, less the in-flight cut, p x min(T, median file) / 2.
import { DatabaseSync } from "node:sqlite"; import { readFileSync, existsSync } from "node:fs"; import { matchesGlob } from "node:path";
const [, , storePath, runsDir, configPath, since, Qarg, Narg, dump] = process.argv;
const Q = Number(Qarg) * 1000, N = Number(Narg), t0 = Date.parse(since);
const db = new DatabaseSync(storePath, { readOnly: true });
const inputs = Object.entries(JSON.parse(readFileSync(configPath, "utf8")).inputs ?? {});
const SCRATCH = (p) => { const n = p.slice(p.lastIndexOf("/") + 1); return n === "4913" || /^\..+\.sw[a-p]$/.test(n) || /^\.#./.test(n); };
const rev = new Map(), byPath = new Map(), declared = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) {
  const id = t.project + "\0" + t.path; (byPath.get(t.path) ?? byPath.set(t.path, []).get(t.path)).push(id);
  for (const p of JSON.parse(t.closure_paths)) (rev.get(p) ?? rev.set(p, new Set()).get(p)).add(id);
  const globs = inputs.filter(([g]) => g === t.path || matchesGlob(t.path, g)).flatMap(([, v]) => v); if (globs.length) declared.set(id, globs);
}
function reachOf(paths) { const reach = new Set(); let keyed = 0; for (const p of paths) { let k = false; for (const id of byPath.get(p) ?? []) { reach.add(id); k = true; } for (const id of rev.get(p) ?? []) { reach.add(id); k = true; } for (const [id, g] of declared) if (g.some((x) => matchesGlob(p, x))) { reach.add(id); k = true; } if (k) keyed++; } return { reach, keyed }; }
const report = (id) => { const f = `${runsDir}/${id}/report.json`; if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, "utf8")).report; } catch { return null; } };
const byW = new Map();
for (const r of db.prepare("SELECT worktree_id w, created_at t, changes FROM revisions WHERE trigger = 'watch' AND created_at >= ? ORDER BY created_at").all(t0)) {
  const paths = JSON.parse(r.changes).map((c) => c.path); if (paths.every(SCRATCH)) continue;
  const { reach, keyed } = reachOf(paths); if (reach.size === 0) continue;
  (byW.get(r.w) ?? byW.set(r.w, []).get(r.w)).push({ t: r.t, reach, edit: keyed < 10 });
}
const tot = { wallsLarge: [], extraWork: 0, cutLarge: 0, episodes: 0, large: 0, sooner: 0, soonerFiles: 0, innerGaps: 0, earlyStarts: 0, earlyWork: 0, waste: 0, kept: 0, files: 0, gapsAll: [] };
for (const [w, revs] of byW) {
  const runs = db.prepare("SELECT id, started_at s, ended_at e, test_files tf FROM runs WHERE worktree_id = ? AND checkpoint_id IS NULL AND started_at >= ? ORDER BY started_at").all(w, t0);
  const lastBefore = (t) => { let i = -1; for (let j = 0; j < revs.length && revs[j].t <= t; j++) i = j; return i; };
  let prevStart = -Infinity;
  for (const run of runs) {
    const li = lastBefore(run.s); if (li < 0) continue; const d = (run.s - revs[li].t) / 1000;
    if (!(d >= 119 && d <= 126) || revs[li].t <= prevStart) continue;
    const next = revs[li + 1]?.t ?? Infinity;
    const ep = runs.filter((r) => r.s >= run.s && r.s < next);
    const F = new Set(); let fileMs = 0; const durs = [];
    for (const r of ep) { for (const f of JSON.parse(r.tf)) F.add((f.project ?? "") + "\0" + f.path); const rep = report(r.id); if (rep) for (const x of rep.fileDurations) { fileMs += x.durationMs; durs.push(x.durationMs); } }
    const wall = Math.max(1, Math.max(...ep.map((r) => r.e ?? r.s)) - run.s); const p = fileMs / wall;
    durs.sort((a, b) => a - b); const medDur = durs.length ? durs[Math.floor(durs.length / 2)] : 1000;
    const from = Math.max(prevStart, run.s - 2 * 3600_000);
    const burst = revs.filter((r) => r.t > from && r.t <= revs[li].t);
    prevStart = run.s; tot.episodes++;
    const reachedBy = burst.map((r) => new Set([...F].filter((id) => r.reach.has(id))));
    const reachedAny = new Set(reachedBy.flatMap((s) => [...s]));
    const leftover = [...F].filter((id) => !reachedAny.has(id)).length;
    const queueAt = (i) => { const s = new Set(); for (let j = 0; j <= i; j++) for (const id of reachedBy[j]) s.add(id); return s.size + leftover; };
    const lastQueue = queueAt(burst.length - 1);
    const rows = [];
    for (let i = 0; i + 1 < burst.length; i++) {
      const g = burst[i + 1].t - burst[i].t; tot.gapsAll.push(g / 1000);
      if (g >= 120_000 || g < Q) continue; tot.innerGaps++;
      const qn = queueAt(i); if (qn <= N) continue;
      tot.earlyStarts++;
      const T = g - Q; const work = T * p / 1000;
      const later = new Set(); for (let j = i + 1; j < burst.length; j++) for (const id of reachedBy[j]) later.add(id);
      const rho = later.size / Math.max(1, qn);
      const inflight = p * Math.min(T, medDur) / 2 / 1000;
      const waste = Math.min(work, rho * work + (1 - rho) * inflight);
      tot.earlyWork += work; tot.waste += waste; tot.kept += work - waste;
      rows.push({ gapS: g / 1000, queue: qn, earlyS: T / 1000, workFileS: Math.round(work), rho: +rho.toFixed(2), wasteFileS: Math.round(waste) });
    }
    // The sooner start adds (120 - Q') s of work at p before the next revision. Kept when the episode drained
    // anyway; when the next revision cut it, the share of F that revisions of the next 2 h re-key is wasted.
    const cut = next !== Infinity && Math.max(...ep.map((r) => r.e ?? r.s)) > next;
    let extra = 0, extraWaste = 0;
    const large = lastQueue > N;
    if (large) {
      tot.large++; tot.sooner += (120_000 - Q) / 1000; tot.soonerFiles += F.size;
      if (cut) { extra = (120_000 - Q) * p / 1000; const after = new Set(); for (const r of revs) if (r.t >= next && r.t < next + 2 * 3600_000) for (const id of F) if (r.reach.has(id)) after.add(id); const rhoNext = after.size / F.size; extraWaste = rhoNext * extra + (1 - rhoNext) * p * Math.min((120_000 - Q), medDur) / 2 / 1000 * 0; tot.extraWork += extra; tot.waste += extraWaste; tot.kept += extra - extraWaste; tot.cutLarge++; }
    }
    tot.files += F.size; if (large) tot.wallsLarge.push(Math.round(wall / 1000));
    if (dump) console.log(JSON.stringify({ w: w.slice(0, 6), start: new Date(run.s).toISOString().slice(5, 19), F: F.size, p: +p.toFixed(2), wallS: Math.round(wall / 1000), cut: next !== Infinity && Math.max(...ep.map((r) => r.e ?? r.s)) > next, burstRevs: burst.length, queueAtQuietStart: lastQueue, large, early: rows }));
  }
}
const g = tot.gapsAll.sort((a, b) => a - b); const share = (lo, hi) => g.filter((x) => x >= lo && x < hi).length;
console.log(JSON.stringify({ rule: `${Q / 1000}@${N}`, episodes: tot.episodes, largeEpisodes: tot.large, soonerS: tot.sooner, filesInLarge: tot.soonerFiles, burstGaps: g.length, gaps: { lt30: share(0, 30), "30-60": share(30, 60), "60-120": share(60, 120) }, innerGapsInWindow: tot.innerGaps, earlyStarts: tot.earlyStarts, earlyWorkFileS: Math.round(tot.earlyWork), cutLargeEpisodes: tot.cutLarge, soonerExtraWorkFileS: Math.round(tot.extraWork), largeEpisodeWallsS: tot.wallsLarge.sort((a, b) => a - b), wasteFileS: Math.round(tot.waste), keptFileS: Math.round(tot.kept) }));
