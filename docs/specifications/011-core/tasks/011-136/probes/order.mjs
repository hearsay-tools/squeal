// Row 011-136: what the same cancels would have cut if each backlog tier ran its longest files first, modelled.
// Usage: node order.mjs <store copy> <hours> <runs snapshot> <end, ISO time>
// Per tier an edit cancelled: each picked file's module duration (this run's report, else the next run of the
// worktree that reports it, else the median of the tier), the order its modules ended in (Spearman's rho of
// end rank against pick index), and W, the number of workers whose list schedule in that order ends as many
// files by the cancel as the run did. Then the same schedule longest first at that W, cancelled at the same time.
// "Cut seconds" are the seconds the files in flight at the cancel had run. Read only; prints one JSON line a tier.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , path, hours, logs, endArg] = process.argv;
if (!endArg) throw new Error("usage: order.mjs <store copy> <hours> <runs snapshot> <end>");
const db = new DatabaseSync(path, { readOnly: true });
const end = Date.parse(endArg), since = end - Number(hours) * 3600_000;
const read = (dir, name) => { try { return readFileSync(`${logs}/${dir.split("/").pop()}/${name}`, "utf8"); } catch { return null; } };
const reportOf = (r) => (r.rep ??= (() => { try { return JSON.parse(read(r.log_dir, "report.json")).report ?? null; } catch { return null; } })());
const id = (f) => f.project + "\0" + f.path;
const label = (k) => { const [p, f] = k.split("\0"); return p ? `[${p}] ${f}` : f; };
const all = db.prepare("SELECT * FROM runs ORDER BY started_at").all();
const byWorktree = new Map();
for (const r of all) { const l = byWorktree.get(r.worktree_id) ?? []; byWorktree.set(r.worktree_id, l); l.push(r); }
const picks = (r) => (r.picks ??= JSON.parse(r.test_files).map(id));
const durationsOf = (r) => (r.durs ??= new Map((reportOf(r)?.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000])));
// List scheduling: each file in `order` starts on the first free of `w` workers. At `tc`: ended, in flight, cut seconds.
const schedule = (order, w, tc) => {
  const free = Array(w).fill(0);
  let ended = 0, inFlight = 0, cut = 0, endedSecs = 0;
  for (const d of order) {
    const i = free.indexOf(Math.min(...free)), s = free[i];
    if (s >= tc) break;
    free[i] = s + d;
    if (s + d <= tc) { ended++; endedSecs += d; } else { inFlight++; cut += tc - s; }
  }
  return { ended, inFlight, cutSecs: +cut.toFixed(1), endedSecs: +endedSecs.toFixed(1) };
};
const rho = (xs) => {
  const n = xs.length; if (n < 3) return null;
  const rank = [...xs].map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const r = Array(n); rank.forEach((j, k) => (r[j] = k));
  const d2 = r.reduce((a, rk, i) => a + (rk - i) ** 2, 0);
  return +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(2);
};
for (const run of all) {
  if (run.started_at < since || run.started_at > end || run.ended_at === null) continue;
  const rep = reportOf(run);
  if (!String(rep?.failure ?? "").startsWith("run cancelled: an edit arrived during a backlog tier")) continue;
  const files = picks(run);
  const later = (byWorktree.get(run.worktree_id) ?? []).filter((r) => r.started_at > run.started_at);
  const own = durationsOf(run);
  const known = files.map((k) => own.get(k) ?? later.map((r) => durationsOf(r).get(k)).find((d) => d !== undefined) ?? null);
  const sorted = known.filter((d) => d !== null).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const d = known.map((x) => x ?? median);
  const ends = (read(run.log_dir, "vitest.log") ?? "").split("\n").filter((l) => l.startsWith("MODULE "))
    .map((l) => files.findIndex((k) => l.endsWith(" " + label(k)))).filter((i) => i >= 0);
  const r = rho(ends);
  const kind = r === null ? "few" : r > 0.5 ? "pick order" : r < -0.5 ? "longest first" : "mixed";
  const tc = rep.durationMs / 1000;
  const observed = kind === "longest first" ? [...d].sort((a, b) => b - a) : d;
  const completed = (rep.completedFiles ?? []).length;
  let w = 1, best = Infinity;
  for (let k = 1; k <= 24; k++) { const e = Math.abs(schedule(observed, k, tc).ended - completed); if (e < best) { best = e; w = k; } }
  console.log(JSON.stringify({
    run: run.id.slice(0, 8), picked: files.length, unknownDurations: known.filter((x) => x === null).length, rho: r, kind,
    cancelAtS: tc, completed, width: w, fitError: best,
    asRun: schedule(observed, w, tc), longestFirst: schedule([...d].sort((a, b) => b - a), w, tc),
    tierSecs: +d.reduce((a, b) => a + b, 0).toFixed(1), longestSecs: +Math.max(...d).toFixed(1),
  }));
}
