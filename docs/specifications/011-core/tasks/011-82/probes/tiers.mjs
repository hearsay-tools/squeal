// 011-82 probe: where a tier's picked files go. Read-only over one store.
// Usage: node tiers.mjs <store.sqlite> <runs-dir> <hours> [out.json]
// Per run: files picked, ended (the report's completed plus withheld),
// stored (distinct test files with a result row still naming the run),
// withheld by the adapter, never ended, and for each file not stored
// whether a revision during the run changed a path of its closure or its
// observed set (today's closures: approximate).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [, , storePath, runsDir, hours = "24", out] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const now = Date.now();
const since = now - Number(hours) * 3600_000;

const ENV = /(^|\/)(package\.json|package-lock\.json|\.package-lock\.json|vitest\.config\.[cm]?[jt]s|squeal\.config\.json|tsconfig[^/]*\.json)$/;
const id = (r) => `${r.project}\u0000${r.path}`;

const closures = new Map();
for (const r of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) {
  closures.set(id(r), new Set(JSON.parse(r.closure_paths)));
}
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) {
  const project = m.key.slice("observed.".length);
  for (const [path, reads] of Object.entries(JSON.parse(m.value))) {
    const set = closures.get(id({ project, path })) ?? new Set();
    for (const p of reads) set.add(p);
    closures.set(id({ project, path }), set);
  }
}

const runs = db
  .prepare(
    `SELECT id, worktree_id, revision, test_files, checkpoint_id, started_at, ended_at, end_state
     FROM runs WHERE started_at >= ? AND ended_at IS NOT NULL ORDER BY started_at`,
  )
  .all(since);
const storedOf = db.prepare(
  `SELECT DISTINCT c.project, c.test_path AS path FROM results r JOIN checks c ON c.id = r.check_id
   WHERE r.run_id = ?`,
);
const revsOf = db.prepare(
  `SELECT number, created_at, changes FROM revisions
   WHERE worktree_id = ? AND created_at > ? AND created_at <= ? ORDER BY number`,
);

const rows = [];
for (const run of runs) {
  const files = JSON.parse(run.test_files);
  const reportPath = join(runsDir, run.id, "report.json");
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8")).report;
    } catch {}
  }
  const completed = new Set((report?.completedFiles ?? []).map(id));
  const withheld = new Set((report?.withheld ?? []).map(id));
  const stored = new Set(storedOf.all(run.id).map(id));
  const revs = revsOf.all(run.worktree_id, run.started_at, run.ended_at);
  const changed = new Set();
  for (const rev of revs) {
    for (const c of JSON.parse(rev.changes)) changed.add(typeof c === "string" ? c : c.path);
  }
  const envChanged = [...changed].some((p) => ENV.test(p));
  const rekeyed = (f) =>
    envChanged || [...(closures.get(id(f)) ?? [])].some((p) => changed.has(p) || changed.has(p.replace(/\/$/, "")));
  const failure = report?.failure ?? "";
  const cancelled = /run cancelled/.test(failure);
  const counts = {
    storedEnded: 0,
    withheld: 0,
    endedNotStored: 0,
    notEnded: 0,
    lostRekeyed: 0,
    lostKeptKey: 0,
  };
  for (const f of files) {
    const k = id(f);
    let lost = true;
    if (stored.has(k)) {
      counts.storedEnded++;
      lost = false;
    } else if (withheld.has(k)) counts.withheld++;
    else if (completed.has(k)) counts.endedNotStored++;
    else counts.notEnded++;
    if (lost) counts[rekeyed(f) ? "lostRekeyed" : "lostKeptKey"]++;
  }
  rows.push({
    id: run.id.slice(0, 8),
    worktree: run.worktree_id.slice(0, 8),
    revision: run.revision,
    at: new Date(run.started_at).toISOString().slice(0, 19),
    wallS: Math.round((run.ended_at - run.started_at) / 100) / 10,
    files: files.length,
    checkpoint: run.checkpoint_id !== null,
    end: run.end_state,
    report: report !== null,
    cancelled,
    cause: cancelled ? failure.split("\n")[0].replace(/^run cancelled:? ?/, "") || "(none named)" : null,
    adapterDrop: /no check key names/.test(failure) ? failure.split("\n").find((l) => /no check key names/.test(l)).slice(0, 240) : null,
    revisionsDuring: revs.length,
    changedDuring: [...changed].slice(0, 8),
    envChanged,
    ...counts,
  });
}

function sum(list) {
  const t = { runs: list.length, files: 0, storedEnded: 0, withheld: 0, endedNotStored: 0, notEnded: 0, lostRekeyed: 0, lostKeptKey: 0, wallS: 0, wallNoneStoredS: 0, runsNoneStored: 0 };
  for (const r of list) {
    for (const k of ["files", "storedEnded", "withheld", "endedNotStored", "notEnded", "lostRekeyed", "lostKeptKey", "wallS"]) t[k] += r[k];
    if (r.storedEnded === 0) {
      t.runsNoneStored++;
      t.wallNoneStoredS += r.wallS;
    }
  }
  t.wallS = Math.round(t.wallS);
  t.wallNoneStoredS = Math.round(t.wallNoneStoredS);
  t.storedShare = t.files === 0 ? null : Math.round((1000 * t.storedEnded) / t.files) / 10;
  return t;
}

const large = (r) => r.files >= 13;
const summary = {
  store: storePath,
  hours: Number(hours),
  at: new Date(now).toISOString(),
  runs: rows.length,
  withReport: rows.filter((r) => r.report).length,
  all: sum(rows),
  large: sum(rows.filter(large)),
  small: sum(rows.filter((r) => !large(r))),
  largeCancelled: sum(rows.filter((r) => large(r) && r.cancelled)),
  largeNotCancelled: sum(rows.filter((r) => large(r) && !r.cancelled)),
  largeAdapterDrop: sum(rows.filter((r) => large(r) && r.adapterDrop !== null)),
  causes: Object.entries(
    rows.filter((r) => r.cancelled).reduce((m, r) => ((m[r.cause] = (m[r.cause] ?? 0) + 1), m), {}),
  ),
};
console.log(JSON.stringify(summary, null, 1));
if (out) writeFileSync(out, `${JSON.stringify({ summary, rows }, null, 1)}\n`);
