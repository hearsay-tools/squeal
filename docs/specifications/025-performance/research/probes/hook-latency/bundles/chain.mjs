// Throwaway probe (row 025-14). Shortest static import chain from a hook's
// entry to a source file, and every importer of that file, from a metafile.
// Usage: node chain.mjs <meta.json> <hook> <src/file.ts>...
import { readFileSync } from "node:fs";

const [metaPath, hook, ...targets] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const out = Object.entries(meta.outputs).find(([k]) => k.endsWith(`/${hook}.mjs`))[1];
const has = (f) => f in out.inputs;
const edges = (f) => (meta.inputs[f]?.imports ?? []).filter((i) => !i.external && has(i.path)).map((i) => i.path);
const parent = new Map([[out.entryPoint, null]]);
const q = [out.entryPoint];
while (q.length) { const f = q.shift(); for (const g of edges(f)) if (!parent.has(g)) { parent.set(g, f); q.push(g); } }
const short = (f) => f.replace(/^src\//, "").replace(/\.ts$/, "");
for (const t of targets) {
  if (!parent.has(t)) { console.log(`${hook}: ${t} not in the bundle`); continue; }
  const c = []; for (let x = t; x; x = parent.get(x)) c.unshift(short(x));
  const importers = Object.keys(out.inputs).filter((f) => edges(f).includes(t)).map(short);
  console.log(`${hook}: ${c.join(" > ")}\n  imported by: ${importers.join(", ")}`);
}
