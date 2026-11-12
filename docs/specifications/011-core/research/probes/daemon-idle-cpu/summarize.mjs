// Throwaway probe (row 011-313). Summarizes a .cpuprofile: self-time share by
// function, and inclusive share by function, of all samples.
// Usage: node summarize.mjs FILE [TOP]
import { readFileSync } from "node:fs";
const [file, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 25);
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const counts = new Map();
for (const s of p.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
const total = p.samples.length;
const label = (n) => {
  const f = n.callFrame;
  const url = f.url.replace(/^.*\/dist\//, "dist/").replace(/^file:\/\//, "");
  return `${f.functionName || "(anon)"} ${url}:${f.lineNumber + 1}`;
};
const self = new Map(), incl = new Map();
for (const [id, c] of counts) {
  const n = byId.get(id);
  self.set(label(n), (self.get(label(n)) ?? 0) + c);
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) {
    const l = label(byId.get(x));
    if (seen.has(l)) continue;
    seen.add(l);
    incl.set(l, (incl.get(l) ?? 0) + c);
  }
}
const pct = (c) => ((100 * c) / total).toFixed(1).padStart(5) + "%";
const durS = (p.endTime - p.startTime) / 1e6;
console.log(`samples ${total} over ${durS.toFixed(1)} s`);
console.log("-- self");
for (const [l, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(pct(c), l);
console.log("-- inclusive");
for (const [l, c] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(pct(c), l);
