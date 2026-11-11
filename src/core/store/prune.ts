import { existsSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PruneOptions, PruneReport, WorktreeRepo } from "../types/store.js";
import { num, str } from "./codec.js";
import type { Connection } from "./connection.js";
import type { StorePaths } from "./paths.js";
import {
  DAY_MS,
  DELETE_BATCH,
  EVICTION_BATCH,
  keptRuns,
  LAST_COMPLETED_CHECKPOINTS,
  LIVE_KEYS,
  PRUNABLE,
  UNPROTECTED,
  UNREFERENCED_RUN,
  VACUUM_PAGES,
} from "./prune-rules.js";
import { expireReplaced, keptByReplaced } from "./repos/replaced.js";
import { dropFallenUnknownRuns } from "./repos/unknown-runs.js";
import { WORKTREE_SCOPED_TABLES } from "./repos/worktrees.js";

/* Spec 001 D8 (row 011-160): the rules are in `prune-rules.ts`. */

/** One write transaction of a prune (spec 021 D3); one that gave up on a busy store is run again. */
export type PruneSlice = () => void;

/** What a prune removed so far, filled in as its slices run. */
export interface PruneCounts {
  resultsRemoved: number;
  runsRemoved: number;
  checkpointsRemoved: number;
  checksRemoved: number;
  worktreesRemoved: number;
}

export function prune(
  conn: Connection,
  worktrees: WorktreeRepo,
  paths: StorePaths,
  options: PruneOptions,
): PruneReport {
  const counts = noneRemoved();
  for (const slice of pruneSlices(conn, worktrees, paths, options, counts)) slice();
  return pruneReport(conn, counts);
}

export function noneRemoved(): PruneCounts {
  return {
    resultsRemoved: 0,
    runsRemoved: 0,
    checkpointsRemoved: 0,
    checksRemoved: 0,
    worktreesRemoved: 0,
  };
}

/** The report of a prune whose slices all ran. */
export function pruneReport(conn: Connection, counts: PruneCounts): PruneReport {
  return {
    ...counts,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size"),
  };
}

/**
 * Spec 021 D3 (row 021-09): the prune as slices, each one write transaction
 * of at most `DELETE_BATCH` rows or `VACUUM_PAGES` pages, so its driver can
 * leave the lock free between them (the daemon's `SlicedPrune`). Each slice
 * is yielded before it runs, and what follows is read once it ran, so its
 * driver asks for the next only after it succeeded. Rows a slice deletes
 * are tested again under the lock. The `checks`, `checkpoints`, expiry and
 * failure-text steps stay one transaction each: their tables have no index
 * a batch could test by, and the daemon's log names them when they are long.
 */
