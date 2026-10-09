import { createHash } from "node:crypto";
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  /** `slow.maxParallel`: the user's permits, of which `slow.lock` is the first. Default 1. */
  readonly permits?: number;
  /** How many permits the tier would use, one per file. Default 1. */
  readonly want?: number;
}

/** The slot: one or more of the user's permits, held for one slow tier. */
export interface SlowSlot {
  /** How many permits are held; 0 once released. */
  readonly permits: number;
  /** Keeps the first `count` permits, at least one, and frees the others. */
  shrinkTo(count: number): void;
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
 * Takes up to `want` of the user's `permits` slow-slot permits, or returns
 * `null` when every one is held.
 *
 * Spec 004 D2 as amended 2026-10-09: `slow.maxParallel` permits per user on
 * the host, a slow tier of k files holding k, released between tiers. Each
 * permit is a lock file in `slowSlotDir()`: the first is `slow.lock`, so a
 * daemon of one permit (`permits` 1, or a version before permits) holds the
 * same one, the others `slow.<i>.lock`. The lock is SQLite's exclusive
 * locking, as the daemon singleton (001 D10), not an `O_EXCL` pid file: the
 * OS drops it when the holder dies, so a SIGKILLed holder frees its permits
 * at once, and no pid is read back, so pid reuse cannot keep a dead holder's
 * permit taken. Never blocks: a daemon that gets none retries on its next
 * scheduling pass. The directory is checked as 001 D10 checks it: owned by
 * `uid`, mode 0700.
 */
export function acquireSlowSlot(request: SlowSlotRequest): SlowSlot | null {
  const { dir, owner, signal } = request;
  if (signal?.aborted) return null;
  preparePrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const permits = Math.max(1, request.permits ?? 1);
  const want = Math.max(1, request.want ?? 1);
  const held: DatabaseSync[] = [];
  try {
    for (let i = 0; i < permits && held.length < want; i++) {
      const db = takePermit(join(dir, permitFile(i)), owner);
      if (db !== null) held.push(db);
    }
  } catch (error) {
    for (const db of held) db.close();
    throw error;
  }
  if (held.length === 0) return null;
  const keep = (count: number): void => {
    for (const db of held.splice(count)) db.close();
    if (held.length === 0) signal?.removeEventListener("abort", release);
  };
  const release = (): void => keep(0);
  signal?.addEventListener("abort", release, { once: true });
  return {
    get permits() {
      return held.length;
    },
    shrinkTo: (count) => keep(Math.max(1, count)),
    release,
  };
}

/** Permit `i`'s lock file: `slow.lock` first, as the one slot was. */
function permitFile(i: number): string {
  return i === 0 ? SLOW_LOCK_FILE : `slow.${i}.lock`;
}

/** One permit's exclusive lock, kept by the returned connection until it closes; `null` when held. */
function takePermit(path: AbsolutePath, owner: SlowSlotOwner): DatabaseSync | null {
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
  try {
    // Committed under locking_mode=EXCLUSIVE, the connection keeps its exclusive
    // lock until it closes, so the permit stays held after the owner is written.
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
  return db;
}

const WAITER_PREFIX = "slow.wait.";

/**
 * How long a waiter's mark counts: twice the slow tier's 15 s recheck, so a
 * daemon still retrying keeps it fresh and one that stopped wanting the slot
 * (it died, its load guard waits, its trigger went) is soon ignored.
 */
export const SLOT_WAITER_FRESH_MS = 30_000;

function waiterPath(dir: AbsolutePath, worktreeId: WorktreeId): AbsolutePath {
  const name = createHash("sha256").update(worktreeId).digest("hex").slice(0, 16);
  return join(dir, `${WAITER_PREFIX}${name}`);
}

/**
 * Spec 004 D2, lessons defect 2: a daemon that wants the slot and did not
 * take it leaves its worktree's mark in the slot's directory, refreshed on
 * each retry. A holder between files that finds another worktree's fresh
 * mark skips one turn (`othersWaitingForSlot`), so the slot is handed over
 * file by file: the holder takes it on its next pass only if the waiter did not.
 */
export function markSlotWaiter(dir: AbsolutePath, worktreeId: WorktreeId): void {
  writeFileSync(waiterPath(dir, worktreeId), `${worktreeId}\n`, { mode: 0o600 });
}

/** The worktree no longer waits: it took the slot, or wants it no more. */
export function clearSlotWaiter(dir: AbsolutePath, worktreeId: WorktreeId): void {
  rmSync(waiterPath(dir, worktreeId), { force: true });
}

/** Another worktree's mark younger than `SLOT_WAITER_FRESH_MS` is in `dir`. */
export function othersWaitingForSlot(
  dir: AbsolutePath,
  worktreeId: WorktreeId,
  now: number = Date.now(),
): boolean {
  const own = waiterPath(dir, worktreeId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  return names.some((name) => {
    const path = join(dir, name);
    if (!name.startsWith(WAITER_PREFIX) || path === own) return false;
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat !== undefined && now - stat.mtimeMs < SLOT_WAITER_FRESH_MS;
  });
}
