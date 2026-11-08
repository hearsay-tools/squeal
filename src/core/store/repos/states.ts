import {
  importIdOf,
  type KnownState,
  originWorktree,
  type ResultOrigin,
  type Transition,
} from "../../types/state.js";
import type { KnownStateRepo, TransitionRepo } from "../../types/store.js";
import {
  CHECK_COLUMNS,
  checkFrom,
  ensureCheckId,
  findCheckId,
  inTestFiles,
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
    list: (worktreeId, files) => {
      const only = files === undefined ? null : inTestFiles("s.check_id", files);
      return conn
        .all(
          `${SELECT_STATES} WHERE s.worktree_id = ? ${only === null ? "" : `AND ${only.sql}`}
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          worktreeId,
          ...(only?.params ?? []),
        )
        .map(toKnownState);
    },
    untold: (consumer) =>
      conn
        .all(
          `${SELECT_STATES} WHERE s.worktree_id = ? AND NOT EXISTS (
             SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
               AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
          consumer.worktreeId,
          consumer.sessionId,
          consumer.agentId,
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
            storedKind(origin),
            origin === null ? null : originWorktree(origin),
            origin === null || origin.kind === "own" ? null : origin.commit,
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

/**
 * Spec 018 D4: an imported origin is stored with no kind and the import's
 * mark as its worktree. A release before 018 reads the kind with
 * `oneOfOrNull` of `own` and `inherited`, so a kind it did not know would
 * throw; it reads no kind as no known origin.
 */
function storedKind(origin: ResultOrigin | null): "own" | "inherited" | null {
  return origin === null || origin.kind === "imported" ? null : origin.kind;
}

function toOrigin(row: Row): ResultOrigin | null {
  const stored = strOrNull(row, "origin_kind");
  // A kind a later release stores reads as no known origin, as this one's reads before 018.
  const kind = stored === "own" || stored === "inherited" ? stored : null;
  if (stored !== null && kind === null) return null;
  if (kind === null) {
    const marked = strOrNull(row, "origin_worktree");
    const importId = marked === null ? null : importIdOf(marked);
    if (importId === null) return null;
    return { kind: "imported", importId, commit: strOrNull(row, "origin_commit") };
  }
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
