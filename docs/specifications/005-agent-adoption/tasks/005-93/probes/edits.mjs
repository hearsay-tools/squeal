// Throwaway probe for the 005-93 design note. Read-only on a Squeal store.
// Usage: node edits.mjs <store.sqlite> <days> > out.jsonl
// One line per edit revision (trigger 'watch'): the test files whose stored closure holds a
// changed path (an approximation of the files the edit re-keyed: closures are today's), when
// each first got a result after the edit, and their stored durations before the edit.
import { DatabaseSync } from "node:sqlite";
const [path, daysArg] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
const since = Date.now() - Number(daysArg ?? 7) * 86400e3;
const byPath = new Map(); // changed path -> Set of "project\0testPath"
for (const t of db.prepare("select project, path, closure_paths c from test_files").iterate()) {
  const id = `${t.project}\0${t.path}`;
  for (const p of [t.path, ...JSON.parse(t.c)]) {
    let s = byPath.get(p);
    if (!s) byPath.set(p, (s = new Set()));
    s.add(id);
  }
}
const revs = db.prepare(
  "select worktree_id w, number n, created_at t, changes from revisions where created_at > ? and trigger = 'watch' order by worktree_id, number",
).all(since);
const keysOf = db.prepare("select project, path from test_file_keys where worktree_id = ?");
const runsOf = db.prepare(
  "select revision r, checkpoint_id cp, started_at s, ended_at e, end_state st, test_files f from runs where worktree_id = ? and started_at >= ? order by started_at",
);
const nextEdit = db.prepare(
  "select min(created_at) t from revisions where worktree_id = ? and number > ? and trigger = 'watch'",
);
const fileCheck = db.prepare("select id from checks where kind = 'file' and project = ? and test_path = ?");
const priorDur = db.prepare(
  "select duration_ms d from results where check_id = ? and recorded_at < ? and outcome != 'skip' order by recorded_at desc limit 5",
);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const keyCache = new Map();
for (const r of revs) {
  if (!keyCache.has(r.w)) keyCache.set(r.w, new Set(keysOf.all(r.w).map((k) => `${k.project}\0${k.path}`)));
  const keyed = keyCache.get(r.w);
  const changed = JSON.parse(r.changes).map((c) => c.path);
  const affected = new Set();
  for (const p of changed) for (const id of byPath.get(p) ?? []) if (keyed.size === 0 || keyed.has(id)) affected.add(id);
  if (affected.size === 0) continue;
  const runs = runsOf.all(r.w, r.t).map((x) => ({ ...x, files: new Set(JSON.parse(x.f).map((f) => `${f.project}\0${f.path}`)) }));
  // Per file that ran here after the edit: [stored duration before the edit or null, start, end].
  const ran = [];
  let never = 0;
  let firstStart = null;
  for (const id of affected) {
    const run = runs.find((x) => x.files.has(id) && x.e !== null && x.st === "completed");
    if (!run) { never++; continue; }
    if (firstStart === null || run.s - r.t < firstStart) firstStart = run.s - r.t;
    const [project, p] = id.split("\0");
    const c = fileCheck.get(project, p);
    const m = c ? median(priorDur.all(c.id, r.t).map((x) => x.d)) : null;
    ran.push([m === null ? null : Math.round(m), run.s - r.t, run.e - r.t]);
  }
  ran.sort((a, b) => a[2] - b[2]);
  console.log(JSON.stringify({
    w: r.w.slice(0, 8), n: r.n, t: r.t, changed: changed.length, files: affected.size, never,
    firstStart, ran, nextEdit: (nextEdit.get(r.w, r.n)?.t ?? null) === null ? null : nextEdit.get(r.w, r.n).t - r.t,
  }));
}
