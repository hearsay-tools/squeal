// summary.mjs [label...]: one line per two-daemon run (row 011-420), from
// results/: wall (edit to the last file of both copies), each copy's last
// end, each copy's first backlog tier (the first Vitest run of 20 files or
// more: start, length, files, mean/peak forks of the copy), the longest
// narrow tier (20 files or more at 3 forks or fewer on average), peak live
// forks of both copies, samples at 11.5 busy CPUs or more, and the host's
// busy CPU-s from the edit to t1 (sample.tsv, 5 s samples; the VM ran
// nothing else). Run from this directory: node summary.mjs
import { readFileSync, readdirSync } from "node:fs";
const R = new URL("./results/", import.meta.url).pathname;
const labels = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(R).filter((f) => /^S-.*\.runs\.json$/.test(f)).map((f) => f.replace(".runs.json", "")).sort();
const tsv = (f) => readFileSync(R + f, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
for (const label of labels) {
  const runs = JSON.parse(readFileSync(`${R}${label}.runs.json`, "utf8"));
  const q4b = JSON.parse(readFileSync(`${R}${label}.q4b.json`, "utf8"));
  const e0 = +readFileSync(`${R}${label}.edits.tsv`, "utf8").split("\t")[0];
  const t1 = +readFileSync(`${R}${label}.t1`, "utf8");
  const w = tsv(`${label}.workers.tsv`);
  const s = tsv(`${label}.tsv`).filter((r) => r[0] > e0 && r[0] <= t1);
  const cpuS = s.reduce((a, r) => a + r[2] * 5, 0);
  const forks = (copy, a, b) => {
    const xs = w.filter((r) => r[1] === copy - 1 && r[0] >= e0 + a * 1000 && r[0] <= e0 + b * 1000).map((r) => r[2]);
    return xs.length ? [+(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(1), Math.max(...xs)] : [null, null];
  };
  const both = new Map();
  for (const r of w.filter((r) => r[0] >= e0)) both.set(r[0], (both.get(r[0]) ?? 0) + r[2]);
  const peak = Math.max(...both.values());
  const parts = [];
  let narrowMax = 0;
  for (const copy of [1, 2]) {
    const v = runs.filter((r) => r.copy === copy && r.lane === "vitest");
    const first = v.find((r) => r.files >= 20);
    const [m, p] = first ? forks(copy, first.start, first.end) : [null, null];
    for (const t of v.filter((r) => r.files >= 20)) {
      const [mm] = forks(copy, t.start, t.end);
      if (mm !== null && mm <= 3) narrowMax = Math.max(narrowMax, t.end - t.start);
    }
    const end = Math.max(...runs.filter((r) => r.copy === copy).map((r) => r.end));
    parts.push(`c${copy} end ${end.toFixed(0)} first ${first ? `${first.start.toFixed(0)}+${(first.end - first.start).toFixed(0)}s ${first.files}f ${m}/${p}` : "none"}`);
  }
  console.log(`${label}: wall ${q4b.spanS.toFixed(0)} s | ${parts.join(" | ")} | narrow ${narrowMax ? narrowMax.toFixed(0) + " s" : "none"} | peak forks ${peak} | >=11.5 busy ${q4b.overshoot.busyAtOrAbove11_5Pct}% | idle CPUs while files wait ${q4b.underUse.idleCoresWhilePending} | host CPU-s ${cpuS.toFixed(0)}`);
}
