import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/**
 * Where a daemon process lives outside its worktree (spec 001 D10, lessons
 * defect 13): its working directory is the store directory,
 * `<common-dir>/squeal/`, and its temp directory is
 * `<common-dir>/squeal/tmp/<worktree-hash>/`, not the `TMPDIR` of the hook
 * that spawned it, which may be a scratch directory another tool removes.
 */
export interface DaemonScratch {
  readonly workDir: AbsolutePath;
  readonly tempDir: AbsolutePath;
}

export function daemonScratch(commonDir: AbsolutePath, worktreeId: WorktreeId): DaemonScratch {
  const workDir = storePaths(commonDir).dir;
  return { workDir, tempDir: join(workDir, "tmp", worktreeId) };
}

/**
 * Creates the temp directory empty. Called under the daemon lock, so no
 * other daemon of the worktree is using what it removes: a previous daemon
 * that died left its files here.
 */
export function prepareScratch(scratch: DaemonScratch): void {
  rmSync(scratch.tempDir, { recursive: true, force: true });
  mkdirSync(scratch.tempDir, { recursive: true });
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
