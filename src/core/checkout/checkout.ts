import { randomBytes } from "node:crypto";
import { constants, copyFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { leaseProcess } from "../daemon/lease-process.js";
import { awaitDaemonLock, type DaemonLock } from "../daemon/lock.js";
import { runGit } from "../fs/git.js";
import { lstatOrNull } from "../fs/git-layout.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { runPath, treePath, writeMarker } from "./marker.js";

/*
 * Spec 023 D4.1, D4.2, D4.8 (row 023-05): create and remove a temporary
 * checkout at a commit. Both take the repository's checkout lock and run
 * `git worktree prune`, as squawk's `withWorktreeMutation` does
 * (`temp-checkout.md` 4). The tree is a detached worktree, locked with the
 * reason `squeal`, so no `prune` of another process removes a live one.
 */

/** How long create and remove wait for another process's checkout lock. */
export const CHECKOUT_LOCK_WAIT_MS = 60_000;
/** How long a stopped process group gets between SIGTERM and SIGKILL. */
export const STOP_GRACE_MS = 5_000;
const GIT_TIMEOUT_MS = 120_000;

export interface Checkout {
  /** `<checkouts dir>/<id>`: the marker, the tree and the run folder. */
  readonly folder: AbsolutePath;
  /** The git worktree at `commit`. */
  readonly tree: AbsolutePath;
  /** The run's `TMPDIR`, created empty. */
  readonly run: AbsolutePath;
  readonly commit: string;
  readonly commonDir: AbsolutePath;
}

export interface CreateCheckoutOptions {
  /** The user's worktree: git resolves `commit` there. */
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  /** A commit id or any revision git resolves to a commit. */
  readonly commit: string;
  /** The checkouts dir `locateCheckouts` chose. */
  readonly dir: AbsolutePath;
  readonly now?: () => EpochMs;
  readonly lockWaitMs?: number;
}

/** The repository's checkout lock: create, remove and sweep hold it. */
export function checkoutLockPath(commonDir: AbsolutePath): AbsolutePath {
  return join(commonDir, "squeal", "checkouts.lock");
}

/** Runs `body` while holding the repository's checkout lock. */
export async function withCheckoutLock<T>(
  commonDir: AbsolutePath,
  body: () => Promise<T>,
  waitMs: number = CHECKOUT_LOCK_WAIT_MS,
): Promise<T> {
  const lock: DaemonLock | string = await awaitDaemonLock(checkoutLockPath(commonDir), {
    timeoutMs: waitMs,
    giveUp: () => false,
  });
  if (typeof lock === "string")
    throw new Error(`squeal: the checkout lock of ${commonDir} stayed held for ${waitMs} ms`);
  try {
    return await body();
  } finally {
    lock.release();
  }
}

/** D4.1, D4.2: lock, prune, marker, then `git worktree add --detach --lock --reason squeal`. */
export async function createCheckout(options: CreateCheckoutOptions): Promise<Checkout> {
  const { root, commonDir, dir } = options;
  const commit = (
    await runGit(root, ["rev-parse", "--verify", "--end-of-options", `${options.commit}^{commit}`])
  ).trim();
  return withCheckoutLock(
    commonDir,
    async () => {
      await runGit(commonDir, ["worktree", "prune"], { timeoutMs: GIT_TIMEOUT_MS });
      const folder = join(dir, `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`);
      mkdirSync(folder, { recursive: true });
      const checkout = {
        folder,
        tree: treePath(folder),
        run: runPath(folder),
        commit,
        commonDir,
      };
      try {
        writeMarker(folder, {
          v: 1,
          owner: leaseProcess(),
          commit,
          commonDir,
          createdAt: (options.now ?? Date.now)(),
        });
        mkdirSync(checkout.run);
        await runGit(
          root,
          ["worktree", "add", "--detach", "--lock", "--reason", "squeal", checkout.tree, commit],
          { timeoutMs: GIT_TIMEOUT_MS },
        );
      } catch (error) {
        await removeTree(checkout);
        throw error;
      }
      return checkout;
    },
    options.lockWaitMs,
  );
}

/**
 * D5.2: copies `files`, paths relative to `from`, into the checkout's tree,
 * creating their folders. A path that leaves the tree is refused. No write
 * follows a symlink (review wave-1 B3): a parent folder that is a symlink is
 * refused, and the file at the destination, a symlink included, is removed
 * and created anew, so a link an old commit tracks never carries the copy
 * into the user's tree.
 */
export function copyIntoCheckout(
  checkout: Pick<Checkout, "tree">,
  from: AbsolutePath,
  files: readonly string[],
): void {
  for (const file of files) {
    const relative = normalize(file);
    if (isAbsolute(relative) || relative === ".." || relative.startsWith(`..${sep}`))
      throw new Error(`squeal: ${file} is not a path inside the tree`);
    const parts = relative.split(sep).filter((part) => part !== "" && part !== ".");
    const name = parts.pop();
    if (name === undefined) throw new Error(`squeal: ${file} names no file`);
    let folder = checkout.tree;
    for (const part of parts) {
      folder = join(folder, part);
      ownFolder(folder, file);
    }
    const target = join(folder, name);
    const existing = lstatOrNull(target);
    if (existing?.isDirectory()) throw new Error(`squeal: ${file} is a folder in the checkout`);
    if (existing !== null) unlinkSync(target);
    // Exclusive: a link made at `target` since the unlink fails the copy, never takes it.
    copyFileSync(join(from, relative), target, constants.COPYFILE_EXCL);
  }
}

/** Makes `folder` when missing; refuses a symlink or a file there. */
function ownFolder(folder: AbsolutePath, file: string): void {
  const stats = lstatOrNull(folder);
  if (stats === null) {
    mkdirSync(folder);
    return;
  }
  if (stats.isSymbolicLink())
    throw new Error(`squeal: ${file} lies under a symlink in the checkout (${folder})`);
  if (!stats.isDirectory()) throw new Error(`squeal: ${file} lies under a file in the checkout`);
}

export interface RemoveCheckoutOptions {
  /** The run's process group: SIGTERM, then SIGKILL after `STOP_GRACE_MS`. */
  readonly group?: number;
  readonly lockWaitMs?: number;
}

/** D4.8: stop the group, then unlock, `remove --force`, delete the folder and `prune`, under the lock. */
export async function removeCheckout(
  checkout: Pick<Checkout, "folder" | "tree" | "commonDir">,
  options: RemoveCheckoutOptions = {},
): Promise<void> {
  if (options.group !== undefined) await stopGroup(options.group);
  await withCheckoutLock(checkout.commonDir, () => removeTree(checkout), options.lockWaitMs);
}

/** The removal steps, for a caller that holds the lock. Each step goes on when the one before failed. */
export async function removeTree(
  checkout: Pick<Checkout, "folder" | "tree" | "commonDir">,
): Promise<void> {
  const { commonDir, tree } = checkout;
  const lenient = { okCodes: [0, 1, 128], timeoutMs: GIT_TIMEOUT_MS };
  await runGit(commonDir, ["worktree", "unlock", tree], lenient).catch(() => "");
  await runGit(commonDir, ["worktree", "remove", "--force", tree], lenient).catch(() => "");
  rmSync(checkout.folder, { recursive: true, force: true, maxRetries: 3 });
  await runGit(commonDir, ["worktree", "prune"], lenient).catch(() => "");
}

/** SIGTERM to the group, then SIGKILL when it still lives after the grace. */
export async function stopGroup(group: number, graceMs: number = STOP_GRACE_MS): Promise<void> {
  // Group 0 is the caller's own; 1 is init's.
  if (!Number.isInteger(group) || group <= 1)
    throw new Error(`squeal: ${group} is not a process group to stop`);
  if (!signalGroup(group, "SIGTERM")) return;
  const deadline = performance.now() + graceMs;
  while (performance.now() < deadline) {
    await sleep(50);
    if (!signalGroup(group, 0)) return;
  }
  signalGroup(group, "SIGKILL");
}

/** False once no process of the group is left. */
function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}
