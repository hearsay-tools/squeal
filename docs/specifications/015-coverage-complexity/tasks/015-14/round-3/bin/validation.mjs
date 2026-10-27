// 015-14 Round 3, D10: what each A/B arm's daemon ran and found per revision
// (revision N is edit E(N-1); 0 is the start), from the arm's own store, read
// only, after the arm stopped. So two arms' CPU is compared only beside the
// work behind it: runs and their end states, test file slots (a test file run
// twice counts twice), distinct test files, results by check kind and outcome,
// and the failing checks with a digest of their names, which is equal when
// both arms failed the same checks.
// Usage: node validation.mjs <arm root>...
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const out = {};
for (const root of process.argv.slice(2)) {
  const db = new DatabaseSync(`${root}/.git/squeal/store.sqlite`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  const revisions = {};
  for (const run of db.prepare("SELECT revision, test_files, end_state FROM runs").all()) {
    const r = (revisions[run.revision] ??= { runs: 0, ends: {}, slots: 0, files: new Set(), results: {}, failing: [] });
    const files = JSON.parse(run.test_files);
    r.runs++;
    r.ends[run.end_state ?? "open"] = (r.ends[run.end_state ?? "open"] ?? 0) + 1;
    r.slots += files.length;
    for (const f of files) r.files.add(typeof f === "string" ? f : JSON.stringify(f));
  }
  const rows = db.prepare(`SELECT r.revision, c.kind, r.outcome, c.test_path, c.full_name
    FROM results r JOIN checks c ON c.id = r.check_id`).all();
  for (const row of rows) {
    const r = (revisions[row.revision] ??= { runs: 0, ends: {}, slots: 0, files: new Set(), results: {}, failing: [] });
    const k = `${row.kind} ${row.outcome}`;
    r.results[k] = (r.results[k] ?? 0) + 1;
    if (row.outcome === "fail") r.failing.push(`${row.test_path} > ${row.full_name}`);
  }
  out[root.split("/").at(-1)] = Object.fromEntries(
    Object.entries(revisions).map(([rev, r]) => {
      const failing = r.failing.sort();
      return [rev, { runs: r.runs, ends: r.ends, slots: r.slots, files: r.files.size, results: r.results,
        failing: failing.length, failingDigest: createHash("sha256").update(failing.join("\n")).digest("hex").slice(0, 12),
        failingFirst: failing.slice(0, 8) }];
    }),
  );
  db.close();
}
console.log(JSON.stringify(out, null, 1));
