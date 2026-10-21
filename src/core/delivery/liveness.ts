import { isRecord } from "../fs/index.js";
import { isInstalledLockfile, testFileId } from "../keys/index.js";
import { readHeader } from "../state/index.js";
import { withDeath } from "../status/died.js";
import { openRuns } from "../status/open-runs.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/snapshot.js";
import {
  type Consumer,
  type DaemonLiveness,
  type DaemonRecord,
  daemonRestMetaKey,
  type EpochMs,
  type FileChange,
  type KnownState,
  type RelativePath,
  type RevisionNumber,
  type StatusHeader,
  type Store,
  type TestFileKeyRecord,
  type WorktreeId,
  type WorktreeRecord,
  worktreeMetaKey,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";
import { asStopped } from "./stopped.js";

/**
 * Daemon liveness from the heartbeat the daemon records in `worktrees`,
 * judged as `squeal status` judges it (spec 001 D10), so a header and status
 * never disagree. Review wave 3, S2: delivered text says when no daemon is
 * validating; hooks restart one when the heartbeat is this old. With no
 * record, `lastHeartbeatAt` (`WorktreeRecord.lastHeartbeatAt`, kept after
 * `squeal stop`) says since when (review wave 4.5, N5).
 */
export function daemonLiveness(
  record: DaemonRecord | null,
  now: EpochMs,
  lastHeartbeatAt: EpochMs | null = null,
): DaemonLiveness {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (now - record.heartbeatAt <= record.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  }
  return { state: "down", since: record.heartbeatAt };
}

/** `daemonLiveness` of a worktree row, its last heartbeat included; down since nothing without a row. */
export function worktreeLiveness(worktree: WorktreeRecord | null, now: EpochMs): DaemonLiveness {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
}

/**
 * The shared header (D6) with the worktree's daemon liveness as delivered
 * text reads it (`asRested`), the paths
 * changed since revision `since` (`changedSince`), which every delivered
 * message names (task 001-85; task 001-89, review wave 10 S4 (b)), and the
 * installed lockfile those changes wrote, if any (task 001-94, S1).
 */
export function readLiveHeader(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  states?: readonly KnownState[],
  since: RevisionNumber | null = null,
  keys?: readonly TestFileKeyRecord[],
): StatusHeader {
  const worktree = store.worktrees.get(worktreeId);
  // Row 011-26: the files the live daemon's open runs hold count running, as status counts them (C15).
  const runs = openRuns(store, worktree, worktreeLiveness(worktree, now));
  const open = new Set(runs.flatMap((run) => run.testFiles.map(testFileId)));
  const header = readHeader(store, worktreeId, states, keys, undefined, open);
  const changes = changedSince(store, worktreeId, header.revision, since);
  const installed = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path),
  );
  return {
    ...header,
    // Task 001-263: a daemon that died without its stop note is named, as status names it.
    daemon: withDeath(
      store,
      worktree,
      asRested(
        store,
        worktree,
        asStopped(store, worktreeId, worktree, worktreeLiveness(worktree, now)),
        now,
      ),
    ),
    changedPaths: [...changes.keys()],
    ...(installed === undefined ? {} : { installedLockfile: installed.path }),
  };
}

/**
 * D10 as amended (task 001-415, review 001-417 B2): while the worktree's
 * daemon rests quietly (`restState`), no delivered header, news or policy
 * report says no daemon is validating. A daemon a hook spawned after the
 * rest is starting; before one is, the daemon rests. Status reads the
 * record alone and still says down; an overdue start is down here too.
 */
function asRested(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
  at: EpochMs,
): DaemonLiveness {
  if (live.state !== "down" || live.startingSince !== undefined || worktree === null) return live;
  // Task 011-08: a stop asked for is said as such, never as a rest.
  if (live.stopped === true) return live;
  if (restState(store, worktree, at) !== "quiet") return live;
  const spawnedAt = readRest(store, worktree.id)?.spawnedAt;
  return spawnedAt === undefined
    ? { ...live, resting: true }
    : { ...live, startingSince: spawnedAt };
}

/**
 * The paths revisions after `since` up to `revision` changed, oldest first,
 * each once with its newest change: what changed since a consumer's last
 * report, so a check that broke at one revision and is reported at a later
 * one names both edits. With nothing after `since`, or no `since`, the paths
 * `revision` changed. One query (review wave 10b, N3).
 */
