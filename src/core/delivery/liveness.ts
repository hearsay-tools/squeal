import { isInstalledLockfile } from "../keys/environment.js";
import { testFileId } from "../keys/reverse-index.js";
import { readPresence } from "../presence/decide.js";
import { forgetRest } from "../presence/events.js";
import { readTold, type ToldLiveness } from "../presence/told.js";
import { headerView, newsChange, withToldStart } from "../presence/views.js";
import { readHeader } from "../state/header.js";
import { readHolds } from "../status/holds.js";
import { openRuns } from "../status/open-runs.js";
import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "../types/common.js";
import type { Consumer } from "../types/delivery.js";
import type { FileChange } from "../types/revision.js";
import type { KnownState } from "../types/state.js";
import type { DaemonLiveness, StatusHeader } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { readSlot, writeSlot } from "./slots.js";

export { resumesRest } from "../presence/facts.js";
// Row 011-293: the heartbeat rule, the told start and the rest are daemon presence's (`presence/`).
export { DAEMON_START_GRACE_MS, daemonLiveness, worktreeLiveness } from "../presence/heartbeat.js";
export type { ToldLiveness } from "../presence/told.js";
export { toldOf } from "../presence/views.js";

/**
 * The shared header (D6) with the worktree's daemon presence as delivered
 * text reads it (`headerView`), the paths
 * changed since revision `since` (`changedSince`), which every delivered
 * message names (task 001-85; task 001-89, review wave 10 S4 (b)), those
 * of them git ignores (row 011-262), and the installed lockfile those
 * changes wrote, if any (task 001-94, S1).
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
  const presence = readPresence(store, worktreeId, now, worktree);
  // Row 011-26: the files the live daemon's open runs hold count running, as status counts them (C15).
  const runs = openRuns(store, worktree, presence.heartbeat);
  const open = new Set(runs.flatMap((run) => run.testFiles.map(testFileId)));
  const header = readHeader(store, worktreeId, states, keys, undefined, open);
  const changes = changedSince(store, worktreeId, header.revision, since);
  const installed = [...changes.values()].find(
    (c) => c.newHash !== null && isInstalledLockfile(c.path),
  );
  const ignored = [...changes.values()].filter((c) => c.ignored === true).map((c) => c.path);
  // Row 011-73 (C8 as amended 2026-10-21): the registration header carries the hold, as status does.
  const holds = readHolds(store, worktree, presence.heartbeat, now);
  return {
    ...header,
    ...(holds.length === 0 ? {} : { holds }),
    daemon: headerView(presence),
    changedPaths: [...changes.keys()],
    ...(ignored.length === 0 ? {} : { ignoredPaths: ignored }),
    ...(installed === undefined ? {} : { installedLockfile: installed.path }),
  };
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
 * view (`slots.ts`): `ToldLiveness`, the presence state and notes it was told
 * (row 011-295), or `{ startingSince }` after a registration that said a
 * daemon is starting (task 001-156). A hook from before either reads the
 * object as `alive`, or as `{ short }` when it names a short handoff.
 */

/** `meta` key of a worktree's told liveness. */
export function livenessMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("livenessTold", worktreeId);
}

/**
 * Liveness last told to `consumer` (`readTold`). A consumer registered before
 * liveness was tracked was told nothing, which read as a validating daemon: `alive`.
 */
export function toldLiveness(store: Store, consumer: Consumer): ToldLiveness {
  return readTold(readSlot(store, livenessMetaKey(consumer.worktreeId), consumer));
}

/** Records what `consumer` was told; `null` forgets it. Call inside a transaction. */
export function tellLiveness(store: Store, consumer: Consumer, told: ToldLiveness | null): void {
  writeSlot(store, livenessMetaKey(consumer.worktreeId), consumer, told);
}

/** `header` with a start its consumer was told of (`withToldStart`). */
export function withTold(header: StatusHeader, told: ToldLiveness, at: EpochMs): StatusHeader {
  return header.daemon === undefined
    ? header
    : { ...header, daemon: withToldStart(header.daemon, told, at) };
}

/**
 * The daemon's liveness when it differs from what `consumer` was told, else
 * `null`: daemon presence's news view (`newsChange`). A rest whose restart is
 * overdue is forgotten here, so this and every later boundary report the
 * daemon down as before. Call inside a transaction.
 */
export function livenessChange(
  store: Store,
  consumer: Consumer,
  at: EpochMs,
): DaemonLiveness | null {
  const presence = readPresence(store, consumer.worktreeId, at);
  const { change, forgetRest: overdue } = newsChange(presence, toldLiveness(store, consumer));
  if (overdue) forgetRest(store, consumer.worktreeId);
  return change;
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
