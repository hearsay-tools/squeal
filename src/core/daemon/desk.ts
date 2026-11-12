import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { RelativePath } from "../types/common.js";
import type { DaemonPhase, SyncAnswer } from "../types/daemon.js";
import type { ImportOutcome, ImportRequest, SentBatch } from "../types/daemon-writes.js";
import type { TestFileRef } from "../types/keys.js";
import type { FullSuiteCheckpoint, FullSuiteRequest } from "../types/scheduler.js";
import type { DeskIdentity, FromDesk, ToDesk } from "./desk-messages.js";
import { createHandlers } from "./handlers.js";
import { GROUP_NOT_SUPPORTED, type GroupRequested, type Held, MainSteps } from "./run-group.js";
import type { SlowSuiteRequested } from "./run-slow.js";
import { createDaemonServer } from "./server.js";

/** The daemon's socket, answering for the main thread. */
export interface FrontDesk {
  setPhase(phase: DaemonPhase): void;
  /**
   * Row 011-302: a step that may block the main thread starts (`running`)
   * or ends, so a pending `run-group` request's answer names it. Told
   * before the step's synchronous work, it reaches the socket's worker
   * while that work blocks the main thread.
   */
  step(operation: string, running: boolean): void;
  /** Closes the socket, which unlinks it while it is still the one bound, and stops the worker. */
  close(): Promise<void>;
}

