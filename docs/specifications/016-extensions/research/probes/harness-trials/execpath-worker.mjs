// Throwaway probe (016-35): run under OMP's Bun (BUN_BE_BUN=1 omp <this>).
// Shows whether an assignment to process.execPath on the main thread reaches
// a worker_threads worker, where Squeal's Pi worker spawns the daemon.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const before = process.execPath;
  try { process.execPath = "/opt/squeal-e2e/node24/bin/node"; } catch (e) { console.log("assign threw", e.message); }
  console.log("main before", before, "after", process.execPath);
  const w = new Worker(new URL(import.meta.url));
  w.on("message", (m) => { console.log("worker sees", m); w.terminate(); });
} else {
  parentPort.postMessage(process.execPath);
}
