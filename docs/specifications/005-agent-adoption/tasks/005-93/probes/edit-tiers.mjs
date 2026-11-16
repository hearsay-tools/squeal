// Throwaway probe for the 005-93 design note. Read-only on a Squeal store.
// Usage: node edit-tiers.mjs <store.sqlite> <days> > out.jsonl
// One line per edit revision (trigger 'watch'): the runs planned at that revision outside a
// checkpoint, of at most `tierSize` (4) files (an edit's tiers; backlog tiers are larger), with
// each file's stored duration before the edit, and the run's start and end from the edit.
import { DatabaseSync } from "node:sqlite";
const [path, daysArg] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
const since = Date.now() - Number(daysArg ?? 7) * 86400e3;
const revs = db.prepare(
  "select worktree_id w, number n, created_at t from revisions where created_at > ? and trigger = 'watch' order by worktree_id, number",
).all(since);
const runsAt = db.prepare(
  "select id, started_at s, ended_at e, end_state st, test_files f from runs where worktree_id = ? and revision = ? and checkpoint_id is null order by started_at",
);
const nextRev = db.prepare("select min(created_at) t from revisions where worktree_id = ? and number > ?");
const fileCheck = db.prepare("select id from checks where kind = 'file' and project = ? and test_path = ?");
const priorDur = db.prepare(
  "select duration_ms d from results where check_id = ? and recorded_at < ? and outcome != 'skip' order by recorded_at desc limit 5",
);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
for (const r of revs) {
  const runs = runsAt.all(r.w, r.n).filter((x) => JSON.parse(x.f).length <= 4);
  if (runs.length === 0) continue;
  const tiers = runs.map((x) => ({
    s: x.s - r.t, e: x.e === null ? null : x.e - r.t, st: x.st,
    d: JSON.parse(x.f).map((f) => {
      const c = fileCheck.get(f.project, f.path);
      const m = c ? median(priorDur.all(c.id, r.t).map((y) => y.d)) : null;
      return m === null ? null : Math.round(m);
    }),
  }));
  const next = nextRev.get(r.w, r.n)?.t ?? null;
  console.log(JSON.stringify({ w: r.w.slice(0, 8), n: r.n, t: r.t, next: next === null ? null : next - r.t, tiers }));
}
