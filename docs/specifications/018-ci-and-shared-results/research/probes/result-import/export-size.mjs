// Throwaway (topic result-import): size an export of one worktree's current keys from a COPIED store.
// node export-size.mjs <store copy> <worktree id>
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
const [path, worktree] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
const keys = db
  .prepare("SELECT project, path, key, revision FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL")
  .all(worktree);
const keySet = new Set(keys.map((k) => k.key));
db.exec("CREATE TEMP TABLE want (key TEXT PRIMARY KEY)");
const ins = db.prepare("INSERT OR IGNORE INTO want VALUES (?)");
for (const k of keySet) ins.run(k);
const results = db
  .prepare(
    `SELECT r.check_id, r.key, r.outcome, r.duration_ms, r.location_path, r.location_line, r.location_column,
            r.fingerprint, r.failure_id, r.commit_sha, r.recorded_at
     FROM results r JOIN temp.want w ON w.key = r.key`,
  )
  .all();
const checkIds = new Set(results.map((r) => r.check_id));
const checks = db.prepare("SELECT * FROM checks").all().filter((c) => checkIds.has(c.id));
const failureIds = new Set(results.map((r) => r.failure_id).filter(Boolean));
const failures = db.prepare("SELECT * FROM failure_texts").all().filter((f) => failureIds.has(f.id));
const files = new Set(keys.map((k) => `${k.project}\0${k.path}`));
const closures = db
  .prepare("SELECT project, path, closure_paths FROM test_files")
  .all()
  .filter((t) => files.has(`${t.project}\0${t.path}`));
const observed = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed%'").all();
const outcomes = {};
for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
const commits = {};
for (const r of results) commits[r.commit_sha ?? "null"] = (commits[r.commit_sha ?? "null"] ?? 0) + 1;
const keysWithResult = new Set(results.map((r) => r.key));
const part = (name, value) => {
  const json = Buffer.from(JSON.stringify(value));
  return { name, rows: Array.isArray(value) ? value.length : undefined, json: json.length, gzip: gzipSync(json).length };
};
const parts = [
  part("keys", keys),
  part("results", results),
  part("checks", checks),
  part("failure_texts", failures),
  part("closures", closures),
  part("observed meta", observed),
];
const all = part("all", { keys, results, checks, failures, closures, observed });
console.log(JSON.stringify({ testFiles: keys.length, distinctKeys: keySet.size, keysWithResult: keysWithResult.size, outcomes, commits: Object.entries(commits).sort((a, b) => b[1] - a[1]).slice(0, 5), parts, all }, null, 1));
