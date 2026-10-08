// Task 001-143 evidence, not product code. A timing preload: with
// SQUEAL143_STAMP=<dir>, each process appends one line at exit to
// <dir>/<pid>.json: argv, wall from process start (performance.timeOrigin) to
// exit, CPU, context switches, and when its first user module began (preload
// time). Loaded ahead of the recorder so it times the recorder's own preload.
"use strict";
const dir = process.env.SQUEAL143_STAMP;
const { isMainThread } = require("node:worker_threads");
if (dir && isMainThread) {
  const fs = require("node:fs");
  const { performance } = require("node:perf_hooks");
  const write = fs.writeFileSync;
  const t0 = performance.timeOrigin;
  const preloaded = performance.now();
  let firstTick;
  setImmediate(() => { firstTick = performance.now(); }).unref();
  process.on("exit", () => {
    try {
      const r = process.resourceUsage();
      write(`${dir}/${process.pid}.json`, JSON.stringify({
        pid: process.pid, ppid: process.ppid, argv: process.argv.slice(1, 5).join(" "),
        start: t0, preloadedMs: preloaded, firstTickMs: firstTick, wallMs: performance.now(),
        cpuMs: (r.userCPUTime + r.systemCPUTime) / 1000, vcs: r.voluntaryContextSwitches, ics: r.involuntaryContextSwitches,
        elu: performance.eventLoopUtilization(),
      }) + "\n");
    } catch {}
  });
}
