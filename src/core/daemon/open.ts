import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "../fs/index.js";
import { isStoreOpenFailure, lockFileFor, openStore, worktreeIdFor } from "../store/index.js";
import type {
  AbsolutePath,
  DaemonExit,
  DaemonExitReason,
  EpochMs,
  Store,
  WorktreeId,
} from "../types/index.js";
import { acquireDaemonLock, type DaemonLock } from "./lock.js";
import { noteInNewerStore, writeNote } from "./notes.js";
import { type DaemonScratch, daemonScratch, prepareScratch, removeScratch } from "./scratch.js";

/** What a daemon owns once it won its worktree. */
export interface OpenedDaemon {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly lock: DaemonLock;
  /** Working and temp directory outside the root, the temp directory emptied under the lock. */
  readonly scratch: DaemonScratch;
}

/** The daemon may wait longer on the store than a hook (spec 001 D8: a busy timeout on every connection). */
export const DAEMON_BUSY_TIMEOUT_MS = 5_000;

/**
 * Daemon start up to the open store: realpath of the root; the common dir
 * from git (D1); the worktree id; the exclusive lock (D10), losers exit;
 * the store with `integrity_check` (D12), exiting with a note on a newer
 * schema (D8); then the temp directory, emptied (D10, lessons defect 13). Spec 001 D10 as amended after the wave 3 review: the
 * daemon takes the lock "before opening the store, so losers never run the
 * integrity check".
 */
export async function openDaemon(
  rootArgument: string,
  now: () => EpochMs,
): Promise<OpenedDaemon | DaemonExit> {
  let root: AbsolutePath;
  let commonDir: AbsolutePath;
  try {
    root = realpathSync(rootArgument);
    if (!existsSync(join(root, ".git"))) throw new Error(`${root} has no .git entry`);
    const out = await runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    commonDir = realpathSync(out.trim());
  } catch (error) {
    return exit(
      "not-a-worktree",
      1,
      `${rootArgument} is not a git worktree root: ${message(error)}`,
    );
  }
  const worktreeId = worktreeIdFor(root);

  // Before the store: a loser never runs `integrity_check` (review S8). The
  // lock file needs only the store directory.
  let lock: DaemonLock | null;
  try {
    lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
  } catch (error) {
    return exit("start-failed", 1, `could not take the daemon lock: ${message(error)}`);
  }
  if (lock === null) return exit("lost-lock", 0, `another daemon serves ${root}`);

  let store: Store;
  try {
    const opened = openStore(commonDir, {
      checkIntegrity: true,
      busyTimeoutMs: DAEMON_BUSY_TIMEOUT_MS,
      now,
    });
    if (isStoreOpenFailure(opened)) {
      lock.release();
      if (opened.reason === "newer-schema") {
        const text = `daemon exited: store schema ${opened.found} is newer than this Squeal (supports ${opened.supported})`;
        noteInNewerStore(commonDir, worktreeId, { at: now(), revision: null, text });
        return exit("store-newer", 1, text);
      }
      return exit("store-unusable", 1, `store unusable: ${JSON.stringify(opened)}`);
    }
    store = opened;
  } catch (error) {
    lock.release();
    return exit("store-unusable", 1, `store unusable: ${message(error)}`);
  }
  // After the store, so a start that fails on it leaves no temp directory behind.
  const scratch = daemonScratch(commonDir, worktreeId);
  const daemon = { root, commonDir, worktreeId, store, lock, scratch };
  try {
    prepareScratch(scratch);
  } catch (error) {
    return abandon(
      daemon,
      now,
      undefined,
      `could not prepare ${scratch.tempDir}: ${message(error)}`,
    );
  }
  return daemon;
}

/** A start that failed before the daemon owned anything else: a note, then the store, the temp directory and the lock go. */
export function abandon(
  opened: OpenedDaemon,
  now: () => EpochMs,
  log: ((line: string) => void) | undefined,
  text: string,
): DaemonExit {
  const report = log ?? (() => {});
  writeNote(opened.store, opened.worktreeId, { at: now(), revision: null, text }, report);
  try {
    opened.store.close();
  } catch (error) {
    report(`shutdown: store.close failed: ${message(error)}`);
  }
  try {
    removeScratch(opened.scratch);
  } catch (error) {
    report(`shutdown: temp dir removal failed: ${message(error)}`);
  }
  opened.lock.release();
  return exit("start-failed", 1, text);
}

export function exit(reason: DaemonExitReason, code: 0 | 1, text: string): DaemonExit {
  return { reason, code, message: text };
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
