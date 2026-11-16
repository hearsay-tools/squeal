// Throwaway probe for the 005-93 design note: how often every file of every edit so far had run
// (the moments a settled or caught-up line could be said), from edits.mjs output.
// Usage: node settles.mjs <edits.jsonl>
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.ran.length > 0);
const byW = new Map();
for (const r of rows) byW.set(r.w, [...(byW.get(r.w) ?? []), r]);
let settles = 0, edits = 0;
const gaps = [];
for (const list of byW.values()) {
  list.sort((a, b) => a.t - b.t);
  let end = -Infinity;
  for (const r of list) {
    edits++;
    if (r.t >= end && end !== -Infinity) { settles++; gaps.push(r.t - end); }
    end = Math.max(end, r.t + r.ran.at(-1)[2]);
  }
  settles++; // the last interval ends too
}
console.log("worktrees", byW.size, "edits", edits, "moments all re-keyed files had run", settles);
