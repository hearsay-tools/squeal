#!/usr/bin/env node
// Throwaway (row 025-26). Per-cell numbers from a benchmark results directory, in run order, and
// the correlation of each metric with the daemon's CPU per edit (a same-code machine-speed proxy).
//   node cell-stats.mjs <bench results dir> [worktree]
import { readdirSync, readFileSync } from "node:fs";
const [D, wt = "0"] = process.argv.slice(2);
// The benchmark's own interpolated quantile (bench/lib.mjs), so p95 matches its scorecards.
const q = (values, p) => {
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos);
  return v[lo] + (v[Math.ceil(pos)] - v[lo]) * (pos - lo);
};
const rows = [];
for (const c of readdirSync(`${D}/cells`)) {
  const j = JSON.parse(readFileSync(`${D}/cells/${c}/cell.json`, "utf8"));
  const all = readdirSync(`${D}/cells/${c}`).filter((f) => /^session-wt\d+\.jsonl$/.test(f));
  const s = all.flatMap((f) => readFileSync(`${D}/cells/${c}/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const h = (n) => s.filter((r) => r.hook === n).map((r) => r.ms);
  const st = s.filter((r) => r.type === "status").map((r) => r.statusMs);
  const cpu = j.phases.sessionDaemonCpuS.reduce((a, b) => a + b, 0) / Math.max(1, j.phases.edits * j.worktrees);
  rows.push({
    cell: c,
    start: new Date(Math.min(...s.map((r) => r.t))).toISOString().slice(11, 16),
    plainVitestS: j.phases.plainVitest ? +(j.phases.plainVitest.ms / 1000).toFixed(1) : null,
    preMin: +q(h("pre-tool-use"), 0).toFixed(0),
    preP50: +q(h("pre-tool-use"), 0.5).toFixed(0),
    preP95: +q(h("pre-tool-use"), 0.95).toFixed(0),
    postP50: +q(h("post-tool-batch"), 0.5).toFixed(0),
    postP95: +q(h("post-tool-batch"), 0.95).toFixed(0),
    statusP95: st.length ? +q(st, 0.95).toFixed(0) : null,
    cpuPerEdit: +cpu.toFixed(2),
  });
}
rows.sort((a, b) => a.start.localeCompare(b.start));
console.log(Object.keys(rows[0]).join("\t"));
for (const r of rows) console.log(Object.values(r).join("\t"));
const corr = (k) => {
  const xs = rows.map((r) => r.cpuPerEdit), ys = rows.map((r) => r[k]);
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mx = m(xs), my = m(ys);
  const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return (cov / sx / sy).toFixed(2);
};
console.log("pearson r with cpuPerEdit:", ["preMin", "preP50", "preP95", "postP50", "postP95", "statusP95"].map((k) => `${k} ${corr(k)}`).join(", "));
