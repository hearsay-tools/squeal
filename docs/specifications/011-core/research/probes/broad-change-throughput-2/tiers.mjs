// tiers.mjs <label> [cpus]: where the idle CPU of one run went, second by
// second, from the edit to the last run's end. Reads $OUT/<label>.{t0,t1,
// edits.tsv,tsv,workers.tsv}, the clone's store (runs, report.json) and each
// run's vitest.log (its maxWorkers line: the tier's width). Prints JSON:
//
// - per Vitest run: start, end, width, files, summed file s, peak and mean
//   live fork workers, its idle worker-s split into head (start to the first
//   fork), tail (after the last second at its peak forks) and middle;
// - for the window, core-seconds of the machine (cpus x wall) split into:
//   used (busy cores, /proc/stat, all processes), not granted (cpus minus
//   the open runs' widths and the node:test processes), granted with no live
//   worker (Vitest slots idle: head, tail, middle, and the lane's gaps), and
//   live workers below one core (granted and live, minus what was used).
//   Busy cores beyond the granted ones (the daemon, Vite transforms in the
//   runner host, other processes) count as used and reduce "not granted".
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2];
const CPUS = Number(process.argv[3] ?? 12);
const OUT = process.env.OUT, REPO = process.env.SQ_REPO;
const read = (f) => readFileSync(join(OUT, f), "utf8");
const tsv = (f) => read(f).trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
const t0 = Number(read(`${label}.t0`));
const t1 = existsSync(join(OUT, `${label}.t1`)) ? Number(read(`${label}.t1`)) : Date.now();
const e0 = Number(read(`${label}.edits.tsv`).split("\t")[0]);
const s = (ms) => +((ms - e0) / 1000).toFixed(1);
const db = new DatabaseSync(join(REPO, ".git/squeal/store.sqlite"), { readOnly: true });
const runs = db.prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at").all(t0, t1).map((r) => {
  const files = JSON.parse(r.test_files);
  const node = existsSync(join(r.log_dir, "node-test"));
  let fin = [], width = null;
  const rep = join(r.log_dir, "report.json");
  if (existsSync(rep)) fin = JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? [];
  const log = join(r.log_dir, "vitest.log");
  if (existsSync(log)) { const m = /maxWorkers[^0-9]*(\d+)/.exec(readFileSync(log, "utf8").slice(0, 4000)); if (m) width = Number(m[1]); }
  return { id: r.id.slice(0, 8), node, start: r.started_at, end: r.ended_at ?? t1, files: files.length, finished: fin.length,
    sumS: fin.reduce((a, d) => a + d.durationMs, 0) / 1000, width, state: r.end_state };
});
const vit = runs.filter((r) => !r.node);
const w = tsv(`${label}.workers.tsv`).filter((r) => r[1] === 0); // t, cg, forks, nodeTest, procs
const samp = tsv(`${label}.tsv`); // t, load1, busy, scope, daemon, procs_running
const lastEnd = Math.max(...runs.map((r) => r.end));
const busyAt = (t) => { // the 5 s sample whose interval holds t
  for (const r of samp) if (r[0] >= t) return r[2];
  return samp.at(-1)?.[2] ?? 0;
};
const perRun = vit.map((r) => {
  const ws = w.filter((x) => x[0] >= r.start && x[0] <= r.end);
  const width = r.width ?? Math.max(1, ...ws.map((x) => x[2]));
  const peak = Math.max(0, ...ws.map((x) => x[2]));
  const first = ws.find((x) => x[2] > 0);
  const head = first ? (first[0] - r.start) / 1000 : (r.end - r.start) / 1000;
  let lastPeak = -1;
  ws.forEach((x, i) => { if (x[2] === peak) lastPeak = i; });
  const tail = lastPeak < 0 ? [] : ws.slice(lastPeak + 1);
  const tailIdle = tail.reduce((a, x) => a + (width - x[2]), 0);
  const used = ws.reduce((a, x) => a + Math.min(width, x[2]), 0);
  const wall = (r.end - r.start) / 1000;
  const idle = Math.max(0, width * wall - used);
  const headIdle = Math.min(idle, width * head);
  return { id: r.id, start: s(r.start), end: s(r.end), wall: +wall.toFixed(1), width, files: r.files, finished: r.finished,
    sumS: +r.sumS.toFixed(1), peak, meanLive: ws.length ? +(used / ws.length).toFixed(2) : 0,
    idleWs: +idle.toFixed(0), headS: +head.toFixed(1), headIdleWs: +headIdle.toFixed(0), tailS: tail.length, tailIdleWs: +tailIdle.toFixed(0),
    midIdleWs: +Math.max(0, idle - headIdle - tailIdle).toFixed(0), state: r.state };
});
// Second by second over the window: granted slots, live workers, busy cores.
let used = 0, notGranted = 0, grantedNoWorker = 0, liveBelowCore = 0, seconds = 0;
let busyOverGrant = 0;
for (const x of w) {
  if (x[0] < e0 || x[0] > lastEnd) continue;
  seconds++;
  const open = vit.filter((r) => r.start <= x[0] && r.end >= x[0]);
  const granted = Math.min(CPUS, open.reduce((a, r) => a + (r.width ?? 1), 0) + x[3]);
  const live = Math.min(granted, x[2] + x[3]);
  const busy = Math.min(CPUS, busyAt(x[0]));
  used += busy;
  const idleCores = CPUS - busy;
  // Idle cores are split in this order: granted slots with no live worker,
  // live workers below a core, and the rest, cores no tier was granted.
  const a = Math.min(idleCores, granted - live);
  const b = Math.min(idleCores - a, Math.max(0, live - busy));
  grantedNoWorker += a; liveBelowCore += b; notGranted += Math.max(0, idleCores - a - b);
  if (busy > granted) busyOverGrant += busy - granted;
}
const total = CPUS * seconds;
const pct = (v) => +((100 * v) / total).toFixed(1);
const sum = (k) => perRun.reduce((a, r) => a + r[k], 0);
console.log(JSON.stringify({
  label, cpus: CPUS, windowS: seconds, lastEndS: s(lastEnd),
  coreSeconds: { total, used: Math.round(used), idle: Math.round(total - used) },
  shareOfMachine: { usedPct: pct(used), notGrantedPct: pct(notGranted), grantedNoWorkerPct: pct(grantedNoWorker), liveBelowCorePct: pct(liveBelowCore) },
  busyBeyondGrantedCoreS: Math.round(busyOverGrant),
  vitestRuns: perRun.length, vitestIdleWs: { all: sum("idleWs"), head: sum("headIdleWs"), tail: sum("tailIdleWs"), middle: sum("midIdleWs") },
  meanWidth: +(perRun.reduce((a, r) => a + r.width * r.wall, 0) / Math.max(1, sum("wall"))).toFixed(2),
  runs: perRun,
}, null, 1));
