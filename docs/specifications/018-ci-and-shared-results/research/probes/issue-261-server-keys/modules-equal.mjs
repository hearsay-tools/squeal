// Throwaway (row 018-72): would stored list + observed + observedModules (all local) equal the
// export's closure list? Squawk store read-only. Usage: node modules-equal.mjs <export.json> <path-regex>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, re] = process.argv.slice(2);
const e = JSON.parse(readFileSync(file, "utf8"));
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const meta = (k) => JSON.parse(db.prepare("select value from meta where key = ?").get(k)?.value ?? "{}");
const obs = meta("observed.server"), mods = meta("observedModules.server");
let equal = 0, n = 0;
for (const f of e.testFiles.filter((f) => f.project === "server" && new RegExp(re).test(f.path))) {
  n++;
  const stored = JSON.parse(db.prepare("select closure_paths c from test_files where project='server' and path=?").get(f.path).c);
  const here = new Set([...stored, ...(obs[f.path] ?? []), ...(mods[f.path] ?? [])]);
  const exp = new Set(f.closure.paths);
  const onlyHere = [...here].filter((p) => !exp.has(p)), onlyExp = [...exp].filter((p) => !here.has(p));
  if (!onlyHere.length && !onlyExp.length) equal++;
  else console.log(JSON.stringify({ path: f.path, onlyHere, onlyExp }));
}
console.log(JSON.stringify({ files: n, equalSets: equal }));
