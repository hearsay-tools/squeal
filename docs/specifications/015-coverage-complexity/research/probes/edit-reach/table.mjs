// Throwaway probe for research/edit-reach.md: Markdown tables from reach.mjs's output.
// Usage: node table.mjs <out.json> [n=25]
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const n = +(process.argv[3] ?? 25);
const suite = r.suite.autoSec;
const kinds = (k, sec) => Object.entries(k).map(([a, v]) => [a, Math.round(100 * v / sec)]).filter(([, v]) => v >= 5)
  .sort((a, b) => b[1] - a[1]).map(([a, v]) => `${a} ${v}`).join(", ");
const cov = (c, sec) => c ? ` | ${Math.round(100 * c.called / sec)} / ${Math.round(100 * (c.loadedOnly + c.loadedUnknown) / sec)} / ${Math.round(100 * c.notLoaded / sec)}` : "";
const head = (extra) => `| # | File | Test files | Recorded s | Share | Path kinds (% of its seconds) | Edits${extra} |\n|---|---|---|---|---|---|---|${extra ? "---|" : ""}`;
const rows = [...r.all].filter((s) => s.sec > 0);
const extra = r.coverage ? " | Called / loaded only / not loaded %" : "";
console.log(`Suite: ${r.suite.autoFiles} automatic test files, ${Math.round(suite)} recorded s.\n`);
console.log("By reach:\n" + head(extra));
rows.sort((a, b) => b.sec - a.sec || a.path.localeCompare(b.path)).slice(0, n).forEach((s, i) =>
  console.log(`| ${i + 1} | \`${s.path}\` | ${s.files} | ${s.sec} | ${(100 * s.sec / suite).toFixed(0)}% | ${kinds(s.kinds, s.sec)} | ${s.edits}${cov(s.coverage, s.sec)} |`));
console.log("\nBy real edits x reach:\n" + head(extra));
const tot = rows.reduce((a, s) => a + s.sec * s.edits, 0);
rows.sort((a, b) => b.sec * b.edits - a.sec * a.edits).slice(0, Math.min(n, 12)).forEach((s, i) =>
  console.log(`| ${i + 1} | \`${s.path}\` | ${s.files} | ${s.sec} | ${(100 * s.sec / suite).toFixed(0)}% (${(100 * s.sec * s.edits / tot).toFixed(0)}% of edit cost) | ${kinds(s.kinds, s.sec)} | ${s.edits}${cov(s.coverage, s.sec)} |`));
// concentration
const sorted = [...rows].sort((a, b) => b.sec - a.sec), all = sorted.reduce((a, s) => a + s.sec, 0);
const share = (k) => (100 * sorted.slice(0, k).reduce((a, s) => a + s.sec, 0) / all).toFixed(0);
const over = (f) => sorted.filter((s) => s.sec >= f * suite).length;
console.log(`\nSource files reached: ${rows.length} of ${r.sourceFiles.tracked}; top 25 hold ${share(25)}% of pair-seconds, top 100 ${share(100)}%.`,
  `Files re-keying >=50% of the suite: ${over(0.5)}, >=25%: ${over(0.25)}, >=10%: ${over(0.1)}.`);
const edited = rows.filter((s) => s.edits > 0);
console.log(`Real edits: ${r.editRevisions} watch revisions of 1-3 paths; ${edited.length} source files edited ${edited.reduce((a, s) => a + s.edits, 0)} times;`,
  `mean re-keyed share per real source edit ${(100 * tot / edited.reduce((a, s) => a + s.edits, 0) / suite).toFixed(1)}%; per source file edited once ${(100 * all / r.sourceFiles.tracked / suite).toFixed(1)}%.`);
