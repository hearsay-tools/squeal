// estimate.mjs <store.sqlite> <durations from ms> <durations to ms> <edit from ms> [width] [edit to ms]
// Q3: what Squeal could estimate at the edit from stored durations, for the
// files the runs after <edit from> held. Durations: each file's last
// duration in the runs of [from, to] (report.json; a node:test run's wall).
// Prints, per lane (Vitest; node:test) and in all:
//   e_gate   = max(longest, sum / W), unknown at the median (squeal code's estimateRun, W = CPUs - 1)
//   e_tiers  = the backlog rule: catch-up order (shortest first, unknown last), tiers cut at
//              sum/W + (1 - 1/W) * longest <= 120 s, each tier's estimate summed (C4 step 5)
//   e_serial = sum / W
// W defaults to CPUs - 1 for the gate and to [width] (default 9) for tiers;
// node:test uses tierSize 4 slots. Read-only.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
const [store, dFrom, dTo, eFrom, widthArg, eToArg] = process.argv.slice(2);
const eTo = eToArg ? Number(eToArg) : Date.now();
const W = Number(widthArg ?? 9);
const gateW = availableParallelism() - 1;
const db = new DatabaseSync(store, { readOnly: true });
const key = (f) => `${f.project}|${f.path}`;
const runsIn = (a, b) => db.prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at").all(a, b);
const dur = new Map();
for (const r of runsIn(Number(dFrom), Number(dTo))) {
  const files = JSON.parse(r.test_files);
  const rep = join(r.log_dir, "report.json");
  if (existsSync(rep)) {
    for (const d of JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? []) dur.set(key(d.testFile), d.durationMs / 1000);
  } else if (existsSync(join(r.log_dir, "node-test")) && r.end_state === "completed" && files.length === 1) {
    dur.set(key(files[0]), (r.ended_at - r.started_at) / 1000);
  }
}
const lanes = { vitest: new Set(), nodeTest: new Set() };
const after = new Map(); // the durations the runs after the edit recorded, to compare with the stored ones
for (const r of runsIn(Number(eFrom), eTo)) {
  const lane = existsSync(join(r.log_dir, "node-test")) ? lanes.nodeTest : lanes.vitest;
  for (const f of JSON.parse(r.test_files)) lane.add(key(f));
  const rep = join(r.log_dir, "report.json");
  if (existsSync(rep)) for (const d of JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? []) after.set(key(d.testFile), d.durationMs / 1000);
}
const both = [...after.keys()].filter((k) => dur.has(k));
const drift = { files: both.length, storedS: Math.round(both.reduce((a, k) => a + dur.get(k), 0)),
  afterS: Math.round(both.reduce((a, k) => a + after.get(k), 0)),
  unknownAfterS: Math.round([...after.keys()].filter((k) => !dur.has(k)).reduce((a, k) => a + after.get(k), 0)) };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const wall = (sum, longest, w) => sum / w + (1 - 1 / w) * longest;
function laneEstimate(files, w) {
  const known = files.filter((f) => dur.has(f)).map((f) => dur.get(f));
  const med = median(known);
  const secs = files.map((f) => dur.get(f) ?? med);
  const sum = secs.reduce((a, b) => a + b, 0);
  const longest = Math.max(0, ...secs);
  // backlog tiers: shortest first, unknown last (counted 0 in the budget, med in the estimate)
  const order = files.map((f) => ({ known: dur.has(f), s: dur.get(f) ?? 0 }))
    .sort((a, b) => (a.known === b.known ? a.s - b.s : a.known ? -1 : 1));
  let tiers = 0, eTiers = 0, cur = [];
  const close = () => { if (!cur.length) return; const s = cur.map((x) => (x.known ? x.s : med));
    eTiers += wall(s.reduce((a, b) => a + b, 0), Math.max(...s), Math.min(w, s.length)); tiers++; cur = []; };
  for (const x of order) {
    const next = [...cur, x];
    const s = next.map((y) => y.s);
    const within = next.length <= w || wall(s.reduce((a, b) => a + b, 0), Math.max(...s), w) <= 120;
    if (within && next.length <= 200) cur = next; else { close(); cur = [x]; }
  }
  close();
  return { files: files.length, known: known.length, sumS: Math.round(sum), longestS: Math.round(longest),
    e_gate: Math.round(Math.max(longest, sum / gateW)), e_serial: Math.round(sum / w), e_tiers: Math.round(eTiers), tiers };
}
const v = laneEstimate([...lanes.vitest], W);
const n = laneEstimate([...lanes.nodeTest], 4);
console.log(JSON.stringify({ W, gateW, drift, vitest: v, nodeTest: n,
  all: { e_gate: Math.max(v.e_gate, n.e_gate), e_tiers: Math.max(v.e_tiers, n.e_tiers), e_serial: Math.max(v.e_serial, n.e_serial) } }, null, 1));
