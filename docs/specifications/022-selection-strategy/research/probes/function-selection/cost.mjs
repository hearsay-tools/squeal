// Throwaway (Q6): time to build one file's structure (parse, function bodies,
// skeleton) and to compare two versions, on this repository's sources at HEAD.
// Each file once cold-ish (first parse in this process) and the median of 5
// further runs. The comparison is two structures of one file with one body
// edited (a token appended to the last function body). One-minute load beside.
//   node cost.mjs <repo-root>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadavg } from "node:os";
import { structure, judge } from "./structure.mjs";
const root = process.argv[2];
const files = execFileSync("git", ["-C", root, "ls-files", "src"], { encoding: "utf8" }).split("\n").filter((f) => /\.(ts|mts|tsx)$/.test(f) && !f.endsWith(".d.ts"));
const loadBefore = loadavg()[0];
if (loadBefore > 24) throw new Error(`load ${loadBefore} > 24; no timing`);
const rows = [];
for (const f of files) {
  const text = readFileSync(join(root, f), "utf8");
  let t = performance.now();
  const a = structure(f, text);
  const first = performance.now() - t;
  const runs = [];
  for (let i = 0; i < 5; i++) { t = performance.now(); structure(f, text); runs.push(performance.now() - t); }
  runs.sort((x, y) => x - y);
  let compareMs = null;
  const last = a.fns.at(-1);
  if (last) {
    const edited = text.slice(0, last.bodyEnd - 1) + ";void 0;" + text.slice(last.bodyEnd - 1);
    const src = { functions: [], covered: "" };
    t = performance.now();
    judge(f, text, edited, src);
    compareMs = performance.now() - t; // two structures built and compared, uncached
  }
  rows.push({ f, kb: text.length / 1024, fns: a.fns.length, first, median: runs[2], compareMs });
}
const q = (xs, p) => { const s = xs.filter((x) => x != null).sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
const col = (k) => rows.map((r) => r[k]);
console.log(JSON.stringify({
  node: process.version, files: rows.length, kbTotal: Math.round(rows.reduce((a, r) => a + r.kb, 0)), loadBefore, loadAfter: loadavg()[0],
  structureMs: { p50: q(col("median"), 0.5), p90: q(col("median"), 0.9), p99: q(col("median"), 0.99), max: q(col("median"), 1) },
  firstParseMs: { p50: q(col("first"), 0.5), p90: q(col("first"), 0.9), max: q(col("first"), 1) },
  compareTwoVersionsMs: { p50: q(col("compareMs"), 0.5), p90: q(col("compareMs"), 0.9), p99: q(col("compareMs"), 0.99), max: q(col("compareMs"), 1) },
  msPerKb: +(rows.reduce((a, r) => a + r.median, 0) / rows.reduce((a, r) => a + r.kb, 0)).toFixed(3),
  largest: rows.sort((x, y) => y.kb - x.kb).slice(0, 3).map((r) => [r.f, +r.kb.toFixed(1), +r.median.toFixed(2), r.compareMs && +r.compareMs.toFixed(2)]),
}, null, 1));
