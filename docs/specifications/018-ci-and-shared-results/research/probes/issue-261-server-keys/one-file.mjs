// Throwaway (row 018-72): one test file's stored closure list and shared observed entries
// in squawk's store (read-only). Usage: node one-file.mjs <project> <path>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const [project, path] = process.argv.slice(2);
const r = db.prepare("select closure_paths c, method, updated_at t, updated_by u from test_files where project=? and path=?").get(project, path);
console.log(JSON.stringify({ stored: JSON.parse(r.c), at: new Date(r.t).toISOString(), by: r.u }));
for (const m of ["observed", "observedDirect", "observedModules"]) {
  const row = db.prepare("select value from meta where key=?").get(`${m}.${project}`);
  console.log(m, JSON.stringify(row ? JSON.parse(row.value)[path] : null));
}
