import { existsSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PruneOptions, PruneReport, WorktreeRepo } from "../types/index.js";
import { num, str } from "./codec.js";
import type { Connection } from "./connection.js";
import type { StorePaths } from "./paths.js";
import { expireReplaced, keptByReplaced } from "./repos/replaced.js";
import { dropFallenUnknownRuns, keptByUnknownRuns } from "./repos/unknown-runs.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVICTION_BATCH = 32;

/**
 * Task 001-141 (003 lessons, defect 5): rows deleted per write transaction
 * and pages freed per `incremental_vacuum`. One `DELETE` of a removed
 * worktree's 80,000 results held cezar's store for 15 s, past a daemon's 5 s
 * busy timeout; a step this size holds it for well under a hook's 1 s.
 */
const DELETE_BATCH = 256;
const VACUUM_PAGES = 512;

/*
 * Spec 001 D8 as amended 2026-10-23 (row 011-160): "keep every result whose
 * key is current in any live worktree plus the newest result per check on
 * the main worktree; drop other keys after 7 days, the results of removed
 * worktrees included, which are kept for the same 7 days so a later worktree
 * at the same content inherits them; [...] a size cap evicting least
 * recently used results as a backstop; drop `checks` rows that no result,
 * known state, view or transition references."
 *
 * A live worktree is a `worktrees` row whose root still has a `.git` entry.
 * Runs and checkpoints follow the 7 days rule unless a kept result
 * references the run or a kept run the checkpoint; the newest completed
 * checkpoint of each live worktree is kept for status (D7). A removed
 * worktree's run goes once no kept result names it. Spec 011 C7 as
 * amended 2026-10-21 (row 011-77): a kept replaced failure keeps its run, its
 * log and its failure text until it expires at the cutoff. Row 011-108: the
 * run behind an UNKNOWN keeps its run and log while that UNKNOWN stands.
 */

/**
 * Keys some live worktree computed for its current revision. Unkeyed rows are
 * left out: one `NULL` in a `NOT IN` list makes it match nothing.
 */
const LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key IS NOT NULL`;

/** The main worktree, whose newest result per check is kept. */
const MAIN = "SELECT id FROM worktrees WHERE is_main = 1";

/**
 * Results under no live key that are not the newest of their check on the
 * main worktree (by `recorded_at`, then `rowid`). Tested row by row, so a
 * batch re-checks only its own rows, under the write lock.
 */
const UNPROTECTED = `key NOT IN (${LIVE_KEYS})
  AND NOT (worktree_id IN (${MAIN}) AND NOT EXISTS (
    SELECT 1 FROM results n
    WHERE n.check_id = results.check_id AND n.worktree_id IN (${MAIN})
      AND (n.recorded_at > results.recorded_at
           OR (n.recorded_at = results.recorded_at AND n.rowid > results.rowid))))`;

/**
 * What no rule keeps: unprotected and older than the cutoff (the one
 * parameter), whether or not its worktree is still registered.
 */
const PRUNABLE = `${UNPROTECTED} AND recorded_at < ?`;

/** Runs no result, kept replaced failure or standing UNKNOWN names; the kept ids are the parameter. */
const UNREFERENCED_RUN = `NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
  AND id NOT IN (SELECT value FROM json_each(?))`;

/** The newest completed checkpoint of each live worktree; status reports it (D7). */
const LAST_COMPLETED_CHECKPOINTS = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM checkpoints x
            WHERE x.worktree_id = w.id AND x.end_state = 'completed'
            ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1) AS id
    FROM worktrees w
  ) WHERE id IS NOT NULL`;

