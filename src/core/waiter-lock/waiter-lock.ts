import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AbsolutePath, Consumer } from "../types/index.js";

/**
 * Spec 001 D9: the idle waiter runs "with a per-consumer lock so only one
 * runs". Same mechanism as the daemon singleton (D10): an exclusive SQLite
 * lock the OS releases on any death, so a killed waiter never leaves a stale
 * lock behind. Its file does stay, and the daemon's expiry pass (D10) reads a
 * file no waiter holds as a main agent whose waiter is gone (task 001-47).
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
  const db = lock(waiterLockPath(locksDir, consumer));
  if (db === null) return null;
  return {
    release(remove) {
      // Review wave 3, N3: close first. Unlinking a file whose lock is still held lets a waiter
      // starting in between create and lock a new file while this one still runs.
      db.close();
      if (remove) removeWaiterLock(locksDir, consumer);
    },
  };
}

/**
 * Deletes the consumer's lock file unless a waiter holds it: only after a
 * fresh lock on it succeeded. For SessionEnd and a waiter whose consumer is
 * gone.
 */
export function removeWaiterLock(locksDir: AbsolutePath, consumer: Consumer): void {
  const path = waiterLockPath(locksDir, consumer);
  if (!existsSync(path)) return;
  const db = lock(path);
  if (db === null) return;
  try {
    rmSync(path, { force: true });
  } finally {
    db.close();
  }
}

/**
 * `absent`: the consumer has no lock file (never a waiter: `-p`, subagents).
 * `held`: a waiter runs. `free`: a lock file no waiter holds, left by a
 * waiter that exited or was killed.
 */
export type WaiterLockState = "absent" | "held" | "free";

/** Probes the consumer's lock without keeping it, so a waiter starting next is not refused. */
export function waiterLockState(locksDir: AbsolutePath, consumer: Consumer): WaiterLockState {
  const path = waiterLockPath(locksDir, consumer);
  if (!existsSync(path)) return "absent";
  const db = lock(path);
  if (db === null) return "held";
  db.close();
  return "free";
}

/** An exclusive lock on the SQLite file at `path`; `null` when another connection holds it. */
function lock(path: AbsolutePath): DatabaseSync | null {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
}
