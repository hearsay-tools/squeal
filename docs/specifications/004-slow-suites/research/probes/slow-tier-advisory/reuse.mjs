// Throwaway, read-only: per worktree, the slow files whose latest known state came from another
// worktree (inherited, run saved) or from its own run, valued at each file's mean single-file run
// wall time in this store. Usage: node reuse.mjs <store.sqlite> <test_path LIKE>
import { DatabaseSync } from "node:sqlite";
const [store, like] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const wall = new Map();
for (const r of db.prepare("SELECT test_files, ended_at - started_at d FROM runs WHERE ended_at IS NOT NULL").all()) {
  const f = JSON.parse(r.test_files);
  if (f.length !== 1) continue;
  const a = wall.get(f[0].path) ?? [0, 0];
  wall.set(f[0].path, [a[0] + r.d, a[1] + 1]);
}
const mean = (p) => { const a = wall.get(p); return a ? a[0] / a[1] / 60000 : 0; };
const rows = db.prepare(`SELECT w.root, k.origin_kind o, k.validity v, c.test_path p FROM known_states k JOIN checks c ON c.id = k.check_id JOIN worktrees w ON w.id = k.worktree_id WHERE c.kind = 'file' AND c.test_path LIKE ?`).all(like);
const per = {};
const tot = {};
for (const r of rows) {
  const w = (per[r.root.replace(/.*\//, "").slice(0, 24)] ??= {});
  const k = `${r.o}-${r.v}`;
  w[k] = (w[k] ?? 0) + 1;
  tot[k] = tot[k] ?? { files: 0, minutes: 0 };
  tot[k].files++;
  tot[k].minutes += mean(r.p);
}
for (const k in tot) tot[k].minutes = +tot[k].minutes.toFixed(1);
const ownRuns = db.prepare(`SELECT count(*) n, sum(ended_at - started_at) / 60000.0 m FROM runs WHERE test_files LIKE ?`).get(`%${like.replace(/%.*$/, "")}%`);
console.log(JSON.stringify({ totals: tot, runsInStore: { n: ownRuns.n, minutes: +ownRuns.m.toFixed(1) }, perWorktree: per }, null, 1));
