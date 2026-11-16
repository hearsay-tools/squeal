// Throwaway probe for the 005-93 design note: the first tier planned at each edit's revision.
// Usage: node first-tier.mjs <tiers.jsonl>
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]) : null; };
const dist = (name, xs) => console.log(name.padEnd(34), "n", String(xs.length).padStart(4), "p50", q(xs, .5), "p75", q(xs, .75), "p90", q(xs, .9), "p95", q(xs, .95), "max", q(xs, 1));
const wall = (sum, longest, width) => sum / width + (1 - 1 / width) * longest;
const firsts = rows.map((r) => ({ ...r, f: r.tiers.find((x) => x.s >= 0 && x.e !== null && x.st === "completed") })).filter((r) => r.f);
for (const r of firsts) {
  const d = r.f.d.map((x) => x ?? 0);
  r.est = wall(d.reduce((a, b) => a + b, 0), Math.max(...d), d.length);
  r.start = r.f.s; r.end = r.f.e; r.runWall = r.f.e - r.f.s;
}
dist("edit -> first tier start ms", firsts.map((r) => r.start));
dist("first tier wall ms", firsts.map((r) => r.runWall));
dist("first tier estimate ms", firsts.map((r) => r.est));
dist("tier wall - estimate ms", firsts.map((r) => r.runWall - r.est));
dist("edit -> first tier end ms", firsts.map((r) => r.end));
// Machine-measured parts: the store's own median start delay and tier overhead (no fixed number).
const startMed = q(firsts.map((r) => r.start), .5);
const overMed = q(firsts.map((r) => r.runWall - r.est), .5);
console.log("measured median start delay", startMed, "median tier overhead", overMed);
for (const k of [2, 3, 4]) {
  const late = firsts.filter((r) => r.end > k * (startMed + overMed + r.est));
  console.log(`late at ${k} x (start + overhead + estimate):`, late.length, "of", firsts.length, `(${(100 * late.length / firsts.length).toFixed(0)}%)`,
    "of which the next edit came first", late.filter((r) => r.next !== null && r.next < k * (startMed + overMed + r.est)).length);
}
// Episodes per worktree at k = 3: one late notice, then nothing until that tier ended (caught up).
const byW = new Map();
for (const r of firsts) byW.set(r.w, [...(byW.get(r.w) ?? []), r]);
let notices = 0, spanH = 0;
const perW = [];
for (const list of byW.values()) {
  list.sort((a, b) => a.t - b.t);
  spanH += (list.at(-1).t + list.at(-1).end - list[0].t) / 3600e3;
  let open = -Infinity, n = 0;
  for (const r of list) {
    const bound = 3 * (startMed + overMed + r.est);
    if (r.t < open) { open = Math.max(open, r.t + r.end); continue; }
    if (r.end > bound) { n++; open = r.t + r.end; }
  }
  notices += n; perW.push(n);
}
console.log("k=3 episodes: worktrees", byW.size, "late notices", notices, "worktrees with none", perW.filter((x) => x === 0).length, "max per worktree", Math.max(...perW), "edit-span hours", spanH.toFixed(0));
