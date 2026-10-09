import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { currentUid, preparePrivateDir, userTmpDir } from "../daemon/paths.js";
import { isBusy } from "../store/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/** Who takes the slot; recorded in the lock file as its last holder. */
export interface SlowSlotOwner {
  readonly pid: number;
  readonly worktreeId: WorktreeId;
}

export interface SlowSlotRequest {
  /** The slot's directory, `slowSlotDir()`; the lock is `slow.lock` in it. */
  readonly dir: AbsolutePath;
  readonly owner: SlowSlotOwner;
  /** Releases the slot when it aborts; an already aborted signal takes nothing. */
  readonly signal?: AbortSignal;
  /** The uid the directory must belong to. Default: this process's. */
  readonly uid?: number;
}

/** The slot, held for one slow file. */
export interface SlowSlot {
  /** Idempotent. The OS also releases it when the process dies, however it dies. */
  release(): void;
}

export const SLOW_LOCK_FILE = "slow.lock";

/**
 * The slot's directory: `squeal` in the daemon's `XDG_RUNTIME_DIR` when it is
 * set to an absolute path, as its socket follows it (`runtimeDir`), else the
 * per-user `/tmp/squeal-<uid>` (spec 001 D10). Spec 004 D2 as amended
 * (004-16): a daemon started under another runtime directory, such as an
 * end-to-end test's inner daemon run by an outer daemon's slow file, has a
 * slot of its own, so the outer file holding its slot cannot starve it.
 */
export function slowSlotDir(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? join(xdg, "squeal") : userTmpDir();
}

/**
 * Takes the per-user slow slot, or returns `null` when another holder has it.
 *
 * Spec 004 D2: one slow tier at a time per user on the host, through
 * `slow.lock` in `slowSlotDir()`, held for one slow file and released between
 * files. The lock is SQLite's exclusive locking, as the daemon singleton
 * (001 D10), not an `O_EXCL` pid file: the OS drops it when the holder dies,
 * so a SIGKILLed holder frees the slot at once, and no pid is read back, so
 * pid reuse cannot keep a dead holder's slot taken. Never blocks: a daemon
 * that does not get the slot retries on its next scheduling pass. The
 * directory is checked as 001 D10 checks it: owned by `uid`, mode 0700.
 */
export function acquireSlowSlot(request: SlowSlotRequest): SlowSlot | null {
  const { dir, owner, signal } = request;
  if (signal?.aborted) return null;
  preparePrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const db = new DatabaseSync(join(dir, SLOW_LOCK_FILE));
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (isBusy(error)) return null;
    throw error;
  }
  try {
    // Committed under locking_mode=EXCLUSIVE, the connection keeps its exclusive
    // lock until it closes, so the slot stays held after the owner is written.
    db.exec(
      "CREATE TABLE IF NOT EXISTS holder (pid INTEGER NOT NULL, worktree_id TEXT NOT NULL, since INTEGER NOT NULL)",
    );
    db.exec("DELETE FROM holder");
    db.prepare("INSERT INTO holder (pid, worktree_id, since) VALUES (?, ?, ?)").run(
      owner.pid,
      owner.worktreeId,
      Date.now(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }
  let held = true;
  const release = (): void => {
    if (!held) return;
    held = false;
    signal?.removeEventListener("abort", release);
    db.close();
  };
  signal?.addEventListener("abort", release, { once: true });
  return { release };
}
