import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { runGit, worktreeIdFor } from "../fs/index.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../store/index.js";
import type {
  AbsolutePath,
  DaemonExit,
  DaemonExitReason,
  EpochMs,
  Store,
  WorktreeId,
} from "../types/index.js";
import { recordedDaemon } from "./ensure.js";
import { acquireDaemonLock, awaitDaemonLock, type DaemonLock, type LockWaitEnd } from "./lock.js";
import { noteInNewerStore, writeNote } from "./notes.js";
import {
  type DaemonScratch,
  daemonScratch,
  type PreparedScratch,
  prepareScratch,
  removeScratch,
} from "./scratch.js";
import { isNewerVersion, squealVersion } from "./version.js";

/** What a daemon owns once it won its worktree. */
export interface OpenedDaemon {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly lock: DaemonLock;
  /** Working and temp directory outside the root, the temp directory emptied under the lock. */
  readonly scratch: DaemonScratch;
  /** Background removal of earlier daemons' temp files; shutdown waits for it. */
  readonly leftovers: Promise<void>;
}

/** The daemon may wait longer on the store than a hook (spec 001 D8: a busy timeout on every connection). */
export const DAEMON_BUSY_TIMEOUT_MS = 5_000;

/**
 * Daemon start up to the open store: realpath of the root; the common dir
 * from git (D1); the worktree id; the exclusive lock (D10), losers exit;
 * the store with `integrity_check` (D12), exiting with a note on a newer
 * schema (D8); then the temp directory, emptied (D10, lessons defect 13).
 * Spec 001 D10 as amended after the wave 3 review: the daemon takes the
 * lock "before opening the store, so losers never run the integrity check".
 */
export async function openDaemon(
  rootArgument: string,
  now: () => EpochMs,
  awaitLockMs?: number,
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
  let lock: DaemonLock | null | LockWaitEnd;
  try {
    const path = lockFileFor(commonDir, worktreeId);
    lock = acquireDaemonLock(path);
    if (lock === null && awaitLockMs !== undefined) {
      lock = await awaitDaemonLock(path, { timeoutMs: awaitLockMs, giveUp: takenOver(root) });
    }
  } catch (error) {
    return exit("start-failed", 1, `could not take the daemon lock: ${message(error)}`);
  }
  if (lock === null || lock === "gave-up") {
    return exit("lost-lock", 0, `another daemon serves ${root}`);
  }
  if (lock === "timed-out") return lockWaitTimedOut(commonDir, worktreeId, now, awaitLockMs ?? 0);

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
  let prepared: PreparedScratch;
  try {
    prepared = prepareScratch(daemonScratch(commonDir, root));
  } catch (error) {
    // Nothing of the temp directory was made.
    const text = `could not prepare a temp directory: ${message(error)}`;
    return giveUp({ worktreeId, store, lock }, now, () => {}, text);
  }
  const { scratch, refusal, leftovers } = prepared;
  if (refusal !== null) {
    writeNote(store, worktreeId, { at: now(), revision: null, text: refusal }, () => {});
  }
  return { root, commonDir, worktreeId, store, lock, scratch, leftovers };
}

/**
 * Task 001-130, the successor's lock wait (`squeal daemon --await-lock`):
 * waiting on is pointless once the store records a daemon other than the
 * one first seen there, or one at least as new as this one, which is never
 * the older daemon it was spawned to replace (another hook's spawn won the
 * lock), or once the root is gone.
 */
function takenOver(root: AbsolutePath): () => boolean {
  const own = squealVersion();
  let first: EpochMs | null | undefined;
  return () => {
    if (!existsSync(root)) return true;
    const record = recordedDaemon(root);
    const startedAt = record?.startedAt ?? null;
    if (first === undefined) first = startedAt;
    if (record === null) return false;
    return startedAt !== first || !isNewerVersion(own, record.squealVersion);
  };
}

/**
 * The successor gives up: the daemon it waited for still holds the lock. A
 * note says so, written without the lock, beside the serving daemon's; the
 * next hook boundary starts a daemon once the lock is free.
 */
function lockWaitTimedOut(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  now: () => EpochMs,
  waitedMs: number,
): DaemonExit {
  const text = `a successor daemon gave up: the lock was still held after ${waitedMs} ms; the next hook boundary starts one`;
  try {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: DAEMON_BUSY_TIMEOUT_MS });
    if (!isStoreOpenFailure(store)) {
      writeNote(store, worktreeId, { at: now(), revision: null, text }, () => {});
      store.close();
    }
  } catch {
    // The exit message still says it.
  }
  return exit("lock-wait-timed-out", 0, text);
}

/**
 * A start that failed before the daemon owned anything else: a note, then
 * the temp directory, once its leftovers are gone, the store and the lock.
 */
export async function abandon(
  opened: OpenedDaemon,
  now: () => EpochMs,
  log: ((line: string) => void) | undefined,
  text: string,
): Promise<DaemonExit> {
  const report = log ?? (() => {});
  await opened.leftovers;
  try {
    removeScratch(opened.scratch);
  } catch (error) {
    report(`shutdown: temp dir removal failed: ${message(error)}`);
  }
  return giveUp(opened, now, report, text);
}

function giveUp(
  opened: Pick<OpenedDaemon, "worktreeId" | "store" | "lock">,
  now: () => EpochMs,
  report: (line: string) => void,
  text: string,
): DaemonExit {
  writeNote(opened.store, opened.worktreeId, { at: now(), revision: null, text }, report);
  try {
    opened.store.close();
  } catch (error) {
    report(`shutdown: store.close failed: ${message(error)}`);
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
