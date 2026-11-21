// Throwaway (row 018-72): local runs and summed check time of test files matching a regex since a
// date: one "file-run" = one key a local worktree stored results at (squawk store, read-only).
// Usage: node cost.mjs <path-regex> <sinceIso> [project]
import { DatabaseSync } from "node:sqlite";
const [re, since, project = "server"] = process.argv.slice(2);
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const ids = db.prepare("select id, test_path p from checks where project = ? and kind = 'test'").all(project).filter((c) => new RegExp(re).test(c.p));
const q = db.prepare("select key, worktree_id w, sum(duration_ms) ms from results where check_id = ? and recorded_at >= ? and length(worktree_id) = 16 group by key, worktree_id");
const imp = new Set(db.prepare("select id from imports").all().map((r) => r.id));
const per = new Map();
for (const c of ids) for (const r of q.iterate(c.id, Date.parse(since))) {
  if (imp.has(r.w)) continue;
  const k = `${c.p}\0${r.key}\0${r.w}`; per.set(k, (per.get(k) ?? 0) + r.ms);
}
const files = new Map();
for (const [k, ms] of per) { const p = k.split("\0")[0]; const f = files.get(p) ?? { runs: 0, s: 0 }; f.runs++; f.s += ms / 1000; files.set(p, f); }
const tot = [...files.values()].reduce((a, f) => ({ runs: a.runs + f.runs, s: a.s + f.s }), { runs: 0, s: 0 });
console.log(JSON.stringify({ since, files: files.size, fileRuns: tot.runs, checkSeconds: Math.round(tot.s), perRunSeconds: +(tot.s / Math.max(1, tot.runs)).toFixed(1) }));
