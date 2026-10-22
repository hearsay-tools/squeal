import {
  type CheckpointLane,
  type CheckpointRecord,
  type CheckpointRepo,
  type RunRecord,
  type RunRepo,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../../types/index.js";
import { json, num, numOrNull, oneOf, oneOfOrNull, str, strOrNull } from "../codec.js";
import type { Connection, Row } from "../connection.js";

const RUN_ENDS = ["completed", "crashed", "timed-out"] as const;
const CHECKPOINT_KINDS = ["run-all", "baseline"] as const;
const CHECKPOINT_ENDS = ["completed", "abandoned"] as const;

export function createRunRepo(conn: Connection): RunRepo {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO runs (id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        JSON.stringify(record.testFiles),
        record.checkpointId,
        record.logDir,
        record.startedAt,
      );
      return { ...record, endedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM runs WHERE id = ?", id);
      return row === null ? null : toRun(row);
    },
    inFlight: (worktreeId, startedSince) =>
      conn
        .all(
          `SELECT * FROM runs WHERE worktree_id = ? AND end_state IS NULL AND started_at >= ?
           ORDER BY started_at, rowid`,
          worktreeId,
          startedSince,
        )
        .map(toRun),
  };
}

function toRun(row: Row): RunRecord {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    testFiles: json<TestFileRef[]>(row, "test_files"),
    checkpointId: strOrNull(row, "checkpoint_id"),
    logDir: str(row, "log_dir"),
    startedAt: num(row, "started_at"),
    endedAt: numOrNull(row, "ended_at"),
    end: oneOfOrNull(row, "end_state", RUN_ENDS),
  };
}

export function createCheckpointRepo(conn: Connection): CheckpointRepo {
  const lanes = (worktreeId: WorktreeId): Record<string, CheckpointLane> =>
    readLanes(conn, worktreeId);
  const withLane = (row: Row): CheckpointRecord => {
    const record = toCheckpoint(row);
    const lane = lanes(record.worktreeId)[record.id];
    return lane === undefined ? record : { ...record, lane };
  };
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO checkpoints (id, worktree_id, revision, kind, test_files, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        record.kind,
        JSON.stringify(record.testFiles),
        record.startedAt,
      );
      if (record.lane !== undefined) writeLane(conn, record.worktreeId, record.id, record.lane);
      return { ...record, completedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE checkpoints SET end_state = ?, completed_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM checkpoints WHERE id = ?", id);
      return row === null ? null : withLane(row);
    },
    lastCompleted: (worktreeId) => {
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId,
      );
      return row === null ? null : withLane(row);
    },
    lastCompletedFull: (worktreeId) => {
      const oneLane = Object.keys(lanes(worktreeId));
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
           AND id NOT IN (SELECT value FROM json_each(?))
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId,
        JSON.stringify(oneLane),
      );
      return row === null ? null : toCheckpoint(row);
    },
  };
}

/**
 * Task 004-61: the lane of each one-lane checkpoint of a worktree, a JSON
 * map in `meta`, so the `checkpoints` table and an older reader of it are
 * unchanged. An older reader counts a one-lane checkpoint as a full one.
 * A lane stays while its checkpoint does (`prune` bounds both): a lane
 * dropped by a count cap would make its checkpoint read as full (review
 * 001-417 B1).
 */
function readLanes(conn: Connection, worktreeId: WorktreeId): Record<string, CheckpointLane> {
  const row = conn.get(
    "SELECT value FROM meta WHERE key = ?",
    worktreeMetaKey("checkpointLanes", worktreeId),
  );
  if (row === null) return {};
  try {
    return toCheckpointLanes(JSON.parse(str(row, "value"))) ?? {};
  } catch {
    return {};
  }
}

/** A `checkpointLanes` row's parsed value; `undefined` when it is not a map. */
export function toCheckpointLanes(value: unknown): Record<string, CheckpointLane> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const lanes: Record<string, CheckpointLane> = {};
  for (const [id, lane] of Object.entries(value)) {
    if (lane === "fast" || lane === "slow") lanes[id] = lane;
  }
  return lanes;
}

function writeLane(
  conn: Connection,
  worktreeId: WorktreeId,
  id: string,
  lane: CheckpointLane,
): void {
  const lanes = readLanes(conn, worktreeId);
  const live = new Set(
    conn
      .all(
        "SELECT id FROM checkpoints WHERE id IN (SELECT value FROM json_each(?))",
        JSON.stringify(Object.keys(lanes)),
      )
      .map((row) => str(row, "id")),
  );
  const kept = Object.entries(lanes).filter(([id]) => live.has(id));
  conn.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    worktreeMetaKey("checkpointLanes", worktreeId),
    JSON.stringify(Object.fromEntries([...kept, [id, lane]])),
  );
}

function toCheckpoint(row: Row): CheckpointRecord {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    kind: oneOf(row, "kind", CHECKPOINT_KINDS),
    testFiles: json<TestFileRef[]>(row, "test_files"),
    startedAt: num(row, "started_at"),
    completedAt: numOrNull(row, "completed_at"),
    end: oneOfOrNull(row, "end_state", CHECKPOINT_ENDS),
  };
}
