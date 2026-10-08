// Throwaway. node history-select.mjs <repo> <sets.json> <durations.json> [n]
// Replays the last n non-merge commits: for each, which slow files the
// observed source closures select, and the selected share of the tier's time.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [repo, setsFile, durFile, n = "300"] = process.argv.slice(2);
const sets = Object.fromEntries(Object.entries(JSON.parse(readFileSync(setsFile, "utf8"))).map(([k, v]) => [k, new Set(v)]));
const dur = JSON.parse(readFileSync(durFile, "utf8"));
const total = Object.values(dur).reduce((a, b) => a + b, 0);
const log = execFileSync("git", ["-C", repo, "log", "--no-merges", "--name-only", "--format=@%h", `-${n}`], { encoding: "utf8" });
const commits = log.split("@").filter(Boolean).map((c) => { const [h, ...f] = c.trim().split("\n"); return { h, files: f.filter(Boolean) }; });
let code = 0, none = 0, all = 0, share = 0;
for (const c of commits) {
  const src = c.files.filter((f) => /^packages\/(cezar|contract)\/src\/.*\.ts$/.test(f) && !f.endsWith(".test.ts"));
  if (!src.length) continue;
  code += 1;
  const sel = Object.keys(sets).filter((k) => src.some((f) => sets[k].has(f)));
  const ms = sel.reduce((a, k) => a + (dur[k] ?? 0), 0);
  share += ms / total;
  if (!sel.length) none += 1;
  if (ms / total > 0.9) all += 1;
}
console.log(`commits=${commits.length} touchingSource=${code} selectNone=${none} selectOver90pctOfTime=${all} meanSelectedTimeShare=${(share / code).toFixed(2)}`);
