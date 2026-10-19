// THROWAWAY probe (011-core/research/catch-up.md). Checks the replay's tier model against the
// recorded runs: each recorded tier's files, makespan over W workers in Vitest's longest-first
// order, plus a fixed cost per run, against its measured wall.
import { readFileSync } from "node:fs";
const runs = JSON.parse(readFileSync(new URL("results/cezar-733.json", import.meta.url)));
export const makespan = (ds, w) => {
  const free = Array(Math.max(1, Math.min(w, ds.length))).fill(0);
  for (const d of [...ds].sort((a, b) => b - a)) free[free.indexOf(Math.min(...free))] += d;
  return Math.max(...free);
};
export const FIXED_S = 0.5;
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [route, lane, w] of [["edit", "vitest", 4], ["edit", "node:test", 4], ["backlog", "vitest", 23], ["backlog", "node:test", 4]]) {
    const rs = runs.filter((r) => r.route === route && r.lane === lane && r.wallS !== null);
    const model = rs.reduce((a, r) => a + makespan(r.files.map((f) => f.s), w) + FIXED_S, 0);
    const measured = rs.reduce((a, r) => a + r.wallS, 0);
    console.log(`${route} ${lane} W=${w}: ${rs.length} runs, model ${model.toFixed(0)} s, measured ${measured.toFixed(0)} s (measured/model ${(measured / model).toFixed(2)})`);
  }
  const big = runs.filter((r) => r.route === "backlog" && r.lane === "vitest");
  for (const r of big) console.log(`  backlog tier ${r.files.length} files: model ${(makespan(r.files.map((f) => f.s), 23) + FIXED_S).toFixed(1)} s, measured ${r.wallS} s, longest file ${Math.max(...r.files.map((f) => f.s)).toFixed(1)} s, sum ${r.files.reduce((a, f) => a + f.s, 0).toFixed(0)} s`);
}
