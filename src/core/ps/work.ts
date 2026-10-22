import { type BigIntStats, existsSync, statSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { daemonUsedMetaKey, readDaemonUsed } from "../daemon/last-use.js";
import { readPolicy } from "../daemon/policy.js";
import { harnessAlive, toHarness } from "../delivery/harness-process.js";
import { isRecord } from "../fs/index.js";
import { immutableUrl } from "../slow/slot.js";
import { toSlowActivity } from "../slow/state.js";
import { toCheckpointLanes } from "../store/repos/runs.js";
import { toDaemonToken } from "../store/repos/worktrees.js";
import {
  type AbsolutePath,
  type DaemonRecord,
  DEFAULT_POLICY,
  type SlowTierActivity,
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
 * store is read once, through one read-only connection in one read
 * transaction, never through `openStore`, which migrates an older store and
 * so would make the daemon serving it exit (011 C7). The read creates no
 * file (goal 4, 014-26). The columns read are schema V1's; a meta value of a
 * format this release does not know reads as `null`, and `unknown` names it.
 * A waiting daemon is not read: its worktree's row is the lock holder's.
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
    const store = openReadOnly(path);
    if (typeof store === "string") {
      for (const d of group) unknown.push({ what: `daemon ${d.row.pid} work`, why: store });
      continue;
    }
    const { db, file } = store;
    const read = new Map<number, DaemonWork>();
    const named: PsUnknown[] = [];
    // The store's open runs, one query for all its daemons (014-23): `runs` has no index to filter by.
    // Read at the first daemon, so a store that fails it names each daemon unknown, as any read does.
    let runs: Map<string, Row[]> | undefined;
    const runsOf = (id: WorktreeId): Row[] => {
      runs ??= openRuns(db);
      return runs.get(id) ?? [];
    };
    try {
      // One committed state for every daemon of the store.
      db.exec("BEGIN");
      for (const d of group) {
        try {
          read.set(d.row.pid, readOne(db, d, runsOf, table, namespace, ownStart, named));
        } catch (error) {
          const why = `its store ${path} cannot be read: ${message(error)}`;
          named.push({ what: `daemon ${d.row.pid} work`, why });
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    if (file !== null && changed(path, file)) {
      const why = `its store ${path} changed while it was read without its WAL`;
      for (const d of group) unknown.push({ what: `daemon ${d.row.pid} work`, why });
      continue;
    }
    for (const [pid, w] of read) work.set(pid, w);
    unknown.push(...named);
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

/**
 * The connection, or why there is none. SQLite's WAL reader creates `-wal`
 * and `-shm` when they are missing (`lessons.md` P6), so it reads only a
 * store that has both. Without a `-wal`, or with an empty one, every commit
 * is in the database file: it is read `immutable`, which opens no other
 * file, and `file` is the file's state, which `changed` checks after the
 * read. A `-wal` with frames and no `-shm`, as a crash leaves it, may hold
 * commits the file lacks, which only a reader that creates `-shm` recovers:
 * that store is unknown (the wave 4 review).
 *
 * One limit stays (review N1). The store's last connection can close, and
 * remove both files, between this check and the reader's first read, about
 * 0.1 ms later; the reader then makes them again. Its read is still right,
 * and SQLite takes the files as its own. No open mode of `node:sqlite`
 * avoids it: `readonly_shm` still makes `-wal`, and `nolock` and
 * `unix-none` read no WAL store. Only a read lock on the database file
 * taken before the check would, and Node has no `fcntl`.
 */
function openReadOnly(path: AbsolutePath): { db: DatabaseSync; file: BigIntStats | null } | string {
  let db: DatabaseSync | undefined;
  try {
    const file = statSync(path, { bigint: true });
    const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
    const held = wal !== undefined && existsSync(`${path}-shm`);
    if (!held && (wal?.size ?? 0) > 0)
      return `its store ${path} has a WAL whose commits cannot be read without creating its -shm`;
    db = new DatabaseSync(held ? path : immutableUrl(path), { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version >= READS_SCHEMA) return { db, file: held ? null : file };
    db.close();
    return `its store ${path} is at schema ${version}, which has no tables yet`;
  } catch (error) {
    db?.close();
    return `its store ${path} cannot be read: ${message(error)}`;
  }
}

/** A writer that opened the store and checkpointed into its file during an `immutable` read. */
function changed(path: AbsolutePath, before: BigIntStats): boolean {
  try {
    const after = statSync(path, { bigint: true });
    return (
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    );
  } catch {
    // Gone since: nothing read from it stands.
    return true;
  }
}

/** Every worktree's open runs, by worktree, oldest first. */
function openRuns(db: DatabaseSync): Map<string, Row[]> {
  const byWorktree = new Map<string, Row[]>();
  for (const r of all(db, OPEN_RUNS)) {
    const rows = byWorktree.get(str(r, "worktree_id"));
    if (rows === undefined) byWorktree.set(str(r, "worktree_id"), [r]);
    else rows.push(r);
  }
  return byWorktree;
}

function readOne(
  db: DatabaseSync,
  d: FoundDaemon,
  runsOf: (id: WorktreeId) => readonly Row[],
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
  // its record, token, runs and last use are the predecessor's, never this daemon's.
  // `recordedStartedAt` keeps its start, which tells `starting` (D2).
  const theirs = startedAt !== null && ownStart(d, startedAt) === false;
  if (theirs)
    name(
      "work",
      `its row is a predecessor's: its record, token and last use are ${UNKNOWN} until it registers`,
    );
  const token =
    startedAt === null || theirs
      ? null
      : meta("daemonToken", "token", (v) => toDaemonToken(v, startedAt, version), null);
  const record = row === null || theirs ? null : recordOf(row, token);

  const counts = new Map(
    all(db, PENDING, id).map((r) => [str(r, "pending"), num(r, "n")] as const),
  );
  const slow = meta("slowTier", "slowWaiting", (v) => slowOf(toSlowActivity(v)), NO_SLOW);
  let lanes: Readonly<Record<string, string>> | null | undefined;
  const laneOf = (checkpointId: string): string | null => {
    if (lanes === undefined)
      lanes = meta("checkpointLanes", "checkpoint lanes", toCheckpointLanes, {});
    return lanes?.[checkpointId] ?? null;
  };
  const since = theirs ? Number.POSITIVE_INFINITY : (startedAt ?? Number.POSITIVE_INFINITY);
  const tiers = runsOf(id)
    .filter((r) => num(r, "started_at") >= since)
    .map((r): PsTier => {
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
    const harness = slot(harnesses, of, `consumer ${sessionId} harness`, toHarness);
    return {
      sessionId,
      agentId,
      lastSeenAt: num(r, "last_seen_at"),
      harness,
      // `harnessGone`'s rule, over the process table.
      alive: harness === null ? null : harnessAlive(harness, namespace, statIn(table)),
      version: slot(versions, of, `consumer ${sessionId} version`, text),
    };
  });

  // D9: the worktree's row, read as this daemon's only from the start its row records.
  const usedText = get(db, "SELECT value FROM meta WHERE key = ?", daemonUsedMetaKey(id))?.value;
  const lastUse =
    startedAt === null || theirs
      ? null
      : readDaemonUsed(typeof usedText === "string" ? usedText : null, startedAt);
  if (lastUse === null && record !== null)
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
// Every worktree's: `readOne` keeps a daemon's own, under D3's time bound.
const OPEN_RUNS = `SELECT worktree_id, id, test_files, checkpoint_id, started_at FROM runs
  WHERE end_state IS NULL ORDER BY started_at, rowid`;
// D3's time bound: a run or checkpoint an earlier daemon left open runs nothing now.
const OPEN_CHECKPOINTS = `SELECT id, test_files, started_at FROM checkpoints
  WHERE worktree_id = ? AND completed_at IS NULL AND started_at >= ? ORDER BY started_at, rowid`;
const CONSUMERS = `SELECT session_id, agent_id, last_seen_at FROM consumers
  WHERE worktree_id = ? ORDER BY session_id, agent_id`;
const UNKNOWN = "has a format this release does not know";

/** Reads a parsed JSON value; `undefined` when its format is not known. */
type Decode<T> = (value: unknown) => T | undefined;

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
 * What the `slowTier` row (004 D8) tells: whether slow work waits, and the
 * files of the slow run. The slow tier publishes those in the transaction
 * that starts its run (`scheduler/slow-tier.ts`), the only start besides the
 * fast lane's.
 */
interface Slow {
  readonly waits: boolean;
  readonly running: readonly string[];
}
const NO_SLOW: Slow = { waits: false, running: [] };

function slowOf(activity: SlowTierActivity | null | undefined): Slow | undefined {
  if (activity === undefined) return undefined;
  if (activity === null) return NO_SLOW;
  return {
    waits: true,
    running: activity.kind === "running" ? (activity.paths ?? [activity.path]) : [],
  };
}

/** A per-consumer row (`delivery/slots.ts`): `{ "<session>\n<agent>": value }`. */
type Slots = Readonly<Record<string, unknown>>;
const slotsOf: Decode<Slots> = (v) => (isRecord(v) ? v : undefined);
const text: Decode<string> = (v) => (typeof v === "string" ? v : undefined);

const finiteNumber: Decode<number> = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** A PID's row of the process table as `harnessAlive` reads a stat; `null` without one. */
const statIn = (table: ProcessTable) => (pid: number) => {
  const row = table.get(pid);
  return row === undefined ? null : { startTime: row.startTicks, state: row.state };
};

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
