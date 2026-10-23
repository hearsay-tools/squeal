// 011-160 probe (throwaway): of the rows that worktrees live in O and removed by N stored in N's window (as O holds them), those
// whose (check, key) N holds no row for: what the 7-day rule would still hold at N's time. Usage: node adds.mjs <O> <N> <N copy ms> <hours>
import { DatabaseSync } from "node:sqlite";
const [, , oPath, nPath, copyMs, hours] = process.argv;
const T = Number(copyMs), from = T - Number(hours) * 3600e3, cutoff = T - 7 * 24 * 3600e3;
const O = new DatabaseSync(oPath, { readOnly: true }), N = new DatabaseSync(nPath, { readOnly: true });
const nLive = new Set(N.prepare("SELECT id FROM worktrees").all().map((r) => r.id));
const gone = O.prepare("SELECT id FROM worktrees").all().map((r) => r.id).filter((id) => !nLive.has(id));
const ident = (r) => [r.kind, r.project, r.test_path, r.full_name].join("\0");
const nCheck = new Map(N.prepare("SELECT id, kind, project, test_path, full_name FROM checks").all().map((r) => [ident(r), r.id]));
const nHas = N.prepare("SELECT 1 FROM results WHERE check_id = ? AND key = ?");
let rows = 0, inN = 0, adds = 0, addsFail = 0, runsWithAdds = new Set(), files = new Set(), runs = new Set();
const q = O.prepare(`SELECT r.key, r.failure_id, r.run_id, r.recorded_at, c.kind, c.project, c.test_path, c.full_name FROM results r
  JOIN checks c ON c.id = r.check_id JOIN runs u ON u.id = r.run_id WHERE r.worktree_id = ? AND u.started_at >= ?`);
for (const id of gone) for (const r of q.iterate(id, from)) {
  rows++; runs.add(r.run_id); const c = nCheck.get(ident(r));
  if (c !== undefined && nHas.get(c, r.key)) { inN++; continue; }
  if (r.recorded_at < cutoff) continue;
  adds++; if (r.failure_id) addsFail++; runsWithAdds.add(r.run_id); if (r.kind === "file") files.add(r.run_id + "\0" + r.test_path);
}
const oSpan = (O.prepare("SELECT max(started_at) t FROM runs").get().t - from) / 3600e3;
console.log(JSON.stringify({ worktrees: gone.length, sliceHours: +oSpan.toFixed(1), rows, rowsAtAKeyNHolds: inN, adds, addsWithFailure: addsFail,
  runs: runs.size, runsWithAdds: runsWithAdds.size, fileRowsAdded: files.size }));
