// Throwaway (environment-at-commit): share.mjs's per-commit rows (its stderr)
// by commit age, weighted by the asker's test files per project (its stdout).
// Usage: node by-age.mjs <share.json> <rows.jsonl>
import { readFileSync } from "node:fs";
const [summary, rowsPath] = process.argv.slice(2);
const s = JSON.parse(readFileSync(summary, "utf8"));
const rows = readFileSync(rowsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
// Rows exist only for not-determined pairs; all pairs per bucket come from the commit count.
const w = (p) => s.projects[p].files;
const buckets = [["under 1 day", 0, 1], ["1 to 3 days", 1, 3], ["3 to 7 days", 3, 7]];
const out = {};
for (const [name, lo, hi] of buckets) {
  const r = rows.filter((x) => x.ageDays >= lo && x.ageDays < hi);
  const nd = r.reduce((a, x) => a + w(x.project), 0);
  const sum = (f) => r.filter(f).reduce((a, x) => a + w(x.project), 0);
  const pct = (v) => (nd ? `${((100 * v) / nd).toFixed(1)}%` : "n/a");
  out[name] = { notDeterminedFileCommits: nd, derive: pct(sum((x) => x.derive)), recordByCommit: pct(sum((x) => x.recordC)), recordByInputs: pct(sum((x) => x.recordI)), anyOfThree: pct(sum((x) => x.derive || x.recordC || x.recordI)) };
}
console.log(JSON.stringify(out, null, 1));
