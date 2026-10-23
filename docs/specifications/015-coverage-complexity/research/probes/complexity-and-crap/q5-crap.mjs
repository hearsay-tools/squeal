// Throwaway probe (015-02), Q4 and Q5: join tree-sitter functions to a coverage-v8 istanbul map
// (coverage-final.json) by body start, then CRAP per function from own statements and branches.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { viaTreeSitter } from "./engines.mjs";

const [coverageFile, repoRoot] = process.argv.slice(2);
const t0 = performance.now();
const coverage = JSON.parse(readFileSync(coverageFile, "utf8"));
const t1 = performance.now();
const crap = (cc, pct) => cc * cc * (1 - pct / 100) ** 3 + cc;
const before = (a, b) => a.line < b.line || (a.line === b.line && a.col <= b.col);
const pos = (p) => ({ line: p.line, col: p.column ?? Number.MAX_SAFE_INTEGER });

let matched = 0, unmatchedTs = 0, ambiguous = 0; const unmatchedCov = []; const rows = []; let joinMs = 0;
for (const [path, fc] of Object.entries(coverage)) {
  const { fns } = viaTreeSitter(path);
  const tj = performance.now();
  const byBody = new Map();
  for (const [id, f] of Object.entries(fc.fnMap)) {
    const k = `${f.loc.start.line}:${f.loc.start.column}`;
    byBody.set(k, byBody.has(k) ? null : id); // null marks two coverage functions at one body start
  }
  const used = new Set();
  const ranges = fns.map((f) => ({ f, start: { line: f.line, col: f.col }, end: { line: f.endLine, col: f.endCol } }));
  const inside = (p, r) => before(r.start, p) && before(p, r.end);
  // Each coverage statement or branch belongs to the innermost function containing its start.
  const owner = (p) => { let best = null; for (const r of ranges) if (inside(p, r) && (!best || before(best.start, r.start))) best = r; return best?.f; };
  const own = new Map(fns.map((f) => [f, { s: 0, sc: 0, b: 0, bc: 0, lines: new Map() }]));
  for (const [id, st] of Object.entries(fc.statementMap)) {
    const o = owner(pos(st.start)); if (!o) continue;
    const a = own.get(o); a.s++; if (fc.s[id] > 0) a.sc++;
    a.lines.set(st.start.line, (a.lines.get(st.start.line) ?? false) || fc.s[id] > 0);
  }
  for (const [id, br] of Object.entries(fc.branchMap)) {
    const o = owner(pos(br.loc?.start ?? br.locations[0].start)); if (!o) continue;
    const a = own.get(o); for (const c of fc.b[id]) { a.b++; if (c > 0) a.bc++; }
  }
  for (const f of fns) {
    const id = f.bodies.map((b) => byBody.get(`${b.line}:${b.col}`)).find((x) => x !== undefined);
    if (id === null) { ambiguous++; continue; }
    if (id === undefined) { unmatchedTs++; continue; }
    matched++; used.add(id);
    const a = own.get(f);
    const stmtPct = a.s ? (100 * a.sc) / a.s : 100;
    const branchPct = a.b ? (100 * a.bc) / a.b : 100;
    const lineVals = [...a.lines.values()]; const linePct = lineVals.length ? (100 * lineVals.filter(Boolean).length) / lineVals.length : 100;
    rows.push({ file: path.slice(repoRoot.length + 1), name: f.name, line: f.line, cc: f.cc, calls: fc.f[id], stmtPct, branchPct, linePct,
      crapStmt: crap(f.cc, stmtPct), crapMin: crap(f.cc, Math.min(stmtPct, branchPct)), crapLine: crap(f.cc, linePct) });
  }
  for (const [id, f] of Object.entries(fc.fnMap)) if (!used.has(id)) unmatchedCov.push(`${path.slice(repoRoot.length + 1)}:${f.loc.start.line} ${f.name}`);
  joinMs += performance.now() - tj;
}
const t2 = performance.now();
console.log(JSON.stringify({ readCoverageMs: +(t1 - t0).toFixed(1), countAndJoinMs: +(t2 - t1).toFixed(1), joinOnlyMs: +joinMs.toFixed(1), matched, unmatchedTs, ambiguous, unmatchedCoverage: unmatchedCov.length }, null, 0));
console.log("unmatched coverage functions:", unmatchedCov.slice(0, 10));
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
for (const k of ["crapStmt", "crapMin", "crapLine"]) {
  const v = rows.map((r) => r[k]).sort((a, b) => a - b);
  console.log(k, { n: v.length, p50: +q(v, 0.5).toFixed(1), p90: +q(v, 0.9).toFixed(1), p99: +q(v, 0.99).toFixed(1), max: +v.at(-1).toFixed(1), atLeast30: v.filter((x) => x >= 30).length });
}
console.log("\n| CRAP (stmt) | CRAP (min stmt, branch) | CC | stmt % | branch % | calls | function |\n| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows.sort((a, b) => b.crapStmt - a.crapStmt).slice(0, 20))
  console.log(`| ${r.crapStmt.toFixed(1)} | ${r.crapMin.toFixed(1)} | ${r.cc} | ${r.stmtPct.toFixed(0)} | ${r.branchPct.toFixed(0)} | ${r.calls} | \`${r.file}:${r.line}\` ${r.name} |`);
const uncovered = rows.filter((r) => r.calls === 0);
console.log(`\nfunctions never called: ${uncovered.length}; of them CC>=5: ${uncovered.filter((r) => r.cc >= 5).map((r) => `${r.name}(${r.cc})`).join(", ")}`);
