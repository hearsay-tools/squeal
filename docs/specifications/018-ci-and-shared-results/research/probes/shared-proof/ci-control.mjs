// Throwaway (018-21). Within-run control for runner speed: per merge-group run where all four
// Vitest shards and all four cockpit E2E shards ran their test step, the ratio
// (sum of Vitest test steps) / (sum of E2E test steps). The E2E shards run in the same run at the
// same time and are not recorded, so a change in runner speed moves both; recording moves only
// the numerator. Groups by recording and by date. Bootstrap 95% interval of the difference.
// Push-to-main runs that ran their shards (most reuse a result) form the group "push plain".
// Usage: node ci-control.mjs <data dir>
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2];
const runs = readFileSync(`${dir}/runs.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t = (s) => Date.parse(s);
const rows = [];
for (const run of runs) {
  const p = `${dir}/jobs/${run.id}.json`;
  if (!(run.event === "merge_group" || (run.event === "push" && run.head_branch === "main")) || !existsSync(p)) continue;
  const jobs = JSON.parse(readFileSync(p, "utf8")).jobs ?? [];
  const step = (re, stepRe) => jobs.filter((j) => re.test(j.name)).map((j) => (j.steps ?? []).find((s) => stepRe.test(s.name) && s.conclusion === "success")).filter(Boolean);
  const v = step(/^Vitest shard \d\/4$/, /^Run server and cockpit unit suites/);
  const e = step(/^Cockpit browser E2E shard \d\/4$/, /^Run cockpit browser E2E$/);
  if (v.length !== 4 || e.length !== 4) continue;
  const sum = (xs) => xs.reduce((a, s) => a + (t(s.completed_at) - t(s.started_at)) / 1000, 0);
  const recording = v.every((s) => / with Squeal recording$/.test(s.name));
  const tag = run.event === "push" ? "push plain" : recording ? (t(run.created_at) < t("2026-11-10T13:00:00Z") ? "0.1.423 (not attached)" : "recording") : "plain";
  rows.push({ run: run.id, created: run.created_at, tag, vitest: sum(v), e2e: sum(e), ratio: sum(v) / sum(e) });
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const groups = new Map();
for (const r of rows) {
  const k = `${r.tag} ${r.created.slice(0, 10)}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
console.log("group (date)                        n   vitest s  e2e s   ratio mean (sd)");
for (const [k, xs] of [...groups].sort()) {
  console.log(`${k.padEnd(34)} ${String(xs.length).padStart(3)}  ${mean(xs.map((x) => x.vitest)).toFixed(0).padStart(7)}  ${mean(xs.map((x) => x.e2e)).toFixed(0).padStart(6)}   ${mean(xs.map((x) => x.ratio)).toFixed(3)} (${xs.length > 1 ? sd(xs.map((x) => x.ratio)).toFixed(3) : "-"})`);
}
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (a, b, n = 5000) => {
  const ds = [];
  for (let i = 0; i < n; i++) ds.push(mean(b.map(() => b[Math.floor(rnd() * b.length)])) - mean(a.map(() => a[Math.floor(rnd() * a.length)])));
  ds.sort((x, y) => x - y);
  return [ds[Math.floor(0.025 * n)], ds[Math.floor(0.975 * n)]];
};
const rec = rows.filter((r) => r.tag === "recording").map((r) => r.ratio);
for (const [label, pred] of [
  ["all plain", (r) => r.tag === "plain"],
  ["plain since 2026-11-09", (r) => r.tag === "plain" && r.created >= "2026-11-09"],
  ["plain 2026-11-08", (r) => r.tag === "plain" && r.created < "2026-11-09"],
]) {
  const a = rows.filter(pred).map((r) => r.ratio);
  const [lo, hi] = boot(a, rec);
  console.log(`recording (n=${rec.length}) vs ${label} (n=${a.length}): ratio ${mean(a).toFixed(3)} -> ${mean(rec).toFixed(3)}, ${((100 * (mean(rec) - mean(a))) / mean(a)).toFixed(1)}% (95% CI ${((100 * lo) / mean(a)).toFixed(1)}% to ${((100 * hi) / mean(a)).toFixed(1)}%)`);
}
