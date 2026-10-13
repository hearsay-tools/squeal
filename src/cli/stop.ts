import { setTimeout as sleep } from "node:timers/promises";
import { recordedDaemon } from "../core/daemon/ensure.js";
import { acquireDaemonLock } from "../core/daemon/lock.js";
import { lstatOrNull, resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { lockFileFor } from "../core/store/index.js";
import type { AbsolutePath } from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";

/** Shutdown waits for the tier in flight (D10); the CLI waits this long before saying so. */
const STOP_WAIT_MS = 60_000;
/**
 * Task 001-340: after its socket goes, the daemon releases its lock, a few
 * milliseconds that an I/O stall on a loaded host stretched past 8 s (task
 * 001-337). The CLI waits this long for it, the wait a daemon spawned
 * meanwhile gives the lock (`VACANT_LOCK_WAIT_MS`).
 */
const LOCK_WAIT_MS = 30_000;

/** `squeal stop [root]`: asks the worktree's daemon to shut down and waits for it to go. */
export async function stopCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal stop [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const ping = await askDaemon(socketPath, { type: "ping" }).catch(() => null);
  const daemon = ping?.ok === true && ping.type === "ping" ? ping : null;
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response === null) {
    io.stdout(`No daemon running for ${root}\n`);
    return 0;
  }
  if (!response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}\n`);
    return 1;
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while ((await askDaemon(socketPath, { type: "ping" }).catch(() => "busy")) !== null) {
    if (Date.now() > deadline) {
      io.stdout(`Stop requested; the daemon for ${root} is finishing the tier in flight\n`);
      return 0;
    }
    await sleep(50);
  }
  const lock = await lockFreed(root, daemon, LOCK_WAIT_MS);
  const after = `${LOCK_WAIT_MS / 1_000} s`;
  if (lock.state === "held") {
    io.stdout(
      `Stop requested; the daemon for ${root} closed its socket but still holds its lock after ${after}\n`,
    );
    return 0;
  }
  if (lock.state === "unchecked") {
    io.stdout(
      `Stop requested; the daemon for ${root} closed its socket, and whether it still holds its lock could not be checked after ${after}: ${lock.error}\n`,
    );
    return 0;
  }
  io.stdout(`Squeal daemon stopped for ${root}\n`);
  return 0;
}

/** How the stopping daemon's lock looked when `lockFreed` answered. */
export type LockCheck =
  | { readonly state: "free" | "held" }
  | { readonly state: "unchecked"; readonly error: string };

/**
 * Whether the stopping daemon let go of the worktree's lock within `ms`
 * (D10): its shutdown closes the socket before it releases the lock, so a
 * daemon whose socket is gone may still hold it. Free when the lock is (taken
 * and released at once, as status probes it, `daemonGone`), when the
 * daemon's process is gone, or when the store records a daemon of another
 * start time, which registers only once it holds the lock: a daemon spawned
 * meanwhile may take the lock the moment it comes free, and its pid may name
 * another process by then. Also free when no common dir or lock file is left
 * to hold, which only a lookup that finds the path missing proves: `existsSync`
 * is false under a directory it cannot search too (review 001-347, B1). A
 * probe or lookup that throws proves nothing (review 001-344, B1): the process
 * and the record still may, and at the bound the lock is `unchecked`.
 */
export async function lockFreed(
  root: AbsolutePath,
  daemon: { readonly pid: number; readonly startedAt: number } | null,
  ms: number,
): Promise<LockCheck> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return { state: "free" };
  const path = lockFileFor(commonDir, worktreeIdFor(root));
  const deadline = Date.now() + ms;
  for (;;) {
    if (missing(path) || (daemon !== null && gone(root, daemon))) return { state: "free" };
    const probe = probeLock(path);
    if (probe.state === "free" || Date.now() > deadline) return probe;
    await sleep(50);
  }
}

/** The daemon's process is gone, or a daemon of another start time registered since. */
function gone(root: AbsolutePath, daemon: { readonly pid: number; readonly startedAt: number }) {
  if (processGone(daemon.pid)) return true;
  const record = recordedDaemon(root);
  return record !== null && record.startedAt !== daemon.startedAt;
}

/** A lookup of `path` says it does not exist; one that fails otherwise proves nothing. */
function missing(path: AbsolutePath): boolean {
  try {
    return lstatOrNull(path) === null;
  } catch {
    return false;
  }
}

/** The lock at `path`, taken and released at once. */
function probeLock(path: AbsolutePath): LockCheck {
  try {
    const lock = acquireDaemonLock(path);
    lock?.release();
    return { state: lock === null ? "held" : "free" };
  } catch (error) {
    return { state: "unchecked", error: error instanceof Error ? error.message : String(error) };
  }
}

/** No process `pid` exists here: signal 0 finds none. */
function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