export function prune(
  conn: Connection,
  worktrees: WorktreeRepo,
  paths: StorePaths,
  options: PruneOptions,
): PruneReport {
  const cutoff = options.now - options.retentionDays * DAY_MS;

  let worktreesRemoved = 0;
  for (const worktree of worktrees.list()) {
    if (existsSync(join(worktree.root, ".git"))) continue;
    worktrees.remove(worktree.id);
    worktreesRemoved++;
  }

  // Row 011-77 (011 C7 as amended 2026-10-21): an expired replaced failure first, so its run,
  // log and text go in this pass.
  conn.transaction(() => expireReplaced(conn, cutoff));
  // Row 011-108: a record whose UNKNOWN no longer stands keeps its run no longer.
  conn.transaction(() => dropFallenUnknownRuns(conn));

  let resultsRemoved = dropPrunable(conn, cutoff);

  if (options.maxSizeMb !== null) {
    resultsRemoved += evictToCap(conn, options.maxSizeMb * 1024 * 1024);
  }

  const keptRuns = JSON.stringify([...keptByReplaced(conn).runs, ...keptByUnknownRuns(conn)]);
  const runsRemoved =
    dropLiveWorktreeRuns(conn, paths, keptRuns, cutoff) +
    dropRemovedWorktreeRuns(conn, paths, keptRuns);

  // Same rule as runs, plus: a checkpoint stays while a kept run is one of its tiers.
  const checkpointsRemoved = conn.transaction(() =>
    conn.run(
      `DELETE FROM checkpoints
       WHERE id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
      cutoff,
    ),
  );

  const checksRemoved = conn.transaction(() =>
    conn.run(
      `DELETE FROM checks WHERE id NOT IN (
         SELECT check_id FROM results UNION SELECT check_id FROM known_states
         UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`,
    ),
  );

  vacuum(conn);
  return {
    resultsRemoved,
    runsRemoved,
    checkpointsRemoved,
    checksRemoved,
    worktreesRemoved,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size"),
  };
}

/** A live worktree's runs that ended before the cutoff and that nothing names, with their logs. */
function dropLiveWorktreeRuns(
  conn: Connection,
  paths: StorePaths,
  kept: string,
  cutoff: number,
): number {
  const dropped = conn.transaction(() =>
    conn.all(
      `DELETE FROM runs
       WHERE ${UNREFERENCED_RUN} AND worktree_id IN (SELECT id FROM worktrees)
         AND end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?
       RETURNING log_dir`,
      kept,
      cutoff,
    ),
  );
  for (const row of dropped) removeRunLog(paths, str(row, "log_dir"));
  return dropped.length;
}

/**
 * A removed worktree's runs and their logs (row 011-160). A run goes, with
 * its log, once nothing names it: at once when it stored nothing, else when
 * its last result expires at the cutoff. Its own step, so these logs can
 * follow another rule than the result rows that name their runs.
 */
function dropRemovedWorktreeRuns(conn: Connection, paths: StorePaths, kept: string): number {
  const dropped = conn.transaction(() =>
    conn.all(
      `DELETE FROM runs
       WHERE ${UNREFERENCED_RUN} AND worktree_id NOT IN (SELECT id FROM worktrees)
       RETURNING log_dir`,
      kept,
    ),
  );
  for (const row of dropped) removeRunLog(paths, str(row, "log_dir"));
  return dropped.length;
}

/**
 * Deletes what no rule keeps in batches of `DELETE_BATCH`: the row ids come
 * from one read, which takes no lock in WAL, and each batch re-tests its rows
 * under the write lock, so a key that became live meanwhile keeps its result.
 */
function dropPrunable(conn: Connection, cutoff: number): number {
  const ids = conn
    .read(() => conn.all(`SELECT rowid AS id FROM results WHERE ${PRUNABLE}`, cutoff))
    .map((row) => num(row, "id"));
  let removed = 0;
  for (let at = 0; at < ids.length; at += DELETE_BATCH) {
    const batch = JSON.stringify(ids.slice(at, at + DELETE_BATCH));
    removed += conn.transaction(() =>
      conn.run(
        `DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND ${PRUNABLE}`,
        batch,
        cutoff,
      ),
    );
  }
  conn.transaction(() => dropOrphanFailureTexts(conn));
  return removed;
}

/**
 * Frees the pages deletes left, `VACUUM_PAGES` per write transaction; a bare
 * `incremental_vacuum` frees them all in one. Stops when a step frees
 * nothing, as on a store created without `auto_vacuum`.
 */
function vacuum(conn: Connection): void {
  let free = pragmaNumber(conn, "freelist_count");
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
    const left = pragmaNumber(conn, "freelist_count");
    if (left >= free) return;
    free = left;
  }
}

/**
 * The size-cap backstop. Evicts least recently used results first: those
 * no rule keeps, then the newest main-worktree results that no live worktree
 * uses. Results under a live key are never evicted, because known states
 * rest on them. Returns how many results it removed.
 */
function evictToCap(conn: Connection, capBytes: number): number {
  const tiers = [UNPROTECTED, `key NOT IN (${LIVE_KEYS})`];
  let removed = 0;
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      const batch = conn.transaction(() => {
        const n = conn.run(
          `DELETE FROM results WHERE rowid IN (
             SELECT rowid FROM results WHERE ${tier} ORDER BY last_used_at, rowid LIMIT ?)`,
          EVICTION_BATCH,
        );
        dropOrphanFailureTexts(conn);
        return n;
      });
      if (batch === 0) break;
      removed += batch;
    }
  }
  return removed;
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
