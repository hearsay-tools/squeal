// Host loads the plugin in a worker thread; a timeout terminates the worker.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
if (isMainThread) {
  const mode = process.argv[2];
  const w = new Worker(new URL(import.meta.url), { workerData: mode });
  const t = setTimeout(async () => { console.log('[host] timeout: terminating worker'); await w.terminate(); }, 500);
  w.on('message', (m) => { console.log(`[host] plugin returned ${m}`); clearTimeout(t); w.terminate(); });
  w.on('error', (e) => { console.log(`[host] worker error event: ${e.message}`); clearTimeout(t); });
  w.on('exit', (c) => console.log(`[host] worker exit code ${c}; host [1].includes(2) = ${[1].includes(2)}`));
} else {
  const { check } = await import('./plugin.mjs');
  parentPort.postMessage(String(await check(workerData)));
}
