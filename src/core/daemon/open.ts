import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { clearHandoff } from "../delivery/handoff.js";
import { runGit, worktreeIdFor } from "../fs/index.js";
import { isBusy, isStoreOpenFailure, lockFileFor, openStore } from "../store/index.js";
import type {
  AbsolutePath,
  DaemonExit,
  DaemonExitReason,
  EpochMs,
  Store,
  WorktreeId,
} from "../types/index.js";
import { liveDaemonRecorded, recordedDaemon } from "./ensure.js";
import { acquireDaemonLock, awaitDaemonLock, type DaemonLock, type LockWaitEnd } from "./lock.js";
import { VACANT_LOCK_WAIT_MS } from "./lock-wait.js";
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
 * Task 001-161: until it is ready the daemon waits this long on the store.
 * A start that gives up exits, and nothing restarts it before the next hook
 * boundary, while one more wait costs nothing: the socket answers from its
 * own thread. On cezar's store a daemon starting beside another worktree's
 * tier exited 5.03 s after that tier's write transaction began; recording a
 * 198-file tier then held the lock 11 to 67 s.
 */
export const DAEMON_START_BUSY_TIMEOUT_MS = 120_000;

/**
 * Daemon start up to the open store: realpath of the root; the common dir
 * from git (D1); the worktree id; the exclusive lock (D10), losers exit,
 * after a wait for it: a successor's (`awaitLockMs`, task 001-130), or
 * `vacantLockWaitMs` while no daemon is recorded serving and the last one
 * recorded is no newer than this one (tasks 001-340, 001-345); a waiter
 * that takes the lock while the last one recorded is newer exits as a loser
 * too (review 001-347, B2), and one that cannot read it within
 * `decideWithinMs` lets go of the lock and exits as a timed-out wait
 * (review 001-351, B1);
 * the store with `quick_check` (D12; the full check runs after serving, row
 * 011-226) and the start's busy timeout
 * (`DAEMON_START_BUSY_TIMEOUT_MS`), exiting with a note on a newer
 * schema (D8); then the temp directory, emptied (D10, lessons defect 13).
 * Spec 001 D10 as amended after the wave 3 review: the daemon takes the
 * lock "before opening the store, so losers never run the integrity check".
 */
