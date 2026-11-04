import { existsSync, readFileSync, statSync } from "node:fs";
import { acquireDaemonLock } from "../daemon/lock.js";
import { lifeOf } from "../daemon/terminate.js";
import { isRecord } from "../fs/index.js";
import type { AbsolutePath, EpochMs } from "../types/index.js";
import { DAEMON_START_GRACE_MS } from "./heartbeat.js";

/*
 * Row 011-293: the reading half of the marks beside a worktree's daemon lock
 * (row 011-250, row 011-251; their writes stay in `daemon/start-mark.ts`).
 * A daemon that holds the lock and is not registered yet writes a start
 * mark naming its process; a hook that spawns a daemon writes a spawn mark
 * with its time. A reader reads the marks, never the lock, except where a
 * rule says it probes the lock (`lockFree`).
 */

/** The start mark beside the daemon lock file `lockFile`. */
export function startMarkFor(lockFile: AbsolutePath): AbsolutePath {
  return `${lockFile}.starting` as AbsolutePath;
}

/** Row 011-251: the spawn mark beside the daemon lock file `lockFile`. */
export function spawnMarkFor(lockFile: AbsolutePath): AbsolutePath {
  return `${lockFile}.spawned` as AbsolutePath;
}

/** What the marks beside a lock file say at one reading. */
export interface LockMarks {
  /** The live process the start mark names, and when the mark was written; `null` with none. */
  readonly start: { readonly pid: number; readonly since: EpochMs } | null;
  /** The spawn mark's time; `null` with none, or one that cannot be read. */
  readonly spawnedAt: EpochMs | null;
}

/** Reads both marks beside `lockFile` at `now`. Takes no lock and never throws. */
export function readLockMarks(lockFile: AbsolutePath, now: EpochMs): LockMarks {
  const pid = markedPid(lockFile);
  return {
    start: pid === null ? null : { pid, since: writtenAt(startMarkFor(lockFile), now) },
    spawnedAt: spawnedAt(lockFile),
  };
}

/** A start `startOf` reads. */
export type DaemonStart =
  | { readonly kind: "locked"; readonly since: EpochMs; readonly pid: number }
  | { readonly kind: "spawned"; readonly since: EpochMs };

/**
 * How a daemon starts, by `marks` as of `now`: `locked`, the process `pid`
 * holds the lock and its start mark names it alive; `spawned`, a hook
 * spawned one within `DAEMON_START_GRACE_MS` of `now` and none heartbeat
 * since (`heartbeatAt`, the last the reader knows, as a told start is read);
 * `since`, when the mark was written. `null` for neither.
 */
export function startOf(
  marks: LockMarks,
  now: EpochMs,
  heartbeatAt: EpochMs | null = null,
): DaemonStart | null {
  const { start } = marks;
  if (start !== null) return { kind: "locked", since: start.since, pid: start.pid };
  const at = marks.spawnedAt;
  if (at === null || Math.abs(now - at) > DAEMON_START_GRACE_MS) return null;
  return heartbeatAt !== null && heartbeatAt >= at ? null : { kind: "spawned", since: at };
}

/** `startOf` the marks beside `lockFile` at `now`. Takes no lock and never throws. */
export function daemonStart(
  lockFile: AbsolutePath,
  now: EpochMs,
  heartbeatAt: EpochMs | null = null,
): DaemonStart | null {
  return startOf(readLockMarks(lockFile, now), now, heartbeatAt);
}

/**
 * Whether the start mark beside `lockFile` names a live process: on Linux
 * one with the mark's pid and start time that is not exiting, elsewhere one
 * the pid reaches. No mark, one that cannot be read or parsed, or one whose
 * process is gone: `false`. Takes no lock and never throws.
 */
export function startMarked(lockFile: AbsolutePath): boolean {
  return markedPid(lockFile) !== null;
}

/** The spawn mark's time beside `lockFile`; `null` with none, or one that cannot be read or parsed. */
export function spawnedAt(lockFile: AbsolutePath): EpochMs | null {
  try {
    const mark: unknown = JSON.parse(readFileSync(spawnMarkFor(lockFile), "utf8"));
    if (!isRecord(mark) || typeof mark.at !== "number" || !Number.isFinite(mark.at)) return null;
    return mark.at as EpochMs;
  } catch {
    return null;
  }
}

/**
 * Whether no process holds the daemon lock at `lockFile`, which the OS
 * releases on any death (D10). A daemon stopped or wedged past its heartbeat
 * still holds it (lessons, defect 22). Taken and released at once, as
 * `waiterLockState` probes a waiter's; no lock file means no daemon of this
 * store ever ran here, so it proves nothing: `false`.
 */
export function lockFree(lockFile: AbsolutePath): boolean {
  if (!existsSync(lockFile)) return false;
  try {
    const lock = acquireDaemonLock(lockFile);
    lock?.release();
    return lock !== null;
  } catch {
    return false;
  }
}

/** The live process the start mark beside `lockFile` names (`startMarked`), else `null`. */
function markedPid(lockFile: AbsolutePath): number | null {
  let mark: unknown;
  try {
    mark = JSON.parse(readFileSync(startMarkFor(lockFile), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(mark)) return null;
  const { pid, startTime } = mark;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    const life = lifeOf(pid);
    return life !== null && !life.dying && life.start === startTime ? pid : null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? pid : null;
  }
}

/** When the mark at `path` was written (renamed with its write's time); `now` when that cannot be read. */
function writtenAt(path: AbsolutePath, now: EpochMs): EpochMs {
  try {
    return Math.floor(statSync(path).mtimeMs) as EpochMs;
  } catch {
    return now;
  }
}
