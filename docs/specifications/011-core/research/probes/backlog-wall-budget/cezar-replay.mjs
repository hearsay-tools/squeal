// THROWAWAY probe (011-core/research/backlog-wall-budget.md). Replays cezar's 2026-10-19 checkpoint
// tail (results/cezar-701f50.json, tiers from 13:06:12Z on) under today's rule and the wall rule,
// with this run's per-file times standing for the last-known ones. Also checks the estimators
// against the one node:test tier (54 files, 168 s wall) whose per-file times are known.
import { readFileSync } from "node:fs";
const { tiers } = JSON.parse(readFileSync(new URL("results/cezar-701f50.json", import.meta.url)));
const B = 300;
const makespan = (ds, w) => {
  const free = Array(Math.max(1, w)).fill(0);
  for (const d of ds) free[free.indexOf(Math.min(...free))] += d;
  return Math.max(...free);
};
const sum = (ds) => ds.reduce((a, b) => a + b, 0);
const node = tiers.find((t) => t.files === 54);
const ds = node.fileS;
console.log(`node:test tier: 54 files, measured wall ${node.wallS} s; sum ${sum(ds).toFixed(0)} s, longest ${Math.max(...ds)} s`);
console.log(`  max(longest, sum/4) = ${Math.max(Math.max(...ds), sum(ds) / 4).toFixed(0)} s; greedy shortest-first W=4 = ${makespan(ds, 4).toFixed(0)} s; greedy longest-first = ${makespan([...ds].reverse(), 4).toFixed(0)} s; sum/4 + longest = ${(sum(ds) / 4 + Math.max(...ds)).toFixed(0)} s`);
const tail = tiers.filter((t) => t.startedAt >= "2026-10-19T13:06:12" && t.wallS !== null).flatMap((t) => t.fileS);
const measured = tiers.filter((t) => t.startedAt >= "2026-10-19T13:06:12" && t.wallS !== null).reduce((a, t) => a + t.wallS, 0);
console.log(`tail: ${tail.length} files, measured ${measured.toFixed(0)} s of tiers (today's rule, live)`);
function fits(rule, ds, w) {
  if (rule === "today") return sum(ds) <= B;
  if (rule === "graham") return sum(ds) / w + (1 - 1 / w) * Math.max(...ds) <= B;
  return makespan(ds, w) <= B;
}
function replay(rule, w) {
  const q = [...tail].sort((a, b) => a - b);
  const out = [];
  while (q.length) {
    const t = [q.shift()];
    while (q.length && fits(rule, [...t, q[0]], w)) t.push(q.shift());
    out.push({ n: t.length, wall: makespan(t, Math.min(w, t.length)) });
  }
  const total = sum(out.map((o) => o.wall));
  return `${rule} W=${w}: ${out.length} tiers (${out.map((o) => o.n).join(",")}), ${total.toFixed(0)} s, longest tier ${Math.max(...out.map((o) => o.wall)).toFixed(0)} s, mean wait of an edit in a lane that runs to the end ${(sum(out.map((o) => o.wall ** 2)) / (2 * total)).toFixed(0)} s`;
}
for (const [rule, w] of [["today", 23], ["wall", 23], ["graham", 23], ["wall", 6], ["graham", 6], ["wall", 2], ["graham", 2]]) console.log(replay(rule, w));
