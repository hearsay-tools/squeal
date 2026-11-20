import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../daemon/client.js";
import { acquireDaemonLock } from "../daemon/lock.js";
import { SMALL_REQUEST_TIMEOUT_MS } from "../delivery/daemon-writer.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import { storeProcessLockPath } from "./paths.js";

/*
 * Spec 021 D22.2 (row 021-36): a relay's last word to the store process
 * when its daemon stops. Review of the rebuild, B1: a store process takes
 * its lock before it serves its socket, so a daemon stopped on purpose
 * while one starts waits a little for that socket instead of leaving it to
 * its grace.
 */

/** How long a leaving relay waits for a starting store process to serve. */
export const STARTING_MS = 2_000;

export interface ReleaseTarget {
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly socketPath: AbsolutePath;
}

/** The daemon leaves: its lease ends, and with `leaving` the store process hears it was stopped on purpose. */
export async function release(
  at: ReleaseTarget,
  token: string | null,
  leaving: boolean,
  startingMs = STARTING_MS,
): Promise<void> {
  if (token === null && leaving) await untilServing(at, startingMs);
  if (token === null && !(leaving && existsSync(at.socketPath))) return;
  const request = {
    type: "release",
    worktreeId: at.worktreeId,
    token: token ?? "-",
    ...(leaving ? { leaving } : {}),
  } as const;
  await requestDaemon(at.socketPath, request, SMALL_REQUEST_TIMEOUT_MS).catch(() => null);
}

/** Waits up to `ms` while a store process holds its lock and has no socket yet. */
async function untilServing(at: ReleaseTarget, ms: number): Promise<void> {
  const lockPath = storeProcessLockPath(at.commonDir, "code");
  const deadline = performance.now() + ms;
  while (!existsSync(at.socketPath) && performance.now() < deadline) {
    const lock = acquireDaemonLock(lockPath);
    lock?.release();
    if (lock !== null) return;
    await sleep(25);
  }
}
