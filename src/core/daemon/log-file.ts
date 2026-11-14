import {
  closeSync,
  copyFileSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "../fs/git-layout.js";
import { daemonLogFor } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Row 021-32: the log a spawned daemon keeps. `ensureDaemonProcess` opens
 * `daemonLogFor`'s file for append and gives it to the daemon as stdout and
 * stderr, so every line the daemon logs, and what Node or a crash writes
 * there, lands in it. The daemon prefixes its own lines with the UTC time
 * and its pid (`daemonLogLine`).
 *
 * Bound: a file that reached `DAEMON_LOG_MAX_BYTES` is copied to `<log>.1`,
 * over the previous one, and truncated in place. Truncating keeps the inode,
 * so every process that holds the file, a daemon and its successor alike,
 * keeps writing to the one file a reader finds at the path; with the
 * append flag each write lands at the new end. The spawner rotates before it
 * opens the file, which bounds it across restarts; the daemon rotates after
 * each of its own lines and once a minute, which bounds it while one daemon
 * runs for days, writes outside `log` included.
 */

/** 4 MiB per file, one previous file: at most 8 MiB per worktree, plus what one check lets past. */
export const DAEMON_LOG_MAX_BYTES = 4 * 1024 * 1024;

/** How often the daemon checks its log's size besides after each line it writes. */
const CHECK_MS = 60_000;

/** `<ISO 8601 UTC with ms> [<pid>] <line>`. */
export function daemonLogLine(line: string, at: Date = new Date(), pid = process.pid): string {
  return `${at.toISOString()} [${pid}] ${line}`;
}

/**
 * Copies the log at `path` to `<path>.1` and truncates it, when it holds
 * `maxBytes` or more. Never throws: a log that cannot rotate grows until the
 * next try.
 */
export function rotateDaemonLog(path: AbsolutePath, maxBytes = DAEMON_LOG_MAX_BYTES): void {
  try {
    if (statSync(path).size < maxBytes) return;
    copyFileSync(path, `${path}.1`);
    const fd = openSync(path, "r+");
    try {
      ftruncateSync(fd, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    // A missing file has nothing to rotate; any other failure waits for the next check.
  }
}

/**
 * For a spawn: the descriptor of the log at `path`, opened for append and
 * rotated first, with its directory made; `null` when either cannot be made
 * or opened, so the daemon is spawned with `ignore` as before the log.
 * The caller closes it once the child holds its own copy.
 */
export function openDaemonLog(path: AbsolutePath, maxBytes = DAEMON_LOG_MAX_BYTES): number | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateDaemonLog(path, maxBytes);
    return openSync(path, "a", 0o600);
  } catch {
    return null;
  }
}

/** Writes one line of the daemon to its log; never throws. */
export type DaemonLogSink = (line: string) => void;

/**
 * The sink of the daemon of the worktree at `root` when its stderr is that
 * worktree's log (`daemonLogFor`), as `ensureDaemonProcess` spawns it;
 * `null` otherwise, a daemon run in a terminal among them. The sink writes
 * `daemonLogLine(line)` to stderr and rotates the log at `maxBytes`; a
 * minute's timer, which keeps no process alive, rotates what was written
 * outside it.
 */
export function daemonLogSink(
  root: AbsolutePath,
  maxBytes = DAEMON_LOG_MAX_BYTES,
  fd = 2,
): DaemonLogSink | null {
  const path = stderrLog(root, fd);
  if (path === null) return null;
  const check = () => {
    try {
      if (fstatSync(fd).size >= maxBytes) rotateDaemonLog(path, maxBytes);
    } catch {
      // The next line or minute tries again.
    }
  };
  setInterval(check, CHECK_MS).unref();
  return (line) => {
    try {
      writeSync(fd, `${daemonLogLine(line)}\n`);
    } catch {
      // A full disk or a closed descriptor loses the line, never the daemon.
    }
    check();
  };
}

/** `daemonLogFor`'s path of `root` when descriptor `fd` is that file; else `null`. */
function stderrLog(root: AbsolutePath, fd: number): AbsolutePath | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const path = daemonLogFor(commonDir, worktreeIdFor(root));
    const open = fstatSync(fd);
    const file = statSync(path);
    return open.isFile() && open.ino === file.ino && open.dev === file.dev ? path : null;
  } catch {
    return null;
  }
}
