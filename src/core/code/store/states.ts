import { num, numOrNull, oneOf, str } from "../../store/codec.js";
import type { Connection, Params, Row } from "../../store/connection.js";
import type { CodeCheckId, CodeKnownState, CodeMeasure, CodeOutcome } from "../../types/code.js";
import type { RelativePath, WorktreeId } from "../../types/index.js";
import type { CodeEdit, CodeStateRepo } from "./types.js";

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

/** The row id of a code check, inserting its `checks` row first if needed. For write paths. */
export function ensureCodeCheckId(conn: Connection, check: CodeCheckId): number {
  conn.run(
    "INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ...checkParams(check),
  );
  const id = findCodeCheckId(conn, check);
  if (id === null) throw new Error("squeal code store: check row missing after insert");
  return id;
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
 * Row 015-45: the `FROM` of a read of states, through its first `WHERE`
 * term, and its parameters. With `paths`, each path's checks are read
 * first and their states by key, in that order (`CROSS JOIN`), so a few
 * files' states come without a scan of every state of the worktree: 37,299
 * rows, 48 to 65 ms cold, on 011-197's store.
 */
function statesOf(
  worktreeId: WorktreeId,
  paths: readonly RelativePath[] | undefined,
): { readonly from: string; readonly params: Params } {
  if (paths === undefined) {
    return {
      from: "states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?",
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

export function createStateRepo(conn: Connection): CodeStateRepo {
  return {
    list(worktreeId, filter = {}) {
      const { from, params } = statesOf(worktreeId, filter.paths);
      return conn
        .all(
          `SELECT s.*, ${CHECK_COLUMNS} FROM ${from}
             AND (? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?)
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
          ...params,
          ...Array(2).fill(filter.measure ?? null),
          ...Array(2).fill(filter.outcome ?? null),
        )
        .map((row) => toState(worktreeId, row));
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          conn.run(
            `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
               counted_at, blob, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
               outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
               counted_at = excluded.counted_at, blob = excluded.blob,
               changed_at = excluded.changed_at`,
            state.worktreeId,
            ensureCodeCheckId(conn, state.check),
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
      const { from, params } = statesOf(worktreeId, paths);
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
        const toId = ensureCodeCheckId(conn, to);
        for (const table of ["states", "views"]) {
          // `OR REPLACE`: a row `to` already holds is the stale one; the moved state wins.
          conn.run(
            `UPDATE OR REPLACE ${table} SET check_id = ? WHERE worktree_id = ? AND check_id = ?`,
            toId,
            worktreeId,
            fromId,
          );
        }
        // The history explains the moved state: news not yet told and Stop's count (D6, D7).
        // `to`'s own is an earlier function's, as its stale state above.
        conn.run(
          "DELETE FROM transitions WHERE worktree_id = ? AND check_id = ?",
          worktreeId,
          toId,
        );
        conn.run(
          "UPDATE transitions SET check_id = ? WHERE worktree_id = ? AND check_id = ?",
          toId,
          worktreeId,
          fromId,
        );
      });
    },
    adopt(worktreeId, staged, measure, removed) {
      return conn.transaction(() => {
        // Set-based, so the switch costs a statement per kind of write, not one per state.
        // A staged edit mark is the newer (row 015-55); with none, the state keeps its own.
        const written = conn.run(
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
