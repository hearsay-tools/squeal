// throwaway (row 018-22): estimated test seconds of the manual Vitest runs in squeal's
// worktrees. Vitest 5's agent output prints no per-file times, so each run's files are
// priced at the mean file-level duration Squeal's store recorded for them in the window
// (file-ms.json, from a copy of the store). Vitest's filter is a substring match.
// Usage: node squeal-seconds.mjs <runs.json> <file-ms.json>
import fs from "node:fs";
const [runsFile, msFile] = process.argv.slice(2);
const { runs } = JSON.parse(fs.readFileSync(runsFile, "utf8"));
const ms = JSON.parse(fs.readFileSync(msFile, "utf8"));
const paths = Object.keys(ms);
let total = 0, priced = 0, unpriced = 0, wall = 0, files = 0;
const perRun = [];
for (const r of runs.filter((r) => r.repo === "squeal" && !r.elsewhere && !/--config|--root/.test(r.segment))) {
  const words = r.segment.replace(/(?:^|\s)(?:-t|--testNamePattern)(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g, " ").split(/\s+/).filter((w) => /^(?:\.\/)?(?:test|src)\//.test(w));
  const hit = new Set();
  if (r.scope === "full") paths.forEach((p) => hit.add(p));
  for (const w of words) for (const p of paths) if (p.includes(w.replace(/^\.\//, ""))) hit.add(p);
  if (hit.size === 0) { unpriced++; continue; }
  const s = [...hit].reduce((a, p) => a + ms[p], 0) / 1000;
  total += s; priced++; files += hit.size; wall += r.wallS ?? 0; perRun.push(s);
}
perRun.sort((a, b) => a - b);
console.log(`squeal runs priced ${priced}, unpriced ${unpriced} (no test path matched); files ${files}; est. test seconds ${total.toFixed(0)}; wall of priced runs ${wall.toFixed(0)} s; ratio ${(total / wall).toFixed(2)}; per run p50 ${perRun[perRun.length >> 1]?.toFixed(1)} s, p90 ${perRun[Math.floor(perRun.length * 0.9)]?.toFixed(1)} s`);
