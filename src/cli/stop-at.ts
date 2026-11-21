import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveCommit } from "../core/checkout/checkout.js";
import { readCommitWorktree, removeCommitWorktree } from "../core/checkout/commit-worktree.js";
import { cacheCheckoutsRoot, gitCheckoutsDir } from "../core/checkout/location.js";
import { cacheRepositoryDirs, listCheckouts } from "../core/checkout/sweep.js";
import { leaseProcessAlive } from "../core/daemon/lease-process.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { LeaseProcess } from "../core/types/daemon-writes.js";
import { askDaemon, daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import type { StopBounds } from "./stop.js";
import { seconds, socketClosed } from "./stop-waits.js";

/*
 * Spec 023 D7.7 (row 023-38): `squeal stop --at <commit>` stops the commit
 * daemon of each commit worktree of this repository at that commit, waits
 * for its process to go, and removes the worktree. Plain `squeal stop`
 * stops the worktree's own daemon only and never reaches these.
 */

/** Exits 0 once every commit worktree at the commit is gone or none was there, 1 past a bound, 2 on a bad commit. */
export async function stopAt(
  root: AbsolutePath,
  revision: string,
  io: CliIo,
  bounds: StopBounds,
): Promise<number> {
  const commonDir = resolveCommonDir(root);
  let commit: string;
  try {
    if (commonDir === null) throw new Error(`${root} is not a git worktree`);
    commit = await resolveCommit(root, revision);
  } catch (error) {
    const text = error instanceof Error ? error.message.trim() : String(error);
    io.stderr(`squeal stop --at: ${revision} names no commit here: ${text}\n`);
    return 2;
  }
  const cacheRoot = cacheCheckoutsRoot(io.env ?? process.env);
  const trees = listCheckouts([...cacheRepositoryDirs(cacheRoot), gitCheckoutsDir(commonDir)])
    .filter((c) => c.marker?.fingerprint !== undefined)
    .filter((c) => c.marker?.commit === commit && c.marker.commonDir === commonDir)
    .map((c) => c.tree);
  const short = commit.slice(0, 12);
  if (trees.length === 0) {
    io.stdout(`No commit worktree at ${short}\n`);
    return 0;
  }
  let code = 0;
  for (const tree of trees) code = Math.max(code, await stopOne(tree, short, io, bounds));
  return code;
}

async function stopOne(
  tree: AbsolutePath,
  short: string,
  io: CliIo,
  bounds: StopBounds,
): Promise<number> {
  const socketPath = await daemonSocket(tree);
  const response = await askDaemon(socketPath, { type: "stop" }).catch(() => null);
  if (response !== null && !(await socketClosed(socketPath, bounds.socketMs))) {
    io.stdout(
      `Stop requested; the commit daemon at ${short} (${tree}) still serves after ${seconds(bounds.socketMs)}\n`,
    );
    return 1;
  }
  const daemon = readCommitWorktree(tree)?.daemon;
  if (daemon !== undefined && !(await gone(daemon, bounds.lockMs))) {
    io.stdout(
      `Stop requested; the commit daemon at ${short}, pid ${daemon.pid}, is still running after ${seconds(bounds.lockMs)}\n`,
    );
    return 1;
  }
  await removeCommitWorktree(tree, { note: (text) => io.stdout(`${text}\n`) });
  if (existsSync(tree)) {
    io.stdout(`The commit worktree at ${short} is still there: ${tree}\n`);
    return 1;
  }
  const what = response === null ? "No commit daemon ran" : "Commit daemon stopped";
  io.stdout(`${what} at ${short}; removed ${tree}\n`);
  return 0;
}

/** Waits up to `ms` for the daemon to be gone, or for nothing to tell it lives; whether it is. */
async function gone(daemon: LeaseProcess, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (leaseProcessAlive(daemon) === true) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}
