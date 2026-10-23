// Throwaway probe for 011-127 (inferred, not measured): over the src commits listed in <commits.txt>, how many
// of the gap files each commit leaves keyed though their bundle holds an edited file. usage: node exposure.mjs <gap-full.json> <commits.txt>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8")).filter((r) => r.missing > 0);
const commits = readFileSync(process.argv[3], "utf8").trim().split("\n");
let exposed = 0, sumFiles = 0, sumS = 0;
const durations = JSON.parse(readFileSync("/tmp/r127/census.json", "utf8")).testResults
  .reduce((m, f) => ((m[f.name.replace("/tmp/r127/repo/", "")] = (f.endTime - f.startTime) / 1000), m), {});
for (const c of commits) {
  const files = execFileSync("git", ["show", "--name-only", "--format=", c, "--", "src/**/*.ts"], { encoding: "utf8" }).trim().split("\n");
  const hit = rows.filter((r) => files.some((f) => r.missingList.includes(f)));
  if (hit.length) exposed++;
  sumFiles += hit.length; sumS += hit.reduce((s, r) => s + (durations[r.test] ?? 0), 0);
}
console.log(JSON.stringify({ commits: commits.length, gapFiles: rows.length, commitsWithAStalePass: exposed,
  meanFilesLeftStale: +(sumFiles / commits.length).toFixed(1), meanTheirRunS: +(sumS / commits.length).toFixed(1),
  allGapFilesRunS: +rows.reduce((s, r) => s + (durations[r.test] ?? 0), 0).toFixed(1) }));
