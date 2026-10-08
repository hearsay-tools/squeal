// Task 001-143 evidence, not product code. Summarizes a V8 .cpuprofile: its
// span, and the self time per function (name, file:line) over the top N, so
// time blocked in a call (Atomics.wait, a sync syscall) shows as its frame.
// Usage: node prof.mjs <file.cpuprofile> [top]
import { readFileSync } from "node:fs";
const [file, top = "15"] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
p.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.replace(/^.*node_modules\//, "nm/").replace(/^file:\/\/.*\/(squeal|cezar)[^/]*\//, "")}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (p.timeDeltas[i] ?? 0));
});
const total = (p.endTime - p.startTime) / 1000;
console.log(`span ${total.toFixed(0)} ms, ${p.samples.length} samples`);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`);
