// main-results probe (throwaway): tables for questions 1 and 2 from prize.cjs output and a sar export.
// Usage: node summary.cjs <prize.jsonl> <sar-u.csv> <switch ISO> [knee busy vCPUs = 16] [vCPUs = 24]
// Seconds are recorded file seconds. Groups: background = baseline + catch-up/backlog + run-all; edit tiers apart.
// "clean" runs ran at a commit with no uncommitted change, so their content is known; "dirty" runs ran beside
// uncommitted edits, and the match at their commit is only an upper bound.
const fs = require("fs");
const [, , prizePath, sarPath, switchIso, kneeArg, cpuArg] = process.argv;
const SWITCH = Date.parse(switchIso), KNEE = Number(kneeArg ?? 16), CPUS = Number(cpuArg ?? 24);
const sar = fs.readFileSync(sarPath, "utf8").trim().split("\n").map((l) => l.split(";")).map((f) => ({ t: Number(f[2]) * 1000, busy: CPUS * (100 - Number(f[9])) / 100 })).sort((a, b) => a.t - b.t);
const busyAt = (t) => { let lo = 0, hi = sar.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (sar[m].t >= t) { r = sar[m]; hi = m - 1; } else lo = m + 1; } return r && r.t - t <= 11 * 60e3 ? r.busy : null; };
const L = fs.readFileSync(prizePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const T = {};
const add = (k, x, v = x.sec) => { T[k] = (T[k] ?? 0) + v; };
let t0 = Infinity, t1 = 0;
const ages = [], lags = [];
for (const x of L) {
  t0 = Math.min(t0, x.rs); t1 = Math.max(t1, x.rs);
  const g = x.kind === "edit" ? "edit" : "background";
  const per = x.rs < SWITCH ? "before" : "after";
  const st = x.m === null || !x.m.known ? "unknown" : x.dirty ? "dirty" : "clean";
  const busy = busyAt((x.rs + x.re) / 2);
  const band = busy === null ? "nosar" : busy > KNEE ? "above" : "below";
  for (const p of [per, "all"]) {
    const k = `${g}|${p}`;
    add(`${k}|total`, x); add(`${k}|${st}|total`, x); add(`${k}|${band}|total`, x);
    if (g === "background") add(`${k}|kind:${x.kind}|total`, x);
    if (st === "unknown") continue;
    for (const m of ["ci", "near", "landed", "later"]) if (x.m[m]) {
      add(`${k}|${st}|${m}`, x); add(`${k}|${band}|${st}|${m}`, x); add(`${k}|${band}|${st}|total`, x);
      if (g === "background") add(`${k}|kind:${x.kind}|${st}|${m}`, x);
    }
    if (g === "background") add(`${k}|kind:${x.kind}|${st}|total`, x);
  }
  if (x.kind !== "edit" && x.m && x.m.known && !x.dirty && x.m.ci) ages.push([x.m.ciAge, x.sec]);
  if (x.kind !== "edit" && x.m && x.m.known && !x.dirty && x.m.ciLagAfterLanding !== null && (x.m.ci || x.m.later)) lags.push([x.m.ciLagAfterLanding, x.sec]);
}
// band totals were added once per match kind above; recompute them cleanly
for (const k of Object.keys(T)) if (/\|(above|below|nosar)\|(clean|dirty)\|total$/.test(k)) delete T[k];
for (const x of L) {
  if (x.m === null || !x.m.known) continue;
  const g = x.kind === "edit" ? "edit" : "background", st = x.dirty ? "dirty" : "clean";
  const busy = busyAt((x.rs + x.re) / 2); const band = busy === null ? "nosar" : busy > KNEE ? "above" : "below";
  for (const p of [x.rs < SWITCH ? "before" : "after", "all"]) add(`${g}|${p}|${band}|${st}|total`, x);
}
const wq = (a, p) => { const s = [...a].sort((x, y) => x[0] - y[0]); const tot = s.reduce((n, x) => n + x[1], 0); let c = 0; for (const x of s) { c += x[1]; if (c >= p * tot) return x[0]; } return null; };
const days = (t1 - t0) / 864e5;
console.log(JSON.stringify({ from: new Date(t0).toISOString(), to: new Date(t1).toISOString(), days: +days.toFixed(2), switch: switchIso }));
for (const k of Object.keys(T).sort()) {
  const parts = k.split("|"); const base = parts.slice(0, 2).join("|");
  const tot = T[`${base}|total`];
  console.log(`${k.padEnd(52)} ${String(Math.round(T[k])).padStart(9)} s ${(100 * T[k] / tot).toFixed(1).padStart(5)}% of ${parts[0]} ${parts[1]}`);
}
console.log("CI finish to run start, matched clean background s (weighted): p10/p50/p90 h", [0.1, 0.5, 0.9].map((p) => +(wq(ages, p) / 3600).toFixed(2)));
console.log("CI finish after landing, for matched or lost clean background s (weighted): p10/p50/p90 min", [0.1, 0.5, 0.9].map((p) => +(wq(lags, p) / 60).toFixed(1)));
