import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { daemonUsedMetaKey, readDaemonUsed } from "../daemon/last-use.js";
import { readPolicy } from "../daemon/policy.js";
import { isRecord } from "../fs/index.js";
import {
  type AbsolutePath,
  type DaemonRecord,
  DEFAULT_POLICY,
  type HarnessProcess,
  type WorktreeId,
  type WorktreeMetaRow,
  worktreeMetaKey,
} from "../types/index.js";
import { ownStartOn } from "./discover.js";
import type { ConsumerState, DaemonSettings, DaemonWork, FoundDaemon, ReadWork } from "./model.js";
import type { PsCheckpoint, PsTier, PsUnknown } from "./shape.js";
import type { ProcessTable } from "./source.js";

/*
 * Spec 014 D3: what a daemon's store says of it, without the daemon. Each
 * store is read once, through one `{ readOnly: true }` connection in one
 * read transaction, never through `openStore`, which migrates an older store
 * and so would make the daemon serving it exit (011 C7). The columns read
 * are schema V1's; a meta value of a format this release does not know reads
 * as `null`, and `unknown` names it. A waiting daemon is not read: its
 * worktree's row is the lock holder's.
 */

/** A WAL reader waits only for a writer's recovery; a busy store is unknown, not waited on. */
const BUSY_TIMEOUT_MS = 100;
/** The schema whose tables this reads (`store/schema.ts` V1); a later one adds to them. */
const READS_SCHEMA = 1;

type Row = Record<string, unknown>;

