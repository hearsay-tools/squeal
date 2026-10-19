// THROWAWAY probe (011-core/research/backlog-wall-budget.md). The "round" rule at several budgets:
// a backlog tier always takes one file per worker (one round), then more while
// sum/W + (1 - 1/W) * longest <= B. Same replay assumptions as model.mjs; cezar's tail from
// results/cezar-701f50.json.
import { readFileSync } from "node:fs";
const sum = (ds) => ds.reduce((a, b) => a + b, 0);
const makespan = (ds, w) => {
  const free = Array(Math.max(1, w)).fill(0);
  for (const d of ds) free[free.indexOf(Math.min(...free))] += d;
  return Math.max(...free);
};
const graham = (ds, w) => sum(ds) / w + (1 - 1 / w) * Math.max(...ds);
function replay(durations, w, fits) {
  const q = [...durations].sort((a, b) => a - b);
  const tiers = [];
  while (q.length) {
    const t = [q.shift()];
    while (q.length && t.length < 200 && fits([...t, q[0]], w)) t.push(q.shift());
    tiers.push(makespan(t, Math.min(w, t.length)));
  }
  const total = sum(tiers);
  return `${tiers.length} tiers, ${total.toFixed(0)} s, longest ${Math.max(...tiers).toFixed(0)} s, mean wait ${(sum(tiers.map((x) => x * x)) / (2 * total)).toFixed(0)} s`;
}
const spread = (n, lo, hi) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const logUniform = (n, lo, hi) => Array.from({ length: n }, () => lo * (hi / lo) ** rnd());
const { tiers } = JSON.parse(readFileSync(new URL("results/cezar-701f50.json", import.meta.url)));
const cezarTail = tiers.filter((t) => t.startedAt >= "2026-10-19T13:06:12" && t.wallS !== null).flatMap((t) => t.fileS);
const cases = [
  ["cezar tail (47 files, live)", cezarTail, [23, 6]],
  ["cezar-like 30 x 80-145 s", spread(30, 80, 145), [23, 6]],
  ["medium 400 x 2-40 s", logUniform(400, 2, 40), [23, 4]],
  ["fixture node:test 8 x 60-150 s", spread(8, 60, 150), [4]],
];
for (const [name, ds, ws] of cases) {
  for (const w of ws) {
    console.log(`${name}, W=${w}`);
    console.log(`  today (serial sum <= 300): ${replay(ds, w, (t) => sum(t) <= 300)}`);
    for (const B of [60, 120, 180, 300]) console.log(`  round, B=${B}: ${replay(ds, w, (t, w) => t.length <= w || graham(t, w) <= B)}`);
  }
}
