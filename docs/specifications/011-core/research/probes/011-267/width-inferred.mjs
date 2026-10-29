// Throwaway probe, row 011-267. The fewest workers that, placing a tier's files
// longest first, fit its recorded wall time (+2 s): a lower bound on the width
// each wider tier of the 0.1.377 trial really ran at.
import { readFileSync } from 'node:fs';
const t = JSON.parse(readFileSync(new URL('traces.json', import.meta.url), 'utf8')).find((x) => x.name === '0.1.377');
const lpt = (ds, w) => {
  const free = Array(w).fill(0);
  for (const d of [...ds].sort((a, b) => b - a)) { const i = free.indexOf(Math.min(...free)); free[i] += d; }
  return Math.max(...free);
};
for (const r of t.runs) {
  const hm = r.start.slice(11, 19);
  if (hm < '09:29' || hm > '10:03' || r.files.length < 5) continue;
  const ds = r.files.map((f) => f.s).filter((x) => x !== null);
  let w = 1;
  while (w < ds.length && lpt(ds, w) > r.wall + 2) w++;
  console.log(`${hm} files ${String(r.files.length).padStart(3)} named ${String(r.files.filter((f) => f.named).length).padStart(2)} wall ${r.wall.toFixed(0).padStart(4)} s  fewest workers that fit: ${w}`);
}
