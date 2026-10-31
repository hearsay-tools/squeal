// Throwaway (topic result-import): read a COPIED store read-only, print keys, closures, results.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const all = (sql) => db.prepare(sql).all();
const out = {
  keys: all("SELECT project, path, key, revision FROM test_file_keys ORDER BY path"),
  closures: all("SELECT project, path, closure_paths FROM test_files ORDER BY path"),
  results: all(
    "SELECT c.test_path, c.full_name, r.key, r.outcome, r.commit_sha, r.worktree_id FROM results r JOIN checks c ON c.id = r.check_id ORDER BY c.test_path, c.full_name",
  ),
  meta: all("SELECT key, substr(value, 1, 4000) AS value FROM meta ORDER BY key"),
};
console.log(JSON.stringify(out, null, 1));
