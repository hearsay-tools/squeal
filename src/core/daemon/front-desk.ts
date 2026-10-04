import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import type { CheckpointRecord, DaemonPhase } from "../types/index.js";
import type { DeskIdentity, FromDesk, ToDesk } from "./desk-messages.js";
import { createHandlers } from "./handlers.js";
import { createDaemonServer, type DaemonServer } from "./server.js";

/*
 * Worker thread entry of the daemon's socket (see `desk.ts`). Answers every
 * request from its own memory, so the main thread's module loading, Vite
 * transforms and store writes never delay an answer past the hooks' 100 ms
 * budget (spec 001 D9). Work for the scheduler is posted to the main thread.
 */

const port = parentPort;
if (port === null) throw new Error("squeal front desk: not a worker thread");
const post = (message: FromDesk) => port.postMessage(message);
let phase: DaemonPhase = "starting";
const waiting = new Map<
  string,
  { resolve: (checkpoint: CheckpointRecord) => void; reject: (error: Error) => void }
>();

let server: DaemonServer | null = null;

/** Started before the main thread holds the lock; binds only when told to. */
function bind(identity: DeskIdentity): void {
  const handle = createHandlers({
    worktreeId: identity.worktreeId,
    root: identity.root,
    squealVersion: identity.squealVersion,
    startedAt: identity.startedAt,
    phase: () => phase,
    requestFullSuite: (force) =>
      new Promise((resolve, reject) => {
        const id = randomUUID();
        waiting.set(id, { resolve, reject });
        post({ type: "run-all", id, force });
      }),
    onActivity: () => post({ type: "activity" }),
    onStop: () => post({ type: "stop" }),
  });
  createDaemonServer(identity.socketPath, handle).then(
    (bound) => {
      server = bound;
      post({ type: "listening" });
    },
    (error: unknown) => post({ type: "failed", error: String(error) }),
  );
}

port.on("message", (message: ToDesk) => {
  switch (message.type) {
    case "bind":
      bind(message.identity);
      return;
    case "phase":
      phase = message.phase;
      return;
    case "run-all-result": {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.checkpoint !== null) entry?.resolve(message.checkpoint);
      else entry?.reject(new Error(message.error ?? "run --all failed"));
      return;
    }
    case "close":
      phase = "stopping";
      void (server?.close() ?? Promise.resolve()).then(() => post({ type: "closed" }));
      return;
  }
});
