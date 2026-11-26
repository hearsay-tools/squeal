import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.ceil(s.length * p) - 1]; };
const rows = [];
for (const f of readdirSync(dir).filter((n) => n.startsWith("after-")).sort()) {
  const xs = readFileSync(join(dir, f), "utf8").trim().split("\n").map(Number);
  rows.push({ file: f, n: xs.length, p50: q(xs, 0.5).toFixed(1), p95: q(xs, 0.95).toFixed(1) });
}
console.table(rows);
