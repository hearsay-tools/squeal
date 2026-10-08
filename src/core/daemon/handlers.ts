import { randomUUID } from "node:crypto";
import {
  type AbsolutePath,
  type CheckpointRecord,
  type DaemonPhase,
  type DaemonResponse,
  type EpochMs,
  PAYLOAD_SCHEMA_VERSION,
  type RunAllResponse,
  type WorktreeId,
} from "../types/index.js";
import { errorResponse } from "./protocol.js";
import type { DaemonHandler } from "./server.js";
import { isNewerVersion } from "./version.js";

/** `run-all` requests remembered for `run-all-status`; older ones are dropped. */
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

/**
 * Socket request handlers. Every answer comes from memory, so each one fits
 * the hooks' 100 ms socket budget while a tier runs (spec 001 D9). Review
 * wave 2: "never await scheduler work in the socket handler".
 */
export function createHandlers(context: HandlerContext): DaemonHandler {
  const requests = new Map<string, RunAllState>();
  const runAll = (requestId: string, state: RunAllState): RunAllResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-all",
    requestId,
    checkpoint: state.checkpoint,
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
        requests.set(requestId, state);
        for (const old of requests.keys()) {
          if (requests.size <= MAX_REQUESTS) break;
          requests.delete(old);
        }
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
