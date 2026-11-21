// Throwaway (row 018-72): the local shared observed entries of server files matching a regex
// (squawk store, read-only). Usage: node local-observed.mjs <path-regex>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const re = new RegExp(process.argv[2]);
for (const map of ["observed", "observedDirect", "observedModules"]) {
  const v = JSON.parse(db.prepare("select value from meta where key = ?").get(`${map}.server`).value);
  const entries = Array.isArray(v) ? v : Object.entries(v);
  for (const [path, paths] of entries) if (re.test(path)) console.log(map, path, Array.isArray(paths) ? paths.length : JSON.stringify(paths).slice(0, 200));
}
