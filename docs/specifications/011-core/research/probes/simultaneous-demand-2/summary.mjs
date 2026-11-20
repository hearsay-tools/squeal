// summary.mjs [label...]: one line per two-daemon run (row 011-423), from
// results/: wall (edit to the last file of both copies), each copy's last
// end, each copy's first backlog tier (the first Vitest run of 20 files or
// more: start, length, files, mean/peak forks of the copy), the longest
// narrow tier (20 files or more at 3 forks or fewer on average), each copy's
// lag to width (row 011-423, below), peak live
// forks of both copies, samples at 11.5 busy CPUs or more, and the host's
// busy CPU-s from the edit to t1 (sample.tsv, 5 s samples; the VM ran
// nothing else). Run from this directory: node summary.mjs
import { readFileSync, readdirSync } from "node:fs";
const R = process.env.RESULTS ?? new URL("./results/", import.meta.url).pathname;
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
  // Row 011-423: with 011-418 a narrow start is several short 1-wide tiers, not one long one. The
  // lag to width: from the first backlog run of either copy (a Vitest run that starts 100 s or more
  // after the edit, past the quiet) to the copy's first backlog run at more than 3 forks on average.
  const backlog = runs.filter((r) => r.lane === "vitest" && r.start >= 100);
  const firstAny = Math.min(...backlog.map((r) => r.start));
  const lags = [];
  for (const copy of [1, 2]) {
    const v = runs.filter((r) => r.copy === copy && r.lane === "vitest");
    const first = v.find((r) => r.files >= 20);
    const [m, p] = first ? forks(copy, first.start, first.end) : [null, null];
    for (const t of v.filter((r) => r.files >= 20)) {
      const [mm] = forks(copy, t.start, t.end);
      if (mm !== null && mm <= 3) narrowMax = Math.max(narrowMax, t.end - t.start);
    }
    const wide = backlog.filter((r) => r.copy === copy).find((r) => (forks(copy, r.start, r.end)[0] ?? 0) > 3);
    lags.push(wide ? wide.start - firstAny : null);
    const end = Math.max(...runs.filter((r) => r.copy === copy).map((r) => r.end));
    parts.push(`c${copy} end ${end.toFixed(0)} first ${first ? `${first.start.toFixed(0)}+${(first.end - first.start).toFixed(0)}s ${first.files}f ${m}/${p}` : "none"}`);
  }
  // Row 011-423: both copies compete from the first backlog run to the first copy's last file; each
  // copy's mean live forks over that window, and the gap between the copies' last files.
  const ends = [1, 2].map((c) => Math.max(...runs.filter((r) => r.copy === c).map((r) => r.end)));
  const shared = [1, 2].map((c) => forks(c, firstAny, Math.min(...ends))[0]);
  parts.push(`shared ${firstAny.toFixed(0)}-${Math.min(...ends).toFixed(0)}s forks ${shared.join("/")} | end gap ${Math.abs(ends[0] - ends[1]).toFixed(0)} s`);
  // Row 011-423: summed Vitest file time of both copies (files.tsv), and the hypervisor's steal
  // (sample.tsv column 7, from S-qc-8 on) in CPU-s.
  let fileS = null;
  try { fileS = readFileSync(`${R}${label}.files.tsv`, "utf8").trim().split("\n").slice(1).reduce((a, l) => a + Number(l.split("\t")[4]) / 1000, 0); } catch {}
  const stealS = s.length && s[0].length > 6 ? s.reduce((a, r) => a + r[6] * 5, 0) : null;
  if (process.env.JSON === "1") {
    const lagMax = Math.max(...lags.map((l) => l ?? 999));
    console.log(JSON.stringify({ label, arm: label.split("-")[1], wall: q4b.spanS, ends, shared, endGap: Math.abs(ends[0] - ends[1]), narrow: narrowMax, lag: lagMax, peak, over: q4b.overshoot.busyAtOrAbove11_5Pct, cpuS, fileS, stealS, t0: +readFileSync(`${R}${label}.t0`, "utf8"), firsts: parts.slice(0, 2) }));
    continue;
  }
  console.log(`${label}: wall ${q4b.spanS.toFixed(0)} s | ${parts.join(" | ")} | narrow ${narrowMax ? narrowMax.toFixed(0) + " s" : "none"} | lag to width ${lags.map((l) => (l === null ? "never" : l.toFixed(0))).join("/")} s | peak forks ${peak} | >=11.5 busy ${q4b.overshoot.busyAtOrAbove11_5Pct}% | idle CPUs while files wait ${q4b.underUse.idleCoresWhilePending} | host CPU-s ${cpuS.toFixed(0)}`);
}
