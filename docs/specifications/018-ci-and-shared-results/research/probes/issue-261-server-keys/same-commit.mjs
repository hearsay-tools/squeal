// Throwaway (row 018-72): for each test file, the distinct keys local worktrees stored results
// at for one clean commit, and the keys the imports of that commit hold (squawk store, read-only).
// Usage: node same-commit.mjs <commit> [project]
import { DatabaseSync } from "node:sqlite";
const [commit, project = "server"] = process.argv.slice(2);
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const local = db.prepare(`select c.test_path f, r.key k, group_concat(distinct r.worktree_id) w from results r join checks c on c.id = r.check_id
  where r.commit_sha = ? and r.dirty = 0 and c.project = ? and length(r.worktree_id) = 16 and r.worktree_id not in (select id from imports) group by 1, 2`).all(commit, project);
const imp = db.prepare(`select f.path f, f.key k, i.id i from import_files f join imports i on i.id = f.import_id where json_extract(i.header,'$.commit') = ? and f.project = ?`).all(commit, project);
const byFile = new Map();
for (const r of local) { if (!byFile.has(r.f)) byFile.set(r.f, { local: new Map(), imported: new Set() }); byFile.get(r.f).local.set(r.k, r.w.split(",")); }
for (const r of imp) byFile.get(r.f)?.imported.add(r.k);
const tally = {}; const t = (k) => (tally[k] = (tally[k] ?? 0) + 1);
const worktrees = new Set(local.flatMap((r) => r.w.split(",")));
for (const [f, { local: l, imported }] of byFile) {
  const multi = [...l.values()].some((ws) => ws.length > 1);
  t(`${l.size === 1 ? "one local key" : `${l.size} local keys`}${multi ? " (shared by worktrees)" : ""}; ${[...l.keys()].some((k) => imported.has(k)) ? "an import holds one" : imported.size ? "no import holds one" : "not in any import"}`);
}
console.log(JSON.stringify({ commit, project, worktrees: [...worktrees], files: byFile.size, tally }, null, 1));
