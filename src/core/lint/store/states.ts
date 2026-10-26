import {
  bool,
  flag,
  num,
  numOrNull,
  oneOf,
  oneOfOrNull,
  str,
  strOrNull,
} from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { RelativePath, WorktreeId } from "../../types/index.js";
import type { LintJudged, LintKnownState } from "../../types/lint.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureLintCheckId,
  findLintCheckId,
  JUDGED,
  OUTCOMES,
} from "./checks.js";
import type { LintStateRepo } from "./types.js";

/**
 * The `FROM` of a read of a worktree's states, through its first `WHERE`
 * term. With `paths`, each path's checks are read first and their states by
 * key, as the code store reads them (row 015-45).
 */
function statesOf(worktreeId: WorktreeId, paths: readonly RelativePath[] | undefined) {
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

export function createStateRepo(conn: Connection): LintStateRepo {
  return {
    list(worktreeId, filter = {}) {
      const { from, params } = statesOf(worktreeId, filter.paths);
      return conn
        .all(
          `SELECT s.*, ${CHECK_COLUMNS} FROM ${from} AND (? IS NULL OR s.outcome = ?)
           ORDER BY c.path, c.tool`,
          ...params,
          ...Array(2).fill(filter.outcome ?? null),
        )
        .map((row) => toState(worktreeId, row));
    },
    upsertMany(states) {
      conn.transaction(() => {
        for (const state of states) {
          const judged = state.judged;
          conn.run(
            `INSERT INTO states (worktree_id, check_id, outcome, judged_key, judged_outcome,
               judged_fingerprint, judged_blob, judged_revision, stale, reason, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, check_id) DO UPDATE SET
               outcome = excluded.outcome, judged_key = excluded.judged_key,
               judged_outcome = excluded.judged_outcome,
               judged_fingerprint = excluded.judged_fingerprint,
               judged_blob = excluded.judged_blob, judged_revision = excluded.judged_revision,
               stale = excluded.stale, reason = excluded.reason, changed_at = excluded.changed_at`,
            state.worktreeId,
            ensureLintCheckId(conn, state.check),
            state.outcome,
            judged?.key ?? null,
            judged?.outcome ?? null,
            judged?.fingerprint ?? null,
            judged?.blob ?? null,
            judged?.revision ?? null,
            flag(state.stale),
            state.reason,
            state.changedAt,
          );
        }
      });
    },
    removeMany(worktreeId, checks) {
      conn.transaction(() => {
        for (const check of checks) {
          const id = findLintCheckId(conn, check);
          if (id === null) continue;
          conn.run("DELETE FROM states WHERE worktree_id = ? AND check_id = ?", worktreeId, id);
        }
      });
    },
  };
}

function toState(worktreeId: WorktreeId, row: Row): LintKnownState {
  return {
    worktreeId,
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    judged: judgedFrom(row),
    stale: bool(row, "stale"),
    reason: strOrNull(row, "reason"),
    changedAt: num(row, "changed_at"),
  };
}

function judgedFrom(row: Row): LintJudged | null {
  const outcome = oneOfOrNull(row, "judged_outcome", JUDGED);
  const revision = numOrNull(row, "judged_revision");
  if (outcome === null || revision === null) return null;
  return {
    key: str(row, "judged_key"),
    outcome,
    fingerprint: strOrNull(row, "judged_fingerprint"),
    blob: str(row, "judged_blob"),
    revision,
  };
}