export async function openDaemon(
  rootArgument: string,
  now: () => EpochMs,
  awaitLockMs?: number,
  vacantLockWaitMs = VACANT_LOCK_WAIT_MS,
  decideWithinMs = DAEMON_START_BUSY_TIMEOUT_MS,
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
  let undecided: string | null = null;
  const waitMs = awaitLockMs ?? vacantLockWaitMs;
  try {
    const path = lockFileFor(commonDir, worktreeId);
    lock = acquireDaemonLock(path);
    if (lock === null && waitMs > 0) {
      const giveUp =
        awaitLockMs === undefined
          ? servedElsewhere(root, commonDir, worktreeId, now)
          : takenOver(root);
      lock = await awaitDaemonLock(path, { timeoutMs: waitMs, giveUp });
      // Review 001-347, B2: the wait takes the lock between its checks, so
      // a waiter descheduled across a newer daemon's registration and
      // shutdown takes the lock it freed. Nothing registers while this one
      // holds it, so it decides once more here. Review 001-351, B1: a read
      // that fails proves nothing, so it never counts as no daemon recorded.
      if (typeof lock !== "string") {
        const last = await lastDaemonVersion(commonDir, worktreeId, decideWithinMs);
        if ("unread" in last) {
          lock.release();
          undecided = last.unread;
        } else if (isNewer(last.version)) {
          lock.release();
          lock = "gave-up";
        }
      }
    }
  } catch (error) {
    return exit("start-failed", 1, `could not take the daemon lock: ${message(error)}`);
  }
  if (lock === null || lock === "gave-up") {
    return exit("lost-lock", 0, `another daemon serves ${root}`);
  }
  if (lock === "timed-out") {
    const text =
      awaitLockMs === undefined
        ? `a daemon gave up: the lock was still held after ${waitMs} ms with no daemon serving; the next hook boundary starts one`
        : `a successor daemon gave up: the lock was still held after ${waitMs} ms; the next hook boundary starts one`;
    return lockWaitTimedOut(commonDir, worktreeId, now, text, awaitLockMs !== undefined);
  }
  if (undecided !== null) {
    const text = `a daemon gave up: it took the lock but could not read the last daemon recorded within ${decideWithinMs} ms (${undecided}); the next hook boundary starts one`;
    return lockWaitTimedOut(commonDir, worktreeId, now, text, awaitLockMs !== undefined);
  }

  let store: Store;
  try {
    const opened = openStore(commonDir, {
      checkIntegrity: "quick",
      busyTimeoutMs: DAEMON_START_BUSY_TIMEOUT_MS,
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
 * Task 001-340, the wait of a daemon started without `--await-lock` (a hook's
 * spawn, `squeal start`): waiting on is pointless once the store records a
 * daemon with a fresh heartbeat (another daemon serves, the ordinary loser,
 * which leaves no note), or once the root is gone. While none is recorded the
 * holder is a daemon past its record and its socket, stopping (the
 * shutdown clears both before the lock goes) or one still starting, so the
 * lock comes free or a record appears. Review 001-344, B2: nor does it wait
 * for a daemon newer than itself, the identity the stopping one's cleared
 * record keeps: that is a step-down's old daemon, whose successor takes the
 * lock, and this one, a late older hook's, never starts in its place.
 */
function servedElsewhere(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  now: () => EpochMs,
): () => boolean {
  return () =>
    !existsSync(root) ||
    liveDaemonRecorded(root, now()) ||
    newerRecorded(commonDir, worktreeId, 100);
}

/** The daemon the worktree's row last recorded, cleared or not, is newer than this one; `false` when unread. */
function newerRecorded(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  busyTimeoutMs: number,
): boolean {
  const last = readLastDaemon(commonDir, worktreeId, busyTimeoutMs);
  return "version" in last && isNewer(last.version);
}

function isNewer(version: string | null): boolean {
  return version !== null && isNewerVersion(version, squealVersion());
}

/** What a read of the last recorded daemon found: its version, `null` with none or no store yet, or why it is unknown. */
type LastDaemon =
  | { readonly version: string | null }
  | { readonly unread: string; readonly busy: boolean };

/**
 * Review 001-351, B1: the version of the daemon the worktree's row last
 * recorded, cleared or not, read again while the store is busy until
 * `withinMs` has passed, each read waiting at most `DAEMON_BUSY_TIMEOUT_MS`.
 */
async function lastDaemonVersion(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  withinMs: number,
): Promise<LastDaemon> {
  const deadline = performance.now() + withinMs;
  for (;;) {
    const left = Math.ceil(deadline - performance.now());
    const last = readLastDaemon(
      commonDir,
      worktreeId,
      Math.min(DAEMON_BUSY_TIMEOUT_MS, Math.max(left, 0)),
    );
    if (!("unread" in last) || !last.busy || performance.now() >= deadline) {
      return last;
    }
    await sleep(10);
  }
}

/** One read of the last recorded daemon's version. */
function readLastDaemon(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  busyTimeoutMs: number,
): LastDaemon {
  try {
    const store = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) {
      // The serving open after it refuses a newer schema with its note.
      if (store.reason === "missing" || store.reason === "newer-schema") return { version: null };
      return { unread: `store ${store.reason}`, busy: false };
    }
    try {
      return { version: store.worktrees.lastDaemon(worktreeId)?.squealVersion ?? null };
    } finally {
      store.close();
    }
  } catch (error) {
    return { unread: message(error), busy: isBusy(error) };
  }
}

/**
 * A lock wait ran out with the lock still held: a successor's, or one with
 * no daemon serving (task 001-340). A note says so, written without the
 * lock, beside the holder's; the next hook boundary starts a daemon once the
 * lock is free. A successor's ends the handoff claim in the note's write
 * (row 011-32), so that boundary claims again.
 */
function lockWaitTimedOut(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  now: () => EpochMs,
  text: string,
  successor: boolean,
): DaemonExit {
  try {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: DAEMON_BUSY_TIMEOUT_MS });
    if (!isStoreOpenFailure(store)) {
      const note = () =>
        writeNote(store, worktreeId, { at: now(), revision: null, text }, () => {});
      try {
        store.transaction(() => {
          note();
          if (successor) clearHandoff(store, worktreeId);
        });
      } catch {
        note();
      }
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
