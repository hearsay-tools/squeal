// q4b.mjs <label> <n> [cpus]: question 4 summary over local copies of $label.* files. "Queued" counts only
// files above each copy's residual queue (the e2e files and the held run-loop group, which stay queued).
import { readFileSync } from "node:fs";
const [label, nArg, cpusArg = 12] = process.argv.slice(2); const N = +nArg, CPUS = +cpusArg;
const tsv = (f) => readFileSync(f, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
const e0 = +readFileSync(`${label}.edits.tsv`, "utf8").split("\t")[0];
const q = Array.from({ length: N }, (_, i) => tsv(`${label}.${i + 1}.queue.tsv`).filter((r) => Number.isFinite(r[2])));
const residual = q.map((x) => x.at(-1)[2]);
// per copy: the first time after the edit its queue is back at the residual with nothing running
const doneAt = q.map((x, i) => { const after = x.filter((r) => r[0] > e0 + 5000); let last = null; for (const r of after) if (r[2] > residual[i] || r[3] > 0) last = r[0]; return last; });
const end = Math.max(...doneAt);
const pending = (t) => q.some((x, i) => { let last = null; for (const r of x) { if (r[0] > t) break; last = r; } return last && (last[2] > residual[i] || last[3] > 0); });
const samp = tsv(`${label}.tsv`).filter((r) => r[0] >= e0 && r[0] <= end);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const qd = samp.filter((r) => pending(r[0]));
const w = tsv(`${label}.workers.tsv`).filter((r) => r[0] >= e0 && r[0] <= end);
const per = new Map(); for (const r of w) per.set(r[0], (per.get(r[0]) ?? 0) + r[2] + r[3]);
const live = [...per.values()];
const peak = Math.max(...q.map((x) => Math.max(...x.filter((r) => r[0] > e0).map((r) => r[2] + r[3]))));
const r2 = (x) => +x.toFixed(2);
console.log(JSON.stringify({ label, daemons: N, residual, spanS: r2((end - e0) / 1000), perCopyS: doneAt.map((t) => r2((t - e0) / 1000)), peakQueuedPlusRunning: peak,
  meanBusy: r2(mean(samp.map((r) => r[2]))), scopeCpuCopy1: r2(samp.at(-1)[3] - samp[0][3]),
  overshoot: { busyAtOrAbove11_5Pct: r2((100 * samp.filter((r) => r[2] >= 11.5).length) / samp.length), runnableAbove12Pct: r2((100 * samp.filter((r) => r[5] > CPUS).length) / samp.length), meanRunnable: r2(mean(samp.map((r) => r[5]))), p90Runnable: samp.map((r) => r[5]).sort((a, b) => a - b)[Math.floor(0.9 * (samp.length - 1))], maxBusy: Math.max(...samp.map((r) => r[2])) },
  underUse: { samplesPending: qd.length, idleCoresWhilePending: r2(mean(qd.map((r) => CPUS - r[2]))), below9BusyWhilePendingPct: r2((100 * qd.filter((r) => r[2] < 9).length) / Math.max(1, qd.length)) },
  liveForks: { mean: r2(mean(live)), max: Math.max(...live), above12Pct: r2((100 * live.filter((x) => x > CPUS).length) / Math.max(1, live.length)) } }));
