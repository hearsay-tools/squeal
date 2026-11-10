// throwaway (row 018-25): upper bound for a saving in another worktree. Of the file-runs the
// join classed "daemon never ran that content here", those whose content stayed unchanged in
// the worktree to the end of the record and had no later daemon run there: if a daemon in
// another worktree later ran exactly that content, a capture would have saved it. Priced at
// the store mean per file, one per worktree x file. Usage: node bound.mjs <variant> (reads
// pairs-<variant>.json from join.mjs --pairs and stores/<repo>/store.sqlite copies).
import { DatabaseSync } from "node:sqlite"; import fs from "node:fs";
const [v] = process.argv.slice(2); const ps = JSON.parse(fs.readFileSync(`pairs-${v}.json`, "utf8"));
for (const repo of ["squeal", "cezar"]) {
  const db = new DatabaseSync(`stores/${repo}/store.sqlite`, { readOnly: true });
  const mean = new Map(db.prepare("SELECT c.test_path p, avg(r.duration_ms) ms FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' GROUP BY c.project, c.test_path").all().map((r) => [r.p, r.ms]));
  const q = ps.filter((p) => p.repo === repo && p.c === "daemon never ran that content here" && p.next === "none" && !p.daemonRuns.some((d) => d[1] > 0));
  const distinct = new Map(); for (const p of q) distinct.set(`${p.root}\0${p.file}`, mean.get(p.file) ?? 0);
  const s = [...distinct.values()].reduce((a, b) => a + b, 0) / 1000;
  console.log(v, repo, `never-run pairs whose content stayed final in the worktree and had no later daemon run there: ${q.length}; distinct worktree x file ${distinct.size}; file-seconds ${s.toFixed(0)} (${(s / 6).toFixed(0)} a day)`);
}