/** What the front desk hands to the main thread. */
export interface DeskEvents {
  readonly onActivity: () => void;
  /** A hook's nudge (task 001-281); absent: a nudge is only activity. */
  readonly onNudge?: () => void;
  /** `squeal retry` stored or withdrew a request (001-368); absent: it waits in the store. */
  readonly requestRetries?: () => Promise<void>;
  /** A named wait's promotion (spec 011 C15); absent: the daemon answers it cannot promote. */
  readonly requestPromotion?: (
    testFiles: readonly TestFileRef[],
    withinMs: number,
  ) => Promise<void>;
  /** A named wait's focused checks (C15, row 011-145); absent: the daemon answers it cannot focus. */
  readonly requestFocus?: (
    testFiles: readonly TestFileRef[],
    texts: readonly string[],
    withinMs: number,
  ) => Promise<void>;
  readonly requestFullSuite: (request: FullSuiteRequest) => Promise<FullSuiteCheckpoint>;
  readonly requestSlowSuite: () => Promise<SlowSuiteRequested>;
  /**
   * `squeal run <group>` (spec 019 D6); `null` for a group the policy in
   * force does not have. Absent: the daemon answers it cannot run groups.
   * Row 011-302: `held` hears what holds the request until it is taken.
   */
  readonly requestGroup?: (
    group: string,
    held: Held,
    paths?: readonly RelativePath[],
  ) => Promise<GroupRequested | null>;
  /** A `status --wait` reconciliation pass (lessons, defect 30); with `paths`, their readers (row 011-234). */
  readonly requestSync: (paths?: readonly RelativePath[]) => Promise<SyncAnswer>;
  readonly onStop: () => void;
  readonly onStepDown: (version: string) => void;
  /**
   * `squeal hold` (row 011-74): the command holds read again; resolves with
   * whether one holds. Absent: the daemon answers that it cannot hold.
   */
  readonly requestHold?: () => Promise<boolean>;
  /** `squeal hold` ended, or `squeal start`: the command holds read again. */
  readonly requestResume?: () => Promise<void>;
  /**
   * Spec 021 D15 (row 021-16): writes a batch a hook or command sent, in
   * the retried path; rejects with why not. Absent, or without
   * `DeskIdentity.storeSchema`: the daemon answers that it takes no writes.
   */
  readonly requestWrite?: (batch: SentBatch) => Promise<void>;
  /**
   * Spec 021 D15 (row 021-20): imports the export file `squeal import`
   * names, in the retried path. Absent, or without
   * `DeskIdentity.storeSchema`: the daemon answers that it takes no imports.
   */
  readonly requestImport?: (request: ImportRequest) => Promise<ImportOutcome>;
  /** The worker died after it started listening. */
  readonly onFailure: (error: Error) => void;
  /**
   * One of these events threw; the desk caught it and goes on serving
   * (review wave-13ak, B1). Absent: written to stderr.
   */
  readonly onError?: (error: Error) => void;
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
 * socket is served on the main thread instead; a test may name the worker
 * script and the Node options that load it (`worker`).
 */
export function prepareFrontDesk(
  worker: { readonly script: string; readonly execArgv?: readonly string[] } | null = null,
): PreparedDesk {
  const script = worker?.script ?? frontDeskScript(new URL(import.meta.url));
  if (script === null) {
    return { open: (identity, events) => inThread(identity, guarded(events)), discard: () => {} };
  }
  const execArgv = worker?.execArgv;
  return started(new Worker(script, execArgv === undefined ? {} : { execArgv: [...execArgv] }));
}

function started(worker: Worker): PreparedDesk {
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
      return inWorker(worker, identity, guarded(events));
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

/**
 * The events with every callback caught (review wave-13ak, B1): a throw in
 * the worker's message listener on the main thread is uncaught and ends the
 * daemon. A request's synchronous throw becomes its rejection, and so its
 * error answer.
 */
export function guarded(events: DeskEvents): DeskEvents {
  const report =
    events.onError ??
    ((error: Error) => process.stderr.write(`squeal front desk: ${error.message}\n`));
  const caught = (error: unknown) => {
    try {
      report(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // Reporting is best effort; the desk serves on.
    }
  };
  const safe =
    <A extends unknown[]>(call: (...args: A) => void) =>
    (...args: A): void => {
      try {
        call(...args);
      } catch (error) {
        caught(error);
      }
    };
  const asked =
    <A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      try {
        return call(...args);
      } catch (error) {
        return Promise.reject(error);
      }
    };
  const {
    onNudge,
    requestRetries,
    requestPromotion,
    requestFocus,
    requestGroup,
    requestHold,
    requestResume,
    requestWrite,
    requestImport,
  } = events;
  return {
    onActivity: safe(events.onActivity),
    ...(onNudge === undefined ? {} : { onNudge: safe(onNudge) }),
    ...(requestRetries === undefined ? {} : { requestRetries: asked(requestRetries) }),
    ...(requestPromotion === undefined ? {} : { requestPromotion: asked(requestPromotion) }),
    ...(requestFocus === undefined ? {} : { requestFocus: asked(requestFocus) }),
    requestFullSuite: asked(events.requestFullSuite),
    requestSlowSuite: asked(events.requestSlowSuite),
    ...(requestGroup === undefined ? {} : { requestGroup: asked(requestGroup) }),
    requestSync: asked(events.requestSync),
    ...(requestHold === undefined ? {} : { requestHold: asked(requestHold) }),
    ...(requestResume === undefined ? {} : { requestResume: asked(requestResume) }),
    ...(requestWrite === undefined ? {} : { requestWrite: asked(requestWrite) }),
    ...(requestImport === undefined ? {} : { requestImport: asked(requestImport) }),
    onStop: safe(events.onStop),
    onStepDown: safe(events.onStepDown),
    onFailure: safe(events.onFailure),
    onError: caught,
  };
}

const NO_WRITES = "this daemon takes no writes";
const NO_IMPORTS = "this daemon takes no imports";

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
        case "nudge":
          events.onNudge?.();
          return;
        case "retry":
          events.requestRetries?.().catch(() => {});
          return;
        case "promote":
          events.requestPromotion?.(message.testFiles, message.withinMs).catch(() => {});
          return;
        case "focus":
          events.requestFocus?.(message.testFiles, message.texts, message.withinMs).catch(() => {});
          return;
        case "run-all":
          events.requestFullSuite(message.request).then(
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
        case "run-slow":
          events.requestSlowSuite().then(
            (requested) =>
              post({ type: "run-slow-result", id: message.id, requested, error: null }),
            (error: unknown) =>
              post({
                type: "run-slow-result",
                id: message.id,
                requested: null,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          return;
        case "run-group": {
          // Row 011-302: posted only while the request waits; the daemon stops telling once taken.
          const held: Held = (holder) => post({ type: "run-group-held", id: message.id, holder });
          (
            events.requestGroup?.(message.group, held, message.paths) ??
            Promise.reject(new Error(GROUP_NOT_SUPPORTED))
          ).then(
            (requested) =>
              post({ type: "run-group-result", id: message.id, requested, error: null }),
            (error: unknown) =>
              post({
                type: "run-group-result",
                id: message.id,
                requested: null,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          return;
        }
        case "sync":
          events.requestSync(message.paths).then(
            (answer) => post({ type: "sync-result", id: message.id, answer, error: null }),
            (error: unknown) =>
              post({
                type: "sync-result",
                id: message.id,
                answer: null,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          return;
        case "hold":
          (events.requestHold?.() ?? Promise.reject(new Error("this daemon cannot hold"))).then(
            (holding) => post({ type: "hold-result", id: message.id, holding, error: null }),
            (error: unknown) =>
              post({
                type: "hold-result",
                id: message.id,
                holding: null,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          return;
        case "resume":
          events.requestResume?.().catch(() => {});
          return;
        case "write":
          (events.requestWrite?.(message.batch) ?? Promise.reject(new Error(NO_WRITES))).then(
            () => post({ type: "write-result", id: message.id, error: null }),
            (error: unknown) =>
              post({
                type: "write-result",
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          return;
        case "import":
          (events.requestImport?.(message.request) ?? Promise.reject(new Error(NO_IMPORTS))).then(
            (outcome) => post({ type: "import-result", id: message.id, outcome }),
            (error: unknown) =>
              post({
                type: "import-result",
                id: message.id,
                outcome: { failed: error instanceof Error ? error.message : String(error) },
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
    step: (operation, running) =>
      post({ type: "main-step", operation, since: running ? Date.now() : null }),
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
  const steps = new MainSteps();
  const server = await createDaemonServer(
    identity.socketPath,
    createHandlers({
      worktreeId: identity.worktreeId,
      root: identity.root,
      squealVersion: identity.squealVersion,
      startedAt: identity.startedAt,
      token: identity.token,
      phase: () => phase,
      requestFullSuite: events.requestFullSuite,
      requestSlowSuite: events.requestSlowSuite,
      ...(events.requestGroup === undefined ? {} : { requestGroup: events.requestGroup }),
      mainStep: () => steps.current(),
      requestSync: events.requestSync,
      ...(events.requestHold === undefined ? {} : { requestHold: events.requestHold }),
      ...(events.requestResume === undefined ? {} : { requestResume: events.requestResume }),
      onActivity: events.onActivity,
      ...(events.onNudge === undefined ? {} : { onNudge: events.onNudge }),
      ...(events.requestRetries === undefined ? {} : { requestRetries: events.requestRetries }),
      ...(events.requestPromotion === undefined
        ? {}
        : { requestPromotion: events.requestPromotion }),
      ...(events.requestFocus === undefined ? {} : { requestFocus: events.requestFocus }),
      onStop: events.onStop,
      onStepDown: events.onStepDown,
      ...(events.requestWrite === undefined || identity.storeSchema === undefined
        ? {}
        : { requestWrite: events.requestWrite, storeSchema: identity.storeSchema }),
      ...(events.requestImport === undefined || identity.storeSchema === undefined
        ? {}
        : { requestImport: events.requestImport, storeSchema: identity.storeSchema }),
    }),
  );
  return {
    setPhase: (next) => {
      phase = next;
    },
    step: (operation, running) => steps.set(operation, running ? Date.now() : null),
    close: () => server.close(),
  };
}
