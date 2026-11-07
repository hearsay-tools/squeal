// Pairs the candidate no longer holds (main reach minus candidate reach, static value part),
// by their path kind at main; seconds every source once and by real edits; top gateways.
const b = (await import("/tmp/er112/out-main-static.json", { with: { type: "json" } })).default;
const a = (await import("/tmp/er112/out-cand-static.json", { with: { type: "json" } })).default;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const isTest = (p) => p in b.testSec;
const helper = (p) => /^test\//.test(p) && !isTest(p);
const bfs = (g, s, expand = () => true) => { const seen = new Set([s]); const q = [s]; while (q.length) { const x = q.pop(); if (x !== s && !expand(x)) continue; for (const y of g[x]?.v ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } } return seen; };
const setupB = new Set([...bfs(b.graph, "vitest.config.ts"), ...bfs(b.graph, "test/global-teardown.ts")]);
const out = {}, outE = {}, gone = new Map(); let tot = 0, totE = 0;
for (const [t, info] of Object.entries(b.testSec)) {
  if (info.m || !info.s) continue;
  const g = b.graph, v = bfs(g, t), ra = bfs(a.graph, t);
  const plain = bfs(g, t, (m) => !g[m]?.b && !helper(m)), noBarrel = bfs(g, t, (m) => !g[m]?.b);
  const direct = new Set(g[t]?.v ?? []);
  for (const p of v) {
    if (p === t || isTest(p) || !CODE.test(p) || ra.has(p) || setupB.has(p)) continue;
    if (!(p in a.graph)) continue; // deleted at the candidate: counted apart
    const k = g[p]?.t ? "typesModule" : direct.has(p) ? "direct" : plain.has(p) ? "transitive" : !noBarrel.has(p) ? "barrel" : "helper";
    out[k] = (out[k] ?? 0) + info.s; tot += info.s;
    const e = info.s * (a.edits[p] ?? 0); outE[k] = (outE[k] ?? 0) + e; totE += e;
  }
}
const r = (o, n) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, `${Math.round(x)} (${(100 * x / n).toFixed(1)}%)`]));
console.log("removed pair-s on kept sources:", Math.round(tot), "of before", b.outcome.pairSec, r(out, b.outcome.pairSec));
console.log("removed by real edits:", Math.round(totE), "of before", b.outcome.pairEditSec, r(outE, b.outcome.pairEditSec));
console.log("candidate top gateways:", a.cuts.slice(0, 8).map((c) => `${c.path} ${c.barrel ? "barrel" : c.helper ? "helper" : ""} ${c.testsHit} ${c.pctOfPairSec}/${c.pctOfRealEditSec}`).join("\n  "));
