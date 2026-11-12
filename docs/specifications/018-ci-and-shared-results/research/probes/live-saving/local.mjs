// Throwaway probe (row 018-39). Local test load per worktree and day, and per
// time window, from the store's `runs` table and each run's report.json.
// Read-only: the store is opened with `readOnly: true`; report.json files are read.
// Usage: node local.mjs <store.sqlite> <runs-dir> <cutoff-iso> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [storePath, runsDir, cutoffIso, outPath] = process.argv.slice(2);
const cutoff = Date.parse(cutoffIso);
const SINCE = Date.parse("2026-11-05T00:00:00Z");
export const WINDOWS = [
  ["A before any import", "2026-11-05T00:00:00Z"],
  ["B imports, none looked up", "2026-11-10T21:49:00Z"],
  ["C lookups work, CI 0.1.431", "2026-11-11T19:00:00Z"],
  ["D Action, CI 0.1.443", "2026-11-12T09:19:00Z"],
  ["E local 0.1.449+ (node:test re-key)", "2026-11-12T13:21:00Z"],
].map(([name, from]) => ({ name, from: Date.parse(from) }));
const windowOf = (t) => [...WINDOWS].reverse().find((w) => t >= w.from)?.name ?? "-";

const db = new DatabaseSync(storePath, { readOnly: true });
const runs = db
  .prepare(
    "select id, worktree_id wt, started_at s, ended_at e, end_state es, checkpoint_id cp, test_files tf from runs where started_at >= ? and started_at < ?",
  )
  .all(SINCE, cutoff);

const fileChecks = db.prepare(
  "select c.project, c.test_path path, r.duration_ms ms from results r join checks c on c.id = r.check_id where r.run_id = ? and c.kind = 'file'",
);
let fromResults = 0;
const perFile = new Map(); // project\0path -> durations[]
const days = new Map(); // wt\tday -> agg
const wins = new Map(); // window -> agg
let missing = 0;
const agg = () => ({ runs: 0, fileRuns: 0, fileSec: 0, wallSec: 0, files: new Set(), checkpointFileSec: 0, nodeTestFileSec: 0, worktrees: new Set() });
for (const r of runs) {
  let durations = [];
  let nodeTest = false;
  try {
    const rep = JSON.parse(readFileSync(`${runsDir}/${r.id}/report.json`, "utf8"));
    durations = rep.report?.fileDurations ?? [];
  } catch {
    // node:test runs keep no report.json: their surviving file-check results
    // (a later run at the same key replaces a row, so this undercounts).
    durations = fileChecks
      .all(r.id)
      .map((x) => ({ testFile: { project: x.project, path: x.path }, durationMs: x.ms }));
    nodeTest = true;
    if (durations.length > 0) fromResults++;
    else missing++;
  }
  const day = new Date(r.s).toISOString().slice(0, 10);
  for (const [map, k] of [
    [days, `${r.wt}\t${day}`],
    [wins, windowOf(r.s)],
  ]) {
    const a = map.get(k) ?? agg();
    a.runs++;
    a.worktrees.add(r.wt);
    a.wallSec += r.e ? (r.e - r.s) / 1000 : 0;
    for (const d of durations) {
      a.fileRuns++;
      a.fileSec += d.durationMs / 1000;
      if (r.cp) a.checkpointFileSec += d.durationMs / 1000;
      if (nodeTest) a.nodeTestFileSec += d.durationMs / 1000;
      a.files.add(`${d.testFile.project}\0${d.testFile.path}`);
    }
    map.set(k, a);
  }
  for (const d of durations) {
    const id = `${d.testFile.project}\0${d.testFile.path}`;
    const list = perFile.get(id) ?? [];
    list.push(d.durationMs);
    perFile.set(id, list);
  }
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const medians = Object.fromEntries([...perFile].map(([k, v]) => [k, median(v)]));
const fmt = (a) => ({
  runs: a.runs,
  fileRuns: a.fileRuns,
  distinctFiles: a.files.size,
  fileSec: Math.round(a.fileSec),
  checkpointFileSec: Math.round(a.checkpointFileSec),
  nodeTestFileSec: Math.round(a.nodeTestFileSec),
  worktrees: a.worktrees.size,
  wallSec: Math.round(a.wallSec),
});
const out = {
  cutoff: cutoffIso,
  runsRead: runs.length,
  runsFromResultRows: fromResults,
  runsWithoutDurations: missing,
  windows: Object.fromEntries([...wins].map(([k, a]) => [k, fmt(a)])),
  days: Object.fromEntries([...days].sort().map(([k, a]) => [k, fmt(a)])),
  medianFileMs: medians,
};
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ runsRead: out.runsRead, fromResults, missing, windows: out.windows }, null, 1));
