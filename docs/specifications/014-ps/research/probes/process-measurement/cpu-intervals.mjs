// Throwaway probe for research 014-02: how stable is instant CPU from two /proc/<pid>/stat
// samples at 0.5, 1 and 2 s? Samples every Squeal daemon and its marked children of this
// user every 250 ms for DURATION s (read-only), then for each window w compares the reading
// over [t, t+w] with the reading over the centred 10 s around it, in points of one CPU.
import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const DURATION = Number(process.argv[2] ?? 30);
const STEP = 250;
const read = (p) => { try { return readFileSync(p, "latin1"); } catch { return null; } };
function stat(pid) {
  const t = read(`/proc/${pid}/stat`);
  if (t === null) return null;
  const f = t.slice(t.lastIndexOf(")") + 2).split(" ");
  return { ticks: +f[11] + +f[12], start: +f[19] };
}
const uptime = () => Number(read("/proc/uptime").split(" ")[0]);
// Daemons and their marked descendants, chosen once at the start.
const pids = [];
for (const n of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
  const cmd = read(`/proc/${n}/cmdline`) ?? "";
  if (/squeal\.mjs\0daemon\0/.test(cmd)) pids.push({ pid: +n, kind: "daemon" });
  else if ((read(`/proc/${n}/environ`) ?? "").includes("SQUEAL_DAEMON_CHILD=")) pids.push({ pid: +n, kind: "test" });
}
const series = new Map(pids.map((p) => [p.pid, []]));
const load = [loadavg()[0]];
const startAt = Date.now();
while (Date.now() - startAt < DURATION * 1000) {
  const at = uptime();
  for (const { pid } of pids) {
    const s = stat(pid);
    series.get(pid).push(s === null ? null : { at, ...s });
  }
  await sleep(STEP);
}
load.push(loadavg()[0]);
// CPU % of one CPU between samples i and j of one process, null when it changed or left.
const pct = (a, b) => (a && b && a.start === b.start && b.at > a.at ? (100 * (b.ticks - a.ticks)) / 100 / (b.at - a.at) : null);
const result = {};
for (const w of [0.5, 1, 2]) {
  const k = Math.round((w * 1000) / STEP);
  const ref = Math.round(10_000 / STEP);
  const errs = { daemon: [], test: [] };
  const swings = { daemon: [], test: [] };
  for (const { pid, kind } of pids) {
    const s = series.get(pid);
    for (let i = ref / 2; i + k + ref / 2 < s.length; i += k) {
      const v = pct(s[i], s[i + k]);
      const centre = pct(s[i + k / 2 - ref / 2], s[i + k / 2 + ref / 2]);
      const next = pct(s[i + k], s[i + 2 * k]);
      if (v !== null && centre !== null) errs[kind].push(Math.abs(v - centre));
      if (v !== null && next !== null) swings[kind].push(Math.abs(v - next));
    }
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.floor(p * (s.length - 1))].toFixed(1) : null; };
  result[`${w}s`] = Object.fromEntries(
    ["daemon", "test"].map((kind) => [kind, {
      n: errs[kind].length,
      errVs10sMedian: q(errs[kind], 0.5), errVs10sP90: q(errs[kind], 0.9),
      nextSwingMedian: q(swings[kind], 0.5), nextSwingP90: q(swings[kind], 0.9),
    }]),
  );
}
// Lifetime average against the 10 s reading at the end, per daemon.
const life = pids.filter((p) => p.kind === "daemon").map(({ pid }) => {
  const s = series.get(pid);
  const last = s.at(-1), ten = s[s.length - 1 - Math.round(10_000 / STEP)];
  if (!last || !ten || last.start !== ten.start) return null;
  return { pid, last10s: +pct(ten, last).toFixed(1), lifetime: +((100 * last.ticks / 100) / (last.at - last.start / 100)).toFixed(1) };
}).filter(Boolean);
console.log(JSON.stringify({ at: new Date().toISOString(), durationS: DURATION, stepMs: STEP, load1: load, processes: { daemon: pids.filter((p) => p.kind === "daemon").length, test: pids.filter((p) => p.kind === "test").length }, result, life }, null, 1));
