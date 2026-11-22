import type { Connection } from "./connection.js";
import { keptByReplaced } from "./repos/replaced.js";
import { keptByUnknownRuns } from "./repos/unknown-runs.js";

/* The rules a prune deletes by (`prune.ts`), moved out of it unchanged by row 021-09. */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EVICTION_BATCH = 32;

/**
 * Task 001-141 (003 lessons, defect 5): rows deleted per write transaction
 * and pages freed per `incremental_vacuum`. One `DELETE` of a removed
 * worktree's 80,000 results held cezar's store for 15 s, past a daemon's 5 s
 * busy timeout; a step this size holds it for well under a hook's 1 s.
 */
export const DELETE_BATCH = 256;

/**
 * Row 022-08: pages freed per `incremental_vacuum` step, and the time one
 * vacuum slice (one write transaction) runs steps for. Once 0.1.591 emptied
 * the lists, a step of 512 pages held a 7 GB store's lock 0.76 s on average,
 * up to 2.4 s (about 1.5 ms a page, 4.7 ms at worst); a step costs about
 * 0.1 ms beside its pages. Row 022-08r measured both sizes on an 8.6 GB
 * store with a cold cache: a step of 16 took up to 269 ms (p99 63 ms), so a
 * slice up to 270 ms; a step of 8 took up to 52 ms (p99 27 ms), so a slice
 * up to 132 ms (`tasks/022-08/notes.md`, "Repair 022-08r").
 */
export const VACUUM_PAGES = 8;
export const VACUUM_SLICE_MS = 100;

/**
 * Row 022-08: stored lists per delete. A batch of 256 held the lock up to
 * 1.1 s on that store (about 2 to 4 ms a list); 32 stays near
 * `VACUUM_SLICE_MS`.
 */
export const LIST_DELETE_BATCH = 32;

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
export const LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key IS NOT NULL`;

/** The main worktree, whose newest result per check is kept. */
export const MAIN = "SELECT id FROM worktrees WHERE is_main = 1";

/**
 * Results under no live key that are not the newest of their check on the
 * main worktree (by `recorded_at`, then `rowid`). Tested row by row, so a
 * batch re-checks only its own rows, under the write lock.
 */
export const UNPROTECTED = `key NOT IN (${LIVE_KEYS})
  AND NOT (worktree_id IN (${MAIN}) AND NOT EXISTS (
    SELECT 1 FROM results n
    WHERE n.check_id = results.check_id AND n.worktree_id IN (${MAIN})
      AND (n.recorded_at > results.recorded_at
           OR (n.recorded_at = results.recorded_at AND n.rowid > results.rowid))))`;

/**
 * What no rule keeps: unprotected and older than the cutoff (the one
 * parameter), whether or not its worktree is still registered.
 */
export const PRUNABLE = `${UNPROTECTED} AND recorded_at < ?`;

/** Runs no result, kept replaced failure or standing UNKNOWN names; `keptRuns` is the parameter. */
export const UNREFERENCED_RUN = `NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
  AND id NOT IN (SELECT value FROM json_each(?))`;

/** The runs replaced failures and standing UNKNOWNs keep; read inside the deleting transaction. */
export function keptRuns(conn: Connection): string {
  return JSON.stringify([...keptByReplaced(conn).runs, ...keptByUnknownRuns(conn)]);
}

/** The newest completed checkpoint of each live worktree; status reports it (D7). */
export const LAST_COMPLETED_CHECKPOINTS = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM checkpoints x
            WHERE x.worktree_id = w.id AND x.end_state = 'completed'
            ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1) AS id
    FROM worktrees w
  ) WHERE id IS NOT NULL`;
