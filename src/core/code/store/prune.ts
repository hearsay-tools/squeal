import { str } from "../../store/codec.js";
import type { Connection, Params } from "../../store/connection.js";
import type { PruneSlice } from "../../store/prune.js";
import type { EpochMs } from "../../types/common.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { pruneParts } from "./parts.js";
import type { CodePruneCounts, CodePruneOptions, CodePruneReport } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows deleted per write transaction and pages freed per
 * `incremental_vacuum`, as in the main store's prune (task 001-141): many
 * short write transactions, never one long one.
 */
const DELETE_BATCH = 256;
const VACUUM_PAGES = 512;

/** A row of one of the worktrees named; the one parameter is the JSON list of their ids. */
const OF_WORKTREES = "worktree_id IN (SELECT value FROM json_each(?))";

/**
 * Each worktree id `table` holds, one search of its first key column per id
 * instead of a read of every row (row 011-315: on cezar's code store, 24 ids
 * over 2.8 M state rows, 0.1 k page reads against 68 k).
 */
export const worktreeIdsOf = (table: string): string => `WITH RECURSIVE ids(id) AS (
    SELECT min(worktree_id) FROM ${table}
    UNION ALL SELECT (SELECT min(worktree_id) FROM ${table} WHERE worktree_id > ids.id)
      FROM ids WHERE ids.id IS NOT NULL)
  SELECT id FROM ids WHERE id IS NOT NULL`;

/**
 * A coverage step's meta key (row 015-12) of a worktree that is not live; the
 * one parameter is the JSON list of live ids.
 */
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
  const counts = noCodeRemoved();
  for (const slice of pruneCodeSlices(conn, options, counts)) slice();
  return { ...counts };
}

export function noCodeRemoved(): CodePruneCounts {
  return {
    countsRemoved: 0,
    coverageRemoved: 0,
    partsRemoved: 0,
    worktreesRemoved: 0,
    viewsRemoved: 0,
    checksRemoved: 0,
  };
}

/**
 * Row 011-350 (#220): `pruneCodeStore` as slices, each one write transaction
 * of at most `DELETE_BATCH` rows or `VACUUM_PAGES` pages, so its driver can
 * leave the lock free between them (the daemon's `SlicedPrune`, as
 * `pruneSlices` is for the main store). Each slice is yielded before it
 * runs, and what follows is read once it ran. `counts` is filled in as the
 * slices run.
 */
export function* pruneCodeSlices(
  conn: Connection,
  options: CodePruneOptions,
  counts: CodePruneCounts,
): Generator<PruneSlice, void, undefined> {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  const live = JSON.stringify(options.worktrees);

  // Row 011-315: the ids found here, so rows a worktree stores after this read stay.
  const dead = deadWorktrees(conn, options.worktrees);
  if (dead.length > 0) {
    for (const [table, key] of PER_WORKTREE) {
      yield* deleteInBatches(conn, nothing, table, key, OF_WORKTREES, JSON.stringify(dead));
    }
  }
  counts.worktreesRemoved = dead.length;
  // Row 015-12: the coverage step's meta, `coverage:<worktreeId>` and `coverage:<worktreeId>:<path>`.
  yield* deleteInBatches(conn, nothing, "meta", "key", COVERAGE_META_OF_DEAD, live);

  yield* deleteInBatches(
    conn,
    (n) => {
      counts.viewsRemoved += n;
    },
    "views",
    "worktree_id, session_id, agent_id, check_id, measure",
    `(worktree_id, session_id, agent_id) NOT IN (
       SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
       FROM json_each(?))`,
    JSON.stringify(options.consumers),
  );

  yield* deleteInBatches(
    conn,
    (n) => {
      counts.countsRemoved += n;
    },
    "counts",
    "blob, language, counter_version",
    `counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob
       AND f.language = counts.language AND f.counter_version = counts.counter_version)
     AND counts.blob NOT IN (SELECT s.blob FROM states s)`,
    cutoff,
  );
  yield* pruneCoverage(conn, options.resultKeys, cutoff, (n) => {
    counts.coverageRemoved += n;
  });
  yield* pruneParts(conn, cutoff, DELETE_BATCH, (n) => {
    counts.partsRemoved += n;
  });

  yield* deleteInBatches(
    conn,
    (n) => {
      counts.checksRemoved += n;
    },
    "checks",
    "id",
    `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
       UNION SELECT check_id FROM transitions)`,
  );

  yield* vacuum(conn);
}

/** Where a batch's deleted rows are counted. */
type Removed = (n: number) => void;

const nothing: Removed = () => {};

/** The worktree ids the per-worktree tables hold that are not in `live`. */
function deadWorktrees(conn: Connection, live: readonly string[]): string[] {
  const kept = new Set(live);
  const found = new Set(
    PER_WORKTREE.flatMap(([table]) => conn.all(worktreeIdsOf(table)).map((row) => str(row, "id"))),
  );
  return [...found].filter((id) => !kept.has(id));
}

/**
 * Coverage records (row 015-11): with `resultKeys`, a record whose key was
 * asked about and has no result goes; without them, a record older than the
 * cutoff. A record of an older record version goes either way (row 018-10
 * R1). The keys asked are those the records hold when the prune reads them
 * (from `coverage_stored`, without the records), so a record stored after
 * that read stays (row 011-315).
 */
function* pruneCoverage(
  conn: Connection,
  resultKeys: CodePruneOptions["resultKeys"],
  cutoff: EpochMs,
  removed: Removed,
): Generator<PruneSlice, void, undefined> {
  if (resultKeys === undefined) {
    yield* deleteInBatches(
      conn,
      removed,
      "coverage",
      COVERAGE_KEY,
      `recorded_at < ? OR ${OLDER_RECORD}`,
      cutoff,
      COVERAGE_RECORD_VERSION,
    );
    return;
  }
  const held = conn
    .all("SELECT DISTINCT result_key FROM coverage")
    .map((row) => str(row, "result_key"));
  const kept = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  yield* deleteInBatches(
    conn,
    removed,
    "coverage",
    COVERAGE_KEY,
    `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    JSON.stringify(held.filter((key) => !kept.has(key))),
    COVERAGE_RECORD_VERSION,
  );
}

/**
 * Deletes the rows of `table` matching `where`, `DELETE_BATCH` at a time,
 * each batch one slice, its own write transaction that re-tests its rows;
 * `removed` counts what each batch deleted. The next batch follows only one
 * that was full.
 */
function* deleteInBatches(
  conn: Connection,
  removed: Removed,
  table: string,
  key: string,
  where: string,
  ...params: Params
): Generator<PruneSlice, void, undefined> {
  let changed = DELETE_BATCH;
  while (changed === DELETE_BATCH) {
    changed = 0;
    yield () => {
      changed = conn.transaction(() =>
        conn.run(
          `DELETE FROM ${table} WHERE (${key}) IN (
             SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${DELETE_BATCH})`,
          ...params,
        ),
      );
      removed(changed);
    };
  }
}

/**
 * Frees pages `VACUUM_PAGES` per slice, each its own write transaction, so
 * no step holds the write lock for long; stops when a step frees nothing.
 */
function* vacuum(conn: Connection): Generator<PruneSlice, void, undefined> {
  let free = freePages(conn);
  while (free > 0) {
    yield () => conn.transaction(() => conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`));
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
  }
}

function freePages(conn: Connection): number {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count ?? 0);
}
