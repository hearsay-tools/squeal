import { num, numOrNull, oneOf, str } from "../../store/codec.js";
import type { Connection, Params, Row } from "../../store/connection.js";
import type { CodeCheckId, CodeKnownState, CodeMeasure, CodeOutcome } from "../../types/code.js";
import type { RelativePath, WorktreeId } from "../../types/common.js";
import type { CodeEdit, CodeNonPassCounts, CodeStateFilter, CodeStateRepo } from "./types.js";

export const MEASURES = [
  "complexity",
  "crap",
  "uncovered",
] as const satisfies readonly CodeMeasure[];
export const OUTCOMES = [
  "pass",
  "fail",
  "pending",
  "unknown",
] as const satisfies readonly CodeOutcome[];

const CHECK_WHERE = "path = ? AND qualified_name = ? AND occurrence = ?";

function checkParams(check: CodeCheckId) {
  return [check.path, check.qualifiedName, check.occurrence] as const;
}

/** The row id of a code check, or `null` if it was never stored. For read paths. */
export function findCodeCheckId(conn: Connection, check: CodeCheckId): number | null {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE}`, ...checkParams(check));
  return row === null ? null : num(row, "id");
}

/**
 * A statement's `check_id` of the check whose row `ensureCodeCheck` made,
 * looked up when the statement runs: spec 021 D22.5 (row 021-36), a batch
 * sent to the store process cannot read back the row it inserts, so the
 * insert and the lookup run together where the batch is written.
 */
export const CHECK_ID = `(SELECT id FROM checks WHERE ${CHECK_WHERE})`;

/**
 * Inserts `check`'s `checks` row when missing, and returns the parameters
 * of `CHECK_ID` for it. For write paths.
 */
export function ensureCodeCheck(
  conn: Connection,
  check: CodeCheckId,
): readonly [string, string, number] {
  const params = checkParams(check);
  conn.run(
    "INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ...params,
  );
  return params;
}

/** Columns of the check a row's `check_id` names, for a `JOIN checks c`. */
export const CHECK_COLUMNS = "c.path, c.qualified_name, c.occurrence";

export function checkFrom(row: Row): CodeCheckId {
  return {
    kind: "code",
    path: str(row, "path"),
    qualifiedName: str(row, "qualified_name"),
    occurrence: num(row, "occurrence"),
  };
}

/**
 * `CODE_INDEXES`' partial indexes of `states` (row 015-127): the failing
 * states and the edited ones of a worktree, which a tool boundary reads.
 */
export const STATES_FAILING = "states_failing";
export const STATES_EDITED = "states_edited";
/** Spec 025 D6.1: the states that do not pass, which status counts. */
export const STATES_NON_PASS = "states_non_pass";

/** Which of `names` the file has; a store a reader opened before any creating open has none. */
function indexesIn(conn: Connection, names: readonly string[]): ReadonlySet<string> {
  const rows = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(names),
  );
  return new Set(rows.map((row) => str(row, "name")));
}

/**
 * Row 015-45: the `FROM` of a read of states, through its first `WHERE`
 * term, and its parameters. With `paths`, each path's checks are read
 * first and their states by key, in that order (`CROSS JOIN`), so a few
 * files' states come without a scan of every state of the worktree: 37,299
 * rows, 48 to 65 ms cold, on 011-197's store. Without them, `index` names
 * the partial index the read's predicates imply (row 015-127): SQLite's
 * planner otherwise keeps the primary key, a scan of every state of the
 * worktree, 260,000 on 005-110's copy.
 */
function statesOf(
  worktreeId: WorktreeId,
  paths: readonly RelativePath[] | undefined,
  index: string | null,
): { readonly from: string; readonly params: Params } {
  if (paths === undefined) {
    const states = index === null ? "states s" : `states s INDEXED BY ${index}`;
    return {
      from: `${states} JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?`,
      params: [worktreeId],
    };
  }
  return {
    from: `(SELECT DISTINCT value FROM json_each(?)) p
      CROSS JOIN checks c ON c.path = p.value
      CROSS JOIN states s ON s.worktree_id = ? AND s.check_id = c.id
      WHERE true`,
    params: [JSON.stringify(paths), worktreeId],
  };
}

/**
 * The `WHERE` terms of `filter`'s measure and outcome, only those it names,
 * so the planner sees each (row 015-127). `fail` is a literal, which
 * implies `states_failing`'s own `WHERE`.
 */
function filterTerms(filter: CodeStateFilter): { readonly sql: string; readonly params: Params } {
  const terms: string[] = [];
  const params: (string | number)[] = [];
  if (filter.measure !== undefined) {
    terms.push("AND s.measure = ?");
    params.push(filter.measure);
  }
  if (filter.outcome === "fail") terms.push("AND s.outcome = 'fail'");
  else if (filter.outcome !== undefined) {
    terms.push("AND s.outcome = ?");
    params.push(filter.outcome);
  }
  return { sql: terms.join(" "), params };
}

export function createStateRepo(conn: Connection): CodeStateRepo {
  const indexed = indexesIn(conn, [STATES_FAILING, STATES_EDITED, STATES_NON_PASS]);
  const named = (index: string, used: boolean) => (used && indexed.has(index) ? index : null);
  return {
    list(worktreeId, filter = {}) {
      const index = named(STATES_FAILING, filter.outcome === "fail");
      const { from, params } = statesOf(worktreeId, filter.paths, index);
      const terms = filterTerms(filter);
      return conn
        .all(
          `SELECT s.*, ${CHECK_COLUMNS} FROM ${from} ${terms.sql}
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
          ...params,
          ...terms.params,
        )
        .map((row) => toState(worktreeId, row));
    },
    countNonPass(worktreeId, measure) {
      const index = named(STATES_NON_PASS, true);
      const states = index === null ? "states" : `states INDEXED BY ${index}`;
      const counts = { fail: 0, pending: 0, unknown: 0 } satisfies Record<
        keyof CodeNonPassCounts,
        number
      >;
      const rows = conn.all(
        `SELECT outcome, count(*) AS n FROM ${states}
         WHERE worktree_id = ? AND measure = ? AND outcome != 'pass' GROUP BY outcome`,
        worktreeId,
        measure,
      );
      for (const row of rows) {
        const outcome = oneOf(row, "outcome", OUTCOMES);
        if (outcome !== "pass") counts[outcome] = num(row, "n");
      }
      return counts;
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          conn.run(
            `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
               counted_at, blob, changed_at) VALUES (?, ${CHECK_ID}, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
               counted_at = excluded.counted_at, blob = excluded.blob,
               changed_at = excluded.changed_at`,
            state.worktreeId,
            ...ensureCodeCheck(conn, state.check),
            state.measure,
            state.outcome,
            state.value,
            state.threshold,
            state.countedAt,
            state.blob,
            state.changedAt,
          );
        }
      });
    },
    edits(worktreeId, measure, paths) {
      const { from, params } = statesOf(worktreeId, paths, named(STATES_EDITED, true));
      return conn
        .all(
          `SELECT s.measure, s.edited_revision, s.edited_at, ${CHECK_COLUMNS} FROM ${from}
             AND s.measure = ? AND s.edited_at IS NOT NULL
           ORDER BY c.path, c.qualified_name, c.occurrence`,
          ...params,
          measure,
        )
        .map(toEdit);
    },
    markEdited(worktreeId, edits) {
      conn.transaction(() => {
        for (const edit of edits) {
          const id = findCodeCheckId(conn, edit.check);
          if (id === null) continue;
          conn.run(
            `UPDATE states SET edited_revision = ?, edited_at = ?
             WHERE worktree_id = ? AND check_id = ? AND measure = ?`,
            edit.revision,
            edit.at,
            worktreeId,
            id,
            edit.measure,
          );
        }
      });
    },
    removeMany(worktreeId, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findCodeCheckId(conn, check);
          if (id === null) continue;
          conn.run("DELETE FROM states WHERE worktree_id = ? AND check_id = ?", worktreeId, id);
        }
      });
    },
    removeMeasure(worktreeId, measure, paths) {
      if (paths === undefined) {
        conn.run("DELETE FROM states WHERE worktree_id = ? AND measure = ?", worktreeId, measure);
        return;
      }
      conn.run(
        `DELETE FROM states WHERE worktree_id = ? AND measure = ? AND check_id IN (
           SELECT c.id FROM json_each(?) p JOIN checks c ON c.path = p.value)`,
        worktreeId,
        measure,
        JSON.stringify(paths),
      );
    },
    move(worktreeId, from, to) {
      conn.transaction(() => {
        const fromId = findCodeCheckId(conn, from);
        if (fromId === null) return;
        const toId = ensureCodeCheck(conn, to);
        for (const table of ["states", "views"]) {
          // `OR REPLACE`: a row `to` already holds is the stale one; the moved state wins.
          conn.run(
            `UPDATE OR REPLACE ${table} SET check_id = ${CHECK_ID}
             WHERE worktree_id = ? AND check_id = ?`,
            ...toId,
            worktreeId,
            fromId,
          );
        }
        // The history explains the moved state: news not yet told and Stop's count (D6, D7).
        // `to`'s own is an earlier function's, as its stale state above.
        conn.run(
          `DELETE FROM transitions WHERE worktree_id = ? AND check_id = ${CHECK_ID}`,
          worktreeId,
          ...toId,
        );
        conn.run(
          `UPDATE transitions SET check_id = ${CHECK_ID} WHERE worktree_id = ? AND check_id = ?`,
          ...toId,
          worktreeId,
          fromId,
        );
      });
    },
    adopt(worktreeId, staged, measure, removed) {
      return conn.transaction(() => {
        // Row 021-36 (D22.5): counted by a read, since a batch sent to the store process
        // answers no changed rows; the staged rows are this worktree's own.
        const staging = conn.get(
          "SELECT count(*) AS n FROM states WHERE worktree_id = ? AND measure = ?",
          staged,
          measure,
        );
        const written = staging === null ? 0 : num(staging, "n");
        // Set-based, so the switch costs a statement per kind of write, not one per state.
        // A staged edit mark is the newer (row 015-55); with none, the state keeps its own.
        conn.run(
          `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
             counted_at, blob, changed_at, edited_revision, edited_at)
           SELECT ?, check_id, measure, outcome, value, threshold, counted_at, blob, changed_at,
             edited_revision, edited_at
           FROM states WHERE worktree_id = ? AND measure = ?
           ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
             outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
             counted_at = excluded.counted_at, blob = excluded.blob,
             changed_at = excluded.changed_at,
             edited_revision = coalesce(excluded.edited_revision, states.edited_revision),
             edited_at = coalesce(excluded.edited_at, states.edited_at)`,
          worktreeId,
          staged,
          measure,
        );
        if (removed.length > 0) {
          conn.run(
            `DELETE FROM states WHERE worktree_id = ? AND check_id IN (
               SELECT c.id FROM json_each(?) j JOIN checks c ON c.path = j.value ->> 0
                 AND c.qualified_name = j.value ->> 1 AND c.occurrence = j.value ->> 2)`,
            worktreeId,
            JSON.stringify(removed.map((c) => [c.path, c.qualifiedName, c.occurrence])),
          );
        }
        return written;
      });
    },
  };
}

function toState(worktreeId: string, row: Row): CodeKnownState {
  return {
    worktreeId,
    check: checkFrom(row),
    measure: oneOf(row, "measure", MEASURES),
    outcome: oneOf(row, "outcome", OUTCOMES),
    value: numOrNull(row, "value"),
    threshold: numOrNull(row, "threshold"),
    countedAt: num(row, "counted_at"),
    blob: str(row, "blob"),
    changedAt: num(row, "changed_at"),
  };
}

function toEdit(row: Row): CodeEdit {
  return {
    check: checkFrom(row),
    measure: oneOf(row, "measure", MEASURES),
    revision: num(row, "edited_revision"),
    at: num(row, "edited_at"),
  };
}
