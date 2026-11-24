// Throwaway (026, daemonless-hooks). p50 / p95 / max of drive.mjs output per case.
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => !r.skipped);
const by = new Map();
for (const r of rows) (by.get(r.name) ?? by.set(r.name, []).get(r.name)).push(r);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
console.log("case | n | wall p50 | wall p95 | wall max | cpu p50 | maxRSS p50 MB | load range | status");
for (const [name, rs] of by) {
  const w = rs.map((r) => r.wallMs), c = rs.map((r) => r.cpuMs), m = rs.map((r) => r.maxRssMB), l = rs.map((r) => r.load);
  const st = [...new Set(rs.map((r) => r.status))].join(",");
  console.log(`${name} | ${rs.length} | ${q(w, .5)} | ${q(w, .95)} | ${Math.max(...w)} | ${q(c, .5)} | ${q(m, .5)} | ${Math.min(...l).toFixed(1)}-${Math.max(...l).toFixed(1)} | ${st}`);
}
const phases = by.get("both-5")?.[0]?.marks;
if (phases) console.log("example both-5 marks:", JSON.stringify(phases));
