import { readFileSync } from "node:fs";
import { workerData } from "node:worker_threads";

const { port, done } = workerData;
port.on("message", (file) => {
  port.postMessage(readFileSync(file, "utf8"));
  Atomics.store(done, 0, 1);
  Atomics.notify(done, 0);
});
