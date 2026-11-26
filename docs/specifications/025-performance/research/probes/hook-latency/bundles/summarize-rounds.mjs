// Throwaway probe (row 025-14). Pools several hook-runs.probe.ts outputs of
// the same dists (rounds): per case and dist the pooled p50/p95, the median
// over rounds of each round's p95 (latency.test.ts keeps the best round of up
// to 3), and the median over rounds of each dist's p50 change against the
// first dist (paired within a round, so a noisy round moves both sides).
// Usage: node summarize-rounds.mjs <round.json>...
import { readFileSync } from "node:fs";

const rounds = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const med = (xs) => q(xs, 0.5);
console.log(`node ${rounds[0].node}, ${rounds.length} rounds, loads ${rounds.map((r) => r.loads.map((l) => l.toFixed(1)).join(" ")).join(" | ")}`);
console.log("case | dist | pooled p50/p95 | median round p95 | best round p95 | median paired p50 change, p95 change");
for (const c of Object.keys(rounds[0].samples)) {
  const dists = Object.keys(rounds[0].samples[c]);
  const first = dists[0];
  for (const d of dists) {
    const all = rounds.flatMap((r) => r.samples[c][d]);
    const p95s = rounds.map((r) => q(r.samples[c][d], 0.95));
    const dp50 = rounds.map((r) => q(r.samples[c][d], 0.5) - q(r.samples[c][first], 0.5));
    const dp95 = rounds.map((r) => q(r.samples[c][d], 0.95) - q(r.samples[c][first], 0.95));
    console.log(`${c} | ${d} | ${q(all, 0.5).toFixed(1)}/${q(all, 0.95).toFixed(1)} | ${med(p95s).toFixed(1)} | ${Math.min(...p95s).toFixed(1)} | ${d === first ? "" : `${med(dp50).toFixed(1)}, ${med(dp95).toFixed(1)}`}`);
  }
}
