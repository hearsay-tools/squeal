// Summarises a .cpuprofile: self time by function (top N) and by source area,
// and a timeline of 5-second buckets with the top areas. Usage: node prof.mjs <file> [startMs] [endMs]
import { readFileSync } from "node:fs";
const p = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const area = (n) => {
  const f = n.callFrame;
  if (f.functionName === "(idle)") return "(idle)";
  if (f.functionName === "(garbage collector)") return "(gc)";
  if (f.functionName === "(program)") return "(program)";
  if (f.url.includes("node:sqlite") || f.functionName.match(/^(run|all|get|iterate|exec|prepare)$/) && !f.url) return "sqlite";
  if (!f.url) return `native:${f.functionName}`;
  if (f.url.startsWith("node:")) return f.url.replace(/^node:(internal\/)?/, "node:").split("/").slice(0, 2).join("/");
  return f.url.split("/").pop();
};
// Area of the nearest squeal frame for a sample: walk up to find a named function in squeal.mjs.
const squealFn = (id) => {
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const f = nodes.get(cur).callFrame;
    if (f.url.endsWith(".mjs") && f.functionName) return f.functionName;
  }
  return "(none)";
};
const t0 = p.startTime;
const startMs = Number(process.argv[3] ?? 0), endMs = Number(process.argv[4] ?? Infinity);
const self = new Map(), byArea = new Map(), bySq = new Map(), buckets = new Map();
let t = t0;
const dt = p.timeDeltas;
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  t += dt[i];
  const rel = (t - t0) / 1000;
  if (rel < startMs || rel > endMs) continue;
  const d = (dt[i + 1] ?? 0) / 1000;
  const n = nodes.get(p.samples[i]);
  const a = area(n);
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + d);
  byArea.set(a, (byArea.get(a) ?? 0) + d);
  if (a !== "(idle)") {
    const s = squealFn(p.samples[i]);
    bySq.set(s, (bySq.get(s) ?? 0) + d);
  }
  const b = Math.floor(rel / 5000);
  const m = buckets.get(b) ?? new Map();
  m.set(a === "(idle)" ? "(idle)" : squealFn(p.samples[i]), (m.get(a === "(idle)" ? "(idle)" : squealFn(p.samples[i])) ?? 0) + d);
  buckets.set(b, m);
  total += d;
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(2).padStart(7)} s  ${k}`).join("\n");
console.log(`profile ${((p.endTime - p.startTime) / 1e6).toFixed(1)} s wall, window ${(total / 1000).toFixed(1)} s`);
console.log("\nby area\n" + top(byArea, 15));
console.log("\nby nearest named squeal function (busy only)\n" + top(bySq, 30));
console.log("\nby self function\n" + top(self, 25));
console.log("\ntimeline (5 s buckets, top 3)");
for (const [b, m] of [...buckets].sort((a, b) => a[0] - b[0])) console.log(`${String(b * 5).padStart(4)} s: ` + [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(" | "));
