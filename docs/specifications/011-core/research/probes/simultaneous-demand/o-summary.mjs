// o-summary.mjs [label...]: one line per one-daemon run (row 011-420, H0
// shape), from results/: wall (edit to the last file, tiers.json lastEndS),
// mean Vitest width, Vitest idle worker-s (all, tail), the scope's CPU-s
// from the edit to t1 (sample.tsv), samples at 11.5 busy CPUs or more, and
// the longest backlog tier of 20 files or more at 3 workers or fewer
// (timeline.json's runs, if it lists widths). Run from this directory.
import { readFileSync, readdirSync } from "node:fs";
const R = new URL("./results/", import.meta.url).pathname;
const labels = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(R).filter((f) => /^O-.*\.tiers\.json$/.test(f)).map((f) => f.replace(".tiers.json", "")).sort();
const tsv = (f) => readFileSync(R + f, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
for (const label of labels) {
  const t = JSON.parse(readFileSync(`${R}${label}.tiers.json`, "utf8"));
  const e0 = +readFileSync(`${R}${label}.edits.tsv`, "utf8").split("\t")[0];
  const t1 = +readFileSync(`${R}${label}.t1`, "utf8");
  const s = tsv(`${label}.tsv`).filter((r) => r[0] > e0 && r[0] <= t1);
  const scope = s.length ? s.at(-1)[3] - s[0][3] : null;
  const over = s.length ? (100 * s.filter((r) => r[2] >= 11.5).length) / s.length : null;
  const w = tsv(`${label}.workers.tsv`);
  const tiers = (t.tiers ?? t.runs ?? []).filter((x) => (x.lane ?? "vitest") === "vitest" && (x.files ?? 0) >= 20);
  let narrow = 0;
  for (const x of tiers) {
    const a = e0 + x.start * 1000, b = e0 + x.end * 1000;
    const xs = w.filter((r) => r[0] >= a && r[0] <= b).map((r) => r[2]);
    const mean = xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null;
    if (mean !== null && mean <= 3) narrow = Math.max(narrow, x.end - x.start);
  }
  console.log(`${label}: wall ${t.lastEndS.toFixed(0)} s | mean width ${t.meanWidth} | Vitest idle worker-s ${t.vitestIdleWs.all} (tail ${t.vitestIdleWs.tail}) | scope CPU-s ${scope?.toFixed(0)} | >=11.5 busy ${over?.toFixed(1)}% | narrow ${narrow ? narrow.toFixed(0) + " s" : "none"} (${tiers.length} tiers >= 20 files)`);
}
