// Throwaway probe (row 025-14). Prints p50/p95 per case and dist of a
// hook-runs.probe.ts output, and each dist's p50/p95 change against the first dist.
// Usage: node summarize.mjs <hook-runs.json>
import { readFileSync } from "node:fs";

const { node, loads, samples } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
console.log(`node ${node}, load ${loads.map((l) => l.toFixed(1)).join(" ")}`);
for (const [c, byDist] of Object.entries(samples)) {
  const entries = Object.entries(byDist);
  const [, first] = entries[0];
  const cells = entries.map(([d, xs]) => {
    const p50 = q(xs, 0.5), p95 = q(xs, 0.95);
    const delta = xs === first ? "" : ` (${(p50 - q(first, 0.5)).toFixed(1)}/${(p95 - q(first, 0.95)).toFixed(1)})`;
    return `${d} ${p50.toFixed(1)}/${p95.toFixed(1)}${delta}`;
  });
  console.log(`${c.padEnd(26)} n=${entries[0][1].length}  ${cells.join("  ")}`);
}
