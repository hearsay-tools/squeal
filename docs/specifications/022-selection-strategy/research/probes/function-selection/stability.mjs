// Throwaway (Q3c): does a test file's entered-function set change between two
// records whose loaded sources are byte-identical (same path and blob for
// every source)? The store keeps one record per key, so two runs at one key
// cannot be compared; this is the nearest proxy. A sample of test files.
//   node stability.mjs <store> <code> <sample-size> <seed> <out.json>
import { writeFileSync } from "node:fs";
import { open, coverageReader } from "./lib.mjs";
const [storePath, codePath, n, seed, outPath] = process.argv.slice(2);
const s = open(storePath);
const cov = coverageReader(codePath);
const keys = new Set(open(codePath).prepare("select result_key from coverage").all().map((r) => r.result_key));
const byTest = new Map();
for (const r of s.prepare("select ch.project, ch.test_path test, r.key from results r join checks ch on ch.id = r.check_id where ch.kind = 'file'").iterate()) {
  if (!keys.has(r.key)) continue;
  const id = `${r.project}\0${r.test}`;
  if (!byTest.has(id)) byTest.set(id, []);
  byTest.get(id).push(r.key);
}
let x = Number(seed);
const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
const tests = [...byTest.keys()].filter((t) => byTest.get(t).length >= 2).sort();
const sample = tests.map((t) => [rand(), t]).sort((a, b) => a[0] - b[0]).slice(0, Number(n)).map(([, t]) => t);
const pathTests = {};
const out = { testsWithTwoOrMore: tests.length, sampled: sample.length, comparedGroups: 0, testsWithAGroup: 0, testsDiffering: 0, examples: [] };
for (const t of sample) {
  const groups = new Map(); // sources signature -> [entered signature]
  for (const key of byTest.get(t)) {
    const rec = cov.record(key);
    if (!rec || rec.unread.size) continue;
    const srcs = [...rec.sources.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
    const sig = srcs.map((v) => `${v.path}@${v.blob}`).join("|");
    const entered = srcs.map((v) => `${v.path}:${v.functions.filter((f) => f[4]).map((f) => f.slice(0, 4).join(",")).join(";")}`).join("|");
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push({ key, entered, srcs });
  }
  let any = false, differs = false;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    any = true; out.comparedGroups++;
    const distinct = new Set(g.map((r) => r.entered));
    if (distinct.size > 1) {
      differs = true;
      // every path whose entered set differs among the group's records
      const per = g.map((r) => r.entered.split("|"));
      g[0].srcs.forEach((v, i) => { if (new Set(per.map((e) => e[i])).size > 1) (pathTests[v.path] ??= new Set()).add(t); });
      if (out.examples.length < 15) {
        const [a, b] = [...distinct].map((e) => g.find((r) => r.entered === e));
        const diffPaths = a.srcs.map((v, i) => [v.path, a.entered.split("|")[i], b.entered.split("|")[i]]).filter(([, p, q]) => p !== q).map(([p, ea, eb]) => {
          const A = new Set(ea.split(":")[1].split(";")), B = new Set(eb.split(":")[1].split(";"));
          return { path: p, onlyA: [...A].filter((f) => !B.has(f)).length, onlyB: [...B].filter((f) => !A.has(f)).length };
        });
        out.examples.push({ test: t.split("\0")[1], records: g.length, variants: distinct.size, diffPaths: diffPaths.slice(0, 5) });
      }
    }
  }
  if (any) out.testsWithAGroup++;
  if (differs) out.testsDiffering++;
}
const setup = new Set(process.env.SETUP_PATHS ? process.env.SETUP_PATHS.split(",") : []);
const testsByPathCount = Object.entries(pathTests).map(([p, ts]) => [p, ts.size]).sort((a, b) => b[1] - a[1]);
out.topDifferingPaths = testsByPathCount.slice(0, 15);
const outsideSetup = new Set(Object.entries(pathTests).filter(([p]) => !setup.has(p)).flatMap(([, ts]) => [...ts]));
out.testsDifferingOutsideSetup = outsideSetup.size;
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, examples: out.examples.length }));
