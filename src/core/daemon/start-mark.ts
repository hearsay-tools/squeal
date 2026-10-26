import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DAEMON_START_GRACE_MS } from "../delivery/liveness.js";
import { isRecord } from "../fs/index.js";
import type { AbsolutePath, EpochMs } from "../types/index.js";
import type { DaemonLock } from "./lock.js";
import { lifeOf } from "./terminate.js";

/*
 * Row 011-250, review 0.1.350 B1: a daemon registers only once it opened the
 * store, so between its lock and its record a wait finds the record cleared.
 * A wait that probed the lock took it for a moment, and a hook's spawn older
 * than the last daemon recorded that met the probe exited as a loser (C9's
 * version rule), with no daemon serving. The daemon now writes a start mark
 * beside its lock file while it holds the lock and is not registered yet,
 * and a wait reads the mark, never the lock. Only the lock's holder writes
 * the mark, and removes it before the lock goes; a mark whose process is
 * gone is a daemon that died starting. A daemon older than the mark writes
 * none, and a wait reads its start as a stopped daemon, as before row
 * 011-250. Row 011-251 (F1): a spawned daemon takes the lock only once Node
 * started and loaded the CLI, so the hook that spawns it writes a spawn mark
 * beside the start mark, never over it, read for `DAEMON_START_GRACE_MS`;
 * the daemon removes it once it registers.
 */

/** What a start mark holds: the daemon's pid and, on Linux, its start time (`/proc/<pid>/stat` field 22). */
interface StartMark {
  readonly pid: number;
  readonly startTime: number | null;
}

/** The start mark beside the daemon lock file `lockFile`. */
export function startMarkFor(lockFile: AbsolutePath): AbsolutePath {
  return `${lockFile}.starting` as AbsolutePath;
}

/** Row 011-251: the spawn mark beside the daemon lock file `lockFile`. */
export function spawnMarkFor(lockFile: AbsolutePath): AbsolutePath {
  return `${lockFile}.spawned` as AbsolutePath;
}

/**
 * Writes this process's start mark beside `lockFile`, whose lock `lock` it
 * holds, by rename, so a reader never sees half of it. Returns the lock with
 * a release that removes the mark first, while it still holds the lock. A
 * mark that cannot be written costs nothing but the wait's reading.
 */
export function markStart(lockFile: AbsolutePath, lock: DaemonLock): DaemonLock {
  const own: StartMark = { pid: process.pid, startTime: startTimeOf(process.pid) };
  // The wait reads a start whose mark is not written as a stopped daemon.
  writeMark(startMarkFor(lockFile), own);
  let held = true;
  return {
    release() {
      if (held) {
        held = false;
        // Not the spawn mark: a hook may have spawned this daemon's successor.
        removeMark(startMarkFor(lockFile));
      }
      lock.release();
    },
  };
}

/**
 * Removes the start mark beside `lockFile`, and the spawn mark: call only
 * while holding its lock, once registered. A spawn mark written after it
 * reads for `DAEMON_START_GRACE_MS` at most.
 */
export function clearStartMark(lockFile: AbsolutePath): void {
  removeMark(startMarkFor(lockFile));
  removeMark(spawnMarkFor(lockFile));
}

/**
 * Row 011-251 (F1): a hook spawned a daemon at `at`, whose lock is
 * `lockFile`. Written by rename; one that cannot be written costs nothing
 * but the readings of the start. Never throws.
 */
export function markSpawn(lockFile: AbsolutePath, at: EpochMs): void {
  try {
    // A first spawn comes before any daemon made the locks directory.
    mkdirSync(dirname(lockFile), { recursive: true });
  } catch {
    // The write below fails too, and reads as no mark.
  }
  writeMark(spawnMarkFor(lockFile), { at });
}

/**
 * How a daemon with no record starts, as of `now`: `locked`, the process
 * `pid` holds the lock and its start mark names it alive (`startMarked`);
 * `spawned`, a hook spawned one within `DAEMON_START_GRACE_MS` of `now` and
 * none registered since; `since`, when the mark was written. `null` for
 * neither. Takes no lock and never throws.
 */
export function daemonStart(lockFile: AbsolutePath, now: EpochMs): DaemonStart | null {
  const pid = markedPid(lockFile);
  if (pid !== null) return { kind: "locked", since: writtenAt(startMarkFor(lockFile), now), pid };
  const at = spawnedAt(lockFile);
  return at !== null && Math.abs(now - at) <= DAEMON_START_GRACE_MS
    ? { kind: "spawned", since: at }
    : null;
}

/** A start `daemonStart` reads. */
export type DaemonStart =
  | { readonly kind: "locked"; readonly since: EpochMs; readonly pid: number }
  | { readonly kind: "spawned"; readonly since: EpochMs };

/**
 * Whether the start mark beside `lockFile` names a live process: on Linux
 * one with the mark's pid and start time that is not exiting, elsewhere one
 * the pid reaches. No mark, one that cannot be read or parsed, or one whose
 * process is gone: `false`. Takes no lock and never throws.
 */
export function startMarked(lockFile: AbsolutePath): boolean {
  return markedPid(lockFile) !== null;
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

/** The spawn mark's time; `null` with none, or one that cannot be read or parsed. */
function spawnedAt(lockFile: AbsolutePath): EpochMs | null {
  try {
    const mark: unknown = JSON.parse(readFileSync(spawnMarkFor(lockFile), "utf8"));
    if (!isRecord(mark) || typeof mark.at !== "number" || !Number.isFinite(mark.at)) return null;
    return mark.at as EpochMs;
  } catch {
    return null;
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

function writeMark(path: AbsolutePath, mark: object): void {
  try {
    const temp = `${path}.${process.pid}`;
    writeFileSync(temp, JSON.stringify(mark));
    renameSync(temp, path);
  } catch {
    // Read as no mark.
  }
}

function removeMark(path: AbsolutePath): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // A start mark left behind names this process, which a reader checks; a spawn mark lapses.
  }
}

function startTimeOf(pid: number): number | null {
  return process.platform === "linux" ? (lifeOf(pid)?.start ?? null) : null;
}
