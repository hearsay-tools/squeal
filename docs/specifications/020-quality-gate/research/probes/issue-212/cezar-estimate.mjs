// Throwaway probe (row 020-56, #212). Reads cezar's Squeal main store read-only
// (`?immutable=1`: no lock, no -shm write; the WAL's newest rows are not seen)
// and gives what D17.1's estimate says for a change that selects every test
// file of one Vitest project (a `setupFiles` edit): each file's stored seconds
// as `storedDurations` reads them (`NEWEST_OF_FILE`, then `durationOf`), the
// estimate at a width (D17.1: max(longest, sum / width)), and when the stored
// rows were recorded. Writes nothing; prints JSON.
// Only files that exist under <checkout> count (the store keeps deleted ones).
// Usage: node cezar-estimate.mjs <store.sqlite> <checkout> <project> <width> [<path prefix>]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [storePath, checkout, project, widthArg, prefix = ""] = process.argv.slice(2);
const width = Number(widthArg);
const db = new DatabaseSync(`file:${storePath}?immutable=1`, { readOnly: true });
const files = db
  .prepare("select path from test_files where project = ? and path like ? order by path")
  .all(project, `${prefix}%`)
  .map((r) => r.path)
  .filter((path) => existsSync(join(checkout, path)));
// src/core/store/repos/results.ts NEWEST_OF_FILE, reduced to what durationOf reads.
const newest = db.prepare(`
  SELECT c.kind, r.duration_ms, r.recorded_at FROM checks c JOIN results r ON r.check_id = c.id
  WHERE c.project = ? AND c.test_path = ? AND r.key = (
    SELECT r2.key FROM checks c2 JOIN results r2 ON r2.check_id = c2.id
    WHERE c2.project = ? AND c2.test_path = ?
    ORDER BY r2.recorded_at DESC, r2.rowid DESC LIMIT 1)`);
const seconds = [];
const recorded = [];
for (const path of files) {
  const rows = newest.all(project, path, project, path);
  if (rows.length === 0) { seconds.push(null); continue; }
  // src/core/scheduler/files.ts durationOf: max(file row, sum of test rows).
  let fileMs = 0, testsMs = 0, at = 0;
  for (const r of rows) {
    if (r.kind === "file") fileMs = Math.max(fileMs, r.duration_ms);
    else testsMs += r.duration_ms;
    at = Math.max(at, Number(r.recorded_at));
  }
  seconds.push(Math.max(fileMs, testsMs) / 1000);
  recorded.push(at);
}
const known = seconds.filter((s) => s !== null).sort((a, b) => a - b);
const q = (p) => known[Math.min(known.length - 1, Math.floor(p * known.length))];
const median = known.length === 0 ? null : q(0.5);
const each = seconds.map((s) => s ?? median);
const sum = each.reduce((a, b) => a + b, 0);
const longest = Math.max(...each);
const estimate = (w) => Math.ceil(Math.max(longest, sum / w));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const byDay = {};
for (const at of recorded) byDay[day(at)] = (byDay[day(at)] ?? 0) + 1;
console.log(JSON.stringify({
  project, prefix, width, files: files.length, known: known.length,
  seconds: { sum: Math.round(sum), longest, p50: median, p90: q(0.9), p99: q(0.99) },
  estimate: estimate(width),
  estimateAt: Object.fromEntries([5, 11, 16, 23].map((w) => [w, estimate(w)])),
  recordedByDay: byDay,
}, null, 1));
