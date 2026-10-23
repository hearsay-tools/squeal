import type {
  AbsolutePath,
  EpochMs,
  PayloadSchemaVersion,
  RevisionNumber,
  WorktreeId,
} from "./common.js";
import type { TestFileRef } from "./keys.js";
import { worktreeMetaKey } from "./store.js";
import type { CheckpointLane, CheckpointRecord, DaemonRecord } from "./store-records.js";

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
 * `squeal retry` (spec 001 D6, 001-368) stored a request or withdrew one:
 * the scheduler takes the requests in the store that may run now. Answered
 * at once; the requests themselves live in the store.
 */
export interface RetryRequest {
  readonly type: "retry";
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
  /** A warm-up (task 001-307): the checkpoint's runs report the ignored paths each file read. */
  readonly observeIgnored?: boolean;
  /**
   * Only this lane's test files (task 004-61). A daemon from before it reads
   * the request as both lanes; its checkpoint then carries no `lane`.
   */
  readonly lane?: CheckpointLane;
}

/** The checkpoint a `run-all` request created, once the scheduler created it. */
export interface RunAllStatusRequest {
  readonly type: "run-all-status";
  readonly requestId: string;
}

/**
 * Spec 004 D2 `squeal run --slow`: the explicit trigger of the slow tier.
 * Answered at once with a request id, like `run-all`; ask for what the
 * scheduler queued with `RunSlowStatusRequest`.
 */
export interface RunSlowRequest {
  readonly type: "run-slow";
}

/** What a `run-slow` request queued, once the scheduler took it. */
export interface RunSlowStatusRequest {
  readonly type: "run-slow-status";
  readonly requestId: string;
}

/**
 * `squeal status --wait` (lessons, defect 30): a reconciliation pass over
 * the worktree, so the revision of an edit made before the request is
 * stored before the wait may end on quiet. Answered at once with a request
 * id, like `run-all`; ask for the revision with `SyncStatusRequest`. A
 * daemon from before this request answers "unknown request type".
 */
export interface SyncRequest {
  readonly type: "sync";
}

/** The revision a `sync` request's pass left, once it was stored. */
export interface SyncStatusRequest {
  readonly type: "sync-status";
  readonly requestId: string;
}

/**
 * Spec 011 C15: a named wait (`status --wait <ms> <path>...`) promotes the
 * test files its paths select by themselves, for `withinMs`, what is left
 * of the wait, on the daemon's own clock. Answered at once; the scheduler
 * reorders its queue when it takes the request. A daemon from before this
 * request answers "unknown request type", and the wait reads only.
 */
export interface PromoteRequest {
  readonly type: "promote";
  readonly testFiles: readonly TestFileRef[];
  readonly withinMs: number;
}

/**
 * Spec 011 C15, focused checks (row 011-145): a named wait with `--check`
 * asks the daemon to run first, alone, the checks of each of `testFiles`
 * whose full name holds one of `texts`, for `withinMs`, what is left of the
 * wait. Answered at once, as `promote` is; the daemon keeps no entry for a
 * slow file or one whose runner does not focus. A daemon from before this
 * request answers "unknown request type", and the wait reads as a named wait.
 */
export interface FocusRequest {
  readonly type: "focus";
  readonly testFiles: readonly TestFileRef[];
  /** Literal texts, at least one (`RunOptions.checks`). */
  readonly texts: readonly string[];
  readonly withinMs: number;
}

/** `squeal stop`: answered, then the daemon shuts down (D10 shutdown order). */
export interface StopRequest {
  readonly type: "stop";
}

/**
 * A hook whose Squeal version is newer than the daemon's (lessons, defect
 * 26). A daemon older than `version` answers, cancels its tiers in flight
 * (row 011-31) and exits with reason `superseded`, so the next hook starts a
 * current one; an equal or newer daemon answers and keeps running. The hook
 * sends `stop` after an accepted step-down, and instead of it to a daemon
 * from before this request, which answers "unknown request type".
 */
export interface StepDownRequest {
  readonly type: "step-down";
  /** The hook's Squeal version. */
  readonly version: string;
}

/**
 * `squeal hold` (spec 011 C9, "Holds", row 011-74) added its entry to
 * the `commandHold` row of `meta`: the daemon reads it again, starts no tier
 * while an entry holds, and cancels the tiers in flight whose runner
 * cancels. Answered at once with a request id, like `sync`; ask whether the
 * cancelled tiers ended with `HoldStatusRequest`. A daemon from before this
 * request answers "unknown request type".
 */
export interface HoldRequest {
  readonly type: "hold";
}

/** Whether the tiers a `hold` request cancelled ended. */
export interface HoldStatusRequest {
  readonly type: "hold-status";
  readonly requestId: string;
}

/**
 * `squeal hold` removed its entry, or `squeal start` every entry (row
 * 011-74): the daemon reads the row again, and the queued work starts once
 * no entry holds. Answered at once.
 */
export interface ResumeRequest {
  readonly type: "resume";
}

export type DaemonRequest =
  | PingRequest
  | NudgeRequest
  | RetryRequest
  | RunAllRequest
  | RunAllStatusRequest
  | RunSlowRequest
  | RunSlowStatusRequest
  | SyncRequest
  | SyncStatusRequest
  | PromoteRequest
  | FocusRequest
  | StopRequest
  | StepDownRequest
  | HoldRequest
  | HoldStatusRequest
  | ResumeRequest;

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

