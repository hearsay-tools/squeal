import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DaemonLock } from "../daemon/lock.js";
import { lifeOf } from "../daemon/terminate.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { spawnedAt, spawnMarkFor, startMarkFor, stopLockFor, stopMarkFor } from "./marks.js";
import type { StopMark } from "./stored.js";

/*
 * Row 011-294: the presence events stored as marks beside a worktree's
 * daemon lock file (moved from `daemon/start-mark.ts`): start marked, start
 * cleared and spawned. `marks.ts` reads them.
 *
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

/**
 * Start marked: writes this process's start mark beside `lockFile`, whose
 * lock `lock` it holds, by rename, so a reader never sees half of it.
 * Returns the lock with a release that removes the mark first, while it
 * still holds the lock. A mark that cannot be written costs nothing but the
 * wait's reading.
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
 * Start cleared: removes the start mark beside `lockFile`, and the spawn
 * mark. Call only while holding its lock, once registered. A spawn mark
 * written after it reads for `DAEMON_START_GRACE_MS` at most.
 */
export function clearStartMark(lockFile: AbsolutePath): void {
  removeMark(startMarkFor(lockFile));
  removeMark(spawnMarkFor(lockFile));
}

/**
 * Spawned, row 011-251 (F1): a hook spawned a daemon at `at`, whose lock is
 * `lockFile`, after the last heartbeat the store records (`heartbeatAt`,
 * `null` when none is known). Written by rename; one that cannot be
 * written costs nothing but the readings of the start. Never throws. The
 * first spawn since that heartbeat keeps its time, as a rest's does
 * (`spawnedAfterRest`), so a daemon whose starts keep failing reads as
 * stopped once `DAEMON_START_GRACE_MS` passed, whatever spawns follow.
 */
export function markSpawn(lockFile: AbsolutePath, at: EpochMs, heartbeatAt: EpochMs | null): void {
  const first = spawnedAt(lockFile);
  if (first !== null && first <= at && (heartbeatAt === null || heartbeatAt < first)) return;
  try {
    // A first spawn comes before any daemon made the locks directory.
    mkdirSync(dirname(lockFile), { recursive: true });
  } catch {
    // The write below fails too, and reads as no mark.
  }
  writeMark(spawnMarkFor(lockFile), { at });
}

/**
 * Row 021-39 (#285): stopped, `squeal stop`'s mark beside `lockFile`, written
 * by rename from a temp file of its own, so a reader never sees half of it
 * and two writers never share one. No SQLite lock is taken. Throws what the
 * file system throws, so the stop says it was not recorded.
 */
export function writeStopFile(lockFile: AbsolutePath, mark: StopMark): void {
  mkdirSync(dirname(lockFile), { recursive: true });
  const path = stopMarkFor(lockFile);
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temp, JSON.stringify(mark));
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** How long a change of a stop mark waits for another one's lock: each holds it for a file write. */
export const STOP_LOCK_BUSY_MS = 2_000;

/**
 * Row 021-39, review 0.1.639 B1: runs `fn` while this process holds the lock
 * of the stop mark beside `lockFile` (`stopLockFor`), a `BEGIN EXCLUSIVE` on a
 * database of its own, apart from `store.sqlite`, so a read of the mark and
 * the change made from it are one step: no `squeal stop` or `squeal start`
 * lands between them. `fn` is synchronous, so it holds no await. Waits
 * `busyTimeoutMs` for another holder; throws when the lock cannot be taken.
 * The OS releases it on any death.
 */
export function withStopFileLock<T>(
  lockFile: AbsolutePath,
  fn: () => T,
  busyTimeoutMs: number = STOP_LOCK_BUSY_MS,
): T {
  mkdirSync(dirname(lockFile), { recursive: true });
  const db = new DatabaseSync(stopLockFor(lockFile));
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
    // As the daemon lock (spec 001 D10): the file's own lock, held until the connection closes.
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    try {
      return fn();
    } finally {
      db.exec("ROLLBACK");
    }
  } finally {
    db.close();
  }
}

/** Row 021-39: the stop is over; removes the stop mark beside `lockFile`. Throws all but its absence. */
export function removeStopFile(lockFile: AbsolutePath): void {
  try {
    unlinkSync(stopMarkFor(lockFile));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
