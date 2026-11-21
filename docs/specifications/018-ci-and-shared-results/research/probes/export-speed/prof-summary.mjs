// usage: node prof-summary.mjs <cpuprofile> [n]
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] ?? 30);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const dts = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (dts[i] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(), inclBy = new Map();
for (const [id, t] of self) {
  const n = byId.get(id);
  selfBy.set(name(n), (selfBy.get(name(n)) ?? 0) + t);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = name(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    inclBy.set(k, (inclBy.get(k) ?? 0) + t);
  }
}
const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, N).map(([k, t]) => `${(t / 1e6).toFixed(2).padStart(8)} s ${((100 * t) / total).toFixed(1).padStart(5)}%  ${k}`).join("\n");
console.log(`total sampled ${(total / 1e6).toFixed(2)} s, wall ${((prof.endTime - prof.startTime) / 1e6).toFixed(2)} s`);
console.log("\n== self ==\n" + fmt(selfBy));
console.log("\n== inclusive ==\n" + fmt(inclBy));
