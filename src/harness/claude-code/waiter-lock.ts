import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AbsolutePath, Consumer } from "../../core/types/index.js";

/**
 * Spec 001 D9: the idle waiter runs "with a per-consumer lock so only one
 * runs". Same mechanism as the daemon singleton (D10): an exclusive SQLite
 * lock the OS releases on any death, so a killed waiter never leaves a stale
 * lock behind.
 */
export interface WaiterLock {
  /** Releases the lock; `remove` also deletes the lock file. */
  release(remove: boolean): void;
}

export function waiterLockPath(locksDir: AbsolutePath, consumer: Consumer): AbsolutePath {
  const id = createHash("sha256")
    .update(JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId]))
    .digest("hex")
    .slice(0, 16);
  return join(locksDir, `waiter-${id}.sqlite`);
}

/** Takes the consumer's waiter lock; `null` when another waiter holds it. */
export function acquireWaiterLock(locksDir: AbsolutePath, consumer: Consumer): WaiterLock | null {
  mkdirSync(locksDir, { recursive: true });
  const path = waiterLockPath(locksDir, consumer);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
  } catch {
    db.close();
    return null;
  }
  return {
    release(remove) {
      if (remove) rmSync(path, { force: true });
      db.close();
    },
  };
}

/** Deletes the consumer's lock file unless a waiter holds it. For SessionEnd. */
export function removeWaiterLock(locksDir: AbsolutePath, consumer: Consumer): void {
  if (!existsSync(waiterLockPath(locksDir, consumer))) return;
  acquireWaiterLock(locksDir, consumer)?.release(true);
}
