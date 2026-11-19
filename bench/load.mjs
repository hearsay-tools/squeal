#!/usr/bin/env node
// Ambient CPU load: keeps `percent` of the machine's vCPUs busy with plain
// busy loops at normal priority, the way another agent's build or test run
// would. Usage: node load.mjs <percent>. Stops on SIGTERM or SIGINT.
import { availableParallelism } from "node:os";
import { isMainThread, Worker } from "node:worker_threads";

if (isMainThread) {
  const percent = Number(process.argv[2] ?? 0);
  const n = Math.round((availableParallelism() * percent) / 100);
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(new Worker(new URL(import.meta.url)));
  const stop = () => {
    for (const w of workers) w.terminate();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(JSON.stringify({ percent, threads: n }));
  if (n === 0) setInterval(() => {}, 1 << 30);
} else {
  let x = 0;
  for (;;) x = (x * 1103515245 + 12345) % 2147483648;
}
