// 011-160 probe (throwaway): on an older copy O and a newer copy N of one store, the runs and rows that worktrees live in O and removed
// by N had stored at O's time within N's window, and how many of them N still shows. Calibrates growth.mjs's "seen" count.
// Usage: node calib.mjs <O store> <N store> <N copy ms> <hours>
import { DatabaseSync } from "node:sqlite";
const [, , oPath, nPath, copyMs, hours] = process.argv;
const from = Number(copyMs) - Number(hours) * 3600e3;
const O = new DatabaseSync(oPath, { readOnly: true }), N = new DatabaseSync(nPath, { readOnly: true });
const nLive = new Set(N.prepare("SELECT id FROM worktrees").all().map((r) => r.id));
const gone = O.prepare("SELECT id FROM worktrees").all().map((r) => r.id).filter((id) => !nLive.has(id));
const nRuns = new Set(N.prepare("SELECT id FROM runs").all().map((r) => r.id));
const nRows = new Map(N.prepare("SELECT run_id, count(*) n FROM results GROUP BY run_id").all().map((r) => [r.run_id, r.n]));
const oRows = new Map(O.prepare("SELECT run_id, count(*) n FROM results GROUP BY run_id").all().map((r) => [r.run_id, r.n]));
const oLast = O.prepare("SELECT max(started_at) t FROM runs").get().t;
let runs = 0, runsWithRows = 0, survive = 0, surviveWithRows = 0, rowsO = 0, rowsOfSurvivingRunsO = 0, rowsN = 0;
for (const id of gone) for (const run of O.prepare("SELECT id FROM runs WHERE worktree_id = ? AND started_at >= ?").all(id, from)) {
  const ro = oRows.get(run.id) ?? 0; runs++; if (ro > 0) runsWithRows++; rowsO += ro;
  if (nRuns.has(run.id)) { survive++; if (ro > 0) surviveWithRows++; rowsOfSurvivingRunsO += ro; rowsN += nRows.get(run.id) ?? 0; }
}
console.log(JSON.stringify({ oLastRun: new Date(oLast).toISOString(), windowFrom: new Date(from).toISOString(), worktreesRemovedSinceO: gone.length,
  runs, runsWithRows, runsSurvivingInN: survive, surviveWithRows, rowsAtO: rowsO, rowsAtOofSurvivingRuns: rowsOfSurvivingRunsO, rowsInN: rowsN,
  coverageOfRowsBySurvivingRuns: +(rowsOfSurvivingRunsO / Math.max(1, rowsO)).toFixed(3) }));
