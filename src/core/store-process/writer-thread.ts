import { parentPort, workerData } from "node:worker_threads";
import { logLongWrites, longWriteLine } from "../store/long-write.js";
import type { AbsolutePath } from "../types/common.js";
import { openWriteConnection, runJob, type WriteJob } from "./writer.js";

/*
 * Spec 021 D22.3 (row 021-36): the store process's writer thread. It holds
 * the file's only regular write connection and runs one job at a time, as
 * the main thread hands them out of its queue.
 */

const port = parentPort;
if (port !== null) {
  const { commonDir } = workerData as { readonly commonDir: AbsolutePath };
  // D3 (review of 0.1.571): a write that holds the lock past 250 ms is a line in the store process's log.
  logLongWrites((write) =>
    port.postMessage({ type: "log", line: `store process: ${longWriteLine(write)}` }),
  );
  const opened = openWriteConnection(commonDir);
  port.postMessage({
    type: "ready",
    ready: typeof opened === "string" ? { failed: opened } : { schema: opened.schema },
  });
  port.on("message", (message: { readonly id?: number; readonly job?: WriteJob; close?: true }) => {
    if (message.close === true) {
      if (typeof opened !== "string") opened.close();
      port.close();
      return;
    }
    const { id, job } = message;
    if (id === undefined || job === undefined) return;
    try {
      if (typeof opened === "string") throw new Error(opened);
      port.postMessage({ type: "done", id, end: runJob(opened.writer, job, opened.schema) });
    } catch (error) {
      port.postMessage({ type: "failed", id, error: String(error) });
    }
  });
}
