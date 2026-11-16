// Throwaway (glob-membership): copies the closure lists and current keys of a
// live Squeal store, opened read-only, into a scratch SQLite file. Never
// writes the live store. Usage: node copy.mjs <live store> <scratch file>
import { DatabaseSync } from "node:sqlite";
const [src, dst] = process.argv.slice(2);
const live = new DatabaseSync(src, { readOnly: true });
live.exec("PRAGMA query_only = 1");
const out = new DatabaseSync(dst);
const tables = {
  test_files: "select project, path, closure_paths, complete, updated_at from test_files",
  test_file_keys: "select worktree_id, project, path, key from test_file_keys",
  worktrees: "select id, root, is_main from worktrees",
};
for (const [name, sql] of Object.entries(tables)) {
  const rows = live.prepare(sql).all();
  const cols = Object.keys(rows[0] ?? { none: 1 });
  out.exec(`DROP TABLE IF EXISTS ${name}; CREATE TABLE ${name} (${cols.join(", ")})`);
  const ins = out.prepare(`INSERT INTO ${name} VALUES (${cols.map(() => "?").join(", ")})`);
  out.exec("BEGIN");
  for (const r of rows) ins.run(...cols.map((c) => r[c]));
  out.exec("COMMIT");
  console.log(name, rows.length);
}
