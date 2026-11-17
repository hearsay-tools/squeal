// Throwaway probe for row 005-99 (see README.md): kept daemons over time if each session end kept its daemon K minutes.
// Usage: node concurrency.mjs ends.jsonl
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.logged);
const lo = Math.min(...rows.map((r) => r.at)), hi = Math.max(...rows.map((r) => r.at));
console.log("ends from", new Date(lo).toISOString(), "to", new Date(hi).toISOString(), "hours", ((hi - lo) / 3.6e6).toFixed(1));
for (const k of (process.env.KS ?? "2,5,8,10,15,30,60").split(",").map(Number)) {
  const ev = [];
  for (const r of rows) { const len = Math.min((r.gap ?? r.tail), k * 60000); ev.push([r.at, 1], [r.at + len, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, max = 0; const samples = [];
  for (const [, d] of ev) { c += d; max = Math.max(max, c); }
  // time-weighted share of minutes with >= 3 kept
  let area = 0; c = 0; let t0 = ev[0][0]; const hist = {};
  for (const [t, d] of ev) { hist[c] = (hist[c] ?? 0) + (t - t0); t0 = t; c += d; }
  const total = hi - lo; const mean = Object.entries(hist).reduce((s, [n, ms]) => s + n * ms, 0) / total;
  const p = (n) => (Object.entries(hist).filter(([m]) => m >= n).reduce((s, [, ms]) => s + ms, 0) / total * 100).toFixed(1);
  console.log(`K=${k}m mean kept ${mean.toFixed(2)}, max ${max}, time with >=2 kept ${p(2)}%, >=4 ${p(4)}%`);
}