export interface RetryResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "retry";
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
  /**
   * Set with `checkpoint`: the id of the checkpoint whose tiers do the
   * request's work (`FullSuiteCheckpoint.owner`), another one's only when the
   * request joined it. Absent from a daemon before 005-36, whose joins the
   * CLI cannot tell (review wave-3, B4).
   */
  readonly owner?: string;
}

/**
 * State of one `run-slow` request. `requested` is `null` until the scheduler
 * took it: the revision it was taken at and how many slow files it queued
 * (0 when none are declared or all are current). `error` is set when the
 * request failed, for example on a daemon whose scheduler has no slow tier.
 */
export interface RunSlowResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "run-slow";
  readonly requestId: string;
  readonly requested: { readonly revision: RevisionNumber; readonly queued: number } | null;
  readonly error: string | null;
}

/**
 * State of one `sync` request. `revision` is `null` until the pass was
 * stored: the worktree's revision then, which holds every change made before
 * the request. `error` is set when the pass failed. An older CLI's `after`
 * is ignored: with no `rekeyed` in the answer it takes its path for a
 * daemon before task 001-186 (task 001-258).
 */
export interface SyncResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "sync";
  readonly requestId: string;
  readonly revision: RevisionNumber | null;
  readonly error: string | null;
  /**
   * The daemon records the re-key moves a wait reads from the store
   * (the `rekeyedMoves` row, task 001-258). Absent from a daemon before it,
   * whose commits leave that record as it was: the wait then names no
   * files, never ends quiet on them.
   */
  readonly moves?: true;
  /**
   * The answering daemon's incarnation (`daemonIncarnation`), which its
   * ledger names as the writer of those moves (task 001-268). Absent from a
   * daemon before it: the wait cannot tell its moves from another writer's,
   * and names no files.
   */
  readonly incarnation?: string;
}

/** What names a daemon's incarnation (`daemonIncarnation`). */
export type DaemonIdentity = Pick<DaemonRecord, "squealVersion" | "startedAt" | "token">;

/**
 * A daemon's incarnation as its registration row names it: the version, the
 * start time and the start token of the daemon that registered
 * (`DaemonRecord`); `null` with none registered, or with no token (a
 * release before task 001-270), which no wait trusts. Two daemons of one
 * worktree never run at once, so a successor registers another, and its
 * random token tells the two apart even at one start time (a clock set
 * back, review wave 13ae).
 */
export function daemonIncarnation(daemon: DaemonIdentity & { readonly token: string }): string;
export function daemonIncarnation(daemon: DaemonIdentity | null): string | null;
export function daemonIncarnation(daemon: DaemonIdentity | null): string | null {
  if (daemon?.token === undefined) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}

/**
 * The incarnation of the daemon registered on a worktree before this one,
 * read before this one replaces it (task 001-268, as decided by the human):
 * `null` when the worktree has no row, so none ever registered; `undefined`
 * when its identity cannot be read (a release whose clean exit cleared it,
 * no version, or no start token), and a ledger's first commit then takes in
 * what was left.
 */
export function predecessorIncarnation(
  hasRow: boolean,
  last: {
    readonly startedAt: EpochMs;
    readonly squealVersion: string | null;
    readonly token?: string;
  } | null,
): string | null | undefined {
  if (!hasRow) return null;
  if (last === null || last.squealVersion === null) return undefined;
  return daemonIncarnation({ ...last, squealVersion: last.squealVersion }) ?? undefined;
}

/** What a daemon's sync pass left: its revision. */
export interface SyncAnswer {
  readonly revision: RevisionNumber;
}

export interface PromoteResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "promote";
}

export interface FocusResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "focus";
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

/**
 * State of one `hold` request (row 011-74). `settled` is false until the
 * daemon read the row and the tiers it cancelled ended; then `holding` says
 * whether an entry holds. `error` is set when the request failed.
 */
export interface HoldResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "hold";
  readonly requestId: string;
  readonly settled: boolean;
  readonly holding: boolean | null;
  readonly error: string | null;
}

export interface ResumeResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "resume";
}

/** A request the daemon could not parse or does not know, or a status request for an unknown id. */
export interface DaemonErrorResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: false;
  readonly error: string;
}

export type DaemonResponse =
  | PingResponse
  | NudgeResponse
  | RetryResponse
  | RunAllResponse
  | RunSlowResponse
  | SyncResponse
  | PromoteResponse
  | FocusResponse
  | StopResponse
  | StepDownResponse
  | HoldResponse
  | ResumeResponse
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
  return worktreeMetaKey("daemonBootstrapped", worktreeId);
}

/**
 * `meta` key of the incarnation (`daemonIncarnation`) whose shutdown began,
 * written first by its exit path and cleared by the next registration, which
 * status reads to tell a kill while it shut down from a death (`withDeath`,
 * task 001-274). Outside the capped notes, so no number of later notes
 * evicts it (review wave-13ag B1).
 */
export function daemonExitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonExit", worktreeId);
}

/**
 * `meta` key of when a daemon stopped unused (D10 as amended, task 001-415):
 * while its record is cleared and no heartbeat came after it, the worktree's
 * daemon rests, and its consumers are told nothing about it (`livenessChange`).
 */
export function daemonRestMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonRest", worktreeId);
}
