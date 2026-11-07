// Throwaway probe for research/edit-reach.md. What-if over reach.mjs's output graph: remove import
// edges and count the (source, automatic test file) value pairs that no longer hold, weighted by the
// test file's recorded seconds. Reported as a share of all pair-seconds (every source edited once)
// and of pair-seconds weighted by the store's real edits.
// Usage: node cut.mjs <out.json> <scenario>...   scenario: "A>B" (A stops importing B), "A>B,C>D" (several),
//        or "A>*" (A imports nothing that reaches beyond itself)
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const g = r.graph, ts = r.testSec, edits = r.edits;
const isTest = (p) => p in ts;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const closure = (s, drop) => { const seen = new Set([s]); const q = [s];
  while (q.length) { const m = q.pop(); for (const x of g[m]?.v ?? []) if (!seen.has(x) && !drop(m, x)) { seen.add(x); q.push(x); } }
  return seen; };
const totalSec = r.all.reduce((a, s) => a + s.sec, 0);
const totalEditSec = r.all.reduce((a, s) => a + s.sec * (edits[s.path] ?? 0), 0);
const base = new Map();
for (const [t, info] of Object.entries(ts)) if (!info.m) base.set(t, closure(t, () => false));
for (const scenario of process.argv.slice(3)) {
  const rules = scenario.split(",").map((e) => e.split(">"));
  const drop = (a, b) => rules.some(([x, y]) => a === x && (y === "*" || b === y));
  let sec = 0, editSec = 0, files = 0;
  for (const [t, c] of base) {
    if (!rules.some(([x]) => c.has(x))) continue;
    const after = closure(t, drop); let lost = 0;
    for (const p of c) if (!after.has(p) && !isTest(p) && CODE.test(p)) { lost++; sec += ts[t].s; editSec += ts[t].s * (edits[p] ?? 0); }
    if (lost) files++;
  }
  console.log(JSON.stringify({ scenario, testFilesLosingReach: files, pctOfPairSec: +(100 * sec / totalSec).toFixed(1),
    pctOfRealEditSec: +(100 * editSec / totalEditSec).toFixed(1) }));
}
