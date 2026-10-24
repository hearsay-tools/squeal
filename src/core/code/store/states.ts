import { num, numOrNull, oneOf, oneOfOrNull, str } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type {
  CodeCheckId,
  CodeKnownState,
  CodeMeasure,
  CodeOutcome,
  CodeTransition,
  CodeTransitionKind,
} from "../../types/code.js";
import type { CodeEdit, CodeStateRepo, CodeTransitionRepo } from "./types.js";

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
const KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "removed",
] as const satisfies readonly CodeTransitionKind[];

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

export function createStateRepo(conn: Connection): CodeStateRepo {
  return {
    list(worktreeId, filter = {}) {
      return conn
        .all(
          `SELECT s.*, ${CHECK_COLUMNS} FROM states s JOIN checks c ON c.id = s.check_id
           WHERE s.worktree_id = ?
             AND (? IS NULL OR c.path IN (SELECT value FROM json_each(?)))
             AND (? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?)
           ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`,
          worktreeId,
          ...Array(2).fill(filter.paths === undefined ? null : JSON.stringify(filter.paths)),
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
    edits(worktreeId, measure) {
      return conn
        .all(
          `SELECT s.measure, s.edited_revision, s.edited_at, ${CHECK_COLUMNS}
           FROM states s JOIN checks c ON c.id = s.check_id
           WHERE s.worktree_id = ? AND s.measure = ? AND s.edited_at IS NOT NULL
           ORDER BY c.path, c.qualified_name, c.occurrence`,
          worktreeId,
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
      });
    },
  };
}

export function createTransitionRepo(conn: Connection): CodeTransitionRepo {
  return {
    append(transitions) {
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (worktree_id, check_id, measure, kind, from_outcome,
               to_outcome, from_value, to_value, threshold, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureCodeCheckId(conn, t.check),
            t.measure,
            t.kind,
            t.from,
            t.to,
            t.fromValue,
            t.toValue,
            t.threshold,
            t.revision,
            t.at,
          );
        }
      });
    },
    history(worktreeId, check) {
      const id = findCodeCheckId(conn, check);
      if (id === null) return [];
      return conn
        .all(
          `SELECT t.*, ${CHECK_COLUMNS} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.check_id = ? ORDER BY t.id`,
          worktreeId,
          id,
        )
        .map(toTransition);
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

function toTransition(row: Row): CodeTransition {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    measure: oneOf(row, "measure", MEASURES),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES),
    to: oneOfOrNull(row, "to_outcome", OUTCOMES),
    fromValue: numOrNull(row, "from_value"),
    toValue: numOrNull(row, "to_value"),
    threshold: numOrNull(row, "threshold"),
    revision: num(row, "revision"),
    at: num(row, "at"),
  };
}
