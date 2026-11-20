// analyse.mjs [label...]: per two-daemon run (row 011-423), from results/:
// per copy, its Vitest tiers after the edit (start, end, files, summed file s)
// with the copy's mean and peak live forks during each tier (workers.tsv),
// and the run totals. Run from this directory: node analyse.mjs S-base-1 ...
import { readFileSync, readdirSync } from "node:fs";
const R = new URL("./results/", import.meta.url).pathname;
const labels = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(R).filter((f) => /^S-.*\.runs\.json$/.test(f)).map((f) => f.replace(".runs.json", "")).sort();
const tsv = (f) => readFileSync(R + f, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
const out = [];
for (const label of labels) {
  const runs = JSON.parse(readFileSync(`${R}${label}.runs.json`, "utf8"));
  const e0 = +readFileSync(`${R}${label}.edits.tsv`, "utf8").split("\t")[0];
  const w = tsv(`${label}.workers.tsv`);
  const forksOf = (copy, a, b) => {
    const xs = w.filter((r) => r[1] === copy - 1 && r[0] >= e0 + a * 1000 && r[0] <= e0 + b * 1000).map((r) => r[2]);
    return { mean: xs.length ? +(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(1) : null, peak: xs.length ? Math.max(...xs) : null };
  };
  const mem = (copy) => Math.max(...w.filter((r) => r[1] === copy - 1 && r[0] >= e0).map((r) => r[5] || 0));
  const row = { label, copies: [] };
  for (const copy of [1, 2]) {
    const v = runs.filter((r) => r.copy === copy && r.lane === "vitest");
    const tiers = v.map((r) => ({ ...r, ...forksOf(copy, r.start, r.end) }));
    const files = v.reduce((a, r) => a + r.files, 0), sum = v.reduce((a, r) => a + r.sumS, 0);
    const lastEnd = Math.max(...runs.filter((r) => r.copy === copy).map((r) => r.end));
    // narrow: a tier of 20 files or more whose copy ran 3 forks or fewer on average
    const narrow = tiers.filter((t) => t.files >= 20 && t.mean !== null && t.mean <= 3);
    row.copies.push({ copy, lastEnd, vitestTiers: v.length, files, sumS: +sum.toFixed(0), narrowTiers: narrow.map((t) => `${t.start}-${t.end}s ${t.files}f ${t.mean}/${t.peak}`), maxMemMiB: mem(copy), tiers: tiers.map((t) => `${t.start}-${t.end} ${t.files}f ${t.sumS}s ${t.mean}/${t.peak}`) });
  }
  out.push(row);
}
for (const r of out) {
  console.log(r.label);
  for (const c of r.copies) console.log(`  copy ${c.copy}: last end ${c.lastEnd} s, ${c.vitestTiers} Vitest runs, ${c.files} files, ${c.sumS} file-s, max mem ${c.maxMemMiB} MiB; narrow: ${c.narrowTiers.join("; ") || "none"}\n    ${c.tiers.join(" | ")}`);
}
