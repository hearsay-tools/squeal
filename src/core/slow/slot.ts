import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { checkPrivateDir, currentUid, preparePrivateDir, userTmpDir } from "../daemon/paths.js";
import { isBusy } from "../store/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";
import { isRepositorySlotDir, slotFiles } from "./slot-files.js";

export * from "./slot-files.js";

/** Who takes the slot; recorded in the lock file as its last holder. */
export interface SlowSlotOwner {
  readonly pid: number;
  readonly worktreeId: WorktreeId;
}

export interface SlowSlotRequest {
  /** The slot's directory, `slowSlotDir()`; the group's lock files are in it. */
  readonly dir: AbsolutePath;
  /**
   * The check group whose `maxParallel` slot it is (spec 019 D3, row
   * 019-11), which names its files (`slotFiles`). Default `"slow"`, today's.
   */
  readonly group?: string;
  readonly owner: SlowSlotOwner;
  /** Releases the slot when it aborts; an already aborted signal takes nothing. */
  readonly signal?: AbortSignal;
  /** The uid the directory must belong to. Default: this process's. */
  readonly uid?: number;
  /** The group's `maxParallel`: the user's permits, of which `slow.lock` is the slow group's first. Default 1. */
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

/**
 * The slot's directory: `squeal` in the daemon's `XDG_RUNTIME_DIR` when it is
 * set to an absolute path, as its socket follows it (`runtimeDir`), else the
 * per-user `/tmp/squeal-<uid>` (spec 001 D10), or the `userDir` a reader of
 * the pool names for it (`squeal ps`, 014 D7). Spec 004 D2 as amended
 * (004-16): a daemon started under another runtime directory, such as an
 * end-to-end test's inner daemon run by an outer daemon's slow file, has a
 * slot of its own, so the outer file holding its slot cannot starve it.
 */
export function slowSlotDir(
  env: NodeJS.ProcessEnv = process.env,
  userDir: AbsolutePath = userTmpDir(),
): AbsolutePath {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? join(xdg, "squeal") : userDir;
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
 * `uid`, mode 0700. Spec 019 D3: another check group's `maxParallel` is a
 * slot of the same kind in its own files (`slotFiles`).
 */
export function acquireSlowSlot(request: SlowSlotRequest): SlowSlot | null {
  const { dir, owner, signal } = request;
  if (signal?.aborted) return null;
  const files = slotFiles(request.group);
  prepareSlotDir(dir, request.uid ?? currentUid());
  const permits = Math.max(1, request.permits ?? 1);
  const want = Math.max(1, request.want ?? 1);
  const held: DatabaseSync[] = [];
  try {
    for (let i = 0; i < permits && held.length < want; i++) {
      const db = takePermit(join(dir, files.permit(i)), owner);
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

/**
 * Creates the slot's directory private when it is missing, and first its
 * base when it is a repository's (`SlotFiles.dir`): a base made on the way
 * would not be private, and the pool, whose directory it is too, would
 * refuse it.
 */
function prepareSlotDir(dir: AbsolutePath, uid: number): void {
  if (isRepositorySlotDir(dir)) preparePrivateDir(dirname(dir), uid, "slow slot directory");
  preparePrivateDir(dir, uid, "slow slot directory");
}

/**
 * Every one of the user's `permits` slow-slot permits is held: a taker now
 * would get none. Task 004-84: a slow tier whose load guard would wait
 * checks it first, since while another worktree holds the slot the wait
 * lowers no load, and the tier waits at the slot instead. Each permit is
 * locked and let go at once, without writing its holder; a missing
 * directory holds none.
 */
export function slowSlotHeld(request: Omit<SlowSlotRequest, "owner" | "signal" | "want">): boolean {
  const { dir } = request;
  const files = slotFiles(request.group);
  if (!existsSync(dir)) return false;
  preparePrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const permits = Math.max(1, request.permits ?? 1);
  for (let i = 0; i < permits; i++) {
    if (permitFree(join(dir, files.permit(i)))) return false;
  }
  return true;
}

/**
 * What a held permit's lock file records of its holder (row 011-58, gh-58):
 * the row `takePermit` wrote; `missing`, none; `unreadable`, a row or a
 * file that does not read as one.
 */
export type PermitRecord =
  | {
      readonly kind: "holder";
      readonly pid: number;
      readonly worktreeId: WorktreeId;
      readonly since: number;
    }
  | { readonly kind: "missing" | "unreadable" };

/** One held permit: its lock file's name (`slotFiles`), as `slow.lock` or `slow.<i>.lock`, and its record. */
export interface HeldPermit {
  readonly file: string;
  readonly record: PermitRecord;
}

/**
 * Each of the user's first `permits` slow-slot permits that is held now,
 * with the holder its lock file records (row 011-58, gh-58; spec 004 D2,
 * which lets several daemons hold permits at once). Each is tested as
 * `slowSlotHeld` tests it, and a held one's `holder` row is read through
 * SQLite's `immutable` URI, which takes no lock, since the holder's
 * exclusive lock keeps every other reader out. The row is committed before
 * the holder keeps its lock, so the file's bytes hold it. A missing directory or
 * permit file holds none, and none is created; a file the test cannot lock
 * nor read as a database is held, `unreadable`. Throws when the directory
 * is not the user's private one.
 */
export function heldPermits(
  request: Omit<SlowSlotRequest, "owner" | "signal" | "want">,
): readonly HeldPermit[] {
  const { dir } = request;
  const files = slotFiles(request.group);
  if (!existsSync(dir)) return [];
  checkPrivateDir(dir, request.uid ?? currentUid(), "slow slot directory");
  const held: HeldPermit[] = [];
  for (let i = 0; i < Math.max(1, request.permits ?? 1); i++) {
    const file = files.permit(i);
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    let free: boolean;
    try {
      free = permitFree(path);
    } catch {
      held.push({ file, record: { kind: "unreadable" } });
      continue;
    }
    if (!free) held.push({ file, record: permitRecord(path) });
  }
  return held;
}

/** The `holder` row of permit `path`, read without a lock. */
function permitRecord(path: AbsolutePath): PermitRecord {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(immutableUrl(path), { readOnly: true });
  } catch {
    return { kind: "unreadable" };
  }
  try {
    const row = db.prepare("SELECT pid, worktree_id, since FROM holder LIMIT 1").get();
    if (row === undefined) return { kind: "missing" };
    const { pid, worktree_id: worktreeId, since } = row;
    if (!Number.isSafeInteger(pid) || typeof worktreeId !== "string") return { kind: "unreadable" };
    if (!Number.isSafeInteger(since)) return { kind: "unreadable" };
    return {
      kind: "holder",
      pid: pid as number,
      worktreeId: worktreeId as WorktreeId,
      since: since as number,
    };
  } catch (error) {
    return { kind: String(error).includes("no such table") ? "missing" : "unreadable" };
  } finally {
    db.close();
  }
}

/** SQLite's `immutable` URI of the database `path`: a reader of it takes no lock and opens no other file. */
export function immutableUrl(path: AbsolutePath): URL {
  const url = pathToFileURL(path);
  url.search = "immutable=1";
  return url;
}

/** Permit `path` is not held: its exclusive lock was taken and released. */
function permitFree(path: AbsolutePath): boolean {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
    return true;
  } catch (error) {
    if (isBusy(error)) return false;
    throw error;
  } finally {
    db.close();
  }
}

/**
 * One permit's exclusive lock, kept by the returned connection until it
 * closes; `null` when held. The per-user pool's permits are these locks too
 * (`createPermitPool`, spec 001 D11 Capacity).
 */
export function takePermit(path: AbsolutePath, owner: SlowSlotOwner): DatabaseSync | null {
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
