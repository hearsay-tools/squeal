// Throwaway probe (016-27), section 6 (goal 5): per node:test or pytest project of a store, the files and
// paths in the core's observed key (`observed.<project>`) and in each legacy pre-0.1.313 ObservedStore key
// (`nodeTest.observed.*`, `pytest.observed*`), and how many legacy paths the file's stored closure
// (`test_files.closure_paths`) already holds. Read-only. Usage: node-test-observed.mjs <store>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const closure = new Map(db.prepare("select project, path, closure_paths from test_files").all().map((r) => [`${r.project}\0${r.path}`, new Set(JSON.parse(r.closure_paths))]));
for (const { key, value } of db.prepare("select key, value from meta where key like 'nodeTest.%' or key like 'pytest.%' or key like 'observed.%test%' or key like 'observedStartup.%'").all()) {
  const project = key.replace(/^(nodeTest\.observed(Preloads)?|pytest\.observed(Session)?|observed|observedStartup)\./, "");
  const v = JSON.parse(value);
  if (Array.isArray(v)) { console.log(JSON.stringify({ key, list: v.length })); continue; }
  let paths = 0, inClosure = 0, files = 0, listed = 0;
  for (const [test, ps] of Object.entries(v)) {
    files++;
    const c = closure.get(`${project}\0${test}`);
    if (c) listed++;
    for (const p of ps) { paths++; if (c?.has(p)) inClosure++; }
  }
  console.log(JSON.stringify({ key, files, filesWithClosure: listed, paths, inClosure }));
}
