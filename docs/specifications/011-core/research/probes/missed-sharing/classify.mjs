// 011-152 probe (throwaway): one cause per first-start miss, from content.mjs, earlier.mjs and age.mjs; recorded seconds of the files that ran.
// Usage: node classify.mjs <content.jsonl> <earlier.jsonl> <age.jsonl>
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const [, , contentPath, earlierPath, agePath] = process.argv;
const id = (o) => o.ck + "\0" + o.file;
const earlier = new Map(read(earlierPath).map((o) => [id(o), o])), age = new Map(read(agePath).map((o) => [id(o), o]));
const causeOf = (o) => {
  if (o.cls === "commit unknown" || o.cls === "commit not in git") return "G. not determined: no stored row gives the start's commit";
  if (o.cls === "start dirty") return "E. the worktree was dirty at its first start (its own edits)";
  if (o.cls === "equal content stored before, different key") return "D. equal content stored before under another key (a path from another branch in the shared closure list)";
  const e = earlier.get(id(o));
  if (e?.prior && !e.prior.rowNow) return e.prior.wLive ? "C2. an earlier run completed it at equal content in a live worktree; its row is gone" : "C1. an earlier run completed it at equal content in a removed worktree; its row is gone (prune)";
  if (o.cls === "no clean stored row of the file before") return "F. no clean stored row of the file at any commit before (new or rarely run file)";
  const a = age.get(id(o))?.ageMin ?? null;
  if (a !== null && a < 15) return "A. new content: its closure content stood in git less than 15 min before the start";
  return "B. content 15 min or more old, no stored row and no surviving run at equal content";
};
const t = {}; let total = 0, totalN = 0, misses = 0;
for (const o of read(contentPath)) {
  misses++; const k = causeOf(o); t[k] ??= { s: 0, n: 0, all: 0, live: 0, removed: 0 }; t[k].all++;
  if (!o.ran) continue; const s = o.secs ?? 0; t[k].s += s; t[k].n++; t[k][o.live ? "live" : "removed"] += s; total += s; totalN++;
}
console.log(`misses ${misses}; file runs ${totalN}; recorded ${Math.round(total)} s`);
console.log("cause | recorded s (share) | live s / removed s | file runs / misses | CPU-s at 0.32 to 0.59");
for (const [k, v] of Object.entries(t).sort()) console.log(`${k} | ${Math.round(v.s)} (${(100 * v.s / total).toFixed(1)}%) | ${Math.round(v.live)} / ${Math.round(v.removed)} | ${v.n} / ${v.all} | ${Math.round(0.32 * v.s)} to ${Math.round(0.59 * v.s)}`);
