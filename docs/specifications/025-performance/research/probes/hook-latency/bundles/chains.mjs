// Throwaway probe (row 025-14). From an esbuild metafile and the files a
// hook's runs called (coverage.mjs --json), finds for each hook the "gateway"
// imports: a called file importing a file that never ran, and the bytes that
// only that import pulls in (the never-called files reachable from it through
// never-called files alone, minus those also reachable from another gateway
// counted earlier). Also prints the shortest import chain from the entry.
// Usage: node chains.mjs <meta.json> <called.json> <hook> [top]
import { readFileSync } from "node:fs";

const [metaPath, calledPath, hook, topN = "25"] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const called = new Set(JSON.parse(readFileSync(calledPath, "utf8"))[hook]);
const outKey = Object.keys(meta.outputs).find((k) => k.endsWith(`/${hook}.mjs`));
const out = meta.outputs[outKey];
const inBundle = new Map(Object.entries(out.inputs).map(([k, v]) => [k, v.bytesInOutput]));
const imports = (f) =>
  (meta.inputs[f]?.imports ?? []).filter((i) => !i.external && inBundle.has(i.path)).map((i) => i.path);

// Shortest chains from the entry.
const parent = new Map([[out.entryPoint, null]]);
const queue = [out.entryPoint];
while (queue.length) {
  const f = queue.shift();
  for (const g of imports(f)) if (!parent.has(g)) { parent.set(g, f); queue.push(g); }
}
const chain = (f) => { const c = []; for (let x = f; x; x = parent.get(x)) c.unshift(x); return c; };
const short = (f) => f.replace(/^src\//, "").replace(/\.ts$/, "");

// A file is cold when no function in it ran (top-level code still ran).
const cold = (f) => !called.has(f);
const gateways = [];
for (const f of inBundle.keys()) {
  if (cold(f)) continue;
  for (const g of imports(f)) if (cold(g)) gateways.push([f, g]);
}
const closure = (g) => {
  const seen = new Set([g]); const st = [g];
  while (st.length) for (const h of imports(st.pop())) if (cold(h) && !seen.has(h)) { seen.add(h); st.push(h); }
  return seen;
};
const scored = gateways.map(([f, g]) => {
  const c = closure(g);
  return { f, g, c, bytes: [...c].reduce((s, x) => s + inBundle.get(x), 0) };
}).sort((a, b) => b.bytes - a.bytes);
const taken = new Set();
const totalCold = [...inBundle].filter(([f]) => cold(f)).reduce((s, [, n]) => s + n, 0);
const total = [...inBundle.values()].reduce((s, n) => s + n, 0);
console.log(`## ${hook}: ${total} bytes in ${inBundle.size} files, never called ${totalCold}`);
console.log("gateway import (called -> never called): bytes only it adds [files] | chain to the importer");
let shown = 0;
for (const s of scored) {
  const fresh = [...s.c].filter((x) => !taken.has(x));
  const bytes = fresh.reduce((n, x) => n + inBundle.get(x), 0);
  if (bytes < 2000) continue;
  fresh.forEach((x) => taken.add(x));
  console.log(`  ${String(bytes).padStart(6)} ${short(s.f)} -> ${short(s.g)} [${fresh.length}] | ${chain(s.f).map(short).join(" > ")}`);
  if (++shown >= Number(topN)) break;
}
