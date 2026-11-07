// Throwaway probe for research/edit-reach.md. Reads reach.mjs's output and, for each target source,
// tells how the automatic test files that reach it by value imports get there: grouped by the test
// file's own import that leads there (first hop), with one shortest chain per group.
// Usage: node paths.mjs <out.json> <target>...
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const g = r.graph, ts = r.testSec;
const bfs = (s, skip) => { const prev = new Map([[s, null]]); const q = [s];
  while (q.length) { const m = q.shift(); if (m !== s && skip?.(m)) continue; for (const x of g[m]?.v ?? []) if (!prev.has(x)) { prev.set(x, m); q.push(x); } }
  return prev; };
const chain = (prev, t) => { const c = []; for (let x = t; x !== null; x = prev.get(x)) c.unshift(x); return c; };
for (const target of process.argv.slice(3)) {
  let n = 0, sec = 0, directN = 0, directSec = 0; const hop = new Map();
  for (const [t, info] of Object.entries(ts)) {
    if (info.m) continue;
    const prev = bfs(t);
    if (!prev.has(target)) continue;
    n++; sec += info.s;
    if ((g[t]?.v ?? []).includes(target)) { directN++; directSec += info.s; continue; }
    // the first hops of t that still reach the target
    const hops = (g[t]?.v ?? []).filter((h) => h === target || bfs(h).has(target));
    const key = hops.length === 1 ? hops[0] : hops.length + " imports";
    const e = hop.get(key) ?? hop.set(key, { n: 0, sec: 0, chain: chain(bfs(t), target) }).get(key); e.n++; e.sec += info.s;
  }
  console.log(`\n${target}: ${n} automatic test files, ${Math.round(sec)} s; direct importers ${directN} (${Math.round(directSec)} s)`);
  for (const [k, e] of [...hop].sort((a, b) => b[1].sec - a[1].sec).slice(0, 8))
    console.log(`  ${String(e.n).padStart(4)} files ${String(Math.round(e.sec)).padStart(6)} s via ${k}\n        e.g. ${e.chain.join(" -> ")}`);
}
