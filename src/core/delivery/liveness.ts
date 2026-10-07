import { isRecord } from "../fs/index.js";
import { readHeader } from "../state/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/snapshot.js";
import type {
  Consumer,
  DaemonLiveness,
  DaemonRecord,
  EpochMs,
  KnownState,
  StatusHeader,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";

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
 * The shared header (D6) with the worktree's daemon liveness and the paths
 * its revision changed (task 001-85), which every delivered message names.
 */
export function readLiveHeader(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  states?: readonly KnownState[],
): StatusHeader {
  const header = readHeader(store, worktreeId, states);
  const revision = header.revision === 0 ? null : store.revisions.get(worktreeId, header.revision);
  return {
    ...header,
    daemon: worktreeLiveness(store.worktrees.get(worktreeId), now),
    changedPaths: revision?.changes.map((c) => c.path) ?? [],
  };
}

/*
 * What each consumer was last told about liveness, the liveness part of its
 * view. `consumer_views` is keyed by check, so this lives in `meta`, one row
 * per worktree: `{ "<session>\n<agent>": "alive" | "down" }`. Written in the
 * delivery's transaction; consumers no longer registered are dropped on
 * every write.
 */

/** `meta` key of a worktree's told liveness. */
export function livenessMetaKey(worktreeId: WorktreeId): string {
  return `liveness-told:${worktreeId}`;
}

type Told = Record<string, DaemonLiveness["state"]>;

const slot = (consumer: Consumer) => `${consumer.sessionId}\n${consumer.agentId}`;

function readAll(store: Store, worktreeId: WorktreeId): Told {
  const raw = store.meta.get(livenessMetaKey(worktreeId));
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? (value as Told) : {};
  } catch {
    return {};
  }
}

/**
 * Liveness last told to `consumer`. A consumer registered before liveness
 * was tracked was told nothing, which read as a validating daemon: `alive`.
 */
export function toldLiveness(store: Store, consumer: Consumer): DaemonLiveness["state"] {
  const told = readAll(store, consumer.worktreeId)[slot(consumer)];
  return told === "down" ? "down" : "alive";
}

/** Records what `consumer` was told; `null` forgets it. Call inside a transaction. */
export function tellLiveness(
  store: Store,
  consumer: Consumer,
  state: DaemonLiveness["state"] | null,
): void {
  const registered = new Set(
    store.consumers.list(consumer.worktreeId).map((r) => slot(r.consumer)),
  );
  const next: Told = {};
  for (const [key, value] of Object.entries(readAll(store, consumer.worktreeId))) {
    if (registered.has(key)) next[key] = value;
  }
  if (state === null) delete next[slot(consumer)];
  else next[slot(consumer)] = state;
  store.meta.set(livenessMetaKey(consumer.worktreeId), JSON.stringify(next));
}
