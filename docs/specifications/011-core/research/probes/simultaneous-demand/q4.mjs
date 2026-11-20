// q4.mjs <label> [cpus]: one question 4 run, SQ_N daemons. Reads $OUT/<label>
// .{t0,t1,edits.tsv,tsv,workers.tsv,<i>.queue.tsv} and each copy's store.
// Prints JSON: per daemon its runs, files finished, Vitest tiers and mean
// width, and the time from the edit to its last run's end; for the machine,
// from the edit to the last end: mean busy cores, the share of 5 s samples at
// or above 11.5 busy cores and with more than <cpus> runnable tasks
// (overshoot), the mean idle cores and the share of samples below 9 busy
// cores while any copy had files queued (under-use), and the live Vitest
// workers of all daemons together each second (mean, max, share above <cpus>).
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2];
const CPUS = Number(process.argv[3] ?? 12);
const N = Number(process.env.SQ_N);
const OUT = process.env.OUT, P = process.env.P;
const read = (f) => readFileSync(join(OUT, f), "utf8");
const tsv = (f) => read(f).trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
const t0 = Number(read(`${label}.t0`)), t1 = Number(read(`${label}.t1`));
const e0 = Number(read(`${label}.edits.tsv`).split("\t")[0]);
const daemons = [];
for (let i = 1; i <= N; i++) {
  const db = new DatabaseSync(join(P, `q4-${i}`, ".git/squeal/store.sqlite"), { readOnly: true });
  const runs = db.prepare("select * from runs where started_at >= ? and started_at <= ? order by started_at").all(t0, t1);
  let finished = 0, widthWall = 0, wall = 0, vitest = 0;
  for (const r of runs) {
    const rep = join(r.log_dir, "report.json");
    if (existsSync(rep)) finished += (JSON.parse(readFileSync(rep, "utf8")).report.fileDurations ?? []).length;
    else if (existsSync(join(r.log_dir, "node-test")) && r.end_state === "completed") finished += JSON.parse(r.test_files).length;
    const log = join(r.log_dir, "vitest.log");
    if (existsSync(log)) {
      vitest++;
      const m = /maxWorkers[^0-9]*(\d+)/.exec(readFileSync(log, "utf8").slice(0, 4000));
      const w = (r.ended_at - r.started_at) / 1000;
      if (m) { widthWall += Number(m[1]) * w; wall += w; }
    }
  }
  const lastEnd = Math.max(...runs.map((r) => r.ended_at ?? 0));
  daemons.push({ copy: i, runs: runs.length, vitestTiers: vitest, filesFinished: finished,
    meanWidth: wall ? +(widthWall / wall).toFixed(2) : null, lastEndS: +((lastEnd - e0) / 1000).toFixed(1) });
}
const end = e0 + 1000 * Math.max(...daemons.map((d) => d.lastEndS));
const samp = tsv(`${label}.tsv`).filter((r) => r[0] >= e0 && r[0] <= end); // t, load1, busy, scope, daemon, procs_running
const queues = Array.from({ length: N }, (_, i) => tsv(`${label}.${i + 1}.queue.tsv`));
const queuedAt = (t) => queues.some((q) => { let last = null; for (const r of q) { if (r[0] > t) break; last = r; } return last && (last[2] > 0 || last[3] > 0); });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (x) => (x === null ? null : +x.toFixed(2));
const queuedSamples = samp.filter((r) => queuedAt(r[0]));
const w = tsv(`${label}.workers.tsv`).filter((r) => r[0] >= e0 && r[0] <= end);
const perSec = new Map();
for (const r of w) perSec.set(r[0], (perSec.get(r[0]) ?? 0) + r[2] + r[3]);
const live = [...perSec.values()];
const files = daemons.reduce((a, d) => a + d.filesFinished, 0);
const span = (end - e0) / 1000;
console.log(JSON.stringify({
  label, daemons: N, user: read(`${label}.load.txt`).trim().split("\n").at(-1), spanS: +span.toFixed(1), filesFinished: files,
  filesPerMin: +((files * 60) / span).toFixed(1),
  machine: {
    meanBusy: r2(mean(samp.map((r) => r[2]))), meanLoad1: r2(mean(samp.map((r) => r[1]))),
    overshoot: { samplesAtOrAbove11_5BusyPct: r2((100 * samp.filter((r) => r[2] >= 11.5).length) / samp.length),
      samplesRunnableAboveCpusPct: r2((100 * samp.filter((r) => r[5] > CPUS).length) / samp.length), meanRunnable: r2(mean(samp.map((r) => r[5]))), maxRunnable: Math.max(...samp.map((r) => r[5])) },
    underUse: { samplesWithQueue: queuedSamples.length, meanIdleCoresWhileQueued: r2(mean(queuedSamples.map((r) => CPUS - r[2]))),
      samplesBelow9BusyWhileQueuedPct: r2((100 * queuedSamples.filter((r) => r[2] < 9).length) / Math.max(1, queuedSamples.length)) },
    liveWorkers: { mean: r2(mean(live)), max: Math.max(0, ...live), secondsAboveCpusPct: r2((100 * live.filter((x) => x > CPUS).length) / Math.max(1, live.length)) },
  },
  perDaemon: daemons,
}, null, 1));
