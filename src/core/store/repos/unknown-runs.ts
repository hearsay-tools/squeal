import { isRecord } from "../../fs/index.js";
import type {
  EpochMs,
  MarkedUnknown,
  RevisionNumber,
  UnknownRun,
  WorktreeId,
} from "../../types/index.js";
import { strOrNull } from "../codec.js";
import type { Connection } from "../connection.js";

/*
 * Row 011-108 (gh-74; 011 C6 and C7 as amended): when a check reads UNKNOWN,
 * the run that produced it is recorded beside the known state, never as a
 * keyed result, so C7 holds: an `unknown` under a key would be inherited as
 * a hit. One record per worktree and test file, the newest. `why` names the
 * record that fits the state; prune keeps the run and its log while the
 * UNKNOWN stands, and drops a record that no longer fits a state.
 *
 * Review 0.1.265 B3: no bound evicts a record whose UNKNOWN stands, so `why`
 * never names an older daemon for this release's record and prune keeps its
 * run. Each write drops the fallen records first; what is left is one record
 * per file UNKNOWN in a live worktree, as many as `known_states` holds.
 */

/** `meta` key of every worktree's records, oldest first. */
export const UNKNOWN_RUNS_META_KEY = "unknown-runs";

/** Every record, oldest first; empty when none or unreadable, and one that does not parse is left out. */
export function readUnknownRuns(conn: Connection): UnknownRun[] {
  const row = conn.get("SELECT value FROM meta WHERE key = ?", UNKNOWN_RUNS_META_KEY);
  if (row === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(strOrNull(row, "value") ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(isEntry) : [];
}

/** See `FailureRepo.recordUnknownRuns`. */
export function recordUnknownRuns(
  conn: Connection,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  marked: readonly MarkedUnknown[],
  at: EpochMs,
): void {
  const added = marked.flatMap(({ testFiles, reason, runId }) =>
    testFiles.map((testFile) => ({ worktreeId, testFile, runId, revision, reason, at })),
  );
  if (added.length === 0) return;
  conn.transaction(() => {
    const ids = new Set(added.map(idOf));
    // Review 0.1.265 B3: the fallen records go first, and no bound evicts a standing one.
    const kept = standing(conn, readUnknownRuns(conn)).filter((r) => !ids.has(idOf(r)));
    // Within one commit the last mark of a file is its state's.
    const newest = new Map(added.map((r) => [idOf(r), r]));
    write(conn, [...kept, ...newest.values()]);
  });
}

/**
 * A record whose state still stands: a check of its file in its worktree is
 * `unknown`, observed at its revision, with its reason as the summary.
 * `CROSS JOIN` keeps `checks` the outer loop, so the file's checks are
 * searched by their index: driven by `known_states`, SQLite reads every
 * state of the worktree per record (12 ms against 11.6 s for 2,400 records
 * over 30,000 checks a worktree).
 */
const STANDS = `SELECT 1 FROM checks c CROSS JOIN known_states s
    ON s.worktree_id = ? AND s.check_id = c.id
  WHERE c.project = ? AND c.test_path = ? AND s.outcome = 'unknown'
    AND s.observed_at = ? AND s.summary = ? LIMIT 1`;

/** Drops the records whose UNKNOWN no longer stands; inside the caller's transaction. Returns how many. */
export function dropFallenUnknownRuns(conn: Connection): number {
  const records = readUnknownRuns(conn);
  const kept = standing(conn, records);
  if (kept.length < records.length) write(conn, kept);
  return records.length - kept.length;
}

/** The runs the records name, which prune keeps while their UNKNOWN stands; read inside its transaction. */
export function keptByUnknownRuns(conn: Connection): string[] {
  return readUnknownRuns(conn).flatMap((r) => (r.runId === null ? [] : [r.runId]));
}

function standing(conn: Connection, records: readonly UnknownRun[]): UnknownRun[] {
  return records.filter((r) => conn.get(STANDS, ...standsParams(r)) !== null);
}

function standsParams(r: UnknownRun) {
  return [r.worktreeId, r.testFile.project, r.testFile.path, r.revision, r.reason] as const;
}

function idOf(r: UnknownRun): string {
  return JSON.stringify([r.worktreeId, r.testFile.project, r.testFile.path]);
}

function write(conn: Connection, records: readonly UnknownRun[]): void {
  if (records.length === 0) conn.run("DELETE FROM meta WHERE key = ?", UNKNOWN_RUNS_META_KEY);
  else {
    conn.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      UNKNOWN_RUNS_META_KEY,
      JSON.stringify(records),
    );
  }
}

function isEntry(value: unknown): value is UnknownRun {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return (
    typeof value.worktreeId === "string" &&
    typeof value.testFile.project === "string" &&
    typeof value.testFile.path === "string" &&
    (value.runId === null || typeof value.runId === "string") &&
    typeof value.revision === "number" &&
    typeof value.reason === "string" &&
    typeof value.at === "number"
  );
}
