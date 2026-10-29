// Throwaway probe, row 011-267. Does a named file run slower in a wide tier?
// For each named file: its duration in the 0.1.377 trial (tier width there)
// against its duration in the 0.1.374 trace (tiers of 4, mostly).
import { readFileSync } from 'node:fs';
const t = JSON.parse(readFileSync(new URL('traces.json', import.meta.url), 'utf8'));
const pick = (name, from, to) => {
  const m = new Map();
  for (const r of t.find((x) => x.name === name).runs) {
    const hm = r.start.slice(11, 19);
    if (hm < from || hm > to) continue;
    for (const f of r.files) if (f.named && f.s !== null) m.set(f.path, { s: f.s, width: r.files.length });
  }
  return m;
};
const a = pick('0.1.377', '09:29:00', '10:03:00');
const b = pick('0.1.374', '01:21:00', '02:00:00');
const groups = {};
for (const [p, x] of a) {
  const y = b.get(p);
  if (!y) continue;
  const g = x.width <= 4 ? 'tier of <=4' : x.width <= 11 ? 'tier of 5-11' : 'tier of 12+';
  (groups[g] ??= []).push(x.s / y.s);
}
for (const [g, r] of Object.entries(groups)) {
  r.sort((p, q) => p - q);
  console.log(`${g.padEnd(13)} files ${String(r.length).padStart(2)}  0.1.377/0.1.374 duration ratio: median ${r[Math.floor(r.length / 2)].toFixed(2)}, min ${r[0].toFixed(2)}, max ${r[r.length - 1].toFixed(2)}`);
}
