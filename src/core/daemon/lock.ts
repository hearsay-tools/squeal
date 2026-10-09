import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { isBusy } from "../store/index.js";
import type { AbsolutePath } from "../types/index.js";

/** The daemon singleton, held for the life of the process. */
export interface DaemonLock {
  /** Idempotent. The OS also releases it when the process dies, however it dies. */
  release(): void;
}

/**
 * Takes the per-worktree singleton lock, or returns `null` when another
 * process holds it.
 *
 * Spec 001 D10: "The daemon takes `BEGIN EXCLUSIVE` with
 * `locking_mode=EXCLUSIVE` on `locks/<worktree-hash>.sqlite` and holds it for
 * life. Losers exit. The lock is released by the OS on any death, so no pid
 * file exists and pid reuse cannot fool it." No busy timeout: a loser gives
 * up at once.
 */
export function acquireDaemonLock(path: AbsolutePath): DaemonLock | null {
  const db = lockDatabase(path);
  let lock: DaemonLock | null;
  try {
    lock = tryLock(db);
  } catch (error) {
    db.close();
    throw error;
  }
  if (lock === null) db.close();
  return lock;
}

/** How a lock wait went when it did not take the lock. */
export type LockWaitEnd = "gave-up" | "timed-out";

export interface LockWait {
  readonly timeoutMs: number;
  /** True when waiting on is pointless (another daemon took over); asked every `checkMs`. */
  readonly giveUp: () => boolean;
  /** Default 10 ms. */
  readonly pollMs?: number;
  /** Default 250 ms. */
  readonly checkMs?: number;
}

/**
 * Task 001-130: the successor a step-down spawns retries the lock every
 * `pollMs` until it holds it, `giveUp` says so, or `timeoutMs` passed.
 * SQLite has no blocking lock, so a daemon spawned in the moment between the
 * holder's release and the next retry can still win.
 *
 * Task 001-153: each attempt is `acquireDaemonLock`, a connection of its own
 * closed when it fails. In exclusive locking mode a failed `BEGIN EXCLUSIVE`
 * keeps the SHARED lock it reached, and PENDING and RESERVED when it got that
 * far, until its connection closes; two successors retrying on kept
 * connections could each hold what the other needs until one timed out.
 */
export async function awaitDaemonLock(
  path: AbsolutePath,
  wait: LockWait,
): Promise<DaemonLock | LockWaitEnd> {
  const deadline = performance.now() + wait.timeoutMs;
  let checkAt = 0;
  for (;;) {
    const lock = acquireDaemonLock(path);
    if (lock !== null) return lock;
    const at = performance.now();
    if (at >= checkAt) {
      if (wait.giveUp()) return "gave-up";
      checkAt = at + (wait.checkMs ?? 250);
    }
    if (at >= deadline) return "timed-out";
    await sleep(Math.min(wait.pollMs ?? 10, deadline - at));
  }
}

function lockDatabase(path: AbsolutePath): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** `BEGIN EXCLUSIVE` on `db`: the lock, or `null` when another process holds it. */
function tryLock(db: DatabaseSync): DaemonLock | null {
  try {
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    if (isBusy(error)) return null;
    throw error;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    },
  };
}
