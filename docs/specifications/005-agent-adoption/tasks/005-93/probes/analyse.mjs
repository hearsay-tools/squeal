// Throwaway probe for the 005-93 design note: candidate lateness rules over edits.mjs output.
// Usage: node analyse.mjs <edits.jsonl> <startup ms>
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.ran.length > 0);
const S = Number(process.argv[3]);
const TIER = 4;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]) : null; };
const dist = (name, xs) => console.log(name.padEnd(30), "n", xs.length, "p50", q(xs, .5), "p75", q(xs, .75), "p90", q(xs, .9), "p95", q(xs, .95), "max", q(xs, 1));
// The scheduler's list-scheduling bound (src/core/scheduler/backlog.ts, wallEstimate).
const wall = (sum, longest, width) => sum / width + (1 - 1 / width) * longest;
for (const r of rows) {
  r.actual = r.ran.at(-1)[2];
  let e = 0;
  for (let i = 0; i < r.ran.length; i += TIER) {
    const d = r.ran.slice(i, i + TIER).map((x) => x[0] ?? 0);
    e += S + wall(d.reduce((a, b) => a + b, 0), Math.max(...d), d.length);
  }
  r.idle = e;
  r.unknownDur = r.ran.filter((x) => x[0] === null).length;
}
console.log("edits with a file run after them", rows.length, "of which some file had no stored duration", rows.filter((r) => r.unknownDur > 0).length);
dist("files run after the edit", rows.map((r) => r.ran.length));
dist("files with a lookup or no run", rows.map((r) => r.never));
dist("first start ms", rows.map((r) => r.firstStart));
dist("last result ms", rows.map((r) => r.actual));
dist("idle estimate ms", rows.map((r) => r.idle));
dist("last result / idle estimate %", rows.map((r) => 100 * r.actual / r.idle));
// Episodes per worktree: a notice when an owed file passes its bound; caught up when every file of every edit so far ended.
function episodes(bound) {
  const byW = new Map();
  for (const r of rows) byW.set(r.w, [...(byW.get(r.w) ?? []), r]);
  let notices = 0, lateEdits = 0, waits = [], hours = 0;
  for (const list of byW.values()) {
    list.sort((a, b) => a.t - b.t);
    hours += Math.max(1, (list.at(-1).t + list.at(-1).actual - list[0].t)) / 3600e3;
    let episodeEnd = -Infinity;
    for (const r of list) {
      const late = r.actual > bound(r);
      if (late) lateEdits++;
      if (r.t < episodeEnd) { episodeEnd = Math.max(episodeEnd, r.t + r.actual); continue; }
      if (late) { notices++; episodeEnd = r.t + r.actual; waits.push(r.actual - bound(r)); }
    }
  }
  return { notices, lateEdits, hours, waits };
}
const rules = {
  "2 x idle estimate": (r) => 2 * r.idle,
  "3 x idle estimate": (r) => 3 * r.idle,
  "2 x idle + 30 s": (r) => 2 * r.idle + 30000,
  "idle + 60 s": (r) => r.idle + 60000,
  "fixed 30 s (host-tuned, for scale)": () => 30000,
  "fixed 120 s (host-tuned, for scale)": () => 120000,
};
for (const [name, f] of Object.entries(rules)) {
  const { notices, lateEdits, hours, waits } = episodes(f);
  console.log(name.padEnd(36), "late edits", lateEdits, `(${(100 * lateEdits / rows.length).toFixed(0)}%)`, "late notices", notices, "worktree-hours", hours.toFixed(0), "notice -> caught up ms p50", q(waits, .5), "p90", q(waits, .9));
}
