// 011-300 probe (throwaway): tables for main-daemon-2.md from md2.mjs outputs.
// Usage: node report.cjs <out prefix> (for example out/cezar-env)
const fs = require("fs");
const [, , pre] = process.argv;
const rd = (f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const q = (a, p) => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))] : NaN; };
const k = (v) => Math.round(v).toLocaleString("en-US");
const pc = rd(pre + "-percommit.jsonl");
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
console.log(`## Cost per main commit (${pc.length} commits, each against the one before)`);
console.log(`re-keyed: ${k(sum(pc, (x) => x.rekeyedSec))} s; already stored at equal content when it landed: ${k(sum(pc, (x) => x.storedAtLandSec))} s`);
console.log(`per commit re-keyed s: p50 ${k(q(pc.map((x) => x.rekeyedSec), 0.5))}, p90 ${k(q(pc.map((x) => x.rekeyedSec), 0.9))}, max ${k(q(pc.map((x) => x.rekeyedSec), 1))}; files p50 ${q(pc.map((x) => x.rekeyed), 0.5)}, p90 ${q(pc.map((x) => x.rekeyed), 0.9)} of ${pc.at(-1).files}`);
console.log(`commits that re-key nothing: ${pc.filter((x) => x.rekeyed === 0).length}; landing after commit time (min): p50 ${q(pc.map((x) => x.lagMin), 0.5)}, p90 ${q(pc.map((x) => x.lagMin), 0.9)}`);
const gaps = pc.slice(1).map((x, i) => (Date.parse(x.at) - Date.parse(pc[i].at)) / 60e3);
console.log(`gap between landings (min): p50 ${q(gaps, 0.5).toFixed(1)}, p90 ${q(gaps, 0.9).toFixed(1)}; landings at the same moment as the one before: ${gaps.filter((g) => g === 0).length}`);
const S = JSON.parse(fs.readFileSync(pre + "-sim.json", "utf8"));
console.log(`\n## Policies (recorded s, 72 h)`);
console.log(`| policy | rate s/min | targets | main ran | skipped (stored) | superseded | used later | worktree ran first | no worktree needed | first baseline spared, clean / dirty / total | restart baseline spared | other runs spared | all spared, clean only | all spared incl. dirty |`);
for (const x of S) {
  const g = (key) => x.by[key] ?? 0;
  const sp = (kind) => `${k(g(kind + " clean spared"))} / ${k(g(kind + " dirty spared"))} of ${k(g(kind + " clean total") + g(kind + " dirty total"))}`;
  const kinds = ["first", "restart", "none", "run-all"];
  const clean = sum(kinds, (kd) => g(kd + " clean spared")), all = clean + sum(kinds, (kd) => g(kd + " dirty spared"));
  console.log(`| ${x.policy} | ${x.rate} | ${x.targets} | ${k(x.ran)} | ${k(x.skippedStored)} | ${k(x.superseded)} | ${k(x.mainUsed)} | ${k(x.mainLate)} | ${k(x.mainUnneeded)} | ${sp("first")} | ${sp("restart")} | ${sp("none")} | ${k(clean)} | ${k(all)} |`);
}
const tot = S[0].by; const T = (re) => sum(Object.entries(tot).filter(([kk]) => re.test(kk)), ([, v]) => v);
console.log(`\nworktree file runs judged: total ${k(T(/ total$/))} s; clean ${k(T(/clean total$/))} s; first ${k(T(/^first .* total$/))}, restart ${k(T(/^restart .* total$/))}, other ${k(T(/^(none|run-all) .* total$/))}`);
for (const f of fs.readdirSync(require("path").dirname(pre)).filter((f) => f.startsWith(require("path").basename(pre) + "-wait-")).sort()) {
  const L = rd(require("path").dirname(pre) + "/" + f); const cov = L.filter((x) => x.cov > 0);
  console.log(`\n## Waiting, first baselines (${f}; covered = clean run of content the main daemon finished before the run)`);
  console.log(`baselines with ended runs ${L.length}; with a covered file ${cov.length}; all covered ${L.filter((x) => x.cov === x.n).length}; covered share of their seconds ${(100 * sum(L, (x) => x.covSec ?? 0) / sum(L, (x) => x.sec ?? 0)).toFixed(1)}%`);
  console.log(`covered files current earlier by (min, baselines with one): p50 ${q(cov.map((x) => x.lastCov), 0.5).toFixed(0)}, p90 ${q(cov.map((x) => x.lastCov), 0.9).toFixed(0)}`);
  console.log(`mean wait per ended file (min): today p50 ${q(L.map((x) => x.meanToday), 0.5).toFixed(1)}, p90 ${q(L.map((x) => x.meanToday), 0.9).toFixed(1)}; with main p50 ${q(L.map((x) => x.meanMain), 0.5).toFixed(1)}, p90 ${q(L.map((x) => x.meanMain), 0.9).toFixed(1)}`);
  const scaled = L.map((x) => x.lastToday * (x.sec ? 1 - x.covSec / x.sec : 1));
  console.log(`last ended file (min): today p50 ${q(L.map((x) => x.lastToday), 0.5).toFixed(0)}, p90 ${q(L.map((x) => x.lastToday), 0.9).toFixed(0)}; with main, today's times of uncovered files p50 ${q(L.map((x) => x.lastUncov), 0.5).toFixed(0)}, p90 ${q(L.map((x) => x.lastUncov), 0.9).toFixed(0)}; scaled by uncovered seconds p50 ${q(scaled, 0.5).toFixed(0)}, p90 ${q(scaled, 0.9).toFixed(0)}`);
  const per = L.map((x) => x.lastToday - x.lastUncov), perS = L.map((x, i) => x.lastToday - scaled[i]);
  console.log(`earlier by (min): kept times p50 ${q(per, 0.5).toFixed(0)}, p90 ${q(per, 0.9).toFixed(0)}; scaled p50 ${q(perS, 0.5).toFixed(0)}, p90 ${q(perS, 0.9).toFixed(0)}`);
}
for (const f of fs.readdirSync(require("path").dirname(pre)).filter((f) => f.startsWith(require("path").basename(pre) + "-start-")).sort()) {
  const L = rd(require("path").dirname(pre) + "/" + f);
  const w = L.filter((x) => x.listed > 0);
  console.log(`\n## Start verdict (${f}): first baselines ${L.length}, with listed misses ${w.length}, start commit from a revision ${L.filter((x) => x.fromRevision).length}`);
  console.log(`listed misses ${k(sum(L, (x) => x.listed))} files, ${k(sum(L, (x) => x.listedSec))} s; main had them done at the start: ${k(sum(L, (x) => x.covered))} files, ${k(sum(L, (x) => x.coveredSec))} s (${(100 * sum(L, (x) => x.coveredSec) / Math.max(1, sum(L, (x) => x.listedSec))).toFixed(1)}%)`);
  const sh = w.map((x) => (x.listedSec ? x.coveredSec / x.listedSec : 0));
  console.log(`per baseline covered share of listed seconds: p50 ${(100 * q(sh, 0.5)).toFixed(0)}%, p90 ${(100 * q(sh, 0.9)).toFixed(0)}%; baselines with no listed miss left: ${w.filter((x) => x.covered === x.listed).length} (today: ${L.length - w.length} listed none)`);
}
