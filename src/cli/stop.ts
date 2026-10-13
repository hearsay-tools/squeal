import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireDaemonLock } from "../core/daemon/lock.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
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
  const pid = ping?.ok === true && ping.type === "ping" ? ping.pid : null;
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
  if (!(await lockFreed(root, pid, LOCK_WAIT_MS))) {
    io.stdout(
      `Stop requested; the daemon for ${root} closed its socket but still holds its lock after ${LOCK_WAIT_MS / 1_000} s\n`,
    );
    return 0;
  }
  io.stdout(`Squeal daemon stopped for ${root}\n`);
  return 0;
}

/**
 * Whether the stopping daemon let go of the worktree's lock within `ms`
 * (D10): its shutdown closes the socket before it releases the lock, so a
 * daemon whose socket is gone may still hold it. Free when the lock is (taken
 * and released at once, as status probes it, `daemonGone`) or when the
 * daemon's process `pid` is gone, since a daemon spawned meanwhile may take
 * the lock the moment it comes free. Also true when no common dir or lock
 * file is left to hold, or when the lock cannot be probed: nothing proves a
 * holder then.
 */
async function lockFreed(root: AbsolutePath, pid: number | null, ms: number): Promise<boolean> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return true;
  const path = lockFileFor(commonDir, worktreeIdFor(root));
  const deadline = Date.now() + ms;
  for (;;) {
    if (!existsSync(path) || (pid !== null && processGone(pid))) return true;
    try {
      const lock = acquireDaemonLock(path);
      lock?.release();
      if (lock !== null) return true;
    } catch {
      return true;
    }
    if (Date.now() > deadline) return false;
    await sleep(50);
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
