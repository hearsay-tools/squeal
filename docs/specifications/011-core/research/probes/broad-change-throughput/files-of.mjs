// files-of.mjs <store.sqlite> <from ms> <out prefix>: the distinct test files
// the daemon's runs since <from> held, split for a plain re-run:
// <prefix>.vitest.txt ("project path" lines) and <prefix>.node-test.txt
// ("project path" lines), plus their last stored durations in
// <prefix>.durations.tsv (from report.json fileDurations, node:test runs' wall).
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [store, from, prefix] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const runs = db.prepare("select * from runs where started_at >= ? order by started_at").all(Number(from));
const vitest = new Set(), nodeTest = new Set();
for (const r of runs) {
  const isNode = existsSync(join(r.log_dir, "node-test"));
  for (const f of JSON.parse(r.test_files)) (isNode ? nodeTest : vitest).add(`${f.project} ${f.path}`);
}
writeFileSync(`${prefix}.vitest.txt`, [...vitest].sort().join("\n") + "\n");
writeFileSync(`${prefix}.node-test.txt`, [...nodeTest].sort().join("\n") + "\n");
console.log(JSON.stringify({ runs: runs.length, vitest: vitest.size, nodeTest: nodeTest.size }));
