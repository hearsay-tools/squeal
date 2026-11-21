// Throwaway (row 018-72): per worktree at one clean commit, when each distinct key of a project's
// files was recorded (squawk store, read-only): runs grouped into key "generations".
// Usage: node key-times.mjs <commit> [project]
import { DatabaseSync } from "node:sqlite";
const [commit, project = "server"] = process.argv.slice(2);
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const rows = db.prepare(`select r.worktree_id w, c.test_path f, r.key k, min(r.recorded_at) t, r.revision rev from results r join checks c on c.id = r.check_id
  where r.commit_sha = ? and r.dirty = 0 and c.project = ? group by 1, 2, 3`).all(commit, project);
const hours = {};
for (const r of rows) { const h = `${r.w} rev ${r.rev} ${new Date(r.t).toISOString().slice(0, 15)}x`; hours[h] = (hours[h] ?? 0) + 1; }
console.log(Object.entries(hours).sort().map(([k, v]) => `${k}  ${v} file-keys`).join("\n"));
const imps = db.prepare(`select id, imported_at t from imports where json_extract(header,'$.commit') = ?`).all(commit);
console.log(imps.map((i) => `import ${i.id} at ${new Date(i.t).toISOString()}`).join("\n"));
