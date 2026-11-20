// 011-416 probe (throwaway): catch-up starts as recorded, from a store copy and a report.json snapshot.
// Usage: node episodes.mjs <store copy> <runs snapshot dir> [since ISO date] > episodes.jsonl
// For each live worktree: its watch revisions, and each run (no checkpoint) with d = start - last watch
// revision before it. A catch-up start is a run with d in [119, 126] s (CATCHUP_QUIET_MS = 120 s plus
// the pump's 1 s recheck and tier selection). Its episode is every run started from it until the next
// watch revision; the files they held are a lower bound on the backlog at the start (a revision that
// cancels the episode leaves the rest queued). Prints one JSON line per episode and a histogram of d.
import { DatabaseSync } from "node:sqlite"; import { readFileSync, existsSync } from "node:fs";
const [, , storePath, runsDir, since = "2026-10-25"] = process.argv;
const t0 = Date.parse(since);
const db = new DatabaseSync(storePath, { readOnly: true });
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id w, created_at t, changes FROM revisions WHERE trigger = 'watch' AND created_at >= ? ORDER BY created_at").all(t0))
  (revs.get(r.w) ?? revs.set(r.w, []).get(r.w)).push({ t: r.t, n: JSON.parse(r.changes).length });
const hist = new Map(); const bin = (d) => d < 0 ? "none" : d < 10 ? "<10" : d < 30 ? "10-30" : d < 60 ? "30-60" : d < 119 ? "60-119" : d <= 126 ? "119-126" : d < 300 ? "126-300" : ">=300";
const report = (id) => { const f = `${runsDir}/${id}/report.json`; if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, "utf8")).report; } catch { return null; } };
for (const [w, list] of revs) {
  const runs = db.prepare("SELECT id, started_at s, ended_at e, end_state st, test_files tf FROM runs WHERE worktree_id = ? AND checkpoint_id IS NULL AND started_at >= ? ORDER BY started_at").all(w, t0);
  let i = 0; const lastBefore = (t) => { let last = null; for (const r of list) { if (r.t > t) break; last = r; } return last; };
  const nextAfter = (t) => list.find((r) => r.t > t)?.t ?? Infinity;
  for (const run of runs) { const last = lastBefore(run.s); run.d = last ? (run.s - last.t) / 1000 : -1; hist.set(bin(run.d), (hist.get(bin(run.d)) ?? 0) + 1); }
  for (const run of runs) {
    if (!(run.d >= 119 && run.d <= 126)) continue;
    const last = lastBefore(run.s); const prev = runs.filter((r) => r.s < run.s && r.s > last.t && r.d >= 119 && r.d <= 126);
    if (prev.length) continue; // a second tier started in the same second: counted in the first's episode
    const end = nextAfter(run.s);
    const ep = runs.filter((r) => r.s >= run.s && r.s < end);
    const files = new Set(); let fileSecs = 0, completed = 0, inflightAtEnd = 0;
    for (const r of ep) { for (const f of JSON.parse(r.tf)) files.add((f.project ?? "") + "\0" + f.path); const rep = report(r.id); if (rep) { fileSecs += rep.fileDurations.reduce((a, x) => a + x.durationMs, 0) / 1000; completed += rep.completedFiles.length; } }
    const lastEnd = Math.max(...ep.map((r) => r.e ?? r.s));
    console.log(JSON.stringify({ w, start: run.s, d: run.d, quietFrom: last.t, tiers: ep.length, files: files.size, completed, fileSecs: Math.round(fileSecs), drainS: Math.round((lastEnd - run.s) / 1000), nextRevS: end === Infinity ? null : Math.round((end - run.s) / 1000), cutByRev: end !== Infinity && lastEnd > end }));
  }
}
console.error("runs by d (s since the last watch revision):", JSON.stringify(Object.fromEntries(hist)));
