// Row 015-114: where named files stand in a `squeal reach --json` answer.
// Usage: node lookup.mjs <reach.json> <path or regex>...
import { readFileSync } from "node:fs";
const [jsonPath, ...wanted] = process.argv.slice(2);
const report = JSON.parse(readFileSync(jsonPath, "utf8"));
const byEdits = [...report.files].sort((a, b) => b.editSeconds - a.editSeconds);
const r = (v) => Math.round(v * 100);
for (const w of wanted) {
  const re = w.startsWith("/") ? new RegExp(w.slice(1, -1)) : null;
  const hits = report.files.map((e, i) => ({ e, i })).filter(({ e }) => e.files.some((p) => (re ? re.test(p) : p === w)));
  if (hits.length === 0) console.log(`${w}: not in the files part`);
  for (const { e, i } of hits) {
    const g = e.gateway;
    console.log(`${w}: rank ${i + 1} (by edit cost ${byEdits.indexOf(e) + 1}), ${e.files.length} file(s), ${e.testFiles} test files, ${r(e.share)}%, ${Math.round(e.seconds)} s, ${e.edits} edits, ${Math.round(e.editSeconds)} edit-s, avoidable ${Math.round(e.avoidableSeconds)} s`);
    console.log(`    coverage ${Object.entries(e.coverage).map(([k, v]) => `${k} ${r(v)}`).join(", ")}`);
    console.log(`    kinds ${Object.entries(e.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${r(v)}`).join(", ")}`);
    if (g) console.log(`    gateway ${g.kind} ${g.gateway} (${g.testFiles} test files)`);
    if (e.suggestion) console.log(`    suggestion [${e.suggestion.kind}] ${e.suggestion.text}`);
  }
}
