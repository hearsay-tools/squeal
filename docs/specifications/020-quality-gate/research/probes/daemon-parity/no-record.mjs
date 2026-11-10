// Throwaway probe (survey 020-07, Q5). Read-only. Usage: node no-record.mjs <common-dir> <worktree-id>
// Splits one worktree's keyed test files without a coverage record (version 4) by project,
// and by how their results came (run id prefix: a daemon run, an import, a CI export).
import { DatabaseSync } from "node:sqlite";
const [commonDir, w] = process.argv.slice(2);
const main = new DatabaseSync(`${commonDir}/squeal/store.sqlite`, { readOnly: true });
const code = new DatabaseSync(`${commonDir}/squeal/code.sqlite`, { readOnly: true });
const rec = code.prepare("select 1 from coverage where result_key = ? and provider_version = 4");
const runs = main.prepare("select run_id from results where key = ? limit 1");
const by = {};
for (const r of main.prepare("select project, path, key from test_file_keys where worktree_id = ? and key is not null").all(w)) {
  const has = rec.get(r.key) !== undefined;
  const run = String(runs.get(r.key)?.run_id ?? "none").replace(/[0-9a-f-]{8,}.*/, "*");
  const k = `${r.project} | ${has ? "record" : "no record"} | run ${run}`;
  by[k] = (by[k] ?? 0) + 1;
}
console.log(JSON.stringify(by, null, 2));
