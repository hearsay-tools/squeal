import { randomUUID } from "node:crypto";
import {
  type AbsolutePath,
  type DaemonPhase,
  type DaemonResponse,
  daemonIncarnation,
  type EpochMs,
  type FullSuiteCheckpoint,
  type FullSuiteRequest,
  type HoldResponse,
  PAYLOAD_SCHEMA_VERSION,
  type RelativePath,
  type RevisionNumber,
  type RunAllResponse,
  type RunSlowResponse,
  type SyncAnswer,
  type SyncReaders,
  type SyncResponse,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { errorResponse } from "./protocol.js";
import { SLOW_NOT_SUPPORTED, type SlowSuiteRequested } from "./run-slow.js";
import type { DaemonHandler } from "./server.js";
import { isNewerVersion } from "./version.js";

/**
 * `run-all`, `run-slow` and `sync` requests remembered for their status
 * requests; older ones are dropped.
 */
const MAX_REQUESTS = 32;

export interface HandlerContext {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly squealVersion: string;
  readonly startedAt: EpochMs;
  /** `DaemonRecord.token`: with the version and start time, its incarnation (task 001-270). */
  readonly token: string;
  readonly phase: () => DaemonPhase;
  /**
   * Hands a `run --all` to the scheduler once it has started. Never awaited
   * by a handler: the scheduler may be busy with a batch or a runner call.
   */
  readonly requestFullSuite: (request: FullSuiteRequest) => Promise<FullSuiteCheckpoint>;
  /**
   * Hands a `run --slow` to the scheduler (spec 004 D2), like
   * `requestFullSuite`. Absent: this daemon has no slow tier.
   */
  readonly requestSlowSuite?: () => Promise<SlowSuiteRequested>;
  /**
   * Runs a reconciliation pass for `status --wait` (lessons, defect 30) and
   * resolves with the worktree's revision once the pass is stored, like
   * `requestFullSuite`. Absent: this daemon answers that it cannot sync.
   * The files a wait holds for are read from the store (task 001-258).
   * With `paths`, it names their readers too (row 011-234).
   */
  readonly requestSync?: (paths?: readonly RelativePath[]) => Promise<SyncAnswer>;
  /**
   * `squeal retry` (001-368): the scheduler takes the stored requests that
   * may run now, like `requestFullSuite`, never awaited. Absent: the
   * requests wait in the store for a daemon that takes them.
   */
  readonly requestRetries?: () => Promise<void>;
  /**
   * A named wait's promotion (spec 011 C15), like `requestRetries`, never
   * awaited. Absent: this daemon answers that it cannot promote, and the
   * wait reads only.
   */
  readonly requestPromotion?: (
    testFiles: readonly TestFileRef[],
    withinMs: number,
  ) => Promise<void>;
  /**
   * A named wait's focused checks (spec 011 C15, row 011-145), like
   * `requestPromotion`, never awaited. Absent: this daemon answers that it
   * cannot focus, and the wait reads as a named wait.
   */
  readonly requestFocus?: (
    testFiles: readonly TestFileRef[],
    texts: readonly string[],
    withinMs: number,
  ) => Promise<void>;
  /** A nudge or a request: the daemon is in use. */
  readonly onActivity: () => void;
  /**
   * A hook's nudge, after `onActivity` (task 001-281): a consumer may have
   * gone idle, so the scheduler plans its waiting slow files now.
   */
  readonly onNudge?: () => void;
  /** Called after the stop answer is built; the shutdown runs after it is sent. */
  readonly onStop: () => void;
  /**
   * A hook at `version`, newer than this daemon, asked it to step down
   * (defect 26). Called after the answer is built, like `onStop`.
   */
  readonly onStepDown: (version: string) => void;
  /**
   * `squeal hold` (spec 011 C9, row 011-74): the scheduler reads the command
   * holds again and cancels what a hold cancels, like `requestSync`;
   * resolves with whether one holds once the tiers it cancelled ended.
   * Absent: this daemon answers that it cannot hold.
   */
  readonly requestHold?: () => Promise<boolean>;
  /** `squeal hold` removed its entry, or `squeal start` all: the scheduler reads them again. Never awaited. */
  readonly requestResume?: () => Promise<void>;
}

interface RunAllState {
  checkpoint: FullSuiteCheckpoint | null;
  error: string | null;
}

interface RunSlowState {
  requested: RunSlowResponse["requested"];
  error: string | null;
}

interface SyncState {
  revision: RevisionNumber | null;
  readers: SyncReaders | null;
  error: string | null;
}

interface HoldState {
  holding: boolean | null;
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
  const holdRequests = new Map<string, HoldState>();
  const runAll = (requestId: string, state: RunAllState): RunAllResponse => {
    const answer = {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-all",
      requestId,
      error: state.error,
    } as const;
    if (state.checkpoint === null) return { ...answer, checkpoint: null };
    const { owner, ...checkpoint } = state.checkpoint;
    return { ...answer, checkpoint, owner };
  };
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
    moves: true,
    incarnation: daemonIncarnation(context),
    ...(state.readers === null ? {} : { readers: state.readers }),
  });
  const hold = (requestId: string, state: HoldState): HoldResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "hold",
    requestId,
    settled: state.holding !== null || state.error !== null,
    holding: state.holding,
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
        context.onNudge?.();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "retry":
        context.onActivity();
        context.requestRetries?.().catch(() => {});
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "retry" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state: RunAllState = { checkpoint: null, error: null };
        remember(requests, requestId, state);
        const full = {
          force: request.force === true,
          observeIgnored: request.observeIgnored === true,
          ...(request.lane === undefined ? {} : { lane: request.lane }),
        };
        context.requestFullSuite(full).then(
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
        // A wait (`status --wait`) is use (D10 as amended, task 001-415).
        context.onActivity();
        const requestId = randomUUID();
        const state: SyncState = { revision: null, readers: null, error: null };
        remember(syncRequests, requestId, state);
        context.requestSync(request.paths).then(
          (answer) => {
            state.revision = answer.revision;
            state.readers = answer.readers ?? null;
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
      case "hold": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestHold === undefined) return errorResponse("this daemon cannot hold");
        const requestId = randomUUID();
        const state: HoldState = { holding: null, error: null };
        remember(holdRequests, requestId, state);
        context.requestHold().then(
          (holding) => {
            state.holding = holding;
          },
          (error: unknown) => {
            state.error = error instanceof Error ? error.message : String(error);
          },
        );
        return hold(requestId, state);
      }
      case "hold-status": {
        const state = holdRequests.get(request.requestId);
        if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
        return hold(request.requestId, state);
      }
      case "resume":
        if (context.requestResume === undefined) return errorResponse("this daemon cannot hold");
        context.requestResume().catch(() => {});
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "resume" };
      case "promote":
        if (context.requestPromotion === undefined)
          return errorResponse("this daemon cannot promote");
        context.onActivity();
        context.requestPromotion(request.testFiles, request.withinMs).catch(() => {});
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "promote" };
      case "focus":
        if (context.requestFocus === undefined) return errorResponse("this daemon cannot focus");
        context.onActivity();
        context.requestFocus(request.testFiles, request.texts, request.withinMs).catch(() => {});
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "focus" };
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

/** Remembers `requestId`; the oldest are dropped past `MAX_REQUESTS`. */
function remember<T>(requests: Map<string, T>, requestId: string, state: T): void {
  requests.set(requestId, state);
  for (const old of requests.keys()) {
    if (requests.size <= MAX_REQUESTS) break;
    requests.delete(old);
  }
}
