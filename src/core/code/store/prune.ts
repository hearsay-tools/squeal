import type { Connection, Params } from "../../store/connection.js";
import type { CodePruneOptions, CodePruneReport } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows deleted per write transaction and pages freed per
 * `incremental_vacuum`, as in the main store's prune (task 001-141): many
 * short write transactions, never one long one.
 */
const DELETE_BATCH = 256;
const VACUUM_PAGES = 512;

/** A worktree that is not live; the one parameter is the JSON list of live ids. */
const DEAD_WORKTREE = "worktree_id NOT IN (SELECT value FROM json_each(?))";

/** A coverage step's meta key (row 015-12) of a worktree that is not live; the parameter as above. */
const COVERAGE_META_OF_DEAD = `key LIKE 'coverage:%' AND (CASE
    WHEN instr(substr(key, 10), ':') = 0 THEN substr(key, 10)
    ELSE substr(key, 10, instr(substr(key, 10), ':') - 1) END) NOT IN (SELECT value FROM json_each(?))`;

/** Per-worktree tables, each with the columns that name one row. */
const PER_WORKTREE = [
  ["files", "worktree_id, path"],
  ["states", "worktree_id, check_id, measure"],
  ["views", "worktree_id, session_id, agent_id, check_id, measure"],
  ["transitions", "id"],
] as const;

/**
 * Spec 015 D4, after 011 C7: rows of worktrees that are no longer live go;
 * view entries of consumers no longer registered go; a count stays while a
 * live worktree's current file uses it, or a kept state was judged on it
 * (the pass's old bodies, while the file's next count is pending), and is
 * dropped once it is also older than the retention, so a later worktree at
 * the same bytes still finds it;
 * a coverage record goes with the last result at its key (`resultKeys`, row
 * 015-11), else by the same age rule; `checks` rows nothing references go
 * last.
 */
export function pruneCodeStore(conn: Connection, options: CodePruneOptions): CodePruneReport {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  const live = JSON.stringify(options.worktrees);

  const worktreesRemoved = conn.all(
    `SELECT DISTINCT worktree_id FROM (SELECT worktree_id FROM files UNION
         SELECT worktree_id FROM states UNION SELECT worktree_id FROM views
         UNION SELECT worktree_id FROM transitions) WHERE ${DEAD_WORKTREE}`,
    live,
  ).length;
  for (const [table, key] of PER_WORKTREE) deleteInBatches(conn, table, key, DEAD_WORKTREE, live);
  // Row 015-12: the coverage step's meta, `coverage:<worktreeId>` and `coverage:<worktreeId>:<path>`.
  deleteInBatches(conn, "meta", "key", COVERAGE_META_OF_DEAD, live);

  const viewsRemoved = deleteInBatches(
    conn,
    "views",
    "worktree_id, session_id, agent_id, check_id, measure",
    `(worktree_id, session_id, agent_id) NOT IN (
       SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
       FROM json_each(?))`,
    JSON.stringify(options.consumers),
  );

  const countsRemoved = deleteInBatches(
    conn,
    "counts",
    "blob, language, counter_version",
    `counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob
       AND f.language = counts.language AND f.counter_version = counts.counter_version)
     AND counts.blob NOT IN (SELECT s.blob FROM states s)`,
    cutoff,
  );
  const coverageRemoved =
    options.resultKeys === undefined
      ? deleteInBatches(conn, "coverage", "result_key, provider_version", "recorded_at < ?", cutoff)
      : deleteInBatches(
          conn,
          "coverage",
          "result_key, provider_version",
          "result_key NOT IN (SELECT value FROM json_each(?))",
          JSON.stringify(options.resultKeys),
        );

  const checksRemoved = deleteInBatches(
    conn,
    "checks",
    "id",
    `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
       UNION SELECT check_id FROM transitions)`,
  );

  vacuum(conn);
  return { countsRemoved, coverageRemoved, worktreesRemoved, viewsRemoved, checksRemoved };
}

/**
 * Deletes the rows of `table` matching `where`, `DELETE_BATCH` at a time,
 * each batch its own write transaction that re-tests its rows. Returns the
 * number deleted.
 */
function deleteInBatches(
  conn: Connection,
  table: string,
  key: string,
  where: string,
  ...params: Params
): number {
  let removed = 0;
  for (;;) {
    const changed = conn.transaction(() =>
      conn.run(
        `DELETE FROM ${table} WHERE (${key}) IN (
           SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${DELETE_BATCH})`,
        ...params,
      ),
    );
    removed += changed;
    if (changed < DELETE_BATCH) return removed;
  }
}

/** Frees pages a few hundred per step, so no step holds the write lock for long. */
function vacuum(conn: Connection): void {
  let free = freePages(conn);
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
  }
}

function freePages(conn: Connection): number {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count ?? 0);
}
