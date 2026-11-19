import type { Connection } from "./connection.js";
import type { PruneCounts, PruneSlice } from "./prune.js";
import { deleteByKey, hasIndexes, worktreeIdList } from "./prune-keyed.js";
import { LAST_COMPLETED_CHECKPOINTS } from "./prune-rules.js";
import { keptByReplaced } from "./repos/replaced.js";

/*
 * Row 021-33: the main store's prune rules whose search reads a whole table,
 * as keyed deletes (`deleteByKey`): found by a read outside the write lock,
 * each key tested again under it by an index.
 */

type Slices = Generator<PruneSlice, void, undefined>;

/**
 * `PRUNABLE` for one result row, by searches only, as the keyed delete tests
 * it again under the write lock: its key in a registered worktree's current
 * test-file keys by `test_file_keys_by_key`, its worktree by its key, and a
 * newer result of its check in a main worktree by `results_by_check_time`.
 * `PRUNABLE` itself builds the list of live keys and of main worktrees, a
 * scan of each table. The parameter is the cutoff.
 */
export const PRUNABLE_BY_KEY = `NOT EXISTS (SELECT 1 FROM test_file_keys k
    JOIN worktrees w ON w.id = k.worktree_id WHERE k.key = results.key)
  AND NOT (EXISTS (SELECT 1 FROM worktrees m WHERE m.id = results.worktree_id AND m.is_main = 1)
    AND NOT EXISTS (SELECT 1 FROM results n JOIN worktrees m ON m.id = n.worktree_id AND m.is_main = 1
      WHERE n.check_id = results.check_id
        AND (n.recorded_at > results.recorded_at
             OR (n.recorded_at = results.recorded_at AND n.rowid > results.rowid))))
  AND recorded_at < ?`;

/**
 * Checkpoints as runs go (spec 001 D8), plus: a checkpoint stays while a
 * kept run is one of its tiers, and a registered worktree's last completed
 * one stays. Under the lock each key is tested by searches only: its runs by
 * `runs_by_checkpoint`, its worktree by its key, and that worktree's last
 * completed checkpoint by `checkpoints_by_worktree`, not every worktree's.
 */
export function dropEndedCheckpoints(
  conn: Connection,
  cutoff: number,
  counts: PruneCounts,
): Slices {
  return deleteByKey(conn, {
    table: "checkpoints",
    key: ["id"],
    search: `id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
      AND (worktree_id NOT IN (SELECT id FROM worktrees)
           OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
    searchParams: [cutoff],
    recheck: `NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
      AND CASE WHEN EXISTS (SELECT 1 FROM worktrees w WHERE w.id = checkpoints.worktree_id)
        THEN id IS NOT (SELECT x.id FROM checkpoints x
               WHERE x.worktree_id = checkpoints.worktree_id AND x.end_state = 'completed'
               ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1)
             AND end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?
        ELSE 1 END`,
    recheckParams: () => [cutoff],
    removed: (n) => {
      counts.checkpointsRemoved += n;
    },
  });
}

/**
 * `checks` rows nothing references. Under the lock each key is searched in
 * `results` by its key, in `known_states` and `transitions` by worktree id
 * and check id (one search per worktree id), and in `consumer_views` by
 * `consumer_views_by_check`; without that index the rule waits (`hasIndexes`).
 */
export function* dropUnusedChecks(conn: Connection, counts: PruneCounts): Slices {
  if (!conn.read(() => hasIndexes(conn, "consumer_views_by_check"))) return;
  yield* deleteByKey(conn, {
    table: "checks",
    key: ["id"],
    search: `id NOT IN (
      SELECT check_id FROM results UNION SELECT check_id FROM known_states
      UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`,
    recheck: `NOT EXISTS (SELECT 1 FROM results r WHERE r.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM known_states s
        WHERE s.worktree_id IN (SELECT value FROM json_each(?)) AND s.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM transitions t
        WHERE t.worktree_id IN (SELECT value FROM json_each(?)) AND t.check_id = checks.id)
      AND NOT EXISTS (SELECT 1 FROM consumer_views v WHERE v.check_id = checks.id)`,
    recheckParams: () => [
      worktreeIdList(conn, "known_states"),
      worktreeIdList(conn, "transitions"),
    ],
    removed: (n) => {
      counts.checksRemoved += n;
    },
  });
}

/** Failure texts no result and no kept replaced failure names (`results_by_failure`). */
export function dropOrphanTexts(conn: Connection): Slices {
  return deleteByKey(conn, {
    table: "failure_texts",
    key: ["id"],
    search: `id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)
      AND id NOT IN (SELECT value FROM json_each(?))`,
    searchParams: [keptTexts(conn)],
    recheck: `NOT EXISTS (SELECT 1 FROM results r WHERE r.failure_id = failure_texts.id)
      AND id NOT IN (SELECT value FROM json_each(?))`,
    recheckParams: () => [keptTexts(conn)],
  });
}

/** The failure texts kept replaced failures name, as a JSON list. */
export function keptTexts(conn: Connection): string {
  return JSON.stringify(keptByReplaced(conn).texts);
}
