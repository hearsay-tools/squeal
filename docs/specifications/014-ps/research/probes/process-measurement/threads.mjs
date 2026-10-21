// Throwaway probe for research 014-02: are a Node process's worker threads told apart in
// /proc/<pid>/task? Starts three workers (two unnamed, as Vitest 4.1.10's threads pool
// makes them, one named), keeps one unnamed worker busy, then lists each task's comm and
// CPU ticks. Touches no other process.
import { readdirSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { setTimeout as sleep } from "node:timers/promises";

const busy = "const end = Date.now() + 2500; while (Date.now() < end) {}; setInterval(() => {}, 1000)";
const idle = "setInterval(() => {}, 1000)";
const workers = [
  new Worker(busy, { eval: true, env: { MARK: "a" } }),
  new Worker(idle, { eval: true }),
  new Worker(idle, { eval: true, name: "squeal-probe" }),
];
await sleep(2000);
for (const tid of readdirSync(`/proc/${process.pid}/task`)) {
  const stat = readFileSync(`/proc/${process.pid}/task/${tid}/stat`, "latin1");
  const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = +f[11] + +f[12];
  if (ticks > 0 || comm !== "node") console.log(tid, JSON.stringify(comm), "ticks", ticks);
}
const environ = readFileSync(`/proc/${process.pid}/environ`, "latin1");
console.log("worker env MARK in /proc/<pid>/environ:", environ.includes("MARK=a"));
for (const w of workers) await w.terminate();
