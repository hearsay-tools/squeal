// Throwaway probe for research/edit-relevance.md (2026-11-07): lists each new failure order.mjs found,
// by revision, with its coverage class, import depth and work ahead (recorded s) under each order;
// E marks the edit's own work. Usage: node failures.mjs <order-out.json>
import { readFileSync } from "node:fs";
const o = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rv = new Map(o.revisions.map((r) => [r.w + ":" + r.n, r]));
const g = new Map(); for (const f of o.failures) { const k = f.w + ":" + f.n; (g.get(k) ?? g.set(k, []).get(k)).push(f); }
const at = (p) => Math.round(p.ahead) + (p.edit ? "E" : "");
for (const [k, fs] of g) { const r = rv.get(k);
  console.log(`${k.slice(0, 8)}${k.slice(k.indexOf(":"))} sources=${r.sources.join(",")} rekeyed=${r.files} files ${Math.round(r.sec)} s`);
  for (const f of fs) console.log(`  ${f.id.split("\0")[1]} ${f.cls} depth=${f.depth ?? "none"} failed-after=${Math.round(f.observedAfterMs / 1000)}s T=${at(f.T)} A=${at(f.A)} B=${at(f.B)} C=${at(f.C)} P=${at(f.P)}`); }
