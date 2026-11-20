// overrun-check.mjs: per two-daemon run (row 011-423), each backlog tier of 20
// files or more, and the first 4-file tier of the same copy that starts while
// it runs: the delay from the backlog tier's start. Row 011-399's rule opens
// such a tier beside one whose unfinished files all passed max(10 x their
// last-known time, 60 s), counted from the tier's start.
import { readFileSync, readdirSync } from "node:fs";
const R = new URL("./results/", import.meta.url).pathname;
for (const f of readdirSync(R).filter((x) => /^S-.*\.runs\.json$/.test(x)).sort()) {
  const runs = JSON.parse(readFileSync(R + f, "utf8")).filter((r) => r.lane === "vitest");
  const lines = [];
  for (const t of runs.filter((r) => r.files >= 20)) {
    const beside = runs.filter((r) => r.copy === t.copy && r.files <= 4 && r.start > t.start && r.start < t.end);
    if (beside.length) lines.push(`copy ${t.copy} ${t.files}f from ${t.start}: ${beside.length} beside, first +${(beside[0].start - t.start).toFixed(1)} s`);
  }
  console.log(f.replace(".runs.json", "").padEnd(9), lines.join(" | ") || "none");
}
