import { str } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import type { PruneSlice } from "../../store/prune.js";
import {
  deleteByKey,
  hasIndexes,
  type KeyedRule,
  worktreeIdList,
  worktreeIdsOf,
} from "../../store/prune-keyed.js";
import { vacuum } from "../../store/prune-vacuum.js";
import type { EpochMs, WorktreeId } from "../../types/common.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { pruneParts } from "./parts.js";
import { stagedId } from "./staged.js";
import type { CodePruneCounts, CodePruneOptions, CodePruneReport } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows deleted per write transaction, as in the main store's prune (task
 * 001-141): many short write transactions, never one long one. The vacuum
 * is the main store's (`prune-vacuum.ts`, row 022-08).
 */
const DELETE_BATCH = 256;

/**
 * Coverage records per delete: each holds its record as a blob, and a batch
 * of 256 held the lock 251 to 346 ms on a copy of cezar's code store under
 * host load (row 021-33, `021-33-notes.md`).
 */
const COVERAGE_BATCH = 64;

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
 * Per-worktree tables, each with the columns that name one row; `transitions`
 * by its index, so one worktree's rows are read in key order.
 */
const PER_WORKTREE = [
  ["files", ["worktree_id", "path"]],
  ["states", ["worktree_id", "check_id", "measure"]],
  ["views", ["worktree_id", "session_id", "agent_id", "check_id", "measure"]],
  ["transitions", ["worktree_id", "check_id", "id"]],
] as const;

/**
 * A count no live file and no kept state names, older than the cutoff; the
 * parameter is the cutoff. Each test is a search, by `files_by_count` and
 * `states_by_blob`, so it is tested again per key under the write lock.
 */
const UNUSED_COUNT = `counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob
    AND f.language = counts.language AND f.counter_version = counts.counter_version)
  AND NOT EXISTS (SELECT 1 FROM states s WHERE s.blob = counts.blob)`;

/**
 * A check nothing names. Each test is a search: `states` and `transitions`
 * by worktree id and check id (one search per worktree id; the parameters
 * are their ids, read under the lock), `views` by `views_by_check`.
 */
const UNUSED_CHECK = `NOT EXISTS (SELECT 1 FROM states s
    WHERE s.worktree_id IN (SELECT value FROM json_each(?)) AND s.check_id = checks.id)
  AND NOT EXISTS (SELECT 1 FROM transitions t
    WHERE t.worktree_id IN (SELECT value FROM json_each(?)) AND t.check_id = checks.id)
  AND NOT EXISTS (SELECT 1 FROM views v WHERE v.check_id = checks.id)`;

/**
 * Row 011-350 (#220): `pruneCodeStore` as slices, each one write transaction
 * of at most `DELETE_BATCH` rows or about `VACUUM_SLICE_MS` of vacuum, so its driver can
 * leave the lock free between them (the daemon's `SlicedPrune`, as
 * `pruneSlices` is for the main store). Row 021-33: each rule's rows are
 * found by a read outside the write lock and deleted by key, tested again
 * under it (`deleteByKey`), so a prune with nothing to delete writes
 * nothing. Each slice is yielded before it runs, and what follows is read
 * once it ran. `counts` is filled in as the slices run.
 */
export function* pruneCodeSlices(
  conn: Connection,
  options: CodePruneOptions,
  counts: CodePruneCounts,
): Generator<PruneSlice, void, undefined> {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  const live = JSON.stringify(options.worktrees);
  const rule = (r: KeyedRule) => deleteByKey(conn, r);

  // Row 011-315: the ids found here, so rows a worktree stores after this read stay.
  const dead = conn.read(() => deadWorktrees(conn, options.worktrees));
  for (const id of dead) {
    for (const [table, key] of PER_WORKTREE) {
      yield* rule({ table, key, search: "worktree_id = ?", searchParams: [id] });
    }
  }
  counts.worktreesRemoved = dead.length;
  // Row 015-12: the coverage step's meta, `coverage:<worktreeId>` and `coverage:<worktreeId>:<path>`.
  yield* rule({ table: "meta", key: ["key"], search: COVERAGE_META_OF_DEAD, searchParams: [live] });

  yield* rule({
    table: "views",
    key: PER_WORKTREE[2][1],
    search: `(worktree_id, session_id, agent_id) NOT IN (
       SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId'
       FROM json_each(?))`,
    searchParams: [JSON.stringify(options.consumers)],
    removed: (n) => {
      counts.viewsRemoved += n;
    },
  });

  // Row 021-33: a rule whose test needs an index the file lacks waits for an opener to make it.
  const indexed = conn.read(() => hasIndexes(conn, "states_by_blob", "views_by_check"));
  if (indexed) {
    yield* rule({
      table: "counts",
      key: ["blob", "language", "counter_version"],
      search: UNUSED_COUNT,
      searchParams: [cutoff],
      removed: (n) => {
        counts.countsRemoved += n;
      },
    });
  }
  yield* pruneCoverage(conn, options.resultKeys, cutoff, (n) => {
    counts.coverageRemoved += n;
  });
  yield* pruneParts(conn, cutoff, DELETE_BATCH, (n) => {
    counts.partsRemoved += n;
  });

  if (indexed) {
    yield* rule({
      table: "checks",
      key: ["id"],
      search: `id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views
         UNION SELECT check_id FROM transitions)`,
      recheck: UNUSED_CHECK,
      recheckParams: () => [worktreeIdList(conn, "states"), worktreeIdList(conn, "transitions")],
      removed: (n) => {
        counts.checksRemoved += n;
      },
    });
  }

  yield* vacuum(conn);
}

/** Where a batch's deleted rows are counted. */
type Removed = (n: number) => void;

/** The worktree ids the per-worktree tables hold that are not in `live`. */
function deadWorktrees(conn: Connection, live: readonly string[]): string[] {
  // Row 021-36 (D22.5): a live worktree's staged rows stay, so a pass that counted them before
  // its batch reached the store process adopts as many as it counted.
  const kept = new Set([...live, ...live.map((id) => stagedId(id as WorktreeId))]);
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
  const key = ["result_key", "provider_version"];
  if (resultKeys === undefined) {
    yield* deleteByKey(conn, {
      table: "coverage",
      key,
      search: `recorded_at < ? OR ${OLDER_RECORD}`,
      searchParams: [cutoff, COVERAGE_RECORD_VERSION],
      batch: COVERAGE_BATCH,
      removed,
    });
    return;
  }
  const held = conn
    .read(() => conn.all("SELECT DISTINCT result_key FROM coverage"))
    .map((row) => str(row, "result_key"));
  const kept = new Set(typeof resultKeys === "function" ? resultKeys(held) : resultKeys);
  yield* deleteByKey(conn, {
    table: "coverage",
    key,
    search: `result_key IN (SELECT value FROM json_each(?)) OR ${OLDER_RECORD}`,
    searchParams: [JSON.stringify(held.filter((k) => !kept.has(k))), COVERAGE_RECORD_VERSION],
    batch: COVERAGE_BATCH,
    removed,
  });
}
