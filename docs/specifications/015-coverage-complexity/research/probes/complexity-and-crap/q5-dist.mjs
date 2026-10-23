// Throwaway probe (015-02), Q5: CC distribution over src/ with tree-sitter, top 20, and the share of
// increments that are `?.`, `??`, defaults and logical assignment rather than control flow.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { viaTreeSitter } from "./engines.mjs";
const root = process.argv[2];
const files = []; (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|cjs|js|py)$/.test(e) && !e.endsWith(".d.ts")) files.push(p); } })(join(root, "src"));
const t0 = performance.now();
const fns = files.flatMap((f) => viaTreeSitter(f).fns.map((x) => ({ ...x, file: f.slice(root.length + 1) })));
const ms = performance.now() - t0;
const cc = fns.map((f) => f.cc).sort((a, b) => a - b);
const q = (p) => cc[Math.min(cc.length - 1, Math.floor(p * cc.length))];
const buckets = { "1": 0, "2-4": 0, "5-9": 0, "10-19": 0, "20-29": 0, "30+": 0 };
for (const c of cc) buckets[c === 1 ? "1" : c < 5 ? "2-4" : c < 10 ? "5-9" : c < 20 ? "10-19" : c < 30 ? "20-29" : "30+"]++;
const parts = {}; for (const f of fns) for (const [k, v] of Object.entries(f.parts ?? {})) parts[k] = (parts[k] ?? 0) + v;
const controlOnly = (f) => 1 + (f.parts?.control ?? 0) + (f.parts?.andOr ?? 0);
console.log(JSON.stringify({ files: files.length, functions: fns.length, ms: Math.round(ms), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: cc.at(-1), buckets, increments: parts,
  at10plus: fns.filter((f) => f.cc >= 10).length, at10plusWithoutOptionalNullishDefault: fns.filter((f) => controlOnly(f) >= 10).length }));
console.log("\n| CC | without ?. ?? defaults | function |\n| --- | --- | --- |");
for (const f of fns.sort((a, b) => b.cc - a.cc).slice(0, 20)) console.log(`| ${f.cc} | ${controlOnly(f)} | \`${f.file}:${f.line}\` ${f.name} |`);
