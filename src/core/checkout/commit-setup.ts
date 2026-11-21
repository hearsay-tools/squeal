import { join } from "node:path";
import { leaseProcess } from "../daemon/lease-process.js";
import { awaitDaemonLock } from "../daemon/lock.js";
import type { AbsolutePath } from "../types/common.js";
import { CHECKOUT_LOCK_WAIT_MS } from "./checkout.js";
import { commitIdentity } from "./commit-identity.js";
import { type InstallResult, installCheckout } from "./install.js";
import { readMarker, recordGroup, writeMarker } from "./marker.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c, the human: "A: daemon
 * owns setup"): a `status --at --run` call makes the commit worktree with
 * no install and spawns its daemon; the daemon claims the worktree, then
 * installs it here, once, under the folder's install lock. A failed
 * install leaves the worktree: its daemon says why to every caller until
 * it exits, and its exit removes the worktree (D7.2). Between the spawn
 * and the claim the spawned process owns the worktree (`ownedByStart`),
 * so the sweep keeps it while that process lives, even when the call that
 * made it ended first (review wave-23 re-review, the ownership gap).
 */

/** The frozen install's budget (D4.3). */
export const COMMIT_INSTALL_TIMEOUT_MS = 300_000;

/** An install of the tree; `started` hears its process group's leader. */
export type CommitInstall = (
  tree: AbsolutePath,
  started: (group: number) => void,
) => Promise<InstallResult>;

export interface CommitInstallOptions {
  /** Tests: the install; a frozen install by default (D4.3). */
  readonly install?: CommitInstall;
  /** The install's budget; `COMMIT_INSTALL_TIMEOUT_MS` by default. */
  readonly timeoutMs?: number;
  /** How long to wait for another installer's lock; the install's budget and a minute by default. */
  readonly lockWaitMs?: number;
}

/**
 * D7.1: the frozen install of the commit worktree at `tree`, once: under
 * the folder's lock, skipped when the marker says done. `null` once
 * installed, else why not. Nothing is removed here.
 */
export async function installCommitWorktree(
  tree: AbsolutePath,
  options: CommitInstallOptions = {},
): Promise<string | null> {
  const identity = commitIdentity(tree);
  if (identity === null) return `${tree} is not a commit worktree Squeal made`;
  const { folder } = identity;
  const timeoutMs = options.timeoutMs ?? COMMIT_INSTALL_TIMEOUT_MS;
  const lock = await awaitDaemonLock(join(folder, "install.lock"), {
    timeoutMs: options.lockWaitMs ?? timeoutMs + CHECKOUT_LOCK_WAIT_MS,
    giveUp: () => false,
  });
  if (typeof lock === "string") return `the install of ${tree} did not end within ${timeoutMs} ms`;
  try {
    if (readMarker(folder)?.installed === true) return null;
    const started = (group: number) => {
      try {
        recordGroup(folder, leaseProcess(group));
      } catch {
        // No marker to record in: the sweep removes such a folder without its group.
      }
    };
    const install =
      options.install ?? ((t: AbsolutePath, s) => installCheckout(t, { timeoutMs, started: s }));
    const result = await install(identity.tree, started);
    if (!result.ok) return `the install in ${tree} failed: ${result.command}: ${result.reason}`;
    const marker = readMarker(folder);
    if (marker !== null) writeMarker(folder, { ...marker, installed: true });
    return null;
  } finally {
    lock.release();
  }
}

/**
 * Review wave-23 re-review B1 (the ownership gap): the daemon process
 * `pid`, just spawned in `tree`, owns the commit worktree from now on, as
 * its creator did, so the sweep keeps it while that process lives. A
 * daemon that already claimed it stays the owner; `false` then, or when
 * `tree` is not a commit worktree.
 */
export function ownedByStart(tree: AbsolutePath, pid: number): boolean {
  const identity = commitIdentity(tree);
  if (identity === null || identity.marker.daemon !== undefined) return false;
  writeMarker(identity.folder, { ...identity.marker, owner: leaseProcess(pid) });
  return true;
}
