// Pairs the candidate adds (candidate value reach minus main value reach) on sources both hold
const b = (await import("/tmp/er112/out-main-static.json", { with: { type: "json" } })).default;
const a = (await import("/tmp/er112/out-cand-static.json", { with: { type: "json" } })).default;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const bfs = (g, s) => { const seen = new Set([s]); const q = [s]; while (q.length) { const x = q.pop(); for (const y of g[x]?.v ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } } return seen; };
const setupA = new Set([...bfs(a.graph, "vitest.config.ts"), ...bfs(a.graph, "test/global-teardown.ts")]);
const bySrc = new Map(), byTest = new Map(); let tot = 0;
for (const [t, info] of Object.entries(a.testSec)) {
  if (info.m || !info.s) continue;
  const rb = bfs(b.graph, t);
  for (const p of bfs(a.graph, t)) {
    if (p === t || p in a.testSec || !CODE.test(p) || rb.has(p) || setupA.has(p) || !(p in b.graph)) continue;
    tot += info.s; bySrc.set(p, (bySrc.get(p) ?? 0) + info.s); byTest.set(t, (byTest.get(t) ?? 0) + 1);
  }
}
console.log("added pair-s on sources both hold:", Math.round(tot), "in", byTest.size, "test files");
console.log([...bySrc].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([p, s]) => `${Math.round(s)} ${p}`).join("\n"));
const [t0] = [...byTest].sort((x, y) => y[1] - x[1]); console.log("most added:", t0);
