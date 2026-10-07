import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
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
