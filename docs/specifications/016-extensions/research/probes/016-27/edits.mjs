// Throwaway probe (016-27), question 2: for each revision since <sinceMs> whose changed paths hold a
// path some test file's stored direct marks hold (`observedDirect.<project>`), each such marked file:
// the daemon version the worktree ran then, the first run of the file in that worktree after the
// revision (delay, the run's revision and size), and how many files the revision's marks reached.
// Read-only. Usage: node edits.mjs <store> <sinceMs> [worktreeId-to-skip]
import { DatabaseSync } from "node:sqlite";
const [file, sinceMs, skip = ""] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const since = Number(sinceMs);
// Daemon incarnations per worktree, from the notes rows.
const inc = new Map();
const re = /(\d+\.\d+\.\d+)@(\d{13})/g;
for (const { key, value } of db.prepare("select key, value from meta where key like 'notes%' or key like 'daemon-exit%' or key like 'rekeyed-moves%'").all()) {
  const wt = key.match(/[0-9a-f]{16}/)?.[0];
  if (!wt) continue;
  for (const m of value.matchAll(re)) {
    const list = inc.get(wt) ?? [];
    if (!list.some((x) => x.at === Number(m[2]))) list.push({ version: m[1], at: Number(m[2]) });
    inc.set(wt, list);
  }
}
for (const r of db.prepare("select id, daemon_version v, daemon_started_at s from worktrees where daemon_started_at is not null").all()) {
  const list = inc.get(r.id) ?? [];
  if (!list.some((x) => x.at === r.s)) list.push({ version: r.v, at: r.s });
  inc.set(r.id, list);
}
for (const list of inc.values()) list.sort((a, b) => a.at - b.at);
const versionAt = (wt, t) => (inc.get(wt) ?? []).filter((x) => x.at <= t).at(-1)?.version ?? "?";
// Marks: path -> marked test files, per project.
const marked = new Map();
for (const { key, value } of db.prepare("select key, value from meta where key like 'observedDirect.%'").all()) {
  const project = key.slice("observedDirect.".length);
  for (const [test, paths] of Object.entries(JSON.parse(value)))
    for (const p of paths) {
      const set = marked.get(p) ?? new Set();
      set.add(`${project}\0${test}`);
      marked.set(p, set);
    }
}
const runs = db.prepare("select id, revision, started_at, ended_at, end_state, test_files from runs where worktree_id = ? and started_at >= ? order by started_at").all.bind(db.prepare("select id, revision, started_at, ended_at, end_state, test_files from runs where worktree_id = ? and started_at >= ? order by started_at"));
const revs = db.prepare("select worktree_id w, number, created_at t, changes from revisions where created_at >= ? order by w, number").all(since);
const out = [];
for (const r of revs) {
  if (r.w === skip) continue;
  const changed = JSON.parse(r.changes).map((c) => c.path);
  const changedSet = new Set(changed);
  const reached = new Map();
  for (const p of changed) for (const f of marked.get(p) ?? []) {
    if (changedSet.has(f.split("\0")[1])) continue;
    reached.set(f, [...(reached.get(f) ?? []), p]);
  }
  if (reached.size === 0) continue;
  const later = runs(r.w, r.t);
  const rows = [];
  for (const [f, paths] of reached) {
    const [project, path] = f.split("\0");
    const idx = later.findIndex((run) => JSON.parse(run.test_files).some((x) => x.project === project && x.path === path));
    const run = idx >= 0 ? later[idx] : null;
    rows.push({ project, path, via: paths.slice(0, 3), viaCount: paths.length,
      run: run === null ? null : { delayS: Math.round((run.started_at - r.t) / 100) / 10, revision: run.revision, files: JSON.parse(run.test_files).length, end: run.end_state, runsBefore: idx } });
  }
  out.push({ worktree: r.w, revision: r.number, at: new Date(r.t).toISOString(), version: versionAt(r.w, r.t),
    changed: changed.length, changedSample: changed.slice(0, 4), markedReached: reached.size, files: rows });
}
for (const o of out) console.log(JSON.stringify(o));
