// Throwaway probe for 016-09: keep non-feature rows and mark each a process row (a review, research,
// proof and so on), a review-repair row, or a defect row. Usage: node rows2.mjs <rows.jsonl>
import { readFileSync } from "node:fs";

const NOT = /\b(review|re-review|research|survey|quality pass|quality scan|measure|measurement|proof|probe|digest|release|eval run|baseline|design)\b/i;
const REP = /\b(repair|fix(es)? (of|for)|B\d|S\d)\b/i;
for (const l of readFileSync(process.argv[2], "utf8").trim().split("\n")) {
  const r = JSON.parse(l);
  if (r.origin === "feature") continue;
  const h = r.head.replace(/^\S+ /, "");
  r.kind = NOT.test(h) ? "process-row" : REP.test(h) ? "review-repair-row" : "defect-row";
  console.log(JSON.stringify(r));
}
