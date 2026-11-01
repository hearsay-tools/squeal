#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as agent; reads /proc only.
//   node sampler.mjs <out.jsonl> <clone path> [interval ms, default 250]
// Every interval: the Squeal daemon of <clone path> (a squeal-e2e process whose command line
// ends with `daemon <clone path>`), each of its threads' CPU (utime + stime, in ticks of
// 1/100 s), name and start time, and the process's VmRSS and VmHWM. A line is written for each
// sample in which a thread's CPU moved or a thread appeared, and every 5 s regardless.
// Also the one-minute load. Stops on SIGTERM or SIGINT.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";

const [out, clone, every0] = process.argv.slice(2);
if (!out || !clone) {
  console.error("usage: sampler.mjs <out.jsonl> <clone path> [interval ms]");
  process.exit(2);
}
const every = Number(every0 ?? 250);
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const findDaemon = () => {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    const cmd = read(`/proc/${pid}/cmdline`);
    if (!cmd) continue;
    const args = cmd.split("\0").filter(Boolean);
    const i = args.lastIndexOf("daemon");
    if (i >= 0 && args[i + 1] === clone) return Number(pid);
  }
  return null;
};
const threads = (pid) => {
  const rows = {};
  let names;
  try {
    names = readdirSync(`/proc/${pid}/task`);
  } catch {
    return null;
  }
  for (const tid of names) {
    const stat = read(`/proc/${pid}/task/${tid}/stat`);
    if (!stat) continue;
    const close = stat.lastIndexOf(")");
    const comm = stat.slice(stat.indexOf("(") + 1, close);
    const f = stat.slice(close + 2).split(" ");
    // fields after comm: f[0] is field 3 (state); utime is field 14, stime 15, starttime 22.
    rows[tid] = { comm, cpu: Number(f[11]) + Number(f[12]), start: Number(f[19]) };
  }
  return rows;
};
const mem = (pid) => {
  const s = read(`/proc/${pid}/status`) ?? "";
  const kb = (k) => Number((s.match(new RegExp(`${k}:\\s+(\\d+)`)) ?? [])[1] ?? NaN);
  return { rssKb: kb("VmRSS"), hwmKb: kb("VmHWM") };
};
let pid = null;
let last = {};
let lastWrite = 0;
let stop = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (stop = true));
while (!stop) {
  const t = Date.now();
  if (pid === null || read(`/proc/${pid}/stat`) === null) {
    const found = findDaemon();
    if (found !== pid) {
      appendFileSync(out, `${JSON.stringify({ t, daemon: found })}\n`);
      pid = found;
      last = {};
    }
  }
  if (pid !== null) {
    const now = threads(pid);
    if (now) {
      const moved = {};
      for (const [tid, row] of Object.entries(now)) {
        const was = last[tid];
        if (!was || was.cpu !== row.cpu) moved[tid] = was ? { cpu: row.cpu } : row;
      }
      if (Object.keys(moved).length > 0 || t - lastWrite >= 5000) {
        const load1 = Number(read("/proc/loadavg").split(" ")[0]);
        appendFileSync(out, `${JSON.stringify({ t, pid, load1, ...mem(pid), moved })}\n`);
        lastWrite = t;
      }
      last = now;
    }
  }
  await new Promise((r) => setTimeout(r, every));
}
