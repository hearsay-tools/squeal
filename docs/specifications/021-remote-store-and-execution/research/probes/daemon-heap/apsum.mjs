// Throwaway probe for research 021-27. Summarizes a .heapprofile from inside.mjs's ap-stop
// (sampling heap profiler, collected objects included): total sampled allocation, the top
// frames by self allocation, and the top Squeal bundle frames (the deepest frame in
// squeal.mjs on each stack, so JSON.parse and other builtins count against their caller),
// each with its two Squeal callers.
// Usage: node apsum.mjs <file.heapprofile> [top]
import { readFileSync } from "node:fs";
const p = JSON.parse(readFileSync(process.argv[2], "utf8"));
const TOP = Number(process.argv[3] ?? 25);
const mib = (b) => (b / 2 ** 20).toFixed(1);
const own = new Map();
const bySq = new Map();
let total = 0;
const name = (f) => `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
const walk = (node, stack) => {
  const f = node.callFrame;
  const s = [...stack, f];
  if (node.selfSize > 0) {
    total += node.selfSize;
    own.set(name(f), (own.get(name(f)) ?? 0) + node.selfSize);
    const sq = s.filter((x) => x.url.endsWith("squeal.mjs"));
    const key = sq.length === 0 ? "(no squeal frame)" : sq.slice(-3).reverse().map(name).join(" ← ");
    bySq.set(key, (bySq.get(key) ?? 0) + node.selfSize);
  }
  for (const c of node.children) walk(c, s);
};
walk(p.head, []);
console.log(`sampled allocation: ${mib(total)} MiB`);
console.log(`\n## top ${TOP} frames by self allocation (MiB)`);
for (const [k, v] of [...own].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${mib(v).padStart(8)}  ${k}`);
console.log(`\n## top ${TOP} by deepest Squeal frame ← its callers (MiB)`);
for (const [k, v] of [...bySq].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${mib(v).padStart(8)}  ${k}`);
