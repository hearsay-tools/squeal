import { socketPathFor } from "../core/daemon/paths.js";
import { HANDOFF_BOUND_MS } from "../core/delivery/handoff.js";
import { daemonLiveness } from "../core/delivery/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../core/status/index.js";
import type { AbsolutePath, DaemonRecord, EpochMs, WorktreeId } from "../core/types/index.js";
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
 * the wait at once. Row 011-34 (011 C9 as amended 2026-10-20): a socket
 * whose daemon answers that it is stopping keeps the wait going until the
 * handoff's bound, `HANDOFF_BOUND_MS` past the interval after its last
 * heartbeat, when its shutdown began; past it the wait returns without a
 * daemon and names `squeal start`.
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
 * not answered yet; `down`, no daemon will finish the wait.
 */
export type WaitLiveness =
  | { readonly state: "alive" | "lapsed" }
  | { readonly state: "down"; readonly reason: DownReason };

/** A heartbeat lapse the wait went on through: the oldest the heartbeat got, in ms. */
export interface HeartbeatLapse {
  readonly staleMs: number;
}

export interface DaemonWatch {
  /** Judges the record read at clock time `at`; a stale one starts a socket check in the background. */
  judge(record: DaemonRecord | null, at: EpochMs): WaitLiveness;
  /** The lapse a socket check found the daemon alive through, if any. */
  lapse(): HeartbeatLapse | null;
}

export interface DaemonWatchOptions {
  /** Default `WAIT_DOWN_MS`. */
  readonly downMs?: number | undefined;
  /** Default `process.env`: the runtime dir of the computed socket. */
  readonly env?: NodeJS.ProcessEnv;
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
    judge(record, at) {
      if (record === null) return { state: "down", reason: "stopped" };
      if (daemonLiveness(record, at).state === "alive") {
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
