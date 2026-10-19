// THROWAWAY probe (011-core/research/streaming-lanes.md). Q3: today's rule, W1's rule (one round,
// then 120 s of estimated wall time) and streaming slots replayed on cezar's 2026-10-19
// checkpoint (../backlog-wall-budget/results/cezar-701f50.json, per-file sums of check durations,
// which omit process start and collection, so every total is low). Lanes: the 54-file tier
// started 13:00:07Z is node:test; every other tier is Vitest. Same assumptions as model.mjs.
import { readFileSync } from "node:fs";
import { meanCancelLoss, summary, tiers } from "./model.mjs";

const { tiers: recorded } = JSON.parse(
  readFileSync(new URL("../backlog-wall-budget/results/cezar-701f50.json", import.meta.url)),
);
const done = recorded.filter((t) => t.wallS !== null);
const node = done.find((t) => t.files === 54).fileS;
const vitest = done.filter((t) => t.files !== 54).flatMap((t) => t.fileS);
const tail = done.filter((t) => t.startedAt >= "2026-10-19T13:06:12").flatMap((t) => t.fileS);
const cases = [
  ["node:test lane, 54 files", node, [4]],
  ["Vitest tail, 47 files from 13:06:12Z", tail, [23, 6]],
  [`Vitest whole backlog, ${vitest.length} files`, vitest, [23, 6]],
];
const rows = [];
for (const [name, ds, ws] of cases) {
  for (const w of ws) {
    for (const rule of ["today", "w1", "stream", "stream-over"]) {
      const s = summary(rule, ds, w);
      const shape = rule.startsWith("stream") ? "no tiers" : `${tiers(ds, rule, w).length} tiers`;
      const loss = name.startsWith("Vitest") ? { meanCancelLossS: meanCancelLoss(rule, ds, w) } : {};
      rows.push({ lane: name, W: w, rule, ...s, ...loss, shape });
    }
  }
}
console.table(rows);
console.log(`measured: node:test tier 168 s (one tier of 54); Vitest tail ${done.filter((t) => t.startedAt >= "2026-10-19T13:06:12").reduce((a, t) => a + t.wallS, 0).toFixed(0)} s of tiers`);
