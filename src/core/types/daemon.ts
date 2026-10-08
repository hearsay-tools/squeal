import type { AbsolutePath, EpochMs, PayloadSchemaVersion, WorktreeId } from "./common.js";
import type { CheckpointRecord } from "./store-records.js";

/*
 * The daemon's unix socket. Spec 001 D1: "The unix socket for liveness is
 * `<runtime dir>/squeal-<worktree-hash>.sock`". D9: hooks use "the socket
 * only for liveness and nudges with a 100 ms timeout". D10: "The winner
 * unlinks a stale socket, binds its own, records the path and a heartbeat in
 * the store".
 *
 * Wire format: one JSON request line from the client, one JSON response line
 * from the daemon, then the daemon ends the connection. Every handler answers
 * from memory and never awaits scheduler work, so an answer fits the hooks'
 * 100 ms budget while a tier runs.
 */

/** Hooks' socket budget. Spec 001 D9: "with a 100 ms timeout". */
export const DAEMON_SOCKET_TIMEOUT_MS = 100;

/** Liveness. */
export interface PingRequest {
  readonly type: "ping";
}

/**
 * A hook saw agent activity. Resets the daemon's idle clock; never waits for
 * anything.
 */
export interface NudgeRequest {
  readonly type: "nudge";
}

/**
 * Spec 001 D5 `squeal run --all [--force]`. Answered at once with a request
 * id; the checkpoint is recorded once the scheduler takes the request, which
 * may wait for a batch or a runner call in flight. Ask for it with
 * `RunAllStatusRequest`.
 */
export interface RunAllRequest {
  readonly type: "run-all";
  readonly force?: boolean;
}

/** The checkpoint a `run-all` request created, once the scheduler created it. */
export interface RunAllStatusRequest {
  readonly type: "run-all-status";
  readonly requestId: string;
}

/** `squeal stop`: answered, then the daemon shuts down (D10 shutdown order). */
export interface StopRequest {
  readonly type: "stop";
}

/**
 * A hook whose Squeal version is newer than the daemon's (lessons, defect
 * 26). A daemon older than `version` answers, lets a tier in flight finish
 * and exits with reason `superseded`, so the next hook starts a current
 * one; an equal or newer daemon answers and keeps running. A daemon from
 * before this request answers "unknown request type", and the hook sends
 * `stop` instead.
 */
export interface StepDownRequest {
  readonly type: "step-down";
  /** The hook's Squeal version. */
  readonly version: string;
}

export type DaemonRequest =
  | PingRequest
  | NudgeRequest
  | RunAllRequest
  | RunAllStatusRequest
  | StopRequest
  | StepDownRequest;

/** Where a daemon is in its life. `starting`: socket bound, scheduler not started yet. */
export type DaemonPhase = "starting" | "ready" | "stopping";

export interface PingResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "ping";
  readonly pid: number;
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly squealVersion: string;
  readonly phase: DaemonPhase;
  readonly startedAt: EpochMs;
}

export interface NudgeResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "nudge";
}

/**
 * State of one `run-all` request. `checkpoint` is `null` until the scheduler
 * recorded it; `error` is set when the request failed.
 */
export interface RunAllResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "run-all";
  readonly requestId: string;
  readonly checkpoint: CheckpointRecord | null;
  readonly error: string | null;
}

export interface StopResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "stop";
}

export interface StepDownResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "step-down";
  /** The daemon's own version. */
  readonly squealVersion: string;
  /** True when the daemon is older than the request's version and exits. */
  readonly steppingDown: boolean;
}

/** A request the daemon could not parse or does not know, or a `run-all-status` for an unknown id. */
export interface DaemonErrorResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: false;
  readonly error: string;
}

export type DaemonResponse =
  | PingResponse
  | NudgeResponse
  | RunAllResponse
  | StopResponse
  | StepDownResponse
  | DaemonErrorResponse;

/**
 * Result of probing a worktree's socket. `absent`: no socket file
 * (`ENOENT`) or nobody listening (`ECONNREFUSED`), so a hook may spawn a
 * daemon. `unresponsive`: anything else, a timeout included; a hung daemon
 * still holds the lock, so spawning another would only lose.
 */
export type DaemonProbe =
  | { readonly state: "alive"; readonly ping: PingResponse }
  | { readonly state: "absent"; readonly code: "ENOENT" | "ECONNREFUSED" }
  | { readonly state: "unresponsive"; readonly reason: string };

/**
 * What `ensureDaemon` did. Spec 001 D10: "A hook that finds no live socket
 * spawns `squeal daemon <root>` detached [...] and returns without waiting."
 */
export type EnsureDaemonResult = "alive" | "spawned" | "unavailable";

/**
 * Why a daemon process ended. Spec 001 D10: "The daemon exits when its root
 * is deleted, when `<common-dir>/worktrees/<name>` disappears, when the store
 * schema is newer than it understands, or after a configurable idle period
 * with no registered consumers". `lost-lock`: another daemon serves this
 * worktree ("Losers exit").
 */
export type DaemonExitReason =
  | "lost-lock"
  | "not-a-worktree"
  | "store-newer"
  | "store-unusable"
  | "bad-policy"
  | "start-failed"
  | "idle"
  /** Every session that used it is gone: the last unregistered, or its harness process died (defect 24). */
  | "sessions-gone"
  | "root-removed"
  | "worktree-removed"
  | "stop-requested"
  | "signal"
  /** The install went under the running daemon (a reinstall); the next hook starts a fresh one (task 001-113). */
  | "reinstalled"
  /** A hook newer than this daemon asked it to step down; the hook spawned its successor (defect 26, task 001-130). */
  | "superseded"
  /** A successor (`squeal daemon --await-lock`) found the lock still held when its wait ended (task 001-130). */
  | "lock-wait-timed-out";

export interface DaemonExit {
  readonly reason: DaemonExitReason;
  /** Process exit code: `0` when another daemon serves or nothing is wrong, `1` when this one could not serve. */
  readonly code: 0 | 1;
  readonly message: string;
}

/**
 * `meta` key of a worktree's bootstrap marker: the `DaemonRecord.startedAt`
 * of the daemon that finished its start scan (`bootstrap`). The scan hashes
 * files it has no hash for without a revision, so an edit made before it
 * can be in no revision; a consumer registered while the marker matches the
 * live daemon may be told "none of the files changed here" while that daemon lives
 * (task 001-96, review wave 10c). No hook waits for it.
 */
export function bootstrappedMetaKey(worktreeId: WorktreeId): string {
  return `daemon-bootstrapped:${worktreeId}`;
}
