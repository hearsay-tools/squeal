// Throwaway probe (row 020-17). Reads cezar's Squeal store read-only
// (`?immutable=1`: no lock, no -shm write; the WAL's newest rows are not seen)
// and cezar's CI duration manifest, and answers for one change:
//  - the selection (test files whose stored closure holds a changed path, plus
//    changed test files), by Vitest project and check group;
//  - the loader set size of each changed path;
//  - a per-file cost: CI manifest (median suite ms, CI --maxWorkers=4, no
//    Squeal provider) or, when absent, the median wall of the daemon's
//    single-file runs of that file, or else the median of the known costs;
//  - the per-file list that simulate.mjs schedules (W is only echoed).
// COST=store takes the store's file durations first (default: manifest first).
// Usage: node cezar-store.mjs <store.sqlite> <durations.json> <W> <changed,...>
// Writes nothing; prints JSON.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [storePath, durationsPath, wArg, changedArg] = process.argv.slice(2);
const W = Number(wArg);
const changed = changedArg.split(",");
const db = new DatabaseSync(`file:${storePath}?immutable=1`, { readOnly: true });
const manifest = JSON.parse(readFileSync(durationsPath, "utf8")).durationsMs;
const group = (f) => (f.project === "e2e" ? "browser (manual)" : "tests");

const all = db.prepare("select project, path, closure_paths, complete, method from test_files").all();
const selected = [];
for (const row of all) {
  const closure = new Set(JSON.parse(row.closure_paths));
  const loads = changed.filter((p) => closure.has(p) || p === row.path);
  if (loads.length > 0) selected.push({ project: row.project, path: row.path, loads });
}
const byProject = {};
const byGroup = {};
for (const f of selected) {
  byProject[f.project] = (byProject[f.project] ?? 0) + 1;
  byGroup[group(f)] = (byGroup[group(f)] ?? 0) + 1;
}
const loaderSets = Object.fromEntries(
  changed.map((p) => {
    const l = selected.filter((f) => f.loads.includes(p));
    return [p, { all: l.length, inScope: l.filter((f) => group(f) === "tests").length }];
  }),
);

// Per-file cost.
const single = db.prepare(
  "select started_at, ended_at from runs where test_files = ? and ended_at is not null and end_state = 'completed' order by started_at desc limit 9",
);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
let fromManifest = 0;
let fromRuns = 0;
for (const f of selected) {
  const m = manifest[f.path];
  if (f.ms !== undefined) continue;
  if (typeof m === "number" && m > 0) {
    f.ms = m;
    f.source = "ci-manifest";
    fromManifest++;
    continue;
  }
  const rows = single.all(JSON.stringify([{ project: f.project, path: f.path }]));
  const wall = median(rows.map((r) => r.ended_at - r.started_at));
  if (wall !== null) {
    f.ms = wall;
    f.source = "daemon-single-run";
    fromRuns++;
  }
}
// What a pre-run estimate can read from the store today: per file, the latest
// result of its `file` check, whose duration is the module's whole cost
// (environment, prepare, collect, setup, tests: reporter.ts moduleDuration).
const fileCheck = db.prepare("select id from checks where project = ? and test_path = ? and kind = 'file'");
const latest = db.prepare("select duration_ms from results where check_id = ? order by recorded_at desc limit 1");
let withStored = 0;
for (const f of selected) {
  const c = fileCheck.get(f.project, f.path);
  const r = c ? latest.get(c.id) : undefined;
  if (r && r.duration_ms > 0) { f.storedFileMs = r.duration_ms; withStored++; }
}
// COST=store: the stored file duration first, then the manifest, then runs.
if (process.env.COST === "store") for (const f of selected) if (f.storedFileMs) { f.ms = f.storedFileMs; f.source = "store-file-check"; }
const bySource = {};
for (const f of selected) if (f.source) (bySource[f.source] ??= []).push(f.ms);
const known = selected.filter((f) => f.ms !== undefined).map((f) => f.ms);
const fallback = median(known);
for (const f of selected) if (f.ms === undefined) { f.ms = fallback; f.source = "fallback-median"; }
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const costs = {
  fromManifest,
  fromDaemonSingleRuns: fromRuns,
  fallback: selected.length - fromManifest - fromRuns,
  fallbackMedianMs: fallback,
  serialSecondsAll: Math.round(sum(selected.map((f) => f.ms)) / 1000),
  serialSecondsTests: Math.round(sum(selected.filter((f) => group(f) === "tests").map((f) => f.ms)) / 1000),
  serialSecondsBrowser: Math.round(sum(selected.filter((f) => group(f) !== "tests").map((f) => f.ms)) / 1000),
  p50: median(known), max: Math.max(...known),
  medianBySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { n: v.length, medianMs: median(v) }])),
  storedFileDurations: {
    files: withStored,
    serialSeconds: Math.round(sum(selected.filter((f) => f.storedFileMs).map((f) => f.storedFileMs)) / 1000),
    medianMs: median(selected.filter((f) => f.storedFileMs).map((f) => f.storedFileMs)),
    storeOverManifestMedianRatio: median(selected.filter((f) => f.storedFileMs && manifest[f.path] > 0).map((f) => f.storedFileMs / manifest[f.path])),
  },
};

// The daemon's full-suite runs (`squeal run --all`): files and wall.
const runAll = db
  .prepare("select test_files, started_at, completed_at, end_state from checkpoints where kind = 'run-all' and completed_at is not null order by started_at desc limit 8")
  .all()
  .map((c) => ({ files: JSON.parse(c.test_files).length, wallSeconds: Math.round((c.completed_at - c.started_at) / 1000), end: c.end_state }));

const files = selected.map((f) => ({ project: f.project, path: f.path, loads: f.loads, storedFileMs: f.storedFileMs ?? null, manifestMs: manifest[f.path] > 0 ? manifest[f.path] : null, ms: f.ms, source: f.source }));
console.log(JSON.stringify({ W, changed, files, testFilesInStore: all.length, selected: selected.length, byProject, byGroup, loaderSets, costs, runAll }, null, 1));
