// Throwaway (026, tiered-pre-pr). Splits a store's local test time in a window
// into: the last run of each test file in each worktree ("final"), earlier runs
// at a key other than that last key ("intermediate"), and earlier runs whose
// key equals the last key or is unknown because a later run at the same key
// replaced its results ("repeat").
// File time is report.json's fileDurations (wall time of each file in its
// worker), summed: file-seconds, a proxy for CPU.
// Usage: node churn.mjs <store copy> <runs dir> <from ISO> <to ISO>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [store, runsDir, fromIso, toIso] = process.argv.slice(2);
const from = Date.parse(fromIso), to = Date.parse(toIso);
const db = new DatabaseSync(store, { readOnly: true });
const mainIds = new Set(db.prepare("select id from worktrees where is_main = 1").all().map((r) => r.id));
const runs = db.prepare(
  "select id, worktree_id w, started_at s from runs where started_at >= ? and started_at < ? order by started_at",
).all(from, to);
const keyOf = new Map();
for (const r of db.prepare(
  `select distinct r.run_id, c.project, c.test_path, r.key from results r join checks c on c.id = r.check_id
   where r.recorded_at >= ? and r.recorded_at < ?`,
).iterate(from, to + 3600_000)) keyOf.set(`${r.run_id}\0${r.project}\0${r.test_path}`, r.key);

const perFile = new Map(); // w \0 project \0 path -> [{s, d, key}]
let missingReports = 0;
for (const run of runs) {
  let report;
  try { report = JSON.parse(readFileSync(join(runsDir, run.id, "report.json"), "utf8")).report; }
  catch { missingReports++; continue; }
  for (const f of report.fileDurations ?? []) {
    const { project, path } = f.testFile;
    const id = `${run.w}\0${project}\0${path}`;
    const key = keyOf.get(`${run.id}\0${project}\0${path}`) ?? null;
    (perFile.get(id) ?? perFile.set(id, []).get(id)).push({ s: run.s, d: f.durationMs / 1000, key });
  }
}
const sum = { final: 0, intermediate: 0, repeat: 0 };
const byWt = new Map();
for (const [id, list] of perFile) {
  const w = id.split("\0")[0];
  const t = byWt.get(w) ?? byWt.set(w, { final: 0, intermediate: 0, repeat: 0, files: 0, main: mainIds.has(w) }).get(w);
  t.files++;
  const last = list[list.length - 1];
  const finalKey = last.key ?? [...list].reverse().find((x) => x.key)?.key ?? null;
  for (const x of list) {
    const cat = x === last ? "final" : x.key && finalKey && x.key !== finalKey ? "intermediate" : "repeat";
    t[cat] += x.d;
  }
}
const rows = [...byWt.entries()].map(([w, t]) => ({ w, ...t, total: t.final + t.intermediate + t.repeat }));
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0");
for (const main of [false, true]) {
  const sel = rows.filter((r) => r.main === main);
  const T = sel.reduce((a, r) => ({ final: a.final + r.final, intermediate: a.intermediate + r.intermediate, repeat: a.repeat + r.repeat, files: a.files + r.files }), { final: 0, intermediate: 0, repeat: 0, files: 0 });
  const total = T.final + T.intermediate + T.repeat;
  console.log(`${main ? "main checkout" : "other worktrees"}: worktrees ${sel.length}, file-runs grouped into ${T.files} (worktree, file) pairs`);
  console.log(`  total ${(total / 3600).toFixed(1)} file-h; final ${(T.final / 3600).toFixed(1)} (${pct(T.final, total)}%), intermediate ${(T.intermediate / 3600).toFixed(1)} (${pct(T.intermediate, total)}%), repeat ${(T.repeat / 3600).toFixed(1)} (${pct(T.repeat, total)}%)`);
  const shares = sel.filter((r) => r.total > 60).map((r) => (r.intermediate + r.repeat) / r.total).sort((a, b) => a - b);
  const q = (p) => (shares.length ? (100 * shares[Math.min(shares.length - 1, Math.floor(p * shares.length))]).toFixed(0) : "-");
  console.log(`  per worktree (> 60 file-s), churn share p25 ${q(0.25)}%, p50 ${q(0.5)}%, p75 ${q(0.75)}%, n ${shares.length}`);
  const tot = sel.filter((r) => r.total > 60).map((r) => r.total).sort((a, b) => a - b);
  const qt = (p) => (tot.length ? tot[Math.min(tot.length - 1, Math.floor(p * tot.length))].toFixed(0) : "-");
  console.log(`  per worktree total file-s p25 ${qt(0.25)}, p50 ${qt(0.5)}, p75 ${qt(0.75)}, p90 ${qt(0.9)}, mean ${(tot.reduce((a, b) => a + b, 0) / Math.max(1, tot.length)).toFixed(0)}`);
  const fin = sel.filter((r) => r.total > 60).map((r) => r.final).sort((a, b) => a - b);
  const qf = (p) => (fin.length ? fin[Math.min(fin.length - 1, Math.floor(p * fin.length))].toFixed(0) : "-");
  console.log(`  per worktree final file-s p25 ${qf(0.25)}, p50 ${qf(0.5)}, p75 ${qf(0.75)}, max ${qf(0.999)}`);
}
console.log(`runs ${runs.length}, without report.json ${missingReports}`);
