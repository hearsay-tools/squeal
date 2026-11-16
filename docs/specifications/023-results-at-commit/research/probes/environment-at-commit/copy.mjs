// Throwaway (environment-at-commit): copies the small tables this topic reads
// from a live Squeal store, opened read-only, into a scratch SQLite file.
// Never writes the live store. Usage: node copy.mjs <live store> <scratch file>
import { DatabaseSync } from "node:sqlite";
const [src, dst] = process.argv.slice(2);
const live = new DatabaseSync(src, { readOnly: true });
live.exec("PRAGMA query_only = 1");
const out = new DatabaseSync(dst);
const tables = {
  worktrees: "select id, root, is_main, registered_at from worktrees",
  revisions: "select worktree_id, number, created_at, head, dirty, trigger from revisions",
  environments: "select hash, descriptor, recorded_at from environments",
  worktree_environment_hashes: "select * from worktree_environment_hashes",
  test_file_keys: "select worktree_id, project, path, key from test_file_keys",
  imports: "select id, header, imported_at from imports",
  import_env: "select import_id, project, environment, count(*) as files from import_files group by 1, 2, 3",
  // Clean commit labels: a daemon (or an import) had that commit clean when it wrote the row.
  clean_labels: "select commit_sha, worktree_id, min(recorded_at) as first_at, count(*) as n from results where dirty = 0 and commit_sha is not null group by 1, 2",
};
for (const [name, sql] of Object.entries(tables)) {
  let rows;
  try { rows = live.prepare(sql).all(); } catch (e) { console.log(name, "skipped:", e.message); continue; }
  if (rows.length === 0) { console.log(name, 0); continue; }
  const cols = Object.keys(rows[0]);
  out.exec(`DROP TABLE IF EXISTS ${name}; CREATE TABLE ${name} (${cols.join(", ")})`);
  const ins = out.prepare(`INSERT INTO ${name} VALUES (${cols.map(() => "?").join(", ")})`);
  out.exec("BEGIN");
  for (const r of rows) ins.run(...cols.map((c) => r[c]));
  out.exec("COMMIT");
  console.log(name, rows.length);
}
