// Throwaway (results-at-commit, question 5). Which of the last 200
// first-parent main commits have a CI export ref (`refs/squeal/<sha>`, 018 D13).
// Usage: git ls-remote origin 'refs/squeal/*' | node refs.mjs <repo>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [repo] = process.argv.slice(2);
const refs = new Set(readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("\t")[1].replace("refs/squeal/", "")));
const main = execFileSync("git", ["-C", repo, "log", "--first-parent", "--format=%H %cI", "-n", "200", "origin/main"], { encoding: "utf8" })
  .trim().split("\n").map((l) => l.split(" "));
const hits = main.flatMap(([sha], i) => (refs.has(sha) ? [i] : []));
console.log(JSON.stringify({ refs: refs.size, last200Hits: hits.length, hitIndexes: hits, oldestHitDate: main[hits.at(-1)]?.[1] ?? null }));
