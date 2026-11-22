import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { leaseProcess, leaseProcessAlive } from "../daemon/lease-process.js";
import { lstatOrNull, resolveCommonDir } from "../fs/git-layout.js";
import { installCommand } from "../scheduler/install-command.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import type { LeaseProcess } from "../types/daemon-writes.js";
import {
  addCheckout,
  type Checkout,
  removeTree,
  resolveCommit,
  withCheckoutLock,
  withFileLock,
} from "./checkout.js";
import {
  type CommitRemoval,
  commitFolderName,
  commitIdentity,
  isCheckoutLocation,
  pathState,
  removeCommitFolder,
  treelessCommitFolder,
} from "./commit-identity.js";
import {
  commitWorktreeCeiling,
  environmentFingerprint,
  liveCommitWorktrees,
  placesLockPath,
  registerPlace,
  waitsLine,
} from "./commit-places.js";
import { COMMIT_INSTALL_TIMEOUT_MS, installCommitWorktree } from "./commit-setup.js";
import { type InstallResult, manifestOf } from "./install.js";
import {
  cacheCheckoutsDir,
  cacheCheckoutsRoot,
  gitCheckoutsDir,
  locateCheckouts,
  PACKAGE_STORE_TIMEOUT_MS,
  packageStore,
} from "./location.js";
import {
  type CheckoutMarker,
  ownerOf,
  ownerState,
  readMarker,
  treePath,
  writeMarker,
} from "./marker.js";

/*
 * Spec 023 D7.1, D7.4 (row 023-38): the commit worktree. One per
 * (repository, commit, environment fingerprint), in the checkout folder of
 * D4.2 under a name those three fix, so every caller of every worktree of
 * the repository finds the same one under the checkout lock. Its marker is
 * the checkout marker with the fingerprint; its owner is the creator until
 * the commit daemon claims it (`claimCommitWorktree`, row 023-39), and the
 * sweep removes it once that owner is gone. The frozen install runs once,
 * under a lock in its folder: a second caller waits for it and installs
 * nothing. This module starts no daemon (row 023-40 does).
 */

/** How long a creator waits for a place under the ceiling before it gives up. */
export const PLACE_WAIT_MS = 10 * 60_000;
const PLACE_POLL_MS = 1_000;

export { COMMIT_INSTALL_TIMEOUT_MS };

/** What a commit worktree's marker says, for its daemon (row 023-39). */
export interface CommitWorktreeMarker {
  readonly commit: string;
  readonly fingerprint: string;
  readonly commonDir: AbsolutePath;
  readonly createdAt: EpochMs;
  /** The daemon that claimed it, once one did. */
  readonly daemon?: LeaseProcess;
}

export interface CommitWorktree {
  /** The git worktree at `commit`: the commit daemon's root. */
  readonly tree: AbsolutePath;
  /** The folder that holds the tree and its marker. */
  readonly folder: AbsolutePath;
  readonly commit: string;
  readonly fingerprint: string;
  readonly commonDir: AbsolutePath;
}

export interface EnsureCommitWorktreeOptions {
  /** The user's worktree: git resolves `commit` there. */
  readonly root: AbsolutePath;
  /** Any revision that names a commit. */
  readonly commit: string;
  /** The checkouts dir for this repository; `locateCheckouts` chooses it by default (D4.2). */
  readonly dir?: AbsolutePath;
  /** `cacheCheckoutsRoot()` by default: where the ceiling counts every repository's worktrees. */
  readonly cacheRoot?: AbsolutePath;
  /** The allow-listed environment variables the fingerprint covers. */
  readonly environment?: Readonly<Record<string, string>>;
  /** The configured ceiling; else one from free memory (`commitWorktreeCeiling`). */
  readonly limit?: number;
  /** Tests: the free memory the ceiling reads. */
  readonly freeBytes?: () => number;
  readonly install?: (
    tree: AbsolutePath,
    started: (group: number) => void,
  ) => Promise<InstallResult>;
  /**
   * Row 023-40c (D7.3 as amended 2026-11-21): `false` makes the worktree
   * with no install; its daemon installs it (`installCommitWorktree`).
   */
  readonly installs?: boolean;
  readonly placeWaitMs?: number;
  readonly pollMs?: number;
  readonly lockWaitMs?: number;
  /**
   * Spec 023 D7.3 (review wave-23-third B1): epoch ms by which the package
   * store's query and git's worktree steps end (a call's bound); absent:
   * their own timeouts.
   */
  readonly deadline?: number;
  /** Told once when the ceiling makes the call wait, and of processes a removal ended. */
  readonly note?: (text: string) => void;
}

