// analyze.mjs <store.sqlite> <from ms> [to ms]: the runs a daemon started in a
// window, read from its store and each run's report.json. Prints JSON: each
// run (start, end, files, files with a duration, summed file ms, end state),
// the wall time any run was open, mean runs open, the gaps with no run open,
// and when each test file first finished. Read-only.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [store, fromArg, toArg] = process.argv.slice(2);
const from = Number(fromArg);
const to = toArg ? Number(toArg) : Date.now();
const db = new DatabaseSync(store, { readOnly: true });
const rows = db
  .prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at")
  .all(from, to);
const key = (f) => `${f.project}|${f.path}`;
const runs = rows.map((r) => {
  const files = JSON.parse(r.test_files);
  const reportPath = join(r.log_dir, "report.json");
  let durations = [];
  let reportEnd = null;
  let reportMs = null;
  if (existsSync(reportPath)) {
    const { report } = JSON.parse(readFileSync(reportPath, "utf8"));
    durations = report.fileDurations ?? [];
    reportEnd = report.end;
    reportMs = report.durationMs;
  }
  // A node:test run writes no report.json: it holds one file per process and
  // its run's wall time stands for that file's duration (an upper bound).
  const nodeTest = existsSync(join(r.log_dir, "node-test"));
  if (nodeTest && durations.length === 0 && r.end_state === "completed")
    durations = files.map((f) => ({ testFile: f, durationMs: (r.ended_at - r.started_at) / files.length }));
  return {
    id: r.id.slice(0, 8),
    revision: r.revision,
    checkpoint: r.checkpoint_id !== null,
    start: r.started_at - from,
    end: r.ended_at === null ? null : r.ended_at - from,
    wallMs: r.ended_at === null ? null : r.ended_at - r.started_at,
    files: files.length,
    nodeTest,
    finished: durations.length,
    sumFileMs: Math.round(durations.reduce((s, d) => s + d.durationMs, 0)),
    endState: r.end_state,
    reportEnd,
    reportMs,
    finishedFiles: durations.map((d) => ({ k: key(d.testFile), ms: Math.round(d.durationMs) })),
    fileKeys: files.map(key),
  };
});
// Wall time with at least one run open, mean open runs, gaps.
const events = [];
for (const r of runs) {
  events.push([r.start, 1]);
  events.push([r.end ?? to - from, -1]);
}
events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let open = 0, last = 0, busy = 0, area = 0;
const gaps = [];
for (const [t, d] of events) {
  if (open > 0) busy += t - last;
  else if (t > last && last > 0) gaps.push([last, t]);
  area += open * (t - last);
  open += d;
  last = t;
}
const firstFinish = new Map();
for (const r of runs)
  for (const f of r.finishedFiles) if (!firstFinish.has(f.k) && r.end !== null) firstFinish.set(f.k, r.end);
const byState = {};
for (const r of runs) {
  const s = (byState[r.endState ?? "open"] ??= { runs: 0, files: 0, finished: 0, sumFileMs: 0 });
  s.runs++; s.files += r.files; s.finished += r.finished; s.sumFileMs += r.sumFileMs;
}
const span = (runs.at(-1)?.end ?? 0) || to - from;
console.log(JSON.stringify({
  from, to, runs: runs.length, byState,
  fileRunsPicked: runs.reduce((s, r) => s + r.files, 0),
  fileRunsFinished: runs.reduce((s, r) => s + r.finished, 0),
  distinctFinished: firstFinish.size,
  sumFileMs: runs.reduce((s, r) => s + r.sumFileMs, 0),
  busyWallMs: busy, meanOpenRuns: busy ? +(area / busy).toFixed(2) : 0,
  lastEndMs: Math.max(...runs.map((r) => r.end ?? 0)),
  gapsOver1s: gaps.filter(([a, b]) => b - a > 1000).map(([a, b]) => [a, b - a]),
  firstFinish: [...firstFinish.entries()].sort((a, b) => a[1] - b[1]),
  runList: runs.map(({ finishedFiles, fileKeys, ...r }) => r),
  runFiles: Object.fromEntries(runs.map((r) => [r.id, r.fileKeys])),
}, null, 1));
