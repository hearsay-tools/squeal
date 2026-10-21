// Throwaway probe for research 014-02: smaps_rollup of every Squeal process, serial against
// split across 4 worker threads. Read-only.
import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
const read = (p) => { try { return readFileSync(p, "latin1"); } catch { return null; } };
const ours = readdirSync("/proc").filter((n) => /^\d+$/.test(n)).filter((n) => /squeal\.mjs\0daemon\0/.test(read(`/proc/${n}/cmdline`) ?? "") || (read(`/proc/${n}/environ`) ?? "").includes("SQUEAL_DAEMON_CHILD="));
const body = `const { workerData, parentPort } = require("node:worker_threads"); const fs = require("node:fs");
const c0 = process.cpuUsage(); for (const n of workerData) { try { fs.readFileSync("/proc/" + n + "/smaps_rollup"); } catch {} }
const c = process.cpuUsage(c0); parentPort.postMessage((c.user + c.system) / 1000);`;
for (let r = 0; r < 2; r++) {
  let t0 = performance.now(); const c0 = process.cpuUsage();
  for (const n of ours) read(`/proc/${n}/smaps_rollup`);
  const c = process.cpuUsage(c0);
  const serial = { wallMs: +(performance.now() - t0).toFixed(0), cpuMs: +((c.user + c.system) / 1000).toFixed(0) };
  t0 = performance.now(); const p0 = process.cpuUsage();
  const parts = [0, 1, 2, 3].map((i) => ours.filter((_, j) => j % 4 === i));
  const cpus = await Promise.all(parts.map((part) => new Promise((done) => new Worker(body, { eval: true, workerData: part }).once("message", done))));
  // process.cpuUsage() is process-wide (RUSAGE_SELF), in a worker too: read once around all four.
  const p = process.cpuUsage(p0);
  console.log(JSON.stringify({ load1: loadavg()[0], processes: ours.length, serial, fourThreads: { wallMs: +(performance.now() - t0).toFixed(0), processCpuMs: +((p.user + p.system) / 1000).toFixed(0), workersSeen: cpus.length } }));
}
