// Throwaway, read-only (gh-50, research/issue-50.md). Reads the cezarion
// checkout's Squeal store around the incident: crashed runs and daemon notes
// between 12:37:30 and 12:47 UTC on 2026-10-20. Opens SQLite read-only; writes
// nothing and signals no daemon.
// usage: node incident-store.cjs /home/agent/projects/cezar/.git/squeal/store.sqlite
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
db.exec("PRAGMA busy_timeout=3000");
const a = Date.parse("2026-10-20T12:37:30Z"), b = Date.parse("2026-10-20T12:47:00Z");
const t = (x) => new Date(Number(x)).toISOString().slice(11, 23);
console.log("runs ended in the window:");
for (const r of db.prepare(
  "select r.worktree_id w, r.revision, r.started_at s, r.ended_at e, r.end_state, r.test_files f, r.log_dir from runs r where r.ended_at between ? and ? order by r.ended_at",
).all(a, b))
  console.log(` ${r.w} rev ${r.revision} ${t(r.s)}..${t(r.e)} ${r.end_state} ${JSON.parse(r.f).length} files log ${r.log_dir}`);
console.log("daemon notes in the window:");
for (const m of db.prepare("select key, value from meta where key like 'notes.%'").all())
  for (const n of JSON.parse(m.value))
    if (n.at >= a && n.at <= b) console.log(` ${m.key.slice(6)} ${t(n.at)} ${String(n.text).slice(0, 120)}`);
