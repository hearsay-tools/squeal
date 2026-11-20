// stats.mjs: per arm (row 011-423), from summary.mjs's JSON lines (JSON=1 node
// summary.mjs | node stats.mjs): run count, median and range of each measure,
// and for q and qc against base the difference of medians in seconds and
// percent with a 95% bootstrap interval (10,000 resamples, seeded) and a
// two-sided permutation p for the difference of means (10,000 shuffles).
// Kept-store runs (S-keep-*) are listed apart.
import { readFileSync } from "node:fs";
const rows = readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pick = (xs) => xs.map(() => xs[Math.floor(rnd() * xs.length)]);
const measures = { fileS: (r) => r.fileS ?? 0, wall: (r) => r.wall, endGap: (r) => r.endGap, lag: (r) => r.lag, minShared: (r) => Math.min(...r.shared), narrow: (r) => r.narrow, peak: (r) => r.peak, over: (r) => r.over, cpuS: (r) => r.cpuS };
const arms = ["base", "q", "qc", "keep"];
const by = Object.fromEntries(arms.map((a) => [a, rows.filter((r) => r.arm === a)]));
for (const a of arms) {
  if (!by[a].length) continue;
  console.log(`${a} (n = ${by[a].length}): ` + Object.entries(measures).map(([k, f]) => { const xs = by[a].map(f); return `${k} ${med(xs).toFixed(k === "minShared" ? 1 : 0)} [${Math.min(...xs).toFixed(k === "minShared" ? 1 : 0)}-${Math.max(...xs).toFixed(k === "minShared" ? 1 : 0)}]`; }).join(", "));
}
for (const a of ["q", "qc"]) {
  if (!by[a].length || !by.base.length) continue;
  for (const k of ["wall", "endGap", "lag", "cpuS"]) {
    const x = by[a].map(measures[k]), y = by.base.map(measures[k]);
    const d = med(x) - med(y);
    const boots = Array.from({ length: 10000 }, () => med(pick(x)) - med(pick(y))).sort((p, q) => p - q);
    const obs = Math.abs(mean(x) - mean(y)); const all = [...x, ...y]; let hits = 0;
    for (let i = 0; i < 10000; i++) { const s = [...all].sort(() => rnd() - 0.5); if (Math.abs(mean(s.slice(0, x.length)) - mean(s.slice(x.length))) >= obs) hits++; }
    console.log(`${a} vs base ${k}: median diff ${d.toFixed(0)} (${((100 * d) / med(y)).toFixed(1)}%), 95% bootstrap [${boots[250].toFixed(0)}, ${boots[9750].toFixed(0)}], permutation p ${(hits / 10000).toFixed(3)}`);
  }
}

// Blocked comparison: the runs in time order form blocks of three (one per arm, drive.sh), so a
// change of the VM's speed between blocks (row 011-423: from 20:48Z every run's file time rose by
// about 40%) cancels out. Per block, arm minus base; the median of those differences, its 95%
// bootstrap interval, and a sign-flip permutation p (each block's difference flipped at random).
// BLOCKS=n keeps the first n blocks (row 011-423: blocks 1 to 5 ran before the shared physical host's load).
const timed = rows.filter((r) => r.arm !== "keep").sort((a, b) => a.t0 - b.t0);
const blocks = [];
for (let i = 0; i + 2 < timed.length; i += 3) blocks.push(Object.fromEntries(timed.slice(i, i + 3).map((r) => [r.arm, r])));
const full = blocks.filter((b) => b.base && b.q && b.qc).slice(0, Number(process.env.BLOCKS ?? 99));
console.log(`\nblocks with all three arms: ${full.length}`);
for (const a of ["q", "qc"]) {
  for (const k of ["wall", "endGap", "lag", "cpuS", "fileS"]) {
    const d = full.map((b) => measures[k] ? measures[k](b[a]) - measures[k](b.base) : b[a][k] - b.base[k]);
    const base = full.map((b) => (measures[k] ? measures[k](b.base) : b.base[k]));
    const boots = Array.from({ length: 10000 }, () => med(pick(d))).sort((p, q) => p - q);
    const obs = Math.abs(mean(d)); let hits = 0;
    for (let i = 0; i < 10000; i++) if (Math.abs(mean(d.map((x) => (rnd() < 0.5 ? -x : x)))) >= obs) hits++;
    console.log(`${a} - base per block, ${k}: median ${med(d).toFixed(0)} (${((100 * med(d)) / med(base)).toFixed(1)}% of base's median), 95% bootstrap [${boots[250].toFixed(0)}, ${boots[9750].toFixed(0)}], sign-flip p ${(hits / 10000).toFixed(3)}, diffs ${d.map((x) => x.toFixed(0)).join(" ")}`);
  }
}
