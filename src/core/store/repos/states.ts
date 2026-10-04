import type {
  KnownState,
  KnownStateRepo,
  ResultOrigin,
  Transition,
  TransitionRepo,
} from "../../types/index.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  findCheckId,
  location,
  locationParams,
  num,
  numOrNull,
  oneOf,
  oneOfOrNull,
  str,
  strOrNull,
} from "../codec.js";
import type { Connection, Row } from "../connection.js";

const OUTCOMES = ["pass", "fail", "skip", "unknown"] as const;
const VALIDITIES = ["current", "pending", "stale", "unknown"] as const;
const PENDING = ["queued", "running"] as const;
const KINDS = [
  "first-seen-fail",
  "pass-to-fail",
  "fail-to-pass",
  "fail-changed",
  "to-unknown",
] as const;

const SELECT_STATES = `SELECT s.*, ${CHECK_COLUMNS} FROM known_states s JOIN checks c ON c.id = s.check_id`;

export function createKnownStateRepo(conn: Connection): KnownStateRepo {
  return {
    list: (worktreeId) =>
      conn
        .all(
          `${SELECT_STATES} WHERE s.worktree_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          worktreeId,
        )
        .map(toKnownState),
    get: (worktreeId, check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_STATES} WHERE s.worktree_id = ? AND s.check_id = ?`,
        worktreeId,
        id,
      );
      return row === null ? null : toKnownState(row);
    },
    upsertMany: (states) =>
      conn.transaction(() => {
        const now = Date.now();
        for (const s of states) {
          const origin = s.origin;
          conn.run(
            `INSERT OR REPLACE INTO known_states (worktree_id, check_id, outcome, validity,
               pending_phase, observed_at, commit_sha, origin_kind, origin_worktree,
               origin_commit, duration_ms, location_path, location_line, location_column,
               summary, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            s.worktreeId,
            ensureCheckId(conn, s.check, now),
            s.outcome,
            s.validity,
            s.pendingPhase,
            s.observedAt,
            s.commit,
            origin?.kind ?? null,
            origin?.kind === "inherited" ? origin.worktreeId : null,
            origin?.kind === "inherited" ? origin.commit : null,
            s.durationMs,
            ...locationParams(s.location),
            s.summary,
            s.fingerprint,
          );
        }
      }),
    removeMany: (worktreeId, checks) =>
      conn.transaction(() => {
        for (const check of checks) {
          const id = findCheckId(conn, check);
          if (id === null) continue;
          conn.run(
            "DELETE FROM known_states WHERE worktree_id = ? AND check_id = ?",
            worktreeId,
            id,
          );
        }
      }),
  };
}

function toOrigin(row: Row): ResultOrigin | null {
  const kind = oneOfOrNull(row, "origin_kind", ["own", "inherited"] as const);
  if (kind === null) return null;
  if (kind === "own") return { kind };
  return {
    kind,
    worktreeId: str(row, "origin_worktree"),
    commit: strOrNull(row, "origin_commit"),
  };
}

function toKnownState(row: Row): KnownState {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    validity: oneOf(row, "validity", VALIDITIES),
    pendingPhase: oneOfOrNull(row, "pending_phase", PENDING),
    observedAt: numOrNull(row, "observed_at"),
    commit: strOrNull(row, "commit_sha"),
    origin: toOrigin(row),
    durationMs: numOrNull(row, "duration_ms"),
    location: location(row),
    summary: strOrNull(row, "summary"),
    fingerprint: strOrNull(row, "fingerprint"),
  };
}

export function createTransitionRepo(conn: Connection): TransitionRepo {
  return {
    append: (transitions) =>
      conn.transaction(() => {
        for (const t of transitions) {
          conn.run(
            `INSERT INTO transitions (worktree_id, check_id, kind, from_outcome, to_outcome,
               from_fingerprint, to_fingerprint, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.worktreeId,
            ensureCheckId(conn, t.check, t.at),
            t.kind,
            t.from,
            t.to,
            t.fromFingerprint,
            t.toFingerprint,
            t.revision,
            t.at,
          );
        }
      }),
    history: (worktreeId, check) => {
      const id = findCheckId(conn, check);
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

function toTransition(row: Row): Transition {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES),
    to: oneOf(row, "to_outcome", OUTCOMES),
    fromFingerprint: strOrNull(row, "from_fingerprint"),
    toFingerprint: strOrNull(row, "to_fingerprint"),
    revision: num(row, "revision"),
    at: num(row, "at"),
  };
}
