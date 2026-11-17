// Row 009-30: records what Pi and its delivery worker thread do, so an idle-wake timeout can
// name the step that lost the wake. `wakeTrace()` (`pi-wake-trace.ts`) loads it into Pi with
// `NODE_OPTIONS=--import=...` and names the file in `SQUEAL_PI_TRACE`. It only records: it
// adds an `exit` listener, wraps `write` on stdout and stderr (of stderr, only each write's
// size: its text is not recorded, so it is not on disk either), the worker's `postMessage` and
// message listeners, and the `emit` of each `Worker` the main thread makes, and each wrapper
// calls the original unchanged. Node loads it into worker threads too (Node 22, 24 and 26).
// Each process the test starts with it records, with its own pid (`pi install`, then Pi), and
// its threads: a Node child (the daemon, the CLI) inherits `SQUEAL_PI_TRACE_PID` and stays out.

import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import workerThreads, { isMainThread, parentPort, threadId } from "node:worker_threads";

const file = process.env.SQUEAL_PI_TRACE;
const owner = process.env.SQUEAL_PI_TRACE_PID;
const active =
  typeof file === "string" &&
  file !== "" &&
  (isMainThread ? owner === undefined : owner === String(process.pid));

if (active) {
  const note = (kind, data = {}) => {
    try {
      const line = { t: Date.now(), pid: process.pid, thread: threadId, kind, ...data };
      appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {
      // Recording never fails the process it watches.
    }
  };
  const text = (chunk) => (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
  const tap = (stream, observe) => {
    const write = stream.write;
    stream.write = function (chunk, ...rest) {
      try {
        observe(text(chunk));
      } catch {
        // As above.
      }
      return write.call(this, chunk, ...rest);
    };
  };

  if (isMainThread) {
    process.env.SQUEAL_PI_TRACE_PID = String(process.pid);
    // Only the first argument, Pi's subcommand (`install`) or a flag: the script path names
    // a home directory.
    note("start", { arg: process.argv[2] ?? null });
    process.on("exit", (code) => note("exit", { code }));
    // The host sees a worker end even when `terminate()` stops it before its own `exit`
    // listener runs. Wrapping `emit` adds no listener, so delivery and `ref` stay unchanged.
    const Original = workerThreads.Worker;
    workerThreads.Worker = class Worker extends Original {
      constructor(...args) {
        super(...args);
        const worker = this.threadId;
        const emit = this.emit;
        this.emit = function (event, ...rest) {
          if (event === "exit") note("worker-ended", { worker, code: rest[0] });
          if (event === "error") note("worker-error", { worker, error: String(rest[0]?.name) });
          return emit.call(this, event, ...rest);
        };
      }
    };
    syncBuiltinESMExports();
    let partial = "";
    tap(process.stdout, (chunk) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const { type, command, id } = JSON.parse(line);
          if (typeof type === "string") note("event", { type, command, id });
        } catch {
          // Not an RPC line.
        }
      }
    });
    // Sizes and times only: stderr text could hold a path or a secret (row 009-30).
    tap(process.stderr, (chunk) => note("stderr", { bytes: Buffer.byteLength(chunk) }));
  } else if (parentPort !== null) {
    const port = parentPort;
    note("worker-start");
    process.on("exit", (code) => note("worker-exit", { code }));
    const post = port.postMessage;
    port.postMessage = function (message, ...rest) {
      const answer = message?.answer;
      const shape = answer === null ? null : typeof answer === "string" ? "text" : typeof answer;
      note("worker-out", { id: message?.id, ok: message?.ok, held: message?.held, answer: shape });
      return post.call(this, message, ...rest);
    };
    // Wraps the worker's own listener rather than adding one: an earlier listener would start
    // the port and could take messages the worker's code has not yet subscribed to.
    // The worker subscribes with `on` (`serve`, `src/harness/pi/worker.ts`).
    const subscribe = port.on;
    port.on = function (event, listener, ...rest) {
      if (event !== "message" || typeof listener !== "function") {
        return subscribe.call(this, event, listener, ...rest);
      }
      const traced = function (message, ...args) {
        const cancel = message?.cancel;
        const request = cancel === undefined ? message?.request?.kind : "cancel";
        note("worker-in", { id: message?.id ?? cancel, request });
        return listener.call(this, message, ...args);
      };
      return subscribe.call(this, event, traced, ...rest);
    };
  }
}
