// Throwaway: summarizes replay.mjs output. node summarize.mjs <out.json>
import { readFileSync } from "node:fs";
const { counts, pairs } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sec = (xs) => Math.round(xs.reduce((a, p) => a + p.ms, 0) / 1000);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
const today = pairs.filter((p) => p.today);
const other = pairs.filter((p) => !p.today);
const withSet = today.filter((p) => p.hasSet);
console.log("counts", counts);
console.log(`pairs ${pairs.length} (${sec(pairs)} s); closure-driven ${today.length} (${sec(today)} s); other reason ${other.length} (${sec(other)} s)`);
console.log(`closure-driven with a loaded set: ${withSet.length} of ${today.length} runs (${pct(withSet.length, today.length)}), ${sec(withSet)} of ${sec(today)} s; graph from`, Object.fromEntries(Object.entries(Object.groupBy(today, (p) => p.graph)).map(([k, v]) => [k, v.length])), "");
for (const s of ["s1", "s2"]) {
  const skip = withSet.filter((p) => p[s] === "skip");
  console.log(`${s}: skips ${skip.length} of ${withSet.length} runs (${pct(skip.length, withSet.length)}), ${sec(skip)} of ${sec(withSet)} s (${pct(sec(skip), sec(withSet))})`);
  const misses = skip.filter((p) => p.failedNow && !p.failedBefore);
  const failsSkipped = skip.filter((p) => p.failedNow);
  const newFails = withSet.filter((p) => p.failedNow && !p.failedBefore);
  console.log(`  new failures among closure-driven runs with a set: ${newFails.length}; skipped by ${s}: ${misses.length}; any failing run skipped: ${failsSkipped.length}`);
  for (const m of failsSkipped) console.log("   ", m.wt.slice(0, 8), m.test, `r${m.prevRev}->r${m.rev}`, m.failedBefore ? "(failing before too)" : "(NEW)", JSON.stringify(m.paths));
}
// Q1: why today's rule ran the files the pure rule skips: the kinds of changed paths, by run and seconds
const skip1 = withSet.filter((p) => p.s1 === "skip");
const kindRuns = {}, kindSec = {};
for (const p of skip1) for (const k of Object.keys(p.kinds)) if (k !== "outside") { kindRuns[k] = (kindRuns[k] ?? 0) + 1; kindSec[k] = (kindSec[k] ?? 0) + p.ms / 1000; }
console.log("S1-skipped runs by kind of changed path (a run can have several):");
for (const k of Object.keys(kindRuns).sort((a, b) => kindSec[b] - kindSec[a])) console.log(`  ${k}: ${kindRuns[k]} runs, ${Math.round(kindSec[k])} s (${pct(kindSec[k], sec(skip1))})`);
// sole kind
const sole = {};
for (const p of skip1) { const ks = Object.keys(p.kinds).filter((k) => k !== "outside"); const k = ks.length === 1 ? ks[0] : "mixed:" + ks.sort().join("+"); sole[k] = (sole[k] ?? 0) + p.ms / 1000; }
console.log("by sole kind, s:", Object.fromEntries(Object.entries(sole).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])));
// examples
const ex = {};
for (const p of skip1) for (const [k, v] of Object.entries(p.paths)) if (k !== "outside") (ex[k] ??= new Map()).set(v[0], (ex[k].get(v[0]) ?? 0) + 1);
for (const [k, m] of Object.entries(ex)) console.log(" ex", k, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4));
// set sizes
const sizes = withSet.map((p) => p.setSize).sort((a, b) => a - b);
console.log("loaded set size median", sizes[Math.floor(sizes.length / 2)], "p90", sizes[Math.floor(sizes.length * 0.9)]);
// per revision: distinct (wt, rev)
const revs = new Map();
for (const p of withSet) { const id = p.wt + p.rev; const r = revs.get(id) ?? { n: 0, s: 0, skip: 0, skipS: 0 }; r.n++; r.s += p.ms; if (p.s1 === "skip") { r.skip++; r.skipS += p.ms; } revs.set(id, r); }
const rs = [...revs.values()];
const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`revisions ${rs.length}: median runs ${med(rs.map((r) => r.n))}, median S1 skip share ${med(rs.map((r) => r.skip / r.n)).toFixed(2)}; revisions with 100+ runs: ${rs.filter((r) => r.n >= 100).length}, their S1 skip share of seconds ${pct(rs.filter((r) => r.n >= 100).reduce((a, r) => a + r.skipS, 0), rs.filter((r) => r.n >= 100).reduce((a, r) => a + r.s, 0))}`);
