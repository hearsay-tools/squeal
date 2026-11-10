// Throwaway probe (survey 020-07, Q5). Read-only (node:sqlite { readOnly: true }).
// Usage: node reuse.mjs <common-dir> <worktree-id>...
// For each worktree, its test files at the key its daemon last wrote
// (`test_file_keys`), and how many have, at that key: any result, a failed
// or skipped result, and a coverage record at COVERAGE_RECORD_VERSION 4.
// That is the most `--base` could reuse if it computed the same keys.
import { DatabaseSync } from "node:sqlite";

const [commonDir, ...worktrees] = process.argv.slice(2);
const main = new DatabaseSync(`${commonDir}/squeal/store.sqlite`, { readOnly: true });
const code = new DatabaseSync(`${commonDir}/squeal/code.sqlite`, { readOnly: true });
const RECORD_VERSION = 4;
const outcomes = main.prepare(
  "select outcome, count(*) n from results where key = ? group by outcome",
);
const record = code.prepare(
  "select length(record) bytes from coverage where result_key = ? and provider_version = ?",
);
const out = [];
for (const w of worktrees) {
  const rows = main
    .prepare("select project, path, key, pending from test_file_keys where worktree_id = ?")
    .all(w);
  const row = {
    worktree: w,
    testFiles: rows.length,
    unkeyed: 0,
    pending: 0,
    withResult: 0,
    withFail: 0,
    withSkip: 0,
    withRecord: 0,
    resultAndRecord: 0,
    recordBytes: 0,
  };
  for (const r of rows) {
    if (r.key === null) {
      row.unkeyed++;
      continue;
    }
    if (r.pending !== null) row.pending++;
    const o = Object.fromEntries(outcomes.all(r.key).map((x) => [x.outcome, x.n]));
    const has = Object.keys(o).length > 0;
    if (has) row.withResult++;
    if (o.fail) row.withFail++;
    if (o.skip) row.withSkip++;
    const rec = record.get(r.key, RECORD_VERSION);
    if (rec) {
      row.withRecord++;
      row.recordBytes += rec.bytes;
    }
    if (has && rec) row.resultAndRecord++;
  }
  out.push(row);
}
console.log(JSON.stringify(out, null, 2));
