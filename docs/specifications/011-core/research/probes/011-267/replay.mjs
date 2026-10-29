// Throwaway probe, row 011-267. Replays candidate orders on both workloads.
// Usage: node replay.mjs > replay-output.txt   (writes replay.jsonl too)
import { writeFileSync } from 'node:fs';
import { simulate } from './model.mjs';
import { build } from './scenarios.mjs';

const POLICIES = {
  today374: { mode: 'tiers', order: 'today374', inTier: 'lpt' },
  today377: { mode: 'tiers', order: 'today377', inTier: 'lpt' },
  'batch (human)': { mode: 'tiers', order: 'batch', inTier: 'lpt' },
  'batch, shortest-first inside': { mode: 'tiers', order: 'batch', inTier: 'spt' },
  'batch, budget-sized tiers': { mode: 'tiers', order: 'batch-budget', inTier: 'lpt' },
  'batch, per-file slots': { mode: 'slots', order: 'batch', inTier: 'lpt' },
  'slots, edit own first': { mode: 'slots', order: 'edit-first', inTier: 'lpt' },
  'batch + edit tier beside (W-4)': { mode: 'tiers', order: 'batch', inTier: 'lpt', editBeside: 'share' },
  'batch + edit tier beside (+4)': { mode: 'tiers', order: 'batch', inTier: 'lpt', editBeside: 'extra' },
};

const rows = [];
const out = [];
const fmt = (x) => (x === null ? '   -  ' : String(Math.round(x)).padStart(6));
for (const name of ['0.1.377', '0.1.374']) {
  const s = build(name);
  out.push(`\n## ${name}: ${s.files.length} files (N ${s.files.filter((f) => f.cls === 'N').length}, E ${s.files.filter((f) => f.cls === 'E').length}, B ${s.files.filter((f) => f.cls === 'B').length}); recorded in the trace: verdict ${Math.round(s.real.verdictS)} s, own ${Math.round(s.real.ownS)} s, all ${Math.round(s.real.allS)} s`);
  for (const plan of ['recorded', 'cadence']) {
    for (const W of [11, 23, 6]) {
      out.push(`\n${name} plan=${plan} W=${W}            verdict    own    all  tiers`);
      for (const [label, policy] of Object.entries(POLICIES)) {
        const named = s.files.filter((f) => f.cls === 'N').map((f) => f.path);
        const own = s.files.filter((f) => f.own).map((f) => f.path);
        const p =
          plan === 'recorded'
            ? { waits: s.recorded }
            : {
                waits: [],
                reactive: [
                  { name: 'parity', files: named, firstAt: 0, wait: s.cadence.wait, gap: s.cadence.gap },
                  { name: 'own', files: own, firstAt: s.ownFirstAt, wait: s.cadence.wait, gap: s.cadence.gap },
                ],
              };
        const r = simulate({ files: s.files, initialBusyUntil: s.initialBusyUntil, W, policy: { name: label, ...policy }, plan: p });
        const row = { trace: name, plan, W, policy: label, verdictS: r.verdictAt, ownS: r.ownAt, allS: r.allAt, tiers: r.tiers.length };
        rows.push({ ...row, tierLog: r.tiers });
        out.push(`  ${label.padEnd(30)} ${fmt(r.verdictAt)} ${fmt(r.ownAt)} ${fmt(r.allAt)} ${String(r.tiers.length).padStart(5)}`);
      }
    }
  }
}
writeFileSync(new URL('replay.jsonl', import.meta.url), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(out.join('\n'));
