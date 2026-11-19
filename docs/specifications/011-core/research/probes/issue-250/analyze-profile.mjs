// Throwaway probe (row 011-408): self time per function and inclusive time per named frame of a .cpuprofile.
// usage: node analyze-profile.mjs <file.cpuprofile> [topN] [frameName...]
import { readFileSync } from "node:fs";
const [file, topArg, ...frames] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = new Map();
p.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
const total = [...dt.values()].reduce((a, b) => a + b, 0);
const label = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
const self = new Map();
const incl = new Map();
for (const [id, us] of dt) {
  const n = byId.get(id);
  self.set(label(n), (self.get(label(n)) ?? 0) + us);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const name = byId.get(cur).callFrame.functionName;
    if (!seen.has(name)) { seen.add(name); incl.set(name, (incl.get(name) ?? 0) + us); }
  }
}
const ms = (us) => (us / 1000).toFixed(0).padStart(6);
console.log(`total sampled ${ms(total)} ms`);
console.log("-- self time");
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(topArg ?? 25))) console.log(ms(v), k);
if (frames.length) {
  console.log("-- inclusive time of named frames");
  for (const f of frames) console.log(ms(incl.get(f) ?? 0), f);
}
