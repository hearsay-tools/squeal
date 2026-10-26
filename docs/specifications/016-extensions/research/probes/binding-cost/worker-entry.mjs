// Throwaway probe for 016-34: the in-process binding moved to a worker
// thread (plugin-mechanisms.md recommendation 2). Messages are structured
// clones, not JSON.
import { parentPort, workerData } from "node:worker_threads";
import { createProvider } from "./provider.mjs";

const provider = createProvider(workerData);
parentPort.on("message", async ({ id, method, params }) => {
  try {
    parentPort.postMessage({ id, result: await provider[method](...params) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
