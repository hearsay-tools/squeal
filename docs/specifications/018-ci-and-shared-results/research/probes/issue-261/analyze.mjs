// Throwaway probe (row 018-69): per test file, where a sandbox worktree's
// results came from after a fast-forward, from a copy of its store.
// Usage: node analyze.mjs <store.sqlite> <ff ISO time> <to-commit>
import { DatabaseSync } from "node:sqlite";

const [file, ffIso, to] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const ff = Date.parse(ffIso);
const [w] = db.prepare("select id from worktrees").all();
const revs = db.prepare("select number, created_at, head, trigger, json_array_length(changes) n from revisions where worktree_id = ? order by number").all(w.id);
const imports = db.prepare("select id, imported_at, json_extract(header,'$.commit') c from imports order by imported_at").all();
// per test file: origin of its checks' known states
const rows = db.prepare(`select c.project p, c.test_path t, k.validity v, k.outcome o, k.origin_worktree ow, k.origin_commit oc
  from known_states k join checks c on c.id = k.check_id where k.worktree_id = ?`).all(w.id);
const files = new Map();
for (const r of rows) {
  const key = `${r.p} ${r.t}`;
  const f = files.get(key) ?? { origins: new Set(), validity: new Set() };
  f.origins.add(r.ow === w.id ? "own" : r.ow?.startsWith("import:") ? `import ${r.oc?.slice(0, 8)}` : r.ow === null ? "none" : "other worktree");
  f.validity.add(r.v);
  files.set(key, f);
}
const byOrigin = {};
for (const f of files.values()) { const k = [...f.origins].sort().join("+"); byOrigin[k] = (byOrigin[k] ?? 0) + 1; }
// local runs after the fast-forward: when they started relative to it and to the import of `to`
const imp = imports.find((i) => i.c === to);
const runs = db.prepare("select revision, started_at s, ended_at e, test_files tf from runs where worktree_id = ? order by started_at").all(w.id);
const after = runs.filter((r) => r.s >= ff);
const ranFiles = new Set(after.flatMap((r) => JSON.parse(r.tf).map((x) => `${x.project} ${x.path}`)));
const beforeImport = imp ? after.filter((r) => r.s < imp.imported_at) : after;
const ranBeforeImport = new Set(beforeImport.flatMap((r) => JSON.parse(r.tf).map((x) => `${x.project} ${x.path}`)));
console.log(JSON.stringify({
  worktree: w.id,
  revisions: revs.map((r) => ({ ...r, at: new Date(r.created_at).toISOString() })),
  imports: imports.map((i) => ({ commit: i.c.slice(0, 8), at: new Date(i.imported_at).toISOString() })),
  importOfTo: imp ? { at: new Date(imp.imported_at).toISOString(), secondsAfterFf: (imp.imported_at - ff) / 1000 } : null,
  testFiles: files.size, filesByOrigin: byOrigin,
  localRunsAfterFf: after.length, filesRunAfterFf: ranFiles.size,
  runsStartedBeforeImportOfTo: beforeImport.length, filesRunBeforeImportOfTo: ranBeforeImport.size,
  lastRunEnd: after.length ? new Date(Math.max(...after.map((r) => r.e ?? 0))).toISOString() : null,
  minutesOfLocalRunsAfterFf: after.length ? (Math.max(...after.map((r) => r.e ?? 0)) - ff) / 60000 : 0,
}, null, 1));
