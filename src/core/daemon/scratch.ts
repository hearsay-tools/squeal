import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";
import { currentUid, preparePrivateDir, userTmpDir } from "./paths.js";

/**
 * Where a daemon process lives outside its worktree (spec 001 D10, lessons
 * defect 13): its working directory is the store directory,
 * `<common-dir>/squeal/`, and its temp directory is
 * `/tmp/squeal-<uid>/tmp/<worktree-hash>/`. Not the `TMPDIR` of the hook
 * that spawned it, which may be a scratch directory another tool removes,
 * and not under the store, because a test that makes a temp directory must
 * not find itself inside a repository (review wave 7.6, B1).
 */
export interface DaemonScratch {
  readonly workDir: AbsolutePath;
  /** `/tmp/squeal-<uid>`, private to this user, made like the socket fallback directory. */
  readonly userDir: AbsolutePath;
  readonly tempDir: AbsolutePath;
}

export function daemonScratch(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  uid: number = currentUid(),
): DaemonScratch {
  const userDir = userTmpDir(uid);
  return { workDir: storePaths(commonDir).dir, userDir, tempDir: join(userDir, "tmp", worktreeId) };
}

/**
 * Creates the temp directory empty, inside a user directory that must be
 * private (`preparePrivateDir`). Called under the daemon lock, so no other
 * daemon of the worktree is using what it removes: a previous daemon that
 * died left its files here.
 */
export function prepareScratch(scratch: DaemonScratch, uid: number = currentUid()): void {
  preparePrivateDir(scratch.userDir, uid, "temp directory");
  rmSync(scratch.tempDir, { recursive: true, force: true });
  mkdirSync(scratch.tempDir, { recursive: true });
}

/**
 * Removes the temp directory at shutdown, after the runner closed and before
 * the lock goes, so nothing of a retired worktree stays behind (review wave
 * 7.6, S1) and no successor is using it yet.
 */
export function removeScratch(scratch: DaemonScratch): void {
  rmSync(scratch.tempDir, { recursive: true, force: true });
}

/**
 * Moves this process into its scratch: working directory and `TMPDIR`,
 * `TMP` and `TEMP`, which Vitest reads through `os.tmpdir()` when an instance
 * is created and its workers inherit. Only for a process that is the daemon
 * (`squeal daemon`); a daemon started inside a test must not change a shared
 * process. Spec 001 D11's "with no additions" has this one exception.
 */
export function adoptScratch(scratch: DaemonScratch): void {
  process.chdir(scratch.workDir);
  process.env.TMPDIR = scratch.tempDir;
  process.env.TMP = scratch.tempDir;
  process.env.TEMP = scratch.tempDir;
}

/**
 * Runs runner calls with the worktree root as the working directory, and
 * returns to `scratch.workDir` once none is in flight. Vitest starts its
 * test workers in the daemon's working directory and never changes it, and
 * project configs and tests resolve relative paths against it, so they must
 * see the root as `vitest run` from the root would; between calls the daemon
 * holds nothing inside the root. A root that is gone is left to the call to
 * fail on, and to D10 to end the daemon.
 */
export function inRootWhileRunning(
  root: AbsolutePath,
  scratch: DaemonScratch,
): <T>(call: () => Promise<T>) => Promise<T> {
  let inFlight = 0;
  return async (call) => {
    if (inFlight++ === 0) chdirQuietly(root);
    try {
      return await call();
    } finally {
      if (--inFlight === 0) chdirQuietly(scratch.workDir);
    }
  };
}

function chdirQuietly(dir: AbsolutePath): void {
  try {
    process.chdir(dir);
  } catch {
    // Left where it was; the next call or D10 deals with a missing directory.
  }
}
