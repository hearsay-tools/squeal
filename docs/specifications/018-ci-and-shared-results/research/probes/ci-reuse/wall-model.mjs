// Throwaway (018-04). Turns same-key-cez.mjs output into an estimate of
// cezarion's heavy-phase wall time per PR run. Inferred model, not measured:
//   heavy span = max(longest Vitest job, longest cockpit job, build job)
//   Vitest job = setup + max(floor + longest file still to run, step x share left)
//   cockpit job = the same with its own numbers.
// Baselines are the p50 of 57 green four-shard PR runs (results/ci-times.json):
// Vitest job 676 s (test step 646 s), cockpit job 616 s (test step 579 s),
// build-and-package 343 s, which reuse leaves alone. Shards are assumed to
// rebalance over the files left. OVERHEAD_S (default 0) adds Squeal's start,
// keying and store restore to each job; it was not measured.
// Usage: node wall-model.mjs <prs.jsonl>  [OVERHEAD_S=30]
import { readFileSync } from "node:fs";

const O = Number(process.env.OVERHEAD_S ?? 0);
const base = {
  unit: { job: 676, step: 646, floor: 40 },
  e2e: { job: 616, step: 579, floor: 20 },
  build: 343,
};
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.label);
const job = (g, l) => {
  const s = l.seconds[g];
  const total = s.same + s.changed + s.new + s.noClosure;
  const left = total - s.same;
  const setup = base[g].job - base[g].step;
  if (left <= 0) return setup + O;
  return setup + O + Math.max(base[g].floor + l.maxRunSeconds[g], base[g].step * (left / total));
};
const before = Math.max(base.unit.job, base.e2e.job, base.build);
const rows = lines.map((l) => {
  const u = job("unit", l);
  const e = job("e2e", l);
  const after = Math.max(u, e, base.build);
  const unitOnly = Math.max(u, base.e2e.job, base.build); // e2e never skipped
  return { label: l.label, unitJob: Math.round(u), e2eJob: Math.round(e), after: Math.round(after), saved: Math.round(before - after), savedUnitOnly: Math.round(before - unitOnly), jobSecondsSaved: Math.round(4 * (base.unit.job - u) + 4 * (base.e2e.job - e)) };
});
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor(p * xs.length)];
const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const out = {
  overheadSeconds: O,
  beforeSeconds: before,
  savedWall: { mean: mean(rows.map((r) => r.saved)), p25: q(rows.map((r) => r.saved), 0.25), p50: q(rows.map((r) => r.saved), 0.5), p75: q(rows.map((r) => r.saved), 0.75), max: Math.max(...rows.map((r) => r.saved)) },
  savedWallIfE2eNeverSkips: { mean: mean(rows.map((r) => r.savedUnitOnly)), p50: q(rows.map((r) => r.savedUnitOnly), 0.5), max: Math.max(...rows.map((r) => r.savedUnitOnly)) },
  testJobMinutesSavedPerRun: { mean: Math.round(mean(rows.map((r) => r.jobSecondsSaved)) / 60), p50: Math.round(q(rows.map((r) => r.jobSecondsSaved), 0.5) / 60) },
  prsWhereBuildJobBecomesLongest: rows.filter((r) => r.after === base.build).length,
  rows,
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
