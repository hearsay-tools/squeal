// THROWAWAY probe (011-core/research/backlog-wall-budget.md). Replays backlog tier selection on
// fixed durations, no runner: tiers run one after another in a lane, files start in order on
// the earliest free of W workers, every file takes exactly its last-known duration.
// today:   take while the serial sum <= B (first file always taken), at most `cap` files.
// wall:    take while the greedy makespan <= B (first file always taken), at most `cap` files.
// graham:  take while sum/W + (1 - 1/W) * longest <= B (list scheduling's bound, any start order).
// bound:   take while max(longest, sum/W) <= B (the lower bound as the estimate).
// For each: tiers, total time, the longest tier, and the mean wait of an edit landing at a
// uniformly random moment of the backlog in a lane that cannot cancel (sum wall^2 / 2 sum wall).
const B = 300;
const makespan = (ds, w) => {
  const free = Array(Math.max(1, w)).fill(0);
  for (const d of ds) {
    const i = free.indexOf(Math.min(...free));
    free[i] += d;
  }
  return Math.max(...free);
};
const graham = (ds, w) => ds.reduce((a, b) => a + b, 0) / w + (1 - 1 / w) * Math.max(...ds);
const fits = {
  today: (ds) => ds.reduce((a, b) => a + b, 0) <= B,
  wall: (ds, w) => makespan(ds, w) <= B,
  graham: (ds, w) => ds.reduce((a, b) => a + b, 0) / w + (1 - 1 / w) * Math.max(...ds) <= B,
  // round: the first W files always fill one round, then the Graham estimate; at B and at 120 s.
  round: (ds, w) => ds.length <= w || graham(ds, w) <= B,
  round120: (ds, w) => ds.length <= w || graham(ds, w) <= 120,
  bound: (ds, w) => Math.max(...ds, ds.reduce((a, b) => a + b, 0) / w) <= B,
};
function replay(durations, rule, w, cap = 200) {
  const queue = [...durations].sort((a, b) => a - b); // C4 step 4: shortest last-known first
  const tiers = [];
  while (queue.length > 0) {
    const tier = [queue.shift()];
    while (queue.length > 0 && tier.length < cap && fits[rule]([...tier, queue[0]], w)) tier.push(queue.shift());
    // Today's grant is take(files): a tier of n files runs min(n, W) wide.
    tiers.push({ files: tier.length, wall: makespan(tier, Math.min(w, tier.length)) });
  }
  const total = tiers.reduce((a, t) => a + t.wall, 0);
  const meanWait = tiers.reduce((a, t) => a + t.wall ** 2, 0) / (2 * total);
  return { tiers: tiers.length, sizes: tiers.map((t) => t.files).join(","), totalS: +total.toFixed(0), longestTierS: +Math.max(...tiers.map((t) => t.wall)).toFixed(0), meanEditWaitS: +meanWait.toFixed(0) };
}
const spread = (n, lo, hi) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const logUniform = (n, lo, hi) => Array.from({ length: n }, () => lo * (hi / lo) ** rnd());
const scenarios = [
  ["fixture Vitest: 16 files 60-150 s", spread(16, 60, 150), [23, 6, 2]],
  ["fixture node:test: 8 files 60-150 s", spread(8, 60, 150), [4]],
  ["cezar-like tail: 30 files 80-145 s", spread(30, 80, 145), [23, 6, 4, 2]],
  ["medium suite: 400 files 2-40 s log-uniform", logUniform(400, 2, 40), [23, 6, 4]],
  ["light suite: 600 files 0.1-3 s log-uniform", logUniform(600, 0.1, 3), [23, 4]],
];
const rows = [];
for (const [name, ds, widths] of scenarios) {
  for (const w of widths) {
    for (const rule of ["today", "wall", "graham", "round", "round120", "bound"]) rows.push({ scenario: name, W: w, rule, ...replay(ds, rule, w) });
  }
}
console.table(rows.map(({ sizes, ...r }) => r));
for (const r of rows.filter((r) => r.scenario.startsWith("fixture") || r.scenario.startsWith("cezar"))) {
  console.log(`${r.scenario} W=${r.W} ${r.rule}: tier sizes ${r.sizes}`);
}
