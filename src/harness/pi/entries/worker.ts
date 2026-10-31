import { parentPort, workerData } from "node:worker_threads";
import { serve, verdictsOf, workerDeps } from "../worker.js";

// The delivery worker (spec 009 D4), bundled as `dist/worker.mjs`.
if (parentPort !== null) {
  serve(parentPort, workerDeps(new URL(import.meta.url)), verdictsOf(workerData));
}
