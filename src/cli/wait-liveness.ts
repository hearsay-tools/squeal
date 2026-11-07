import { socketPathFor } from "../core/daemon/paths.js";
import { readLockMarks } from "../core/presence/marks.js";
import { readStopping } from "../core/presence/narrow.js";
import { type SocketState, type WaitLiveness, waitView } from "../core/presence/wait.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../core/types/common.js";
import type { DaemonStopping } from "../core/types/status.js";
import type { Store } from "../core/types/store.js";
import type { DaemonRecord, WorktreeRecord } from "../core/types/store-records.js";
import { askDaemon } from "./daemon-access.js";

/*
 * Task 004-66 (issue 12, spec 004 D9 with 011 C9): a requested wait goes on
 * through a lapsed heartbeat while the daemon's socket holds a daemon. This
 * file keeps the wait's I/O: the socket check, the time the socket has been
 * dead, and the record read again in a transaction of its own (row 011-251,
 * N2). What a read says of the daemon is daemon presence's wait view
 * (`waitView`, row 011-293), which names the rules.
 */

// Row 011-293: the wait's view and its types are daemon presence's.
export type { DownReason, WaitLiveness } from "../core/presence/wait.js";

/** A daemon whose record stays stale and whose socket stays dead this long is gone. */
export const WAIT_DOWN_MS = 10_000;

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
  /**
   * Row 011-250: the worktree's daemon lock file (`lockFileFor`), beside
   * which a start is marked; without it, none is read.
   */
  readonly lockFile?: AbsolutePath;
  /** Row 011-251: the store's common dir, whose record a cleared one is read again from. */
  readonly commonDir?: AbsolutePath;
  /**
   * Row 011-251: reads the record in a new read transaction; default, on a
   * connection of its own to `commonDir`'s store.
   */
  readonly recordNow?: () => DaemonRecord | null | undefined;
}

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
  const { lockFile, commonDir } = options;
  const recordNow =
    options.recordNow ??
    (commonDir === undefined ? null : () => freshRecord(commonDir, worktreeId));
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
      const reading = waitView({
        record,
        at,
        stopping,
        marks: () => (lockFile === undefined ? null : readLockMarks(lockFile, at)),
        socket,
        deadMs: () => {
          const now = performance.now();
          deadSince ??= now;
          return now - deadSince;
        },
        // N2: a record a new read finds registered after this poll's read began; the next poll reads it.
        recordedAgain: () => Boolean(recordNow?.()),
        downMs,
      });
      if (reading.forget === "all") socket = null;
      if (reading.forget !== undefined) deadSince = null;
      if (record !== null && reading.ask !== undefined) ask(record, reading.ask);
      if (reading.lapse !== undefined) staleMs = Math.max(staleMs ?? 0, reading.lapse);
      return reading.liveness;
    },
    lapse: () => (staleMs === null ? null : { staleMs }),
  };
}

/**
 * Row 011-251 (review 0.1.350-r2, N2): the record of `worktreeId` in a read
 * of its own, on a connection of its own to the store of `commonDir`.
 * `undefined` when the store does not open or the read fails: it proves
 * nothing.
 */
function freshRecord(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
): DaemonRecord | null | undefined {
  try {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: FRESH_READ_BUSY_MS });
    if (isStoreOpenFailure(store)) return undefined;
    try {
      return store.worktrees.get(worktreeId)?.daemon ?? null;
    } finally {
      store.close();
    }
  } catch {
    return undefined;
  }
}

/** How long the record's second read waits for a busy store: a reader waits only on a checkpoint. */
const FRESH_READ_BUSY_MS = 100;

/** Row 011-250: an ended wait's `locked`, when its last read found no record and a start marked. */
export function lockedOf(daemon: WaitLiveness): { readonly locked?: true } {
  return daemon.state === "lapsed" && daemon.locked === true ? { locked: true } : {};
}

/**
 * The stopping reading of `worktree` at `at`, as status reads it
 * (`Presence.stopping`): its recorded daemon stopping while it holds its
 * lock, or after it cleared its record, a live claim.
 */
export function stoppingOf(
  store: Store,
  worktree: WorktreeRecord | null,
  at: EpochMs,
): DaemonStopping | undefined {
  return readStopping(store, worktree, at);
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