/** D7.1: finds or makes the commit worktree at `commit`, installed; starts no daemon. */
export async function ensureCommitWorktree(
  options: EnsureCommitWorktreeOptions,
): Promise<CommitWorktree> {
  const commonDir = resolveCommonDir(options.root);
  if (commonDir === null) throw new Error(`squeal: ${options.root} is not a git worktree`);
  const commit = await resolveCommit(options.root, options.commit);
  const fingerprint = environmentFingerprint(options.environment);
  const cacheRoot = options.cacheRoot ?? cacheCheckoutsRoot();
  const dir =
    options.dir ??
    (await locatedDir(options.root, commonDir, cacheRoot, options.note, options.deadline));
  // Review wave-22 B1: a commit worktree lies only where `commitIdentity` looks for one.
  if (!isCheckoutLocation(dir, commonDir))
    throw new Error(`squeal: ${dir} is not a checkout location of ${commonDir} (D4.2)`);
  const located = { ...options, cacheRoot, dir, commonDir, commit, fingerprint };
  const checkout = await placeFor(located);
  const worktree = { tree: checkout.tree, folder: checkout.folder, commit, fingerprint, commonDir };
  // Row 023-40c (D7.3 as amended): with `installs: false` the commit daemon installs it.
  if (options.installs !== false) await installOnce(worktree, options);
  return worktree;
}

/** D4.2: the cache's dir when it shares the package store's filesystem, else the git folder's. */
async function locatedDir(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  cacheRoot: AbsolutePath,
  note?: (text: string) => void,
  deadline?: number,
): Promise<AbsolutePath> {
  const command = await installCommand(root, await manifestOf(root));
  const left =
    deadline === undefined ? undefined : Math.min(PACKAGE_STORE_TIMEOUT_MS, deadline - Date.now());
  const store = await packageStore(root, command, left);
  const location = locateCheckouts({ commonDir, cacheRoot, store, root });
  if (location.warning !== null) note?.(location.warning);
  return location.dir;
}

type Place = Pick<Checkout, "folder" | "tree">;

/** The checkout lock's wait: `lockWaitMs`, cut to what is left of `deadline` (review wave-23-fourth B1). */
function remainingWait(options: {
  readonly lockWaitMs?: number | undefined;
  readonly deadline?: number | undefined;
}): number | undefined {
  if (options.deadline === undefined) return options.lockWaitMs;
  const left = Math.max(0, options.deadline - Date.now());
  return options.lockWaitMs === undefined ? left : Math.min(options.lockWaitMs, left);
}

/** Finds the worktree, takes over one whose owner is gone, or makes it when the ceiling has a place. */
async function placeFor(
  options: EnsureCommitWorktreeOptions & {
    readonly cacheRoot: AbsolutePath;
    readonly dir: AbsolutePath;
    readonly commonDir: AbsolutePath;
    readonly commit: string;
    readonly fingerprint: string;
  },
): Promise<Place> {
  const { root, commonDir, commit, fingerprint, cacheRoot } = options;
  const name = commitFolderName(commit, fingerprint);
  const dirs = [cacheCheckoutsDir(cacheRoot, commonDir), gitCheckoutsDir(commonDir), options.dir];
  const deadline = performance.now() + (options.placeWaitMs ?? PLACE_WAIT_MS);
  let told = false;
  for (;;) {
    const got = await withCheckoutLock(
      commonDir,
      async (): Promise<Place | string> => {
        const found = await foundPlace(dirs, name, commonDir, options.note);
        if (found !== null) {
          // Review wave-22 B3: a worktree made before a lost registration is counted again.
          registerPlace(cacheRoot, found.folder);
          return found;
        }
        // Review wave-23-fourth B1: the places lock waits only what is left of the call's deadline.
        const placesWait =
          options.deadline === undefined ? undefined : Math.max(0, options.deadline - Date.now());
        return withFileLock(
          placesLockPath(cacheRoot),
          "the commit worktrees' lock",
          async () => {
            // Review wave-22 B3: every repository's worktrees, the git-folder ones included.
            const live = liveCommitWorktrees(cacheRoot, dirs);
            const configured = options.limit;
            const freeBytes = options.freeBytes?.();
            const ceiling = commitWorktreeCeiling({ configured, freeBytes, live: live.length });
            if (live.length >= ceiling) return waitsLine(live, ceiling);
            registerPlace(cacheRoot, join(options.dir, name));
            const extra = { fingerprint };
            const until = options.deadline === undefined ? {} : { deadline: options.deadline };
            return addCheckout({
              root,
              commonDir,
              commit,
              dir: options.dir,
              name,
              extra,
              ...until,
            });
          },
          placesWait,
        );
      },
      remainingWait(options),
    );
    if (typeof got !== "string") return got;
    if (performance.now() >= deadline)
      throw new Error(
        `${got}; gave up after ${Math.round((options.placeWaitMs ?? PLACE_WAIT_MS) / 1000)} s`,
      );
    if (!told) options.note?.(got);
    told = true;
    await sleep(options.pollMs ?? PLACE_POLL_MS);
  }
}

/**
 * The worktree named `name` in one of `dirs`, under the checkout lock. One
 * whose owner is gone is taken over: this process owns it until a daemon
 * claims it. A folder without a commit worktree's marker and a whole tree
 * is removed, to be made anew. A tree that is not one Squeal made stays,
 * and the call fails (review wave-22 B1); so does every file beside it when
 * the folder has a commit worktree's marker (review wave-23 N1).
 */
