// Throwaway probe for research/edit-reach-refactor.md (row 015-112). Compares two reach.mjs outputs
// (static mode, before and after): pair-seconds and the called share, every source once and by real
// edits, overall and by path kind; once over all sources of each commit, once over the sources both hold.
// Usage: node compare.mjs <before.json> <after.json>
import { readFileSync } from "node:fs";
const [b, a] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const ST = ["called", "loadedOnly", "loadedUnknown", "notLoaded", "noRecord"];
// per source: {sec, edits, kinds:{k:sec}, coverage:{st:sec}}
const rows = (r) => new Map(r.all.map((s) => [s.path, s]));
const B = rows(b), A = rows(a);
const common = new Set([...B.keys()].filter((p) => A.has(p)));
function totals(R, keep, weight) {
  const o = { pairSec: 0, called: 0, kinds: {}, kindCalled: {} };
  for (const [p, s] of R) { if (!keep(p)) continue; const w = weight(s); if (!w) continue;
    o.pairSec += s.sec * w; o.called += (s.coverage?.called ?? 0) * w;
    for (const [k, v] of Object.entries(s.kinds)) o.kinds[k] = (o.kinds[k] ?? 0) + v * w; }
  return o;
}
// per-kind called comes from the outputs' coverage.byKind (all sources) only
const line = (name, x, y) => console.log(`| ${name} | ${Math.round(x)} | ${Math.round(y)} | ${x ? (100 * (y - x) / x).toFixed(1) + "%" : "-"} |`);
for (const [label, weight] of [["every source once", () => 1], ["real edits", (s) => s.edits]]) {
  for (const [scope, keepB, keepA] of [["all sources", () => true, () => true], ["sources at both commits", (p) => common.has(p), (p) => common.has(p)]]) {
    const x = totals(B, keepB, weight), y = totals(A, keepA, weight);
    console.log(`\n${label}, ${scope} (before ${b.head}, after ${a.head})\n| Measure | Before | After | Change |\n|---|---|---|---|`);
    line("pair-seconds", x.pairSec, y.pairSec);
    line("called pair-seconds", x.called, y.called);
    console.log(`| called share | ${(100 * x.called / x.pairSec).toFixed(1)}% | ${(100 * y.called / y.pairSec).toFixed(1)}% | |`);
    for (const k of new Set([...Object.keys(x.kinds), ...Object.keys(y.kinds)])) line(`kind ${k}`, x.kinds[k] ?? 0, y.kinds[k] ?? 0);
  }
}
const kc = (r, key) => Object.fromEntries(Object.entries(r.outcome[key] ?? {}).map(([k, v]) => [k, `${v.sec} s, ${v.calledPct}% called`]));
console.log("\ncalled by kind, every source once", JSON.stringify({ before: kc(b, "calledEverySourceOnce"), after: kc(a, "calledEverySourceOnce") }, null, 1));
console.log("called by kind, real edits", JSON.stringify({ before: kc(b, "calledByRealEdits"), after: kc(a, "calledByRealEdits") }, null, 1));
console.log(`\nsources only before: ${[...B.keys()].filter((p) => !A.has(p)).length} (${[...B].filter(([p]) => !A.has(p)).reduce((t, [, s]) => t + s.edits, 0)} real edits); only after: ${[...A.keys()].filter((p) => !B.has(p)).length}`);
console.log(`suite: before ${b.suite.autoFiles} files ${Math.round(b.suite.autoSec)} s; after ${a.suite.autoFiles} files ${Math.round(a.suite.autoSec)} s`);
