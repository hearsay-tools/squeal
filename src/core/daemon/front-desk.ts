import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import type { CheckpointRecord, DaemonPhase, RevisionNumber } from "../types/index.js";
import type { DeskIdentity, FromDesk, ToDesk } from "./desk-messages.js";
import { createHandlers } from "./handlers.js";
import type { SlowSuiteRequested } from "./run-slow.js";
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

const waitingSlow = new Map<
  string,
  { resolve: (requested: SlowSuiteRequested) => void; reject: (error: Error) => void }
>();

const waitingSync = new Map<
  string,
  { resolve: (revision: RevisionNumber) => void; reject: (error: Error) => void }
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
    requestSlowSuite: () =>
      new Promise((resolve, reject) => {
        const id = randomUUID();
        waitingSlow.set(id, { resolve, reject });
        post({ type: "run-slow", id });
      }),
    requestSync: () =>
      new Promise((resolve, reject) => {
        const id = randomUUID();
        waitingSync.set(id, { resolve, reject });
        post({ type: "sync", id });
      }),
    onActivity: () => post({ type: "activity" }),
    onStop: () => post({ type: "stop" }),
    onStepDown: (version) => post({ type: "step-down", version }),
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
    case "run-slow-result": {
      const entry = waitingSlow.get(message.id);
      waitingSlow.delete(message.id);
      if (message.requested !== null) entry?.resolve(message.requested);
      else entry?.reject(new Error(message.error ?? "run --slow failed"));
      return;
    }
    case "sync-result": {
      const entry = waitingSync.get(message.id);
      waitingSync.delete(message.id);
      if (message.revision !== null) entry?.resolve(message.revision);
      else entry?.reject(new Error(message.error ?? "sync failed"));
      return;
    }
    case "close":
      phase = "stopping";
      void (server?.close() ?? Promise.resolve()).then(() => post({ type: "closed" }));
      return;
  }
});
