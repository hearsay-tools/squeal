// 015-14 Round 3: per worktree with a coverage summary, the files by state and
// cause, and the `uncovered` and `crap` functions by their file's state and
// cause and their own outcome. Round 2's unknown.py read exports; this reads
// the stores directly, read only. A function `pass` in a file `unknown,
// skipped` is a pass proven beside a skipped loader (015-78).
// Usage: node unknown.mjs <.git/squeal dir>
import { DatabaseSync } from "node:sqlite";

const dir = process.argv[2];
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const main = open("store.sqlite");
const roots = new Map(main.prepare("SELECT id, root, daemon_version FROM worktrees").all().map((w) => [w.id, w]));
main.close();
const code = open("code.sqlite");
const states = code.prepare(`SELECT c.path, s.measure, s.outcome, count(*) n FROM states s
  JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND s.measure IN ('uncovered', 'crap')
  GROUP BY c.path, s.measure, s.outcome`);
const out = [];
for (const { key, value } of code.prepare("SELECT key, value FROM meta WHERE key GLOB 'coverage:????????????????'").all()) {
  const wt = key.slice("coverage:".length);
  const summary = JSON.parse(value);
  const files = {};
  const where = (path) => {
    const f = summary.files?.[path];
    return f ? `${f.state}${f.cause ? `, ${f.cause}` : f.reason ? `, ${f.reason}` : ""}` : "absent";
  };
  for (const path of Object.keys(summary.files ?? {})) files[where(path)] = (files[where(path)] ?? 0) + 1;
  const functions = { uncovered: {}, crap: {} };
  for (const r of states.all(wt)) {
    const k = `${where(r.path)} | ${r.outcome}`;
    functions[r.measure][k] = (functions[r.measure][k] ?? 0) + Number(r.n);
  }
  const w = roots.get(wt);
  out.push({ worktree: wt, root: w?.root ?? null, daemon: w?.daemon_version ?? null, files, functions });
}
code.close();
console.log(JSON.stringify(out, null, 1));
