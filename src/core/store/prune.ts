import { existsSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PruneOptions, PruneReport, WorktreeRepo } from "../types/index.js";
import { num, str } from "./codec.js";
import type { Connection } from "./connection.js";
import type { StorePaths } from "./paths.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVICTION_BATCH = 32;

/*
 * Spec 001 D8: "keep every result whose key is current in any live worktree
 * plus the newest result per check on the main worktree; drop other keys
 * after 7 days and everything owned by removed worktrees; a size cap with LRU
 * eviction as a backstop."
 *
 * A live worktree is a `worktrees` row whose root still has a `.git` entry.
 */

/** Keys some live worktree computed for its current revision. */
const LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id`;

/** Row ids of the newest result per check produced by the main worktree. */
const MAIN_NEWEST = `
  SELECT id FROM (
    SELECT rowid AS id,
      row_number() OVER (PARTITION BY check_id ORDER BY recorded_at DESC, rowid DESC) AS n
    FROM results WHERE worktree_id IN (SELECT id FROM worktrees WHERE is_main = 1)
  ) WHERE n = 1`;

/** The newest completed full-suite run of each live worktree; status reports it (D7). */
const LAST_FULL_SUITES = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM runs x
            WHERE x.worktree_id = w.id AND x.full_suite = 1 AND x.end_state = 'completed'
            ORDER BY x.ended_at DESC LIMIT 1) AS id
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

  let resultsRemoved = conn.transaction(() => {
    const removed = conn.run(
      `DELETE FROM results
       WHERE key NOT IN (${LIVE_KEYS})
         AND rowid NOT IN (${MAIN_NEWEST})
         AND (recorded_at < ? OR worktree_id NOT IN (SELECT id FROM worktrees))`,
      cutoff,
    );
    dropOrphanFailureTexts(conn);
    return removed;
  });

  if (options.maxSizeMb !== null) {
    resultsRemoved += evictToCap(conn, options.maxSizeMb * 1024 * 1024);
  }

  const droppedRuns = conn.transaction(() =>
    conn.all(
      `DELETE FROM runs
       WHERE NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
         AND id NOT IN (${LAST_FULL_SUITES})
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))
       RETURNING log_dir`,
      cutoff,
    ),
  );
  for (const row of droppedRuns) removeRunLog(paths, str(row, "log_dir"));

  conn.db.exec("PRAGMA incremental_vacuum");
  return {
    resultsRemoved,
    runsRemoved: droppedRuns.length,
    worktreesRemoved,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size"),
  };
}

/**
 * The size-cap backstop. Evicts least recently recorded results first: those
 * no rule keeps, then the newest main-worktree results that no live worktree
 * uses. Results under a live key are never evicted, because known states
 * rest on them. Returns how many results it removed.
 */
function evictToCap(conn: Connection, capBytes: number): number {
  const tiers = [
    `key NOT IN (${LIVE_KEYS}) AND rowid NOT IN (${MAIN_NEWEST})`,
    `key NOT IN (${LIVE_KEYS})`,
  ];
  let removed = 0;
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      const batch = conn.transaction(() => {
        const n = conn.run(
          `DELETE FROM results WHERE rowid IN (
             SELECT rowid FROM results WHERE ${tier} ORDER BY recorded_at, rowid LIMIT ?)`,
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

function dropOrphanFailureTexts(conn: Connection): void {
  conn.run(
    `DELETE FROM failure_texts
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)`,
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
