// Throwaway probe (015-02), Q2 and Q5: every engine over the repository's src/, agreement and time per file.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { viaTreeSitter, viaAcorn, viaOxc, viaEslint, require } from "./engines.mjs";

const root = process.argv[2];
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e) && !e.endsWith(".d.ts")) files.push(p); } })(join(root, "src"));
const sources = files.map((f) => readFileSync(f, "utf8"));
const bytes = sources.reduce((a, s) => a + Buffer.byteLength(s), 0);

const ts = require("typescript");
function viaTsc(path, source) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let n = 0; (function w(x) { n++; ts.forEachChild(x, w); })(sf); return { fns: [], nodes: n };
}
const engines = { treesitter: viaTreeSitter, acorn: viaAcorn, oxc: viaOxc, eslint: viaEslint, tscParseOnly: viaTsc };
const results = {}; const failures = {}; const timing = {};
for (const [name, fn] of Object.entries(engines)) {
  results[name] = []; failures[name] = [];
  const reps = name === "eslint" ? 2 : 5;
  const times = [];
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    files.forEach((f, i) => {
      try { const out = fn(f, sources[i]); if (r === 0) results[name].push(out.fns.map((x) => ({ ...x, file: f }))); if (r === 0 && (out.hasError || out.errors || out.fatal?.length)) failures[name].push(f); }
      catch (e) { if (r === 0) { results[name].push([]); failures[name].push(`${f}: ${e.message.slice(0, 80)}`); } }
    });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  timing[name] = { medianMs: +times[times.length >> 1].toFixed(1), perFileMs: +(times[times.length >> 1] / files.length).toFixed(3), load1: +loadavg()[0].toFixed(1) };
}
console.log(JSON.stringify({ files: files.length, bytes, timing, failures: Object.fromEntries(Object.entries(failures).map(([k, v]) => [k, v.length ? v.slice(0, 5) : 0])) }, null, 1));

// Agreement against ESLint, per file and start line as a multiset of counts (several functions share a line).
const group = (fns) => { const m = new Map(); for (const f of fns) { const k = `${f.file}:${f.line}`; m.set(k, [...(m.get(k) ?? []), f.cc].sort()); } return m; };
const eslintFns = results.eslint.flat().filter((f) => !/class field initializer|class static block/i.test(f.name));
const eslintFiles = new Set(eslintFns.map((f) => f.file));
const eslint = group(eslintFns);
for (const name of ["treesitter", "acorn", "oxc"]) {
  const mine = group(results[name].flat().filter((f) => eslintFiles.has(f.file)));
  let same = 0, diff = 0; const diffs = [];
  for (const k of new Set([...mine.keys(), ...eslint.keys()])) {
    const a = JSON.stringify(mine.get(k) ?? []), b = JSON.stringify(eslint.get(k) ?? []);
    if (a === b) same++; else { diff++; if (diffs.length < 8) diffs.push(`${k.slice(root.length + 1)} ${a} vs eslint ${b}`); }
  }
  const perFile = (fns) => { const m = new Map(); for (const f of fns) m.set(f.file, [...(m.get(f.file) ?? []), f.cc]); for (const [k, v] of m) m.set(k, JSON.stringify(v.sort((x, y) => x - y))); return m; };
  const pf = perFile(results[name].flat().filter((f) => eslintFiles.has(f.file))), pe = perFile(eslintFns);
  const filesDiff = [...pe.keys()].filter((k) => pf.get(k) !== pe.get(k)).map((k) => k.slice(root.length + 1));
  console.log(name, { filesCompared: pe.size, filesWithDifferentCountMultiset: filesDiff.length }, filesDiff.slice(0, 5));
  console.log(name, { functions: results[name].flat().length, linesSame: same, linesDiff: diff, eslintFunctions: eslintFns.length }, diffs);
}
writeFileSync(process.argv[3], JSON.stringify(results.treesitter.flat().map((f) => ({ ...f, file: f.file.slice(root.length + 1) }))));
