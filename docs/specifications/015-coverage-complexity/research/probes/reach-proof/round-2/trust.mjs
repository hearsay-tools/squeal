// Row 015-114 round 2: why test files stay outside the report after the re-walk.
// For each listed test file of the scratch worktree: is its stored closure its own,
// or another worktree's with an equal current key (closureTrust), and is a walk
// stored at its current key (test_file_imports)?
// Usage: node trust.mjs <store.sqlite> <clone root>
import { DatabaseSync } from "node:sqlite";
const [storePath, root] = process.argv.slice(2);
const db = new DatabaseSync(storePath, { readOnly: true });
const wt = db.prepare("select id from worktrees where root = ?").get(root).id;
const rows = db.prepare(`select k.project, k.path, k.key, t.updated_by, o.key other_key,
    exists(select 1 from test_file_imports i where i.project = k.project and i.path = k.path and i.key = k.key) walked
  from test_file_keys k left join test_files t on t.project = k.project and t.path = k.path
  left join test_file_keys o on o.worktree_id = t.updated_by and o.project = k.project and o.path = k.path
  where k.worktree_id = ?`).all(wt);
const by = {};
for (const r of rows) {
  const trust = r.updated_by === null ? "no stored closure" : r.updated_by === wt ? "own closure" : r.other_key === r.key ? "other worktree, same key" : "other worktree, other key";
  const k = `${trust}; ${r.walked ? "walk at current key" : "no walk at current key"}`;
  (by[k] ??= []).push(r.path);
}
for (const [k, v] of Object.entries(by).sort()) console.log(`${String(v.length).padStart(5)}  ${k}  e.g. ${v.slice(0, 3).join(", ")}`);
