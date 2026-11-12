import { str } from "../../store/codec.js";
import type { Connection, Params } from "../../store/connection.js";
import type { EpochMs } from "../../types/common.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { pruneParts } from "./parts.js";
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

/**
 * A coverage record of an older record version, which no reader takes (row
 * 018-10 R1); a newer one stays for the Squeal that wrote it. The parameter
 * is `COVERAGE_RECORD_VERSION`.
 */
const OLDER_RECORD = "provider_version < ?";

/** The columns that name one coverage record. */
const COVERAGE_KEY = "result_key, provider_version";

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
 * 015-11), else by the same age rule, and at once when its record version is
 * older than this Squeal's (row 018-10 R1); a coverage part once no kept record
 * lists it and it was last used before the cutoff (row 015-85, `./parts.ts`);
 * `checks` rows nothing references go last.
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
  const coverageRemoved = pruneCoverage(conn, options.resultKeys, cutoff);
  const partsRemoved = pruneParts(conn, cutoff, DELETE_BATCH);

  const checksRemoved = deleteInBatches(
    conn,
    "checks",
    "id",
    `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
       UNION SELECT check_id FROM transitions)`,
  );

  vacuum(conn);
  return {
    countsRemoved,
    coverageRemoved,
    partsRemoved,
    worktreesRemoved,
    viewsRemoved,
    checksRemoved,
  };
}

/**
 * Coverage records (row 015-11): with `resultKeys`, a record whose key was
 * asked about and has no result goes; without them, a record older than the
 * cutoff. A record of an older record version goes either way (row 018-10
 * R1). The keys asked are those the records hold when the prune reads them
 * (from `coverage_stored`, without the records), so a record stored after
 * that read stays (row 011-315).
 */
function pruneCoverage(
  conn: Connection,
  resultKeys: CodePruneOptions["resultKeys"],
  cutoff: EpochMs,
): number {
  if (resultKeys === undefined) {
    return deleteInBatches(
      conn,
      "coverage",
      COVERAGE_KEY,
      `recorded_at < ? OR ${OLDER_RECORD}`,
      cutoff,
      COVERAGE_RECORD_VERSION,
    );
  }
  const held = conn
    .all("SELECT DISTINCT result_key FROM coverage")
    .map((row) => str(row, "result_key"));
  const kept = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  return deleteInBatches(
    conn,
    "coverage",
    COVERAGE_KEY,
    `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    JSON.stringify(held.filter((key) => !kept.has(key))),
    COVERAGE_RECORD_VERSION,
  );
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
