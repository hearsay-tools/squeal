// Throwaway probe (015 R3). Squeal's own counter (src/core/code/count, version
// 2) over every src file in the in-process report; each report function gets
// the CC of the innermost counted function whose range holds its body start.
// Then CC and CRAP at coverage 0 (CC² + CC) for child-only.out.tsv and
// uncovered-anywhere.out.tsv. Run from the scratch repo:
//   npx tsx r3/cc-join.mts <inproc/coverage-final.json> <probe dir>
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { countFile } from "../src/core/code/count/index.ts";

const [inprocFile, dir] = process.argv.slice(2);
const inproc = JSON.parse(readFileSync(inprocFile, "utf8"));
const repo = process.cwd();
const cc = new Map<string, number>(); // file:line:name -> CC
let counted = 0, joined = 0, reportFns = 0;
for (const [path, c] of Object.entries<any>(inproc)) {
  const { functions } = await countFile(readFileSync(path, "utf8"), "typescript");
  counted += functions.length;
  const file = relative(repo, path);
  for (const fn of Object.values<any>(c.fnMap)) {
    reportFns++;
    const p = { line: fn.loc.start.line, col: fn.loc.start.column };
    const holds = functions.filter((f) => {
      const r = f.range;
      const afterStart = r.startLine < p.line || (r.startLine === p.line && r.startColumn <= p.col);
      const beforeEnd = r.endLine > p.line || (r.endLine === p.line && r.endColumn >= p.col);
      return afterStart && beforeEnd;
    });
    const inner = holds.sort((a, b) => b.range.startLine - a.range.startLine || b.range.startColumn - a.range.startColumn)[0];
    if (inner) { joined++; cc.set(`${file}:${fn.loc.start.line}:${fn.name}`, inner.complexity); }
  }
}
const crap0 = (n: number) => n * n + n;
const summary: Record<string, unknown> = { counterFunctions: counted, reportFunctions: reportFns, joined };
for (const list of ["child-only", "uncovered-anywhere"]) {
  const rows = readFileSync(join(dir, `${list}.out.tsv`), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  const ccs = rows.map(([f, line, name]) => cc.get(`${f}:${line}:${name}`) ?? null);
  const known = ccs.filter((n): n is number => n !== null);
  summary[list] = {
    functions: rows.length, withCc: known.length,
    ccHistogram: Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, known.filter((n) => n === k).length]).concat([["6+", known.filter((n) => n >= 6).length]])),
    crapOver30AtCov0: known.filter((n) => crap0(n) > 30).length,
    over: rows.filter((_, i) => (ccs[i] ?? 0) >= 6).map(([f, line, name], i) => `${f}:${line} ${name}`),
  };
}
writeFileSync(join(dir, "cc-join.out.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
