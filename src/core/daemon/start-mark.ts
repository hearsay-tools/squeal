import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isRecord } from "../fs/index.js";
import type { AbsolutePath } from "../types/index.js";
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
 * 011-250.
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

/**
 * Writes this process's start mark beside `lockFile`, whose lock `lock` it
 * holds, by rename, so a reader never sees half of it. Returns the lock with
 * a release that removes the mark first, while it still holds the lock. A
 * mark that cannot be written costs nothing but the wait's reading.
 */
export function markStart(lockFile: AbsolutePath, lock: DaemonLock): DaemonLock {
  const mark = startMarkFor(lockFile);
  const own: StartMark = { pid: process.pid, startTime: startTimeOf(process.pid) };
  try {
    const temp = `${mark}.${process.pid}`;
    writeFileSync(temp, JSON.stringify(own));
    renameSync(temp, mark);
  } catch {
    // The wait reads this start as a stopped daemon.
  }
  let held = true;
  return {
    release() {
      if (held) {
        held = false;
        clearStartMark(lockFile);
      }
      lock.release();
    },
  };
}

/** Removes the start mark beside `lockFile`: call only while holding its lock. */
export function clearStartMark(lockFile: AbsolutePath): void {
  try {
    rmSync(startMarkFor(lockFile), { force: true });
  } catch {
    // A mark left behind names this process, which a reader checks.
  }
}

/**
 * Whether the start mark beside `lockFile` names a live process: on Linux
 * one with the mark's pid and start time that is not exiting, elsewhere one
 * the pid reaches. No mark, one that cannot be read or parsed, or one whose
 * process is gone: `false`. Takes no lock and never throws.
 */
export function startMarked(lockFile: AbsolutePath): boolean {
  let mark: unknown;
  try {
    mark = JSON.parse(readFileSync(startMarkFor(lockFile), "utf8"));
  } catch {
    return false;
  }
  if (!isRecord(mark)) return false;
  const { pid, startTime } = mark;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "linux") {
    const life = lifeOf(pid);
    return life !== null && !life.dying && life.start === startTime;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function startTimeOf(pid: number): number | null {
  return process.platform === "linux" ? (lifeOf(pid)?.start ?? null) : null;
}
