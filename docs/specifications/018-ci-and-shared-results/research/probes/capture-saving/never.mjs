// throwaway (row 018-25): why the daemon never ran a manual run's content in its worktree.
// Reads pairs-<variant>.json from join.mjs --pairs (transcript-mode pairs only).
import fs from "node:fs";
const [v] = process.argv.slice(2); const ps = JSON.parse(fs.readFileSync(`pairs-${v}.json`, "utf8"));
const q50 = (xs) => { const s = xs.sort((a, b) => a - b); return s.length ? `p25 ${s[s.length >> 2]}, p50 ${s[s.length >> 1]}, p75 ${s[(s.length * 3) >> 2]}` : "none"; };
for (const repo of ["squeal", "cezar"]) {
  const nv = ps.filter((p) => p.repo === repo && p.mode === "transcript" && p.c === "daemon never ran that content here");
  const nextChange = (p) => (p.next === "none" ? null : Number(p.next.split("+")[1].replace("s", "")));
  const nextRun = (p) => { const a = p.daemonRuns.filter((d) => d[1] > 0).map((d) => d[1]); return a.length ? Math.min(...a) : null; };
  const superseded = nv.filter((p) => nextChange(p) !== null && nextRun(p) !== null && nextRun(p) > nextChange(p)).length;
  const noLater = nv.filter((p) => nextRun(p) === null).length;
  const noPrev = nv.filter((p) => p.prev === "none").length;
  console.log(`${v} ${repo}: never-run file-runs ${nv.length}; the next change came before the daemon's next run of the file ${superseded}; no later daemon run of the file in that worktree ${noLater}; no change seen in that worktree before the run ${noPrev}; seconds from the run's start to the next change: ${q50(nv.map(nextChange).filter((x) => x !== null))}; to the daemon's next run of the file: ${q50(nv.map(nextRun).filter((x) => x !== null))}`);
}
