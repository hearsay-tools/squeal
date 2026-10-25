// Throwaway probe (016-27), question 3: per test file, its runs since <sinceMs> (checkpoint runs left out)
// and how many were a repeat: the next run of the file in the same worktree at the same revision, which
// is how a first-seen confirmation shows (a listing the run added, run once more under its new key).
// Also the same counts over every file, as the base rate. Read-only. Usage: repeats.mjs <store> <sinceMs> <path>...
import { DatabaseSync } from "node:sqlite";
const [file, sinceMs, ...paths] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const runs = db.prepare("select worktree_id w, revision, test_files from runs where started_at >= ? and checkpoint_id is null order by started_at").all(Number(sinceMs));
const last = new Map(), stats = new Map();
const all = { runs: 0, repeats: 0 };
for (const r of runs) for (const { project, path } of JSON.parse(r.test_files)) {
  const id = `${r.w}\0${project}\0${path}`;
  const repeat = last.get(id) === r.revision;
  last.set(id, r.revision);
  all.runs++; if (repeat) all.repeats++;
  if (!paths.includes(path)) continue;
  const s = stats.get(path) ?? { runs: 0, repeats: 0, worktrees: new Set() };
  s.runs++; if (repeat) s.repeats++; s.worktrees.add(r.w.slice(0, 8));
  stats.set(path, s);
}
for (const p of paths) { const s = stats.get(p); console.log(JSON.stringify({ path: p, runs: s?.runs ?? 0, repeats: s?.repeats ?? 0, worktrees: s ? s.worktrees.size : 0 })); }
console.log(JSON.stringify({ allFiles: all, repeatShare: Math.round(1000 * all.repeats / all.runs) / 10 }));
