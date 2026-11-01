// Throwaway: can oxlint's own CLI entry run in a worker thread of a daemon
// whose cwd is not the project root? Prints where the output went.
import { Worker, isMainThread, workerData } from "node:worker_threads";
if (isMainThread) {
  const [root, ...args] = process.argv.slice(2);
  const w = new Worker(new URL(import.meta.url), { workerData: root, argv: args, stdout: true, stderr: true });
  let captured = "";
  w.stdout.on("data", (d) => (captured += d));
  w.stderr.on("data", (d) => (captured += d));
  w.on("exit", (c) => console.error(`[main] worker exit ${c}; worker.stdout captured ${captured.length} bytes; main cwd ${process.cwd()}; exitCode ${process.exitCode}`));
} else {
  await import(workerData + "/node_modules/oxlint/dist/cli.js");
}
