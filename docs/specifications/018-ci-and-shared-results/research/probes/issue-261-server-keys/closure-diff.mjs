// Throwaway (row 018-72): for exported files, the export's closure list against the store's
// test_files closure list (squawk store, read-only). Usage: node closure-diff.mjs <export.json> <path-regex> [project]
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, re, project = "server"] = process.argv.slice(2);
const e = JSON.parse(readFileSync(file, "utf8"));
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const q = db.prepare("select closure_paths c, complete, method, updated_by from test_files where project = ? and path = ?");
for (const f of e.testFiles.filter((f) => f.project === project && new RegExp(re).test(f.path))) {
  const row = q.get(f.project, f.path);
  const local = new Set(row ? JSON.parse(row.c) : []);
  const exp = new Set(f.closure.paths);
  const onlyExp = [...exp].filter((p) => !local.has(p));
  const onlyLocal = [...local].filter((p) => !exp.has(p));
  const { closure, observed, observedDirect, observedModules, ...rest } = f;
  console.log(JSON.stringify({ path: f.path, exported: exp.size, local: local.size, onlyExp, onlyLocal, localMethod: row?.method, rest: { ...rest, closure: { ...closure, paths: undefined } }, observed: observed?.length, observedDirect: observedDirect?.length, observedModules: observedModules?.length }));
}
