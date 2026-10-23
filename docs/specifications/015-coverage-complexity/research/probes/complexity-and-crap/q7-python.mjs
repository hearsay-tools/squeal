// Throwaway probe (015-02), Q7: tree-sitter-python with radon's rules against radon 6.0.1 and lizard 1.24.2,
// per function, on real Python files; times each.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { viaTreeSitter } from "./engines.mjs";
const VENV = process.env.VENV ?? "/tmp/r01502/venv";
const files = readFileSync(0, "utf8").trim().split("\n");
let t = performance.now();
const radonRaw = JSON.parse(execFileSync(`${VENV}/bin/radon`, ["cc", "-j", "-s", ...files], { encoding: "utf8", maxBuffer: 1 << 28 }));
const radonMs = performance.now() - t;
t = performance.now();
const ts = new Map(files.map((f) => [f, viaTreeSitter(f).fns]));
const tsMs = performance.now() - t;
t = performance.now();
const lizCsv = execFileSync(`${VENV}/bin/lizard`, ["-l", "python", "--csv", ...files], { encoding: "utf8", maxBuffer: 1 << 28 });
const lizMs = performance.now() - t;
const liz = new Map();
for (const l of lizCsv.trim().split("\n")) { const c = l.match(/("[^"]*"|[^,]+)/g); const file = c[6].replaceAll('"', ""); liz.set(`${file}:${c[9]}`, Number(c[1])); }
let same = 0, diff = 0, radonOnly = 0, lizSame = 0, lizDiff = 0, lizMissing = 0, parseErrors = 0; const diffs = [];
for (const f of files) {
  const r = radonRaw[f];
  if (!Array.isArray(r)) { parseErrors++; continue; } // radon omits a file with no function or class
  const seen = new Set();
  const flat = r.flatMap((b) => [b, ...(b.methods ?? []), ...(b.closures ?? []).flatMap(function rec(c) { return [c, ...(c.closures ?? []).flatMap(rec)]; })]).filter((b) => b.type !== "class" && !seen.has(b.lineno) && seen.add(b.lineno));
  const mine = new Map(ts.get(f).map((x) => [`${x.line}`, x]));
  for (const b of flat) {
    const m = mine.get(`${b.lineno}`);
    if (!m) { radonOnly++; if (diffs.length < 12) diffs.push(`${f}:${b.lineno} ${b.name} radon ${b.complexity}, tree-sitter none`); continue; }
    if (m.cc === b.complexity) same++; else { diff++; if (diffs.length < 12) diffs.push(`${f}:${b.lineno} ${b.name} radon ${b.complexity}, tree-sitter ${m.cc}`); }
    const l = liz.get(`${f}:${b.lineno}`);
    if (l === undefined) lizMissing++; else if (l === b.complexity) lizSame++; else lizDiff++;
  }
}
const tsCount = [...ts.values()].reduce((a, v) => a + v.length, 0);
console.log(JSON.stringify({ files: files.length, filesWithoutFunctionsOmittedByRadon: parseErrors, treeSitterFunctions: tsCount, vsRadon: { same, diff, radonOnly }, lizardVsRadon: { same: lizSame, diff: lizDiff, missing: lizMissing },
  ms: { radonCli: Math.round(radonMs), treeSitterInProcess: Math.round(tsMs), lizardCli: Math.round(lizMs) } }, null, 1));
console.log(diffs.join("\n"));