export function changedSince(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  since: RevisionNumber | null,
): ReadonlyMap<RelativePath, FileChange> {
  const after = since === null || since >= revision ? revision - 1 : Math.max(since, 0);
  const changes = new Map<RelativePath, FileChange>();
  for (const r of store.revisions.range(worktreeId, after, revision)) {
    for (const change of r.changes) changes.set(change.path, change);
  }
  return changes;
}

/*
 * What each consumer was last told about liveness, the liveness part of its
 * view (`slots.ts`): `"alive" | "down"`, or `{ startingSince }` after a
 * registration that said a daemon is starting (task 001-156). A hook from
 * before that task reads the object as `alive`.
 */

/** What a consumer was last told about the daemon. */
export type ToldLiveness = DaemonLiveness["state"] | { readonly startingSince: EpochMs };

/**
 * Task 001-156: how long a daemon a hook spawned before a registration may
 * go without a first heartbeat while its consumer, told it was starting,
 * hears nothing: two of the daemon's default 5 s heartbeat intervals, the
 * deadline a running daemon's heartbeat has (D10). On a host at load 127 a
 * spawned daemon's first heartbeat came 1.5 s after the spawn.
 */
export const DAEMON_START_GRACE_MS = 10_000;

/** `meta` key of a worktree's told liveness. */
export function livenessMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("livenessTold", worktreeId);
}

/**
 * Liveness last told to `consumer`. A consumer registered before liveness
 * was tracked was told nothing, which read as a validating daemon: `alive`.
 */
export function toldLiveness(store: Store, consumer: Consumer): ToldLiveness {
  const told = readSlot(store, livenessMetaKey(consumer.worktreeId), consumer);
  if (told === "down") return "down";
  const since = isRecord(told) ? told.startingSince : undefined;
  return typeof since === "number" ? { startingSince: since as EpochMs } : "alive";
}

/** Records what `consumer` was told; `null` forgets it. Call inside a transaction. */
export function tellLiveness(store: Store, consumer: Consumer, told: ToldLiveness | null): void {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, told);
}

/**
 * `live` as a consumer told `told` reads it (task 001-156): after "a daemon
 * is starting" at `startingSince`, a down daemon that has not heartbeat since
 * is still starting, `startingSince` set, until `DAEMON_START_GRACE_MS`
 * passed. A heartbeat after the spawn ends the start: a daemon that came up
 * and stopped is down. A starting daemon is not stopped (row 011-20): the
 * stopped mark a `squeal stop` left while the hook spawned it is void at its
 * first heartbeat (`heldStop`).
 */
export function asTold(live: DaemonLiveness, told: ToldLiveness, at: EpochMs): DaemonLiveness {
  if (live.state === "alive" || typeof told !== "object") return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  const { stopped: _void, ...starting } = live;
  return { ...starting, startingSince };
}

/** `header` with its daemon's liveness `asTold`. */
export function withTold(header: StatusHeader, told: ToldLiveness, at: EpochMs): StatusHeader {
  return header.daemon === undefined
    ? header
    : { ...header, daemon: asTold(header.daemon, told, at) };
}

/**
 * The daemon's liveness when it differs from what `consumer` was told, else
 * `null`. A daemon still starting is no news, nor is its first heartbeat,
 * nor one that rests after it stopped unused (`restState`, task 001-415).
 * A rest whose restart is overdue is forgotten here, so this and every later
 * boundary report the daemon down as before. Call inside a transaction.
 */
export function livenessChange(
  store: Store,
  consumer: Consumer,
  at: EpochMs,
): DaemonLiveness | null {
  const told = toldLiveness(store, consumer);
  const worktree = store.worktrees.get(consumer.worktreeId);
  const live = asStopped(
    store,
    consumer.worktreeId,
    worktree,
    asTold(worktreeLiveness(worktree, at), told, at),
  );
  if (live.state === "down" && live.stopped !== true) {
    if (live.startingSince !== undefined) return null;
    const rest = restState(store, worktree, at);
    if (rest === "quiet") return null;
    if (rest === "overdue") store.meta.delete(daemonRestMetaKey(consumer.worktreeId));
  }
  return live.state === (typeof told === "object" ? "alive" : told) ? null : live;
}

