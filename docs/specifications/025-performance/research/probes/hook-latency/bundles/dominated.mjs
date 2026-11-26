// Throwaway probe (row 025-14). For a hook bundle, the never-called modules
// (coverage.mjs --json) whose import, made lazy everywhere, would take the
// most bytes out of the bundle: the bytes no longer reachable from the entry
// when every static import of that module is removed. Nested cuts are folded
// into the largest one that holds them. Prints the importers and one chain.
// Usage: node dominated.mjs <meta.json> <called.json> <hook> [top]
import { readFileSync } from "node:fs";

const [metaPath, calledPath, hook, topN = "15"] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const called = new Set(JSON.parse(readFileSync(calledPath, "utf8"))[hook]);
const out = Object.entries(meta.outputs).find(([k]) => k.endsWith(`/${hook}.mjs`))[1];
const bytes = new Map(Object.entries(out.inputs).map(([k, v]) => [k, v.bytesInOutput]));
const edges = new Map([...bytes.keys()].map((f) => [f, (meta.inputs[f]?.imports ?? [])
  .filter((i) => !i.external && bytes.has(i.path)).map((i) => i.path)]));
const importers = new Map();
for (const [f, gs] of edges) for (const g of gs) (importers.get(g) ?? importers.set(g, []).get(g)).push(f);
const reach = (cut) => {
  const seen = new Set([out.entryPoint]); const st = [out.entryPoint];
  while (st.length) for (const g of edges.get(st.pop()) ?? []) if (g !== cut && !seen.has(g)) { seen.add(g); st.push(g); }
  return seen;
};
const all = reach(null);
const total = [...bytes.values()].reduce((a, b) => a + b, 0);
const short = (f) => f.replace(/^src\//, "").replace(/\.ts$/, "");
const parent = new Map([[out.entryPoint, null]]); const q = [out.entryPoint];
while (q.length) { const f = q.shift(); for (const g of edges.get(f)) if (!parent.has(g)) { parent.set(g, f); q.push(g); } }
const chain = (f) => { const c = []; for (let x = f; x; x = parent.get(x)) c.unshift(short(x)); return c.slice(1).join(" > "); };
const cuts = [];
for (const g of bytes.keys()) {
  if (called.has(g) || g === out.entryPoint) continue;
  const gone = [...all].filter((f) => !reach(g).has(f));
  const warm = gone.filter((f) => called.has(f));
  cuts.push({ g, gone: new Set(gone), warm, n: gone.reduce((s, f) => s + bytes.get(f), 0) });
}
cuts.sort((a, b) => b.n - a.n);
const kept = [];
for (const c of cuts) if (!kept.some((k) => k.gone.has(c.g))) kept.push(c);
const sum = kept.slice(0, Number(topN)).reduce((s, c) => s + c.n, 0);
console.log(`## ${hook}: ${total} bytes; top ${topN} disjoint lazy cuts remove ${sum} bytes (${Math.round(100 * sum / total)}%)`);
for (const c of kept.slice(0, Number(topN))) {
  const imp = importers.get(c.g).map(short);
  console.log(`  ${String(c.n).padStart(6)} [${c.gone.size} files${c.warm.length ? `, called: ${c.warm.map(short).join(" ")}` : ""}] ${short(c.g)}  <- ${imp.slice(0, 4).join(", ")}${imp.length > 4 ? ` +${imp.length - 4}` : ""}\n         chain: ${chain(c.g)}`);
}
