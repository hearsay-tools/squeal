// 011-160 probe (throwaway): what the 7-day rule for removed worktrees would add to a store copy over a window.
// Usage: node growth.mjs <store copy> <runs snapshot> <copy ms> <hours>
// Reads only the copy. Per-unit costs from dbstat; work per run from each run's report.json in the snapshot.
import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"; import { join, basename } from "node:path";
const [, , storePath, logs, copyMs, hours] = process.argv;
const T = Number(copyMs), from = T - Number(hours) * 3600e3;
const db = new DatabaseSync(storePath, { readOnly: true });
const one = (s, ...a) => db.prepare(s).get(...a);
const all = (s, ...a) => db.prepare(s).all(...a);
const bytes = Object.fromEntries(all("SELECT name, sum(pgsize) b FROM dbstat GROUP BY name").map((r) => [r.name, r.b]));
const resIdx = all("SELECT name FROM sqlite_master WHERE tbl_name = 'results'").map((r) => r.name);
const resBytes = resIdx.reduce((a, n) => a + (bytes[n] ?? 0), 0);
const nRes = one("SELECT count(*) n FROM results").n, nFail = one("SELECT count(*) n FROM failure_texts").n;
const nWithFail = one("SELECT count(*) n FROM results WHERE failure_id IS NOT NULL").n;
const runIdx = all("SELECT name FROM sqlite_master WHERE tbl_name = 'runs'").map((r) => r.name);
const runBytes = runIdx.reduce((a, n) => a + (bytes[n] ?? 0), 0), nRuns = one("SELECT count(*) n FROM runs").n;
const total = Object.values(bytes).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ storeBytes: total, results: nRes, bytesPerResult: +(resBytes / nRes).toFixed(1), resultsBytes: resBytes,
  failureTexts: nFail, bytesPerFailureText: +((bytes.failure_texts ?? 0) / Math.max(1, nFail)).toFixed(0), shareWithFailure: +(nWithFail / nRes).toFixed(4),
  runs: nRuns, bytesPerRun: +(runBytes / nRuns).toFixed(0) }));
const live = new Set(all("SELECT id FROM worktrees").map((r) => r.id));
const storedBy = new Map(all("SELECT run_id, count(*) n FROM results GROUP BY run_id").map((r) => [r.run_id, r.n]));
const dirBytes = (d) => { let s = 0; for (const f of readdirSync(d)) s += statSync(join(d, f)).size; return s; };
const acc = { live: {}, removed: {} };
for (const run of all("SELECT id, worktree_id, log_dir, started_at, test_files FROM runs WHERE started_at >= ?", from)) {
  const a = (acc[live.has(run.worktree_id) ? "live" : "removed"] ??= {});
  const dir = join(logs, basename(run.log_dir)); const p = join(dir, "report.json");
  a.runs = (a.runs ?? 0) + 1; a.stored = (a.stored ?? 0) + (storedBy.get(run.id) ?? 0);
  a.files = (a.files ?? 0) + JSON.parse(run.test_files).length;
  if (!existsSync(dir)) { a.noLog = (a.noLog ?? 0) + 1; continue; }
  a.logBytes = (a.logBytes ?? 0) + dirBytes(dir);
  if (!existsSync(p)) { a.noReport = (a.noReport ?? 0) + 1; continue; }
  let rep; try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch { a.badReport = (a.badReport ?? 0) + 1; continue; }
  a.reported = (a.reported ?? 0) + (rep?.results?.length ?? 0);
  a.reportedOfRunsWithReport = (a.reportedOfRunsWithReport ?? 0) + (rep?.results?.length ?? 0);
  a.storedOfRunsWithReport = (a.storedOfRunsWithReport ?? 0) + (storedBy.get(run.id) ?? 0);
}
for (const k of ["live", "removed"]) { const a = acc[k]; a.storedShare = +(a.storedOfRunsWithReport / Math.max(1, a.reportedOfRunsWithReport)).toFixed(3); a.logBytesPerRun = Math.round(a.logBytes / Math.max(1, a.runs - (a.noLog ?? 0))); }
// Removed worktrees: rows the prune deleted from runs that survive, at the stored share live runs keep (replacements and withheld results aside).
const r = acc.removed, l = acc.live;
const deleted = Math.max(0, Math.round(r.reportedOfRunsWithReport * l.storedShare - r.storedOfRunsWithReport));
console.log(JSON.stringify({ window: { from: new Date(from).toISOString(), to: new Date(T).toISOString() }, ...acc,
  removedRowsDeletedSeen: deleted, removedRowsDeletedSeenBytes: Math.round(deleted * (resBytes / nRes)) }));
console.log(JSON.stringify({ removedResultsInStore: one("SELECT count(*) n FROM results WHERE worktree_id NOT IN (SELECT id FROM worktrees)").n,
  removedResultsRecordedInWindow: one("SELECT count(*) n FROM results WHERE worktree_id NOT IN (SELECT id FROM worktrees) AND recorded_at >= ?", from).n }));
