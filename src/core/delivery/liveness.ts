import { readHeader } from "../state/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/snapshot.js";
import type {
  Consumer,
  DaemonLiveness,
  DaemonRecord,
  EpochMs,
  KnownState,
  RelativePath,
  RevisionNumber,
  StatusHeader,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

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
 * changed since revision `since` (`changedSince`), which every delivered
 * message names (task 001-85; task 001-89, review wave 10 S4 (b)).
 */
export function readLiveHeader(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  states?: readonly KnownState[],
  since: RevisionNumber | null = null,
): StatusHeader {
  const header = readHeader(store, worktreeId, states);
  return {
    ...header,
    daemon: worktreeLiveness(store.worktrees.get(worktreeId), now),
    changedPaths: changedSince(store, worktreeId, header.revision, since),
  };
}

/**
 * The paths revisions after `since` up to `revision` changed, oldest first,
 * each once: what changed since a consumer's last report, so a check that
 * broke at one revision and is reported at a later one names both edits.
 * With nothing after `since`, or no `since`, the paths `revision` changed.
 */
export function changedSince(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  since: RevisionNumber | null,
): readonly RelativePath[] {
  const from = since === null || since >= revision ? revision : Math.max(since + 1, 1);
  const paths = new Set<RelativePath>();
  for (let n = from; n <= revision && n > 0; n++) {
    for (const change of store.revisions.get(worktreeId, n)?.changes ?? []) paths.add(change.path);
  }
  return [...paths];
}

/*
 * What each consumer was last told about liveness, the liveness part of its
 * view (`slots.ts`): `"alive" | "down"`.
 */

/** `meta` key of a worktree's told liveness. */
export function livenessMetaKey(worktreeId: WorktreeId): string {
  return `liveness-told:${worktreeId}`;
}

/**
 * Liveness last told to `consumer`. A consumer registered before liveness
 * was tracked was told nothing, which read as a validating daemon: `alive`.
 */
export function toldLiveness(store: Store, consumer: Consumer): DaemonLiveness["state"] {
  return readSlot(store, livenessMetaKey(consumer.worktreeId), consumer) === "down"
    ? "down"
    : "alive";
}

/** Records what `consumer` was told; `null` forgets it. Call inside a transaction. */
export function tellLiveness(
  store: Store,
  consumer: Consumer,
  state: DaemonLiveness["state"] | null,
): void {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, state);
}

/*
 * The revision each consumer was last told about, in a delivered header or
 * its registration (task 001-89, review wave 10 S4 (b)): the next header
 * names the paths changed since.
 */

/** `meta` key of a worktree's told revisions. */
export function revisionMetaKey(worktreeId: WorktreeId): string {
  return `revision-told:${worktreeId}`;
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
