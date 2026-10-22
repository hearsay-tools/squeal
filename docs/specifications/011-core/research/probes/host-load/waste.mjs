import { DatabaseSync } from "node:sqlite";
const [, , path, hours = "24"] = process.argv;
const db = new DatabaseSync(path, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const now = Date.now();
const since = now - Number(hours) * 3600_000;
const runs = db.prepare("SELECT id, test_files, started_at, ended_at, end_state, checkpoint_id FROM runs WHERE started_at >= ? AND ended_at IS NOT NULL").all(since);
const keysOf = db.prepare("SELECT count(DISTINCT key) k FROM results WHERE run_id = ?");
let n = 0, k = 0, wall = 0, wallZero = 0, zeroRuns = 0, cp = 0, cpWall = 0, cpN = 0, cpK = 0;
const bySize = {};
for (const r of runs) {
  const files = JSON.parse(r.test_files).length;
  const kept = keysOf.get(r.id).k;
  const w = (r.ended_at - r.started_at) / 1000;
  n += files; k += kept; wall += w;
  if (kept === 0) { zeroRuns++; wallZero += w; }
  if (r.checkpoint_id) { cp++; cpWall += w; cpN += files; cpK += kept; }
  const b = files >= 100 ? "100+" : files >= 10 ? "10-99" : files >= 2 ? "2-9" : "1";
  const e = (bySize[b] ??= { runs: 0, files: 0, kept: 0, wall: 0, zero: 0 });
  e.runs++; e.files += files; e.kept += kept; e.wall += w; if (kept === 0) e.zero++;
}
const pct = (a, b) => (100 * a / b).toFixed(0) + "%";
console.log(JSON.stringify({
  runs: runs.length, filesSelected: n, filesWithStoredResult: k, keptShare: pct(k, n),
  runWallHours: (wall / 3600).toFixed(1), runsWithNoResult: zeroRuns, wallHoursOfRunsWithNoResult: (wallZero / 3600).toFixed(1), zeroShareOfWall: pct(wallZero, wall),
  checkpointRuns: cp, checkpointFiles: cpN, checkpointKept: cpK, checkpointKeptShare: pct(cpK, cpN), checkpointWallHours: (cpWall / 3600).toFixed(1),
  bySize: Object.fromEntries(Object.entries(bySize).map(([b, e]) => [b, { ...e, wall: Math.round(e.wall), keptShare: pct(e.kept, e.files) }])),
}, null, 1));