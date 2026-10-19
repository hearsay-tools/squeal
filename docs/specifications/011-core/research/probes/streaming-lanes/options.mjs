// THROWAWAY probe (011-core/research/streaming-lanes.md). Question 4 offline: an edit's wait
// (mean / longest, s) for each option, on the heavy fixture and cezar's node:test lane (W = 4),
// against slots (`stream`: the next free slot). Same assumptions as model.mjs.
import { readFileSync } from "node:fs";
import { editOptions, spread, summary } from "./model.mjs";

const { tiers: rec } = JSON.parse(readFileSync(new URL("../backlog-wall-budget/results/cezar-701f50.json", import.meta.url)));
const node = rec.find((t) => t.files === 54).fileS;
const cases = [
  ["fixture node:test, 16 files 20-90 s", spread(16, 20, 90).map(Math.round)],
  ["cezar node:test lane, 54 files", node],
  ["30 files 80-145 s", spread(30, 80, 145)],
];
for (const [name, ds] of cases) {
  for (const rule of ["today", "w1"]) console.log(`${name}, ${rule}, W=4:`, JSON.stringify(editOptions(ds, rule, 4)));
  const s = summary("stream", ds, 4);
  console.log(`${name}, slots, W=4: next free slot ${s.meanWaitS} / ${s.maxWaitS}; an edit's slot beside 0 / 0`);
}
