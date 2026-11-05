import type { DaemonRecord, DaemonStopping, EpochMs } from "../types/index.js";
import { heartbeatFresh, heartbeatGraceEnd } from "./heartbeat.js";
import { type LockMarks, startOf } from "./marks.js";
import { HANDOFF_BOUND_MS } from "./stored.js";

/*
 * Row 011-293: the wait's presence view. The wait (`cli/wait-liveness.ts`)
 * keeps its I/O, the socket check and the time the socket has been dead, and
 * gives their results here; the rules sit beside the other views.
 *
 * Task 004-66 (issue 12, spec 004 D9 with 011 C9): a stale heartbeat only
 * asks the daemon's socket. One that answers, or accepts and does not answer
 * in time (a stalled event loop), is a daemon whose heartbeat lapsed: the
 * wait goes on. A cleared record is a stopped daemon. A stale record whose
 * socket nobody listens on is down once it stayed so for the wait's down
 * bound, counted from the heartbeat's grace or from the wait's first dead
 * socket, whichever is longer, so a daemon long gone ends the wait at once.
 * Row 011-34: a stopping daemon keeps the wait going until the handoff's
 * bound; past it the wait returns without a daemon. It is judged by the
 * reading status prints (`Presence.stopping`). A stopping daemon that leaves
 * no reading, as one with no incarnation (before task 001-270), is judged by
 * its socket's `phase`, with the bound `HANDOFF_BOUND_MS` past the interval
 * after its last heartbeat. Rows 011-250 and 011-251: a cleared record while
 * a start is marked beside the lock, either mark, is a daemon starting: the
 * wait goes on (`locked`), and reads the marks, never the lock. A cleared
 * record with neither mark is read once more before the wait says the daemon
 * stopped (review 0.1.350-r2, N2). Review 0.1.355 B1: a stale record while
 * another daemon holds the lock and marks its start is read as a cleared one
 * is; a spawn mark alone is no start with a stale record.
 */

/**
 * Why a wait found no daemon: its record cleared; its heartbeat stopped and
 * its socket is dead; or it is stopping past its handoff's bound.
 */
export type DownReason = "stopped" | "silent" | "handoff";

/**
 * What one read of the store says of the daemon: `alive`, fresh heartbeat;
 * `lapsed`, stale heartbeat but the socket holds a daemon, or its check has
 * not answered yet, or a handoff before its bound, or with `locked`, no
 * record or a stale one while another daemon holding the lock marks its
 * start; `down`, no daemon will finish the wait.
 */
export type WaitLiveness =
  | { readonly state: "alive" }
  | { readonly state: "lapsed"; readonly locked?: true }
  | { readonly state: "down"; readonly reason: DownReason };

/** What the last socket check found: `stopping`, a daemon answered with `phase: "stopping"`. */
export type SocketState = "listening" | "stopping" | "absent";

/** What the wait gives the view for one read. */
export interface WaitInputs {
  readonly record: DaemonRecord | null;
  readonly at: EpochMs;
  /** The stopping reading of the same read (`Presence.stopping`). */
  readonly stopping?: DaemonStopping | undefined;
  /** The marks beside the lock at `at`, read when a rule asks; `null` without a lock file. */
  readonly marks: () => LockMarks | null;
  /** What the last socket check found; `null` before one answered or since a fresh heartbeat. */
  readonly socket: SocketState | null;
  /** How long the socket has been found dead, the timer starting at the first call. */
  readonly deadMs: () => number;
  /** Whether a second read, in a transaction of its own, finds a record (N2). */
  readonly recordedAgain: () => boolean;
  /** How long a stale record's socket may stay dead before the daemon is down. */
  readonly downMs: number;
}

/** The view's reading, and what the wait does with its socket check and timer. */
export interface WaitReading {
  readonly liveness: WaitLiveness;
  /** `all`: forget the socket's answer and the dead time; `dead`: forget the dead time. */
  readonly forget?: "all" | "dead";
  /** Ask the record's socket in the background, for a heartbeat this many ms stale. */
  readonly ask?: number;
  /** A listening socket's lapse to count, in ms. */
  readonly lapse?: number;
}

/** The wait's reading of one read of the store (`WaitInputs`). */
export function waitView(i: WaitInputs): WaitReading {
  const { record, at, stopping } = i;
  if (stopping?.overdue === true) return { liveness: { state: "down", reason: "handoff" } };
  const alive = record !== null && heartbeatFresh(record, at);
  if (stopping !== undefined && !alive) return { liveness: { state: "lapsed" } };
  if (record === null) {
    const marks = i.marks();
    if (marks !== null && startOf(marks, at) !== null) return lockedReading;
    return i.recordedAgain() ? lockedReading : { liveness: { state: "down", reason: "stopped" } };
  }
  if (alive) return { liveness: { state: "alive" }, forget: "all" };
  if ((i.marks()?.start() ?? null) !== null) return { ...lockedReading, forget: "dead" };
  const ask = at - record.heartbeatAt;
  const boundAt = record.heartbeatAt + record.heartbeatIntervalMs + HANDOFF_BOUND_MS;
  if (i.socket === "stopping" && at >= boundAt) {
    return { liveness: { state: "down", reason: "handoff" }, ask };
  }
  if (i.socket !== "absent") {
    const lapse = i.socket === "listening" ? { lapse: ask } : {};
    return { liveness: { state: "lapsed" }, forget: "dead", ask, ...lapse };
  }
  const deadMs = Math.max(i.deadMs(), at - heartbeatGraceEnd(record));
  const down = deadMs >= i.downMs;
  return { liveness: down ? { state: "down", reason: "silent" } : { state: "lapsed" }, ask };
}

const lockedReading: WaitReading = { liveness: { state: "lapsed", locked: true } };
