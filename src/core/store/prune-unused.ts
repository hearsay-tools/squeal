import type { Connection } from "./connection.js";
import type { PruneCounts, PruneSlice } from "./prune.js";
import { deleteByKey, worktreeIdList } from "./prune-keyed.js";
import { LAST_COMPLETED_CHECKPOINTS } from "./prune-rules.js";
import { keptByReplaced } from "./repos/replaced.js";

/*
 * Row 021-33: the main store's prune rules whose search reads a whole table,
 * as keyed deletes (`deleteByKey`): found by a read outside the write lock,
 * each key tested again under it by an index.
 */

type Slices = Generator<PruneSlice, void, undefined>;

/**
 * Checkpoints as runs go (spec 001 D8), plus: a checkpoint stays while a
 * kept run is one of its tiers, and each worktree's last completed one stays.
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
    removed: (n) => {
      counts.checkpointsRemoved += n;
    },
  });
}

/**
 * `checks` rows nothing references. Under the lock each key is searched in
 * `results` by its key, in `known_states` and `transitions` by worktree id
 * and check id (one search per worktree id), and in `consumer_views`, which
 * is small.
 */
export function dropUnusedChecks(conn: Connection, counts: PruneCounts): Slices {
  return deleteByKey(conn, {
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
      AND id NOT IN (SELECT check_id FROM consumer_views)`,
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
