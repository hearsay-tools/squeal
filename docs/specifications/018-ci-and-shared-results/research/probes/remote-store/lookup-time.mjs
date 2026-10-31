// Throwaway probe (018-03). Times a baseline-sized lookup on a COPIED store.
// Usage: node lookup-time.mjs <copy/store.sqlite> [repeats]
// Keys: the test_file_keys of the worktree row with the most keys (one
// worktree's baseline). Query: ResultRepo.byKey's SELECT (results.ts), once
// read-only (usedAt 0) and once with its last_used_at UPDATE, then one
// batched query over all keys. Also prints the JSON size of the rows, as an
// upper bound of what a remote reply would carry.
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
const db = new DatabaseSync(process.argv[2]);
const repeats = Number(process.argv[3] ?? 3);
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
const wt = db.prepare(`SELECT worktree_id, COUNT(*) n FROM test_file_keys WHERE key IS NOT NULL
  GROUP BY worktree_id ORDER BY n DESC LIMIT 1`).get();
const keys = db.prepare("SELECT key FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL")
  .all(wt.worktree_id).map((r) => r.key);
const SELECT = `SELECT r.*, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name, f.summary, f.errors
  FROM results r JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
const byKey = db.prepare(`${SELECT} WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`);
const touch = db.prepare("UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?");
const out = { worktree: wt.worktree_id, keys: keys.length, runs: [] };
let rows = 0, bytes = 0, hits = 0, slim = 0;
for (let i = 0; i < repeats; i++) {
  let t = performance.now();
  rows = 0; bytes = 0; hits = 0; slim = 0;
  for (const k of keys) {
    const r = byKey.all(k);
    rows += r.length; if (r.length) hits++;
    bytes += Buffer.byteLength(JSON.stringify(r));
    // What a remote needs to carry: check identity, outcome, duration, failure text id.
    slim += Buffer.byteLength(JSON.stringify(r.map((x) => [x.check_kind, x.check_full_name, x.outcome, x.duration_ms, x.failure_id])));
  }
  const perKeyRead = performance.now() - t;
  t = performance.now();
  db.exec("BEGIN");
  const now = Date.now();
  for (const k of keys) { touch.run(now, k, now); byKey.all(k); }
  db.exec("COMMIT");
  const perKeyTouch = performance.now() - t;
  t = performance.now();
  db.exec("CREATE TEMP TABLE IF NOT EXISTS want (key TEXT PRIMARY KEY); DELETE FROM want");
  const ins = db.prepare("INSERT OR IGNORE INTO want VALUES (?)");
  for (const k of keys) ins.run(k);
  const batch = db.prepare(`${SELECT} WHERE r.key IN (SELECT key FROM want)`).all();
  const batched = performance.now() - t;
  out.runs.push({ perKeyReadMs: +perKeyRead.toFixed(1), perKeyWithTouchMs: +perKeyTouch.toFixed(1), batchedMs: +batched.toFixed(1), batchRows: batch.length });
}
Object.assign(out, { hitKeys: hits, rows, jsonBytes: bytes, slimJsonBytes: slim });
console.log(JSON.stringify(out, null, 1));
