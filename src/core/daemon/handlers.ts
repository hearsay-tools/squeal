import { randomUUID } from "node:crypto";
import {
  type AbsolutePath,
  type CheckpointRecord,
  type DaemonPhase,
  type DaemonResponse,
  type EpochMs,
  PAYLOAD_SCHEMA_VERSION,
  type RevisionNumber,
  type RunAllResponse,
  type RunSlowResponse,
  type SyncResponse,
  type WorktreeId,
} from "../types/index.js";
import { errorResponse } from "./protocol.js";
import { SLOW_NOT_SUPPORTED, type SlowSuiteRequested } from "./run-slow.js";
import type { DaemonHandler } from "./server.js";
import { isNewerVersion } from "./version.js";

/** `run-all`, `run-slow` and `sync` requests remembered for their status requests; older ones are dropped. */
const MAX_REQUESTS = 32;

export interface HandlerContext {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly squealVersion: string;
  readonly startedAt: EpochMs;
  readonly phase: () => DaemonPhase;
  /**
   * Hands a `run --all` to the scheduler once it has started. Never awaited
   * by a handler: the scheduler may be busy with a batch or a runner call.
   */
  readonly requestFullSuite: (force: boolean) => Promise<CheckpointRecord>;
  /**
   * Hands a `run --slow` to the scheduler (spec 004 D2), like
   * `requestFullSuite`. Absent: this daemon has no slow tier.
   */
  readonly requestSlowSuite?: () => Promise<SlowSuiteRequested>;
  /**
   * Runs a reconciliation pass for `status --wait` (lessons, defect 30) and
   * resolves with the worktree's revision once the pass is stored, like
   * `requestFullSuite`. Absent: this daemon answers that it cannot sync.
   */
  readonly requestSync?: () => Promise<RevisionNumber>;
  /** A nudge or a request: the daemon is in use. */
  readonly onActivity: () => void;
  /** Called after the stop answer is built; the shutdown runs after it is sent. */
  readonly onStop: () => void;
  /**
   * A hook at `version`, newer than this daemon, asked it to step down
   * (defect 26). Called after the answer is built, like `onStop`.
   */
  readonly onStepDown: (version: string) => void;
}

interface RunAllState {
  checkpoint: CheckpointRecord | null;
  error: string | null;
}

interface RunSlowState {
  requested: RunSlowResponse["requested"];
  error: string | null;
}

interface SyncState {
  revision: RevisionNumber | null;
  error: string | null;
}

/**
 * Socket request handlers. Every answer comes from memory, so each one fits
 * the hooks' 100 ms socket budget while a tier runs (spec 001 D9). Review
 * wave 2: "never await scheduler work in the socket handler".
 */
export function createHandlers(context: HandlerContext): DaemonHandler {
  const requests = new Map<string, RunAllState>();
  const slowRequests = new Map<string, RunSlowState>();
  const syncRequests = new Map<string, SyncState>();
  const runAll = (requestId: string, state: RunAllState): RunAllResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-all",
    requestId,
    checkpoint: state.checkpoint,
    error: state.error,
  });
  const runSlow = (requestId: string, state: RunSlowState): RunSlowResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-slow",
    requestId,
    requested: state.requested,
    error: state.error,
  });
  const sync = (requestId: string, state: SyncState): SyncResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "sync",
    requestId,
    revision: state.revision,
    error: state.error,
  });

  return (request): DaemonResponse => {
    switch (request.type) {
      case "ping":
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: context.worktreeId,
          root: context.root,
          squealVersion: context.squealVersion,
          phase: context.phase(),
          startedAt: context.startedAt,
        };
      case "nudge":
        context.onActivity();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state: RunAllState = { checkpoint: null, error: null };
        remember(requests, requestId, state);
        context.requestFullSuite(request.force === true).then(
          (checkpoint) => {
            state.checkpoint = checkpoint;
          },
          (error: unknown) => {
            state.error = error instanceof Error ? error.message : String(error);
          },
        );
        return runAll(requestId, state);
      }
      case "run-all-status": {
        const state = requests.get(request.requestId);
        if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
        return runAll(request.requestId, state);
      }
      case "run-slow": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state: RunSlowState = { requested: null, error: null };
        remember(slowRequests, requestId, state);
        const request =
          context.requestSlowSuite?.() ?? Promise.reject(new Error(SLOW_NOT_SUPPORTED));
        request.then(
          (requested) => {
            state.requested = requested;
          },
          (error: unknown) => {
            state.error = error instanceof Error ? error.message : String(error);
          },
        );
        return runSlow(requestId, state);
      }
      case "run-slow-status": {
        const state = slowRequests.get(request.requestId);
        if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
        return runSlow(request.requestId, state);
      }
      case "sync": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestSync === undefined) return errorResponse("this daemon cannot sync");
        const requestId = randomUUID();
        const state: SyncState = { revision: null, error: null };
        remember(syncRequests, requestId, state);
        context.requestSync().then(
          (revision) => {
            state.revision = revision;
          },
          (error: unknown) => {
            state.error = error instanceof Error ? error.message : String(error);
          },
        );
        return sync(requestId, state);
      }
      case "sync-status": {
        const state = syncRequests.get(request.requestId);
        if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
        return sync(request.requestId, state);
      }
      case "stop":
        context.onStop();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
      case "step-down": {
        const steppingDown = isNewerVersion(request.version, context.squealVersion);
        if (steppingDown) context.onStepDown(request.version);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "step-down",
          squealVersion: context.squealVersion,
          steppingDown,
        };
      }
    }
  };
}

function remember<T>(requests: Map<string, T>, requestId: string, state: T): void {
  requests.set(requestId, state);
  for (const old of requests.keys()) {
    if (requests.size <= MAX_REQUESTS) break;
    requests.delete(old);
  }
}
