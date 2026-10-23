// 011-143 probe (throwaway): summary of burst.sh's log with the probe daemon's store copy.
// Usage: node burst-sum.cjs <burst log.jsonl> <probe store copy> <cpus>
// Time to an edit's first result: the end of the first run that starts after the edit and holds a test
// file whose closure holds the edited path (or the path itself).
const { DatabaseSync } = require("node:sqlite"); const fs = require("fs");
const [, , log, store, ncpu] = process.argv;
// bc prints .42 for 0.42
const L = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l.replace(/:(-?)\.(\d)/g, ":$10.$2")));
const head = L[0]; const t0 = head.t0 * 1000;
const edits = L.filter((l) => l.edit); const samples = L.filter((l) => l.s !== undefined);
const end = L.find((l) => l.end !== undefined)?.end ?? samples.at(-1).t;
const db = new DatabaseSync(store, { readOnly: true });
const clo = new Map(db.prepare("select path, closure_paths from test_files").all().map((r) => [r.path, new Set(JSON.parse(r.closure_paths))]));
const runs = db.prepare("select started_at s, ended_at e, test_files f from runs where started_at >= ? order by started_at").all(t0 - 1000).map((r) => ({ s: r.s, e: r.e, f: JSON.parse(r.f).map((x) => x.path) }));
const per = edits.map((ed) => {
  const at = t0 + ed.t * 1000;
  const hit = runs.find((r) => r.s >= at && r.e && r.f.some((f) => f === ed.path || clo.get(f)?.has(ed.path)));
  return { edit: ed.edit, path: ed.path, firstResultS: hit ? +((hit.e - at) / 1000).toFixed(1) : null };
});
const cpuAt = (t) => { let best = samples[0]; for (const s of samples) if (s.t <= t) best = s; return best.cpu; };
const lastEdit = edits.at(-1).t;
const win = (a, b) => { const ss = samples.filter((s) => s.t >= a && s.t <= b); const mean = (k) => +(ss.reduce((x, s) => x + s[k], 0) / ss.length).toFixed(2);
  const cpu = (cpuAt(b) - cpuAt(a)) / 1e6; return { fromS: Math.round(a), toS: Math.round(b), cpuS: Math.round(cpu), shareOfPinned: +(cpu / ((b - a) * ncpu)).toFixed(2), meanLoad1: mean("load1"), maxLoad1: Math.max(...ss.map((s) => s.load1)), meanPinBusy: mean("pinBusy"), meanPinRunq: mean("pinRunq") }; };
const firsts = per.map((p) => p.firstResultS).filter((x) => x !== null).sort((a, b) => a - b);
const q = (f) => firsts[Math.min(firsts.length - 1, Math.floor(f * firsts.length))];
console.log(JSON.stringify({ label: head.label, edits: edits.length, endS: Math.round(end), capped: L.some((l) => l.capped), runs: runs.length, fileRuns: runs.reduce((x, r) => x + r.f.length, 0),
  burst: win(0, lastEdit + 30), drain: win(lastEdit + 30, end), whole: win(0, end),
  firstResult: { n: firsts.length, of: per.length, p50: q(0.5), p90: q(0.9), max: firsts.at(-1) }, per }, null, 1));