export const readWork: ReadWork = (source, table, daemons) => {
  const work = new Map<number, DaemonWork>();
  const unknown: PsUnknown[] = [];
  const namespace = source.pidNamespace();
  const ownStart = ownStartOn(source);
  for (const [path, group] of byStore(daemons)) {
    const db = openReadOnly(path);
    if (typeof db === "string") {
      for (const d of group) unknown.push({ what: `daemon ${d.row.pid} work`, why: db });
      continue;
    }
    try {
      // One committed state for every daemon of the store.
      db.exec("BEGIN");
      for (const d of group) {
        try {
          work.set(d.row.pid, readOne(db, d, table, namespace, ownStart, unknown));
        } catch (error) {
          const why = `its store ${path} cannot be read: ${message(error)}`;
          unknown.push({ what: `daemon ${d.row.pid} work`, why });
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  }
  return { work, unknown };
};

/** The daemons whose row is their own, by store: those that hold their lock, or may (D10). */
function byStore(daemons: readonly FoundDaemon[]): Map<AbsolutePath, FoundDaemon[]> {
  const stores = new Map<AbsolutePath, FoundDaemon[]>();
  for (const d of daemons) {
    if (d.storePath === null || d.worktreeId === null || d.holdsLock === false) continue;
    stores.set(d.storePath, [...(stores.get(d.storePath) ?? []), d]);
  }
  return stores;
}

/** The connection, or why there is none. */
function openReadOnly(path: AbsolutePath): DatabaseSync | string {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version >= READS_SCHEMA) return db;
    db.close();
    return `its store ${path} is at schema ${version}, which has no tables yet`;
  } catch (error) {
    db?.close();
    return `its store ${path} cannot be read: ${message(error)}`;
  }
}

function readOne(
  db: DatabaseSync,
  d: FoundDaemon,
  table: ProcessTable,
  namespace: string | null,
  ownStart: ReturnType<typeof ownStartOn>,
  unknown: PsUnknown[],
): DaemonWork {
  const id = d.worktreeId as WorktreeId;
  const name = (what: string, why: string) =>
    unknown.push({ what: `daemon ${d.row.pid} ${what}`, why });
  /** A meta row through `decode`: `absent` without one, `null` (and named) in a format it does not know. */
  const meta = <T>(row: WorktreeMetaRow, what: string, decode: Decode<T>, absent: T): T | null => {
    const key = worktreeMetaKey(row, id);
    const text = get(db, "SELECT value FROM meta WHERE key = ?", key)?.value;
    if (typeof text !== "string") return absent;
    const value = decode(parsed(text));
    if (value !== undefined) return value;
    name(what, `its ${key} ${UNKNOWN}`);
    return null;
  };

  const row = get(db, "SELECT * FROM worktrees WHERE id = ?", id);
  // A cleared record keeps its start time and version (`WorktreeRepo.setDaemon`).
  const startedAt = row === null ? null : numOrNull(row, "daemon_started_at");
  const version = row === null ? null : strOrNull(row, "daemon_version");
  // A predecessor's row under a lock holder that has not registered yet (D2, `starting`):
  // its token, runs and last use are the predecessor's, never this daemon's.
  const theirs = startedAt !== null && ownStart(d, startedAt) === false;
  if (theirs)
    name(
      "work",
      `its row is a predecessor's: its token and last use are ${UNKNOWN} until it registers`,
    );
  const token =
    startedAt === null || theirs
      ? null
      : meta("daemonToken", "token", tokenOf(startedAt, version), null);
  const record = row === null ? null : recordOf(row, token);

  const counts = new Map(
    all(db, PENDING, id).map((r) => [str(r, "pending"), num(r, "n")] as const),
  );
  const slow = meta("slowTier", "slowWaiting", slowOf, { waits: false, running: [] });
  let lanes: Readonly<Record<string, string>> | null | undefined;
  const laneOf = (checkpointId: string): string | null => {
    if (lanes === undefined) lanes = meta("checkpointLanes", "checkpoint lanes", lanesOf, {});
    return lanes?.[checkpointId] ?? null;
  };
  const since = theirs ? Number.POSITIVE_INFINITY : (startedAt ?? Number.POSITIVE_INFINITY);
  const tiers = all(db, OPEN_RUNS, id, since).map((r): PsTier => {
    const checkpointId = strOrNull(r, "checkpoint_id");
    const paths = testFiles(r).map((f) => (isRecord(f) ? f.path : undefined));
    // Its checkpoint's one lane, else the slow tier's own record of its run; `null` without either.
    const slowRun = paths.some((p) => typeof p === "string" && slow?.running.includes(p));
    const lane = slow === null ? null : slowRun ? "slow" : "fast";
    return {
      runId: str(r, "id"),
      lane: (checkpointId === null ? null : laneOf(checkpointId)) ?? lane,
      files: paths.length,
      startedAt: num(r, "started_at"),
      checkpointId,
    };
  });
  const checkpoints = all(db, OPEN_CHECKPOINTS, id, since).map(
    (r): PsCheckpoint => ({
      id: str(r, "id"),
      startedAt: num(r, "started_at"),
      lane: laneOf(str(r, "id")),
      files: testFiles(r).length,
    }),
  );

  const harnesses = meta("harnessProcess", "consumer harnesses", slotsOf, {});
  const versions = meta("consumerVersion", "consumer versions", slotsOf, {});
  /** A consumer's value in a slot row: `null` without one, and named in a format it does not know. */
  const slot = <T>(slots: Slots | null, of: string, what: string, decode: Decode<T>): T | null => {
    const value = slots?.[of];
    const decoded = value === undefined ? null : decode(value);
    if (decoded === undefined) name(what, `its slot ${UNKNOWN}`);
    return decoded ?? null;
  };
  const consumers = all(db, CONSUMERS, id).map((r): ConsumerState => {
    const sessionId = str(r, "session_id");
    const agentId = str(r, "agent_id");
    const of = `${sessionId}\n${agentId}`;
    const harness = slot(harnesses, of, `consumer ${sessionId} harness`, harnessOf);
    return {
      sessionId,
      agentId,
      lastSeenAt: num(r, "last_seen_at"),
      harness,
      alive: aliveOf(harness, table, namespace),
      version: slot(versions, of, `consumer ${sessionId} version`, text),
    };
  });

  // D9: the worktree's row, read as this daemon's only from the start its row records.
  const usedText = get(db, "SELECT value FROM meta WHERE key = ?", daemonUsedMetaKey(id))?.value;
  const lastUse =
    startedAt === null || theirs
      ? null
      : readDaemonUsed(typeof usedText === "string" ? usedText : null, startedAt);
  if (lastUse === null && record !== null && !theirs)
    name(
      "lastUsedAt",
      typeof usedText === "string"
        ? `its ${daemonUsedMetaKey(id)} is a predecessor's or ${UNKNOWN} (D9)`
        : "its daemon records no last use: a release before D9 (D9)",
    );

  const root = d.root ?? (row === null ? null : strOrNull(row, "root"));
  if (root === null) name("settings", "its root is unknown: the defaults stand in");
  return {
    record,
    recordedStartedAt: startedAt,
    token,
    pending: counts.get("queued") ?? 0,
    running: counts.get("running") ?? 0,
    tiers,
    checkpoints,
    consumers,
    departedAt: meta("departed", "departedAt", finiteNumber, null),
    slowWaiting: slow === null ? null : slow.waits,
    lastUse,
    settings: settingsOf(root),
  };
}

const PENDING = `SELECT pending, count(*) AS n FROM test_file_keys
  WHERE worktree_id = ? AND pending IS NOT NULL GROUP BY pending`;
// D3's time bound: a run or checkpoint an earlier daemon left open runs nothing now.
const OPEN_RUNS = `SELECT id, test_files, checkpoint_id, started_at FROM runs
  WHERE worktree_id = ? AND end_state IS NULL AND started_at >= ? ORDER BY started_at, rowid`;
const OPEN_CHECKPOINTS = `SELECT id, test_files, started_at FROM checkpoints
  WHERE worktree_id = ? AND completed_at IS NULL AND started_at >= ? ORDER BY started_at, rowid`;
const CONSUMERS = `SELECT session_id, agent_id, last_seen_at FROM consumers
  WHERE worktree_id = ? ORDER BY session_id, agent_id`;
const UNKNOWN = "has a format this release does not know";

/** Reads a parsed JSON value; `undefined` when its format is not known. */
type Decode<T> = (value: unknown) => T | undefined;

/** `WorktreeRepo`'s token rule: the row's token counts only for the registration it was drawn with. */
const tokenOf =
  (startedAt: number, version: string | null): Decode<string | null> =>
  (v) => {
    if (!isRecord(v) || typeof v.token !== "string") return undefined;
    return v.startedAt === startedAt && v.squealVersion === version ? v.token : null;
  };

function recordOf(row: Row, token: string | null): DaemonRecord | null {
  const socketPath = strOrNull(row, "daemon_socket");
  if (socketPath === null) return null;
  return {
    socketPath,
    startedAt: num(row, "daemon_started_at"),
    heartbeatAt: num(row, "daemon_heartbeat_at"),
    heartbeatIntervalMs: num(row, "daemon_heartbeat_interval_ms"),
    squealVersion: str(row, "daemon_version"),
    ...(token === null ? {} : { token }),
  };
}

/**
 * The `slowTier` row (004 D8): whether slow work waits, and the files of the
 * slow run. The slow tier publishes those in the transaction that starts its
 * run (`scheduler/slow-tier.ts`), the only start besides the fast lane's.
 */
const slowOf: Decode<{ readonly waits: boolean; readonly running: readonly unknown[] }> = (v) => {
  if (v === null) return { waits: false, running: [] };
  if (!isRecord(v)) return undefined;
  if (v.kind === "waiting") return { waits: true, running: [] };
  if (v.kind !== "running" || typeof v.path !== "string") return undefined;
  return { waits: true, running: Array.isArray(v.paths) ? v.paths : [v.path] };
};

/** The `checkpointLanes` row: the lane of each one-lane checkpoint (task 004-61). */
const lanesOf: Decode<Record<string, string>> = (v) => {
  if (!isRecord(v)) return undefined;
  const lanes: Record<string, string> = {};
  for (const [id, lane] of Object.entries(v))
    if (lane === "fast" || lane === "slow") lanes[id] = lane;
  return lanes;
};

/** A per-consumer row (`delivery/slots.ts`): `{ "<session>\n<agent>": value }`. */
type Slots = Readonly<Record<string, unknown>>;
const slotsOf: Decode<Slots> = (v) => (isRecord(v) ? v : undefined);
const text: Decode<string> = (v) => (typeof v === "string" ? v : undefined);

const harnessOf: Decode<HarnessProcess> = (v) =>
  isRecord(v) &&
  typeof v.pid === "number" &&
  typeof v.startTime === "number" &&
  typeof v.pidNamespace === "string"
    ? { pid: v.pid, startTime: v.startTime, pidNamespace: v.pidNamespace }
    : undefined;

const finiteNumber: Decode<number> = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** `harnessGone`'s rule, with `null` where it cannot tell: another PID namespace, or none recorded. */
function aliveOf(
  harness: HarnessProcess | null,
  table: ProcessTable,
  namespace: string | null,
): boolean | null {
  if (harness === null || namespace === null || harness.pidNamespace !== namespace) return null;
  const row = table.get(harness.pid);
  return row !== undefined && row.startTicks === harness.startTime && row.state !== "Z";
}

/** 011 C10: the daemon's own `squeal.config.json`, through the loader that never throws. */
function settingsOf(root: AbsolutePath | null): DaemonSettings {
  const { daemon, runner } = root === null ? DEFAULT_POLICY : readPolicy(root);
  return {
    idleExitMinutes: daemon.idleExitMinutes,
    unusedExitMinutes: daemon.unusedExitMinutes,
    // `null` is no limit, which no process outlives.
    timeoutMs: runner.timeoutMs ?? Number.POSITIVE_INFINITY,
  };
}

function get(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row | null {
  return (db.prepare(sql).get(...params) as Row | undefined) ?? null;
}

function all(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function testFiles(row: Row): unknown[] {
  const files: unknown = JSON.parse(str(row, "test_files"));
  if (!Array.isArray(files)) throw new TypeError("test_files is not a list");
  return files;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: a format this release does not know, which the caller names.
    return undefined;
  }
}

/** Column readers throw on a type V1 does not allow, so a damaged row is unknown, not plausible. */
function num(row: Row, column: string): number {
  if (typeof row[column] === "number") return row[column];
  throw new TypeError(`${column} is not a number`);
}

function str(row: Row, column: string): string {
  if (typeof row[column] === "string") return row[column];
  throw new TypeError(`${column} is not text`);
}

const orNull =
  <T>(read: (row: Row, column: string) => T) =>
  (row: Row, column: string): T | null =>
    row[column] === null ? null : read(row, column);
const numOrNull = orNull(num);
const strOrNull = orNull(str);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
