// Throwaway probe for gh-20 (research/issue-20-reproduction.md). Read only:
// opens each store with node:sqlite readOnly and never writes.
// Usage: node store-scan.mjs <store.sqlite>...
import { DatabaseSync } from "node:sqlite";

for (const file of process.argv.slice(2)) {
  const db = new DatabaseSync(file, { readOnly: true });
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const span = one("SELECT min(started_at) lo, max(started_at) hi, count(*) n FROM runs");
  const results = one("SELECT count(*) n, sum(outcome='fail') f FROM results");
  const texts = one("SELECT count(*) n FROM failure_texts");
  const tmpTexts = all(
    "SELECT id, summary FROM failure_texts WHERE summary LIKE '%/tmp/squeal-%' OR errors LIKE '%/tmp/squeal-%'",
  );
  console.log(`\n== ${file}`);
  console.log(
    `runs ${span.n} (${new Date(span.lo).toISOString()} .. ${new Date(span.hi).toISOString()}); ` +
      `results rows ${results.n}, fail ${results.f}; failure texts ${texts.n}; naming /tmp/squeal- ${tmpTexts.length}`,
  );
  const fsCodes = /\b(ENOTEMPTY|EBUSY|EEXIST|ENOENT|EACCES|EPERM|EMFILE|ENOSPC)\b/;
  for (const t of tmpTexts) {
    const rows = all(
      `SELECT c.kind, c.project, c.test_path, r.outcome, r.run_id, r.recorded_at, r.worktree_id
         FROM results r JOIN checks c ON c.id = r.check_id WHERE r.failure_id = ?`,
      t.id,
    );
    const code = (t.summary ?? "").match(fsCodes)?.[1] ?? "-";
    console.log(`- [${code}] ${(t.summary ?? "").slice(0, 220)}`);
    for (const r of rows) {
      console.log(
        `    ${r.kind} ${r.test_path} ${r.outcome} run ${r.run_id.slice(0, 8)} at ${new Date(r.recorded_at).toISOString()} wt ${r.worktree_id.slice(0, 8)}`,
      );
    }
  }
  // Transitions keep fingerprints after a later pass replaced the result row;
  // a fingerprint spells a temp path as <tmp> (fingerprint.ts VOLATILE).
  const tr = one("SELECT count(*) n, min(at) lo FROM transitions");
  const tmpTr = all(
    `SELECT t.kind, t.to_fingerprint fp, t.at, c.kind ck, c.test_path FROM transitions t
       JOIN checks c ON c.id = t.check_id
      WHERE t.to_fingerprint LIKE '%<tmp>%' OR t.to_fingerprint LIKE '%/tmp/squeal-%'
         OR t.to_fingerprint LIKE '%ENOTEMPTY%' OR t.to_fingerprint LIKE '%EBUSY%' OR t.to_fingerprint LIKE '%EEXIST%'
      ORDER BY t.at`,
  );
  console.log(
    `transitions ${tr.n} (since ${tr.lo === null ? "-" : new Date(tr.lo).toISOString()}); ` +
      `naming a temp path or ENOTEMPTY/EBUSY/EEXIST: ${tmpTr.length}`,
  );
  for (const t of tmpTr) {
    const code = t.fp.match(fsCodes)?.[1] ?? "-";
    console.log(`  ${new Date(t.at).toISOString()} [${code}] ${t.ck} ${t.test_path} ${t.kind}: ${t.fp.slice(0, 160)}`);
  }
  db.close();
}
