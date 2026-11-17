// Throwaway probe (see README.md): the bundled delivery worker, with the answer to one
// request kind posted late, as a worker that misses its deadline under load would.
import { parentPort, workerData } from "node:worker_threads";

const { real, delayKind, delayMs, exitOn, log } = workerData;
const kinds = new Map();
parentPort.on("message", (message) => {
  if ("cancel" in message) log.postMessage({ at: performance.now(), cancel: message.cancel });
  else {
    kinds.set(message.id, message.request.kind);
    // In a worker thread, process.exit ends the thread only: the worker dies with the request.
    if (message.request.kind === exitOn) process.exit(1);
  }
});
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message) => {
  const kind = kinds.get(message.id);
  log.postMessage({ at: performance.now(), answer: kind, ok: message.ok, value: message.answer ?? null });
  if (kind === delayKind) setTimeout(() => post(message), delayMs);
  else post(message);
};
await import(real);
