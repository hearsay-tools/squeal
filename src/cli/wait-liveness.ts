import { socketPathFor } from "../core/daemon/paths.js";
import { startMarked } from "../core/daemon/start-mark.js";
import { HANDOFF_BOUND_MS } from "../core/delivery/handoff.js";
import { daemonLiveness } from "../core/delivery/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../core/status/index.js";
import { withStopping } from "../core/status/stopping.js";
import type {
  AbsolutePath,
  DaemonRecord,
  DaemonStopping,
  EpochMs,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../core/types/index.js";
import { askDaemon } from "./daemon-access.js";

/*
 * Task 004-66 (issue 12, spec 004 D9 with 011 C9): a requested wait ended
 * "no daemon" at the first stale heartbeat, while the daemon was alive and
 * another connection held the store's write lock, and the agent fell back to
 * a competing run. A stale heartbeat now only asks the daemon's socket. One
 * that answers, or accepts and does not answer in time (a stalled event
 * loop), is a daemon whose heartbeat lapsed: the wait goes on and its line
 * says so. A cleared record is a stopped daemon. A stale record whose socket
 * nobody listens on is down once it stayed so for `WAIT_DOWN_MS`, the Stop
 * wait's down bound (`STOP_SLOW_DOWN_MS`), since a successor may be taking
 * over: counted from the heartbeat's grace by the record's clock, or from the
 * wait's first dead socket, whichever is longer, so a daemon long gone ends
 * the wait at once. Row 011-34 (011 C9 as amended 2026-10-20): a stopping
 * daemon keeps the wait going until the handoff's bound; past it the wait
 * returns without a daemon and names `squeal start`. The wait judges it by
 * the reading status prints (`withStopping`), the claim's bound and the
 * window after the old daemon cleared its record included (review 0.1.259,
 * B2). A stopping daemon that leaves no reading, as one with no
 * incarnation (before task 001-270), is judged by its socket's `phase`, with
 * the bound `HANDOFF_BOUND_MS` past the interval after its last heartbeat.
 * Row 011-250 (gh-1): a cleared record while a daemon that holds the
 * worktree's lock marks its start is a daemon starting, which registers only
 * once it opened the store, or one whose start failed and is ending: the
 * wait goes on (`locked`). Review 0.1.350, B1: the wait reads the mark
 * (`startMarked`) and never takes the lock, which made an older hook's
 * spawn exit as a loser.
 */

/** A daemon whose record stays stale and whose socket stays dead this long is gone. */
export const WAIT_DOWN_MS = 10_000;

/**
 * Why a wait found no daemon: its record cleared; its heartbeat stopped and
 * its socket is dead; or it is stopping past its handoff's bound.
 */
export type DownReason = "stopped" | "silent" | "handoff";

/**
 * What one read of the store says of the daemon: `alive`, fresh heartbeat;
 * `lapsed`, stale heartbeat but the socket holds a daemon, or its check has
 * not answered yet, or a handoff before its bound, or with `locked`, no
 * record while a daemon holding the lock marks its start; `down`, no daemon
 * will finish the wait.
 */
export type WaitLiveness =
  | { readonly state: "alive" }
  | { readonly state: "lapsed"; readonly locked?: true }
  | { readonly state: "down"; readonly reason: DownReason };

/** A heartbeat lapse the wait went on through: the oldest the heartbeat got, in ms. */
export interface HeartbeatLapse {
  readonly staleMs: number;
}

export interface DaemonWatch {
  /**
   * Judges the record read at clock time `at`, with the stopping reading of
   * the same read (`stoppingOf`); a stale record with none starts a socket
   * check in the background.
   */
  judge(record: DaemonRecord | null, at: EpochMs, stopping?: DaemonStopping): WaitLiveness;
  /** The lapse a socket check found the daemon alive through, if any. */
  lapse(): HeartbeatLapse | null;
}

export interface DaemonWatchOptions {
  /** Default `WAIT_DOWN_MS`. */
  readonly downMs?: number | undefined;
  /** Default `process.env`: the runtime dir of the computed socket. */
  readonly env?: NodeJS.ProcessEnv;
  /** Row 011-250: the worktree's daemon lock file (`lockFileFor`), beside which a start is marked; without it, none is read. */
  readonly lockFile?: AbsolutePath;
}

/** `stopping`: a daemon answered with `phase: "stopping"`. */
type SocketState = "listening" | "stopping" | "absent";

/**
 * Watches the daemon of worktree `worktreeId` across a wait's reads. A
 * socket is asked for a `ping` at most once at a time, the record's socket
 * and the one this environment computes (a daemon started elsewhere listens
 * at its own), and any of them answering or accepting means a daemon holds
 * the worktree.
 */
export function watchDaemon(worktreeId: WorktreeId, options: DaemonWatchOptions = {}): DaemonWatch {
  const downMs = options.downMs ?? WAIT_DOWN_MS;
  const computed = socketPathFor(worktreeId, options.env);
  let socket: SocketState | null = null;
  let asking = false;
  let deadSince: number | null = null;
  let staleMs: number | null = null;
  const ask = (record: DaemonRecord, asked: number) => {
    if (asking) return;
    asking = true;
    void listening([...new Set([record.socketPath, computed])]).then((found) => {
      socket = found;
      // The lapse the check began on counts, even when the heartbeat is fresh by the next read.
      if (found !== "absent") staleMs = Math.max(staleMs ?? 0, asked);
      asking = false;
    });
  };
  return {
    judge(record, at, stopping) {
      if (stopping?.overdue === true) return { state: "down", reason: "handoff" };
      const alive = record !== null && daemonLiveness(record, at).state === "alive";
      if (stopping !== undefined && !alive) return { state: "lapsed" };
      if (record === null) {
        return options.lockFile !== undefined && startMarked(options.lockFile)
          ? { state: "lapsed", locked: true }
          : { state: "down", reason: "stopped" };
      }
      if (alive) {
        socket = null;
        deadSince = null;
        return { state: "alive" };
      }
      const seen: SocketState | null = socket;
      ask(record, at - record.heartbeatAt);
      const boundAt = record.heartbeatAt + record.heartbeatIntervalMs + HANDOFF_BOUND_MS;
      if (seen === "stopping" && at >= boundAt) return { state: "down", reason: "handoff" };
      if (seen !== "absent") {
        deadSince = null;
        if (seen === "listening") staleMs = Math.max(staleMs ?? 0, at - record.heartbeatAt);
        return { state: "lapsed" };
      }
      const now = performance.now();
      deadSince ??= now;
      const graceEnd = record.heartbeatAt + record.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS;
      const deadMs = Math.max(now - deadSince, at - graceEnd);
      return deadMs >= downMs ? { state: "down", reason: "silent" } : { state: "lapsed" };
    },
    lapse: () => (staleMs === null ? null : { staleMs }),
  };
}

/** Row 011-250: an ended wait's `locked`, when its last read found no record and a start marked. */
export function lockedOf(daemon: WaitLiveness): { readonly locked?: true } {
  return daemon.state === "lapsed" && daemon.locked === true ? { locked: true } : {};
}

/**
 * The stopping reading of `worktree` at `at`, as status reads it
 * (`withStopping`): its recorded daemon stopping while it holds its lock, or
 * after it cleared its record, a live claim while the lock is held.
 */
export function stoppingOf(
  store: Store,
  worktree: WorktreeRecord | null,
  at: EpochMs,
): DaemonStopping | undefined {
  return withStopping(store, worktree, daemonLiveness(worktree?.daemon ?? null, at), at).stopping;
}

async function listening(paths: readonly AbsolutePath[]): Promise<SocketState> {
  const answers = await Promise.all(
    paths.map((path) =>
      askDaemon(path, { type: "ping" }).then(
        (answer): SocketState =>
          answer === null
            ? "absent"
            : answer.ok && answer.type === "ping" && answer.phase === "stopping"
              ? "stopping"
              : "listening",
        // A socket that accepts and does not answer in time: a daemon whose event loop is stalled.
        (): SocketState => "listening",
      ),
    ),
  );
  if (answers.includes("stopping")) return "stopping";
  return answers.includes("listening") ? "listening" : "absent";
}