export function* pruneSlices(
  conn: Connection,
  worktrees: WorktreeRepo,
  paths: StorePaths,
  options: PruneOptions,
  counts: PruneCounts,
): Generator<PruneSlice, void, undefined> {
  const cutoff = options.now - options.retentionDays * DAY_MS;

  for (const worktree of worktrees.list()) {
    if (!isGone(worktree.root)) continue;
    yield* removeWorktree(conn, worktrees, worktree, counts);
  }

  // Row 011-77 (011 C7 as amended 2026-10-21): an expired replaced failure first, so its run,
  // log and text go in this pass.
  yield () => conn.transaction(() => expireReplaced(conn, cutoff));
  // Row 011-108: a record whose UNKNOWN no longer stands keeps its run no longer.
  yield () => conn.transaction(() => dropFallenUnknownRuns(conn));

  yield* dropPrunable(conn, cutoff, counts);

  if (options.maxSizeMb !== null) {
    yield* evictToCap(conn, options.maxSizeMb * 1024 * 1024, counts);
  }

  yield* dropRuns(conn, paths, cutoff, counts);

  // Same rule as runs, plus: a checkpoint stays while a kept run is one of its tiers.
  yield () => {
    counts.checkpointsRemoved += conn.transaction(() =>
      conn.run(
        `DELETE FROM checkpoints
         WHERE id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
           AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
           AND (worktree_id NOT IN (SELECT id FROM worktrees)
                OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
        cutoff,
      ),
    );
  };

  yield () => {
    counts.checksRemoved += conn.transaction(() =>
      conn.run(
        `DELETE FROM checks WHERE id NOT IN (
           SELECT check_id FROM results UNION SELECT check_id FROM known_states
           UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`,
      ),
    );
  };

  yield* vacuum(conn);
}

/** A worktree whose root has no `.git` entry any more (spec 001 D8). */
function isGone(root: string): boolean {
  return !existsSync(join(root, ".git"));
}

/** The column a batch of each worktree table's rows is chosen by; `rowid` unless listed. */
const BATCH_KEYS: Partial<Record<(typeof WORKTREE_SCOPED_TABLES)[number], string>> = {
  // `WITHOUT ROWID`, keyed by `(worktree_id, path)`.
  file_hashes: "path",
};

/**
 * A removed worktree's rows, `DELETE_BATCH` per slice and table, then its
 * registration and the rest in `WorktreeRepo.remove`. Each slice tests the
 * root again, so a worktree made again at the root meanwhile keeps its rows.
 */
function* removeWorktree(
  conn: Connection,
  worktrees: WorktreeRepo,
  worktree: { readonly id: string; readonly root: string },
  counts: PruneCounts,
): Generator<PruneSlice, void, undefined> {
  for (const table of WORKTREE_SCOPED_TABLES) {
    const key = BATCH_KEYS[table] ?? "rowid";
    let removed = DELETE_BATCH;
    while (removed === DELETE_BATCH) {
      removed = 0;
      yield () => {
        if (!isGone(worktree.root)) return;
        removed = conn.transaction(() =>
          conn.run(
            `DELETE FROM ${table} WHERE worktree_id = ?1 AND ${key} IN (
               SELECT ${key} FROM ${table} WHERE worktree_id = ?1 LIMIT ?2)`,
            worktree.id,
            DELETE_BATCH,
          ),
        );
      };
    }
  }
  yield () => {
    if (!isGone(worktree.root)) return;
    worktrees.remove(worktree.id);
    counts.worktreesRemoved++;
  };
}

/**
 * The runs nothing names, with their logs: a removed worktree's at once, a
 * live worktree's once ended before the cutoff. A removed worktree's run
 * that a kept result names stays until that result expires (row 011-160).
 * Read first, then deleted `DELETE_BATCH` per slice, each run tested again.
 */
function* dropRuns(
  conn: Connection,
  paths: StorePaths,
  cutoff: number,
  counts: PruneCounts,
): Generator<PruneSlice, void, undefined> {
  const DROPPABLE = `${UNREFERENCED_RUN}
    AND (worktree_id NOT IN (SELECT id FROM worktrees)
         OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))`;
  const ids = conn
    .read(() => conn.all(`SELECT id FROM runs WHERE ${DROPPABLE}`, keptRuns(conn), cutoff))
    .map((row) => str(row, "id"));
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    yield () => {
      const dropped = conn.transaction(() =>
        conn.all(
          `DELETE FROM runs WHERE id IN (SELECT value FROM json_each(?)) AND ${DROPPABLE}
           RETURNING log_dir`,
          batch,
          keptRuns(conn),
          cutoff,
        ),
      );
      for (const row of dropped) removeRunLog(paths, str(row, "log_dir"));
      counts.runsRemoved += dropped.length;
    };
  }
}

/**
 * Deletes what no rule keeps in batches of `DELETE_BATCH`: the row ids come
 * from one read, which takes no lock in WAL, and each batch re-tests its rows
 * under the write lock, so a key that became live meanwhile keeps its result.
 */
function* dropPrunable(
  conn: Connection,
  cutoff: number,
  counts: PruneCounts,
): Generator<PruneSlice, void, undefined> {
  const ids = conn
    .read(() => conn.all(`SELECT rowid AS id FROM results WHERE ${PRUNABLE}`, cutoff))
    .map((row) => num(row, "id"));
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    yield () => {
      counts.resultsRemoved += conn.transaction(() =>
        conn.run(
          `DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND ${PRUNABLE}`,
          batch,
          cutoff,
        ),
      );
    };
  }
  yield () => conn.transaction(() => dropOrphanFailureTexts(conn));
}

/**
 * Frees the pages deletes left, `VACUUM_PAGES` per write transaction; a bare
 * `incremental_vacuum` frees them all in one. Stops when a step frees
 * nothing, as on a store created without `auto_vacuum`.
 */
function* vacuum(conn: Connection): Generator<PruneSlice, void, undefined> {
  let free = pragmaNumber(conn, "freelist_count");
  while (free > 0) {
    yield () => conn.transaction(() => conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`));
    const left = pragmaNumber(conn, "freelist_count");
    if (left >= free) return;
    free = left;
  }
}

/**
 * The size-cap backstop. Evicts least recently used results first: those
 * no rule keeps, then the newest main-worktree results that no live worktree
 * uses. Results under a live key are never evicted, because known states
 * rest on them. Adds what it removed to `counts`.
 */
function* evictToCap(
  conn: Connection,
  capBytes: number,
  counts: PruneCounts,
): Generator<PruneSlice, void, undefined> {
  const tiers = [UNPROTECTED, `key NOT IN (${LIVE_KEYS})`];
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      let batch = 0;
      yield () => {
        batch = conn.transaction(() => {
          const n = conn.run(
            `DELETE FROM results WHERE rowid IN (
               SELECT rowid FROM results WHERE ${tier} ORDER BY last_used_at, rowid LIMIT ?)`,
            EVICTION_BATCH,
          );
          dropOrphanFailureTexts(conn);
          return n;
        });
        counts.resultsRemoved += batch;
      };
      if (batch === 0) break;
    }
  }
}

/** Texts no result and no kept replaced failure names; inside the caller's transaction. */
function dropOrphanFailureTexts(conn: Connection): void {
  conn.run(
    `DELETE FROM failure_texts
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)
       AND id NOT IN (SELECT value FROM json_each(?))`,
    JSON.stringify(keptByReplaced(conn).texts),
  );
}

function usedBytes(conn: Connection): number {
  const pages = pragmaNumber(conn, "page_count") - pragmaNumber(conn, "freelist_count");
  return pages * pragmaNumber(conn, "page_size");
}

function pragmaNumber(conn: Connection, name: string): number {
  const row = conn.get(`PRAGMA ${name}`);
  if (row === null) throw new Error(`squeal store: PRAGMA ${name} returned nothing`);
  return num(row, name);
}

/**
 * Spec 001 D1: run output is "pruned with them". Only directories inside
 * `<store>/runs/` are deleted, whatever a run row says.
 */
function removeRunLog(paths: StorePaths, logDir: string): void {
  const runsDir = resolve(paths.runsDir);
  const target = resolve(logDir);
  if (target.startsWith(runsDir + sep)) rmSync(target, { recursive: true, force: true });
}