/*
 * D10 as amended (task 001-415, the coordinator's bound of 2026-10-15): a
 * daemon that stopped unused records its rest, `{ at }`; the first hook that
 * spawns a daemon after it adds `spawnedAt`. The rest is quiet until a daemon
 * heartbeats after `at`, or until the spawned one is overdue: no heartbeat
 * within `DAEMON_START_GRACE_MS` of `spawnedAt`, the start timeout a
 * registration's "starting" has.
 */

interface Rest {
  readonly at: EpochMs;
  readonly spawnedAt?: EpochMs;
}

/** The daemon's unused stop at `at`, before it clears its record. */
export function markRest(store: Store, worktreeId: WorktreeId, at: EpochMs): void {
  store.meta.set(daemonRestMetaKey(worktreeId), JSON.stringify({ at } satisfies Rest));
}

/** A hook spawned a daemon at `at`: the first spawn after a rest starts its start timeout. */
export function spawnedAfterRest(store: Store, worktreeId: WorktreeId, at: EpochMs): void {
  const rest = readRest(store, worktreeId);
  if (rest === null || rest.spawnedAt !== undefined) return;
  store.meta.set(daemonRestMetaKey(worktreeId), JSON.stringify({ ...rest, spawnedAt: at }));
}

/**
 * `quiet` while the worktree's daemon rests and any daemon spawned after it
 * is not overdue; `overdue` once it is; `null` with no rest: no mark, a
 * record, or a heartbeat after it.
 */
export function restState(
  store: Store,
  worktree: WorktreeRecord | null,
  at: EpochMs,
): "quiet" | "overdue" | null {
  if (worktree === null || worktree.daemon !== null) return null;
  const rest = restAfterHeartbeats(store, worktree);
  if (rest === null) return null;
  if (rest.spawnedAt === undefined || at - rest.spawnedAt <= DAEMON_START_GRACE_MS) return "quiet";
  return "overdue";
}

/**
 * Whether a daemon starting on `worktree` resumes a rest: read before it
 * registers, the rest mark is later than every heartbeat the row records
 * (spec 011 C9 as amended 2026-10-21, row 011-91).
 */
export function resumesRest(store: Store, worktree: WorktreeRecord | null): boolean {
  return worktree !== null && restAfterHeartbeats(store, worktree) !== null;
}

/** The worktree's rest when no heartbeat its row records came after it, else `null`. */
function restAfterHeartbeats(store: Store, worktree: WorktreeRecord): Rest | null {
  const rest = readRest(store, worktree.id);
  const heartbeat =
    worktree.daemon?.heartbeatAt ?? worktree.lastHeartbeatAt ?? Number.POSITIVE_INFINITY;
  return rest === null || rest.at < heartbeat ? null : rest;
}

function readRest(store: Store, worktreeId: WorktreeId): Rest | null {
  const text = store.meta.get(daemonRestMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const rest: unknown = JSON.parse(text);
    if (!isRecord(rest) || typeof rest.at !== "number") return null;
    const spawnedAt = typeof rest.spawnedAt === "number" ? { spawnedAt: rest.spawnedAt } : {};
    return { at: rest.at as EpochMs, ...spawnedAt };
  } catch {
    return null;
  }
}

/*
 * The revision each consumer was last told about, in a delivered header or
 * its registration (task 001-89, review wave 10 S4 (b)): the next header
 * names the paths changed since.
 */

/** `meta` key of a worktree's told revisions. */
export function revisionMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("revisionTold", worktreeId);
}

/** The revision last told to `consumer`; `null` when none was recorded (registered by 0.1.8 or older). */
export function toldRevision(store: Store, consumer: Consumer): RevisionNumber | null {
  const told = readSlot(store, revisionMetaKey(consumer.worktreeId), consumer);
  return typeof told === "number" ? told : null;
}

/** Records the revision `consumer` was told about; `null` forgets it. Call inside a transaction. */
export function tellRevision(store: Store, consumer: Consumer, revision: RevisionNumber | null) {
  writeSlot(store, revisionMetaKey(consumer.worktreeId), consumer, revision);
}
