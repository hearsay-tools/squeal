import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { CheckpointRecord, DaemonPhase } from "../types/index.js";
import type { DeskIdentity, FromDesk, ToDesk } from "./desk-messages.js";
import { createHandlers } from "./handlers.js";
import { createDaemonServer } from "./server.js";

/** The daemon's socket, answering for the main thread. */
export interface FrontDesk {
  setPhase(phase: DaemonPhase): void;
  /** Closes the socket, which unlinks it while it is still the one bound, and stops the worker. */
  close(): Promise<void>;
}

/** What the front desk hands to the main thread. */
export interface DeskEvents {
  readonly onActivity: () => void;
  readonly requestFullSuite: (force: boolean) => Promise<CheckpointRecord>;
  readonly onStop: () => void;
  readonly onStepDown: (version: string) => void;
  /** The worker died after it started listening. */
  readonly onFailure: (error: Error) => void;
}

/** A front desk worker booting while the daemon takes its lock. */
export interface PreparedDesk {
  /** Binds the socket. The caller must hold the worktree lock: a stale socket file is removed first. */
  open(identity: DeskIdentity, events: DeskEvents): Promise<FrontDesk>;
  /** This process lost the lock or failed before binding. */
  discard(): void;
}

/**
 * Starts the worker thread that will serve the daemon socket, so answers do
 * not wait for the main thread. Loading Vitest blocks the main thread for
 * about 150 ms right after the socket is bound, and Vite transforms and store
 * writes block it later; a ping must still answer within the hooks' 100 ms
 * (spec 001 D9) and a replacement daemon must serve soon after its spawn
 * (D10). The worker boots (about 50 ms) while the main thread asks git,
 * opens the store and takes the lock.
 *
 * Run from TypeScript sources, where no compiled worker script exists, the
 * socket is served on the main thread instead.
 */
export function prepareFrontDesk(): PreparedDesk {
  const script = frontDeskScript(new URL(import.meta.url));
  if (script === null) {
    return { open: (identity, events) => inThread(identity, events), discard: () => {} };
  }
  const worker = new Worker(script);
  // A worker that dies before `open` fails it; a discarded worker's errors do not matter.
  const early: Error[] = [];
  const onError = (error: Error) => early.push(error);
  const onExit = (code: number) => early.push(new Error(`socket worker exited with code ${code}`));
  worker.on("error", onError);
  worker.on("exit", onExit);
  return {
    open: (identity, events) => {
      worker.off("error", onError);
      worker.off("exit", onExit);
      if (early[0] !== undefined) return Promise.reject(early[0]);
      return inWorker(worker, identity, events);
    },
    discard: () => void worker.terminate(),
  };
}

/**
 * The socket worker beside `module`: `front-desk.js` in the `tsc` build,
 * `front-desk.mjs` beside the plugin's CLI bundle (review wave 3, B1).
 * `null` from the TypeScript sources.
 */
export function frontDeskScript(module: URL): string | null {
  for (const name of ["./front-desk.js", "./front-desk.mjs"]) {
    const script = fileURLToPath(new URL(name, module));
    if (existsSync(script)) return script;
  }
  return null;
}

async function inWorker(
  worker: Worker,
  identity: DeskIdentity,
  events: DeskEvents,
): Promise<FrontDesk> {
  const post = (message: ToDesk) => worker.postMessage(message);
  let listening = false;
  let closing = false;
  let closed: (() => void) | null = null;
  const listen = new Promise<void>((resolve, reject) => {
    worker.on("message", (message: FromDesk) => {
      switch (message.type) {
        case "listening":
          listening = true;
          resolve();
          return;
        case "failed":
          reject(new Error(message.error));
          return;
        case "activity":
          events.onActivity();
          return;
        case "run-all":
          events.requestFullSuite(message.force).then(
            (checkpoint) =>
              post({ type: "run-all-result", id: message.id, checkpoint, error: null }),
            (error: unknown) =>
              post({
                type: "run-all-result",
                id: message.id,
                checkpoint: null,
                error: String(error),
              }),
          );
          return;
        case "stop":
          events.onStop();
          return;
        case "step-down":
          events.onStepDown(message.version);
          return;
        case "closed":
          closed?.();
          return;
      }
    });
    const died = (error: Error) => {
      if (!listening) reject(error);
      else if (!closing) events.onFailure(error);
      closed?.();
    };
    worker.on("error", died);
    worker.on("exit", (code) => died(new Error(`socket worker exited with code ${code}`)));
    post({ type: "bind", identity });
  });
  try {
    await listen;
  } catch (error) {
    closing = true;
    await worker.terminate();
    throw error;
  }
  return {
    setPhase: (phase) => post({ type: "phase", phase }),
    async close() {
      if (closing) return;
      closing = true;
      await new Promise<void>((resolve) => {
        closed = resolve;
        post({ type: "close" });
      });
      await worker.terminate();
    },
  };
}
async function inThread(identity: DeskIdentity, events: DeskEvents): Promise<FrontDesk> {
  let phase: DaemonPhase = "starting";
  const server = await createDaemonServer(
    identity.socketPath,
    createHandlers({
      worktreeId: identity.worktreeId,
      root: identity.root,
      squealVersion: identity.squealVersion,
      startedAt: identity.startedAt,
      phase: () => phase,
      requestFullSuite: events.requestFullSuite,
      onActivity: events.onActivity,
      onStop: events.onStop,
      onStepDown: events.onStepDown,
    }),
  );
  return {
    setPhase: (next) => {
      phase = next;
    },
    close: () => server.close(),
  };
}