async function foundPlace(
  dirs: readonly AbsolutePath[],
  name: string,
  commonDir: AbsolutePath,
  note?: (text: string) => void,
): Promise<Place | null> {
  for (const dir of new Set(dirs)) {
    const folder = join(dir, name);
    // Review wave-22 N3: a folder it cannot read fails the call; it is not missing.
    if (lstatOrNull(folder) === null) continue;
    const tree = treePath(folder);
    const marker = readMarker(folder);
    // Review wave-22 N2: a folder a removal kept loses only Squeal's files; the tree is made beside the rest.
    const treeless = marker?.commonDir === commonDir ? treelessCommitFolder(folder, marker) : null;
    if (treeless !== null) {
      if ((await removeCommitFolder(treeless, note)) !== "removed")
        throw new Error(`squeal: could not clear ${folder} for a new commit worktree`);
      continue;
    }
    // Review wave-23 N1: a folder with a commit worktree's marker is never removed whole.
    if (
      marker?.fingerprint === undefined &&
      (marker === null ||
        marker.commonDir !== commonDir ||
        lstatOrNull(join(tree, ".git")) === null)
    ) {
      await removeTree({ folder, tree, commonDir }, note);
      continue;
    }
    if (commitIdentity(tree) === null)
      throw new Error(`squeal: ${tree} is in the way: it is not a commit worktree Squeal made`);
    if (ownerState(marker) === "dead") writeMarker(folder, takenOver(marker));
    return { folder, tree };
  }
  return null;
}

function takenOver(marker: CheckoutMarker): CheckoutMarker {
  const { daemon: _gone, group: _ended, ...rest } = marker;
  return { ...rest, owner: leaseProcess() };
}

/** D7.1: the frozen install, once (`installCommitWorktree`); a failed one removes the worktree. */
async function installOnce(
  worktree: CommitWorktree,
  options: EnsureCommitWorktreeOptions,
): Promise<void> {
  const failed = await installCommitWorktree(
    worktree.tree,
    options.install === undefined ? {} : { install: options.install },
  );
  if (failed === null) return;
  // A failed frozen install fails again: the next call starts from a new checkout.
  await removeCommitWorktree(worktree.tree, options);
  throw new Error(`squeal: ${failed}`);
}

/**
 * Row 023-39: the marker when `root` is the tree of a commit worktree Squeal
 * made (`commitIdentity`, review wave-22 B1), else `null`.
 */
export function readCommitWorktree(root: AbsolutePath): CommitWorktreeMarker | null {
  const identity = commitIdentity(root);
  if (identity === null) return null;
  const { commit, fingerprint, commonDir, createdAt, daemon } = identity.marker;
  return { commit, fingerprint, commonDir, createdAt, ...(daemon === undefined ? {} : { daemon }) };
}

/**
 * Row 023-39: the commit daemon records itself as the owner, once it holds
 * its daemon lock. The sweep removes the worktree when that daemon is gone.
 */
export function claimCommitWorktree(tree: AbsolutePath): void {
  const identity = commitIdentity(tree);
  if (identity === null) throw new Error(`squeal: ${tree} is not a commit worktree`);
  writeMarker(identity.folder, { ...identity.marker, daemon: leaseProcess() });
}

export interface RemoveCommitWorktreeOptions {
  readonly note?: ((text: string) => void) | undefined;
  readonly lockWaitMs?: number | undefined;
}

/**
 * D7.2, D6: removes the commit worktree at `tree` under the checkout lock:
 * the processes left under it end (the caller and its ancestors are
 * spared), then git removes the tree and the folder's own files go; a file
 * Squeal did not make stays (`removeCommitFolder`). Its daemon calls it at
 * exit; a worktree another live process owns now (a caller took it over)
 * stays. Nothing when `tree` is not a commit worktree Squeal made, checked
 * again under the lock (review wave-22 B1), or is gone; it never throws: a
 * failure goes to `note`, and the sweep removes the rest once the owner is
 * gone. It says what is left of the tree: `unknown` when it cannot read
 * the tree, never `removed` (review wave-22 N3).
 */
export async function removeCommitWorktree(
  tree: AbsolutePath,
  options: RemoveCommitWorktreeOptions = {},
): Promise<CommitRemoval> {
  // Review wave-22 N3: a tree it cannot read is not one it removed.
  const before = pathState(tree);
  if (before === "unknown") {
    options.note?.(`squeal: could not read ${tree}: it may still be there`);
    return before;
  }
  const first = commitIdentity(tree);
  if (first === null) return pathState(tree);
  try {
    return await withCheckoutLock(
      first.marker.commonDir,
      async (): Promise<CommitRemoval> => {
        const identity = commitIdentity(tree);
        if (identity === null || identity.folder !== first.folder) return pathState(tree);
        const owner = ownerOf(identity.marker);
        if (owner.pid !== process.pid && leaseProcessAlive(owner) === true) {
          options.note?.(`squeal: kept ${tree}: pid ${owner.pid} owns it now`);
          return "kept";
        }
        return removeCommitFolder(identity, options.note);
      },
      options.lockWaitMs,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    options.note?.(`squeal: could not remove ${tree}: ${text}`);
    return pathState(tree);
  }
}
