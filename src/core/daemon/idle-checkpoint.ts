import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { EpochMs } from "../types/common.js";

/*
 * Spec 021 D4 (row 021-09): a daemon quiet for a minute runs a `TRUNCATE`
 * checkpoint of the store. It copies the WAL into the database and cuts the
 * file to zero bytes, which the passive checkpoints of committers never do:
 * with readers that always overlap, the WAL only grows (cezar's: 422 MB of
 * file for 1,055 live frames, 2026-11-11). It waits `CHECKPOINT_BUSY_MS` at
 * most, since writers wait while it does, and a busy one is tried again a
 * minute later.
 */

/** How long the daemon is quiet before it checkpoints, and between two tries. */
export const IDLE_CHECKPOINT_MS = 60_000;

/** The checkpoint's busy timeout: every writer of the store waits while it waits. */
export const CHECKPOINT_BUSY_MS = 100;

/** What `PRAGMA wal_checkpoint(TRUNCATE)` answered. */
export interface Checkpointed {
  /** A writer or a reader kept it from finishing in its busy timeout. */
  readonly busy: boolean;
  /** Frames in the WAL, `-1` when the store is not in WAL. */
  readonly log: number;
  /** Frames it copied into the database. */
  readonly checkpointed: number;
}

/**
 * `PRAGMA wal_checkpoint(TRUNCATE)` on `db` with a busy timeout of `busyMs`,
 * the connection's own restored after; `null`, with nothing run, while `db`
 * has a transaction open, a read one included.
 */
export function truncateWal(db: DatabaseSync, busyMs: number): Checkpointed | null {
  if (db.isTransaction) return null;
  const own = Number(Object.values(db.prepare("PRAGMA busy_timeout").get() ?? {})[0]);
  db.exec(`PRAGMA busy_timeout = ${busyMs}`);
  try {
    const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() ?? {};
    return {
      busy: Number(row.busy) !== 0,
      log: Number(row.log),
      checkpointed: Number(row.checkpointed),
    };
  } finally {
    db.exec(`PRAGMA busy_timeout = ${own}`);
  }
}

/*
 * Spec 024 D5: a connection opened with `managedCheckpoint` (the daemon's,
 * the store process's writer) never checkpoints at a commit, so its owner
 * runs a `PASSIVE` checkpoint between its transactions while the WAL is
 * large. A passive checkpoint takes no write lock and never waits: it copies
 * what no reader still needs, and writers go on appending meanwhile.
 */

/**
 * A passive checkpoint runs while the `-wal` file holds at least this much:
 * about SQLite's default auto-checkpoint of 1,000 pages at 4 KiB, so the
 * connections that still checkpoint at their commits (hooks) seldom reach it.
 */
export const PASSIVE_CHECKPOINT_BYTES = 4 * 1024 * 1024;

/** How often the daemon looks at its store's WAL for a passive checkpoint. */
export const PASSIVE_CHECKPOINT_MS = 15_000;

/**
 * `PRAGMA wal_checkpoint(PASSIVE)` on `db` when the file at `walPath` holds
 * at least `minBytes`; `null`, with nothing run, while `db` has a
 * transaction open or the file is smaller or missing.
 */
export function passiveCheckpoint(
  db: DatabaseSync,
  walPath: string,
  minBytes = PASSIVE_CHECKPOINT_BYTES,
): Checkpointed | null {
  if (db.isTransaction) return null;
  const wal = statSync(walPath, { throwIfNoEntry: false });
  if (wal === undefined || wal.size < minBytes) return null;
  const row = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() ?? {};
  return {
    busy: Number(row.busy) !== 0,
    log: Number(row.log),
    checkpointed: Number(row.checkpointed),
  };
}

/**
 * Runs `passiveCheckpoint` on `db` every `everyMs` on an unreferenced timer,
 * which ends once `db` is closed, or when the returned stop is called. A
 * failed check is tried again at the next one.
 */
export function checkpointPassively(
  db: DatabaseSync,
  walPath: string,
  everyMs = PASSIVE_CHECKPOINT_MS,
): () => void {
  const timer = setInterval(() => {
    if (!db.isOpen) {
      clearInterval(timer);
      return;
    }
    try {
      passiveCheckpoint(db, walPath);
    } catch {
      // The next check tries again; the idle checkpoint still cuts the file.
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** The daemon's work as a check sees it (`TimerContext.work`); `null` before its scheduler starts. */
export interface WorkSeen {
  readonly revision: number;
  readonly inUse: boolean;
  readonly queued?: number;
}

/**
 * When the idle checkpoint is due: the daemon was quiet (its scheduler
 * started, no edit pending or work owed, nothing queued, the same revision)
 * at every check for `IDLE_CHECKPOINT_MS`, and the last try is as long ago.
 * A daemon that stays quiet tries once a minute, so the WAL other worktrees
 * write is cut while this one waits.
 */
export class IdleCheckpoint {
  #quietSince: EpochMs | null = null;
  #revision: number | null = null;
  #tried: EpochMs | null = null;

  /** One check at `at` with the work it sees; true when the checkpoint runs now. */
  due(at: EpochMs, work: WorkSeen | null): boolean {
    const quiet = work !== null && !work.inUse && (work.queued ?? 0) === 0;
    if (!quiet || work.revision !== this.#revision) {
      this.#quietSince = quiet ? at : null;
      this.#revision = quiet ? work.revision : null;
      return false;
    }
    const since = Math.max(this.#quietSince ?? at, this.#tried ?? Number.NEGATIVE_INFINITY);
    if (at - since < IDLE_CHECKPOINT_MS) return false;
    this.#tried = at;
    return true;
  }
}
