// Throwaway probe, row 011-267. When each named file's own result lands (a
// tier stores its results at its end; a slot at its file's end), 0.1.377, W = 11,
// recorded waits: median and 10th percentile, and the first result.
import { simulate } from './model.mjs';
import { build } from './scenarios.mjs';
const s = build('0.1.377');
const named = s.files.filter((f) => f.cls === 'N').map((f) => f.path);
const P = {
  today377: { mode: 'tiers', order: 'today377', inTier: 'lpt' },
  'batch (human)': { mode: 'tiers', order: 'batch', inTier: 'lpt' },
  'batch, budget-sized tiers': { mode: 'tiers', order: 'batch-budget', inTier: 'lpt' },
  'batch, per-file slots': { mode: 'slots', order: 'batch', inTier: 'lpt' },
  'slots, shortest-first inside': { mode: 'slots', order: 'batch', inTier: 'spt' },
};
for (const [label, policy] of Object.entries(P)) {
  const r = simulate({ files: s.files, initialBusyUntil: s.initialBusyUntil, W: 11, policy, plan: { waits: s.recorded } });
  const t = named.map((p) => r.done.get(p)).sort((a, b) => a - b);
  console.log(`${label.padEnd(30)} first ${Math.round(t[0])} s, p10 ${Math.round(t[5])} s, median ${Math.round(t[27])} s, last ${Math.round(t[54])} s`);
}
