import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveCommit } from "../core/checkout/checkout.js";
import { readCommitWorktree, removeCommitWorktree } from "../core/checkout/commit-worktree.js";
import { cacheCheckoutsRoot, gitCheckoutsDir } from "../core/checkout/location.js";
import { cacheRepositoryDirs, listCheckouts } from "../core/checkout/sweep.js";
import { leaseProcessAlive } from "../core/daemon/lease-process.js";
import { acquireDaemonLock } from "../core/daemon/lock.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { lockFileFor } from "../core/store/paths.js";
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
  // Review 0.1.596 B1: read before the stop. The daemon's exit removes the tree, and a tree git
  // has begun to remove has no marker left to name the process to wait for.
  const before = readCommitWorktree(tree);
  const lockPath = before === null ? null : lockPathOf(tree, before.commonDir);
  const socketPath = await daemonSocket(tree);
  const response = await askDaemon(socketPath, { type: "stop" }).catch(() => null);
  if (response !== null && !(await socketClosed(socketPath, bounds.socketMs))) {
    io.stdout(
      `Stop requested; the commit daemon at ${short} (${tree}) still serves after ${seconds(bounds.socketMs)}\n`,
    );
    return 1;
  }
  const daemon = before?.daemon ?? readCommitWorktree(tree)?.daemon;
  if (daemon !== undefined && !(await gone(daemon, bounds.lockMs))) {
    io.stdout(
      `Stop requested; the commit daemon at ${short}, pid ${daemon.pid}, is still running after ${seconds(bounds.lockMs)}\n`,
    );
    return 1;
  }
  // A daemon that answered without a claim: its exit may still be removing the tree.
  if (daemon === undefined && response !== null && lockPath !== null)
    await treeOrLockGone(tree, lockPath, bounds.lockMs);
  await removeCommitWorktree(tree, { note: (text) => io.stdout(`${text}\n`) });
  if (existsSync(tree)) {
    io.stdout(`The commit worktree at ${short} is still there: ${tree}\n`);
    return 1;
  }
  const what = response === null ? "No commit daemon ran" : "Commit daemon stopped";
  io.stdout(`${what} at ${short}; removed ${tree}\n`);
  return 0;
}

/** The daemon lock of `tree`, while the tree is there to name it; `null` once it is gone. */
function lockPathOf(tree: AbsolutePath, commonDir: AbsolutePath): AbsolutePath | null {
  try {
    return lockFileFor(commonDir, worktreeIdFor(tree));
  } catch {
    return null;
  }
}

/** Waits up to `ms` for `tree` to be gone or for its daemon's lock to be free. */
async function treeOrLockGone(tree: AbsolutePath, path: AbsolutePath, ms: number) {
  const deadline = Date.now() + ms;
  while (existsSync(tree) && existsSync(path) && !lockFree(path)) {
    if (Date.now() > deadline) return;
    await sleep(50);
  }
}

/** The daemon lock at `path`, taken and released at once; a probe that throws proves nothing. */
function lockFree(path: AbsolutePath): boolean {
  try {
    const lock = acquireDaemonLock(path);
    lock?.release();
    return lock !== null;
  } catch {
    return false;
  }
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
