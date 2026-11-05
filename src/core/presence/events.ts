import { isNewerVersion } from "../daemon/version.js";
import { appendNote } from "../notes.js";
import { isBusy, withBusySliceSync } from "../store/index.js";
import {
  type DaemonRecord,
  daemonExitMetaKey,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeId,
  type WorktreeRecord,
} from "../types/index.js";
import {
  daemonRestMetaKey,
  feedDeliveredMetaKey,
  HANDOFF_BOUND_MS,
  type HandoffClaim,
  handoffMetaKey,
  liveHandoff,
  readHandoff,
  readRest,
  readStop,
  type ShortHandoff,
  type StopMark,
  shortHandoffMetaKey,
  stoppedMetaKey,
} from "./stored.js";

/*
 * Row 011-294 (`research/daemon-presence.md`, decision 2): the presence
 * events the daemon, its hooks and the CLI report, one function each, which
 * store them in the meta rows `stored.ts` names. `lock-events.ts` stores the
 * events kept beside the lock file. Each event writes what its writer wrote
 * before the move, at the same moment: a caller that wrote inside a
 * transaction calls it inside the same transaction.
 */

/** What a daemon registers (`recordRegistration`). */
export interface Registration {
  /** The worktree's row, without a daemon. */
  readonly worktree: Omit<WorktreeRecord, "daemon" | "lastHeartbeatAt">;
  /** Its record, whose incarnation (`daemonIncarnation`) the marks name. */
  readonly daemon: DaemonRecord & { readonly token: string; readonly executable: string };
  /** When the handoff it ends ended (row 011-32). */
  readonly at: EpochMs;
  /** Its own shutdown began before it registered (task 001-276). */
  readonly exiting: boolean;
}

/**
 * Registered, review wave 2 input 4: `worktrees.upsert`, then `setDaemon`
 * with the socket and a heartbeat. A predecessor's shutdown mark goes (task
 * 001-274); if this daemon's own shutdown already began, its mark replaces
 * it, since `markExit` had no registration to describe then (task 001-276).
 * The handoff claim goes (`endHandoff`). Call in the registering
 * transaction; once it committed, the start mark goes (`clearStartMark`).
 */
export function recordRegistration(store: Store, registration: Registration): void {
  const { worktree, daemon, at, exiting } = registration;
  const incarnation = daemonIncarnation(daemon);
  if (!exiting) store.meta.delete(daemonExitMetaKey(worktree.id));
  else store.meta.set(daemonExitMetaKey(worktree.id), incarnation);
  endHandoff(store, worktree.id, {
    of: incarnation,
    version: daemon.squealVersion,
    executable: daemon.executable,
    at,
  });
  store.worktrees.upsert({ ...worktree, daemon: null });
  store.worktrees.setDaemon(worktree.id, daemon);
}

/** Beat: the recorded daemon's heartbeat at `at` (D10). */
export function recordHeartbeat(store: Store, worktreeId: WorktreeId, at: EpochMs): void {
  store.worktrees.heartbeat(worktreeId, at);
}

/**
 * Exiting: the daemon of `incarnation` began its shutdown, which status
 * reads to tell a kill from here on from a death (task 001-274). Written
 * only while the worktree has its row, checked in the caller's transaction:
 * a row a prune took while the daemon ran is not made again (task 001-278).
 */
export function markExit(store: Store, worktreeId: WorktreeId, incarnation: string): void {
  if (store.worktrees.get(worktreeId) === null) return;
  store.meta.set(daemonExitMetaKey(worktreeId), incarnation);
}

/** The daemon cleared its record in its shutdown; the row keeps its last heartbeat (`lastHeartbeatAt`). */
export function clearRecord(store: Store, worktreeId: WorktreeId): void {
  store.worktrees.setDaemon(worktreeId, null);
}

/*
 * D10 as amended (task 001-415, the coordinator's bound of 2026-10-15): a
 * daemon that stopped unused records its rest, `{ at }`; the first hook that
 * spawns a daemon after it adds `spawnedAt`. The rest is quiet until a daemon
 * heartbeats after `at`, or until the spawned one is overdue: no heartbeat
 * within `DAEMON_START_GRACE_MS` of `spawnedAt`, the start timeout a
 * registration's "starting" has.
 */

/** Rested: the daemon's unused stop at `at`, before it clears its record. */
export function markRest(store: Store, worktreeId: WorktreeId, at: EpochMs): void {
  store.meta.set(daemonRestMetaKey(worktreeId), JSON.stringify({ at }));
}

/** Spawned after a rest: a hook spawned a daemon at `at`; the first spawn after a rest starts its start timeout. */
export function spawnedAfterRest(store: Store, worktreeId: WorktreeId, at: EpochMs): void {
  const rest = readRest(store, worktreeId);
  if (rest === null || rest.spawnedAt !== undefined) return;
  store.meta.set(daemonRestMetaKey(worktreeId), JSON.stringify({ ...rest, spawnedAt: at }));
}

/** The daemon spawned after a rest is overdue: the rest is forgotten, so every later boundary reads the daemon down. */
export function forgetRest(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(daemonRestMetaKey(worktreeId));
}

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9): `squeal stop` leaves a stopped
 * mark for its worktree, `{ at, tree }`, and no hook boundary ensures a
 * daemon while it holds. Row 011-254: `squeal stop --until-start` marks
 * `untilStart`, which only `squeal start` clears (`delivery/stopped.ts`).
 */

/**
 * Stopped by request: `squeal stop` at `at` for the worktree, its tree
 * printed as `tree`, with `--until-start` when `untilStart`. A plain stop
 * keeps an `untilStart` mark (row 011-254, the coordinator 2026-10-26).
 * Whether the mark it leaves is `untilStart`. Call inside a transaction.
 */
export function markStopped(
  store: Store,
  worktreeId: WorktreeId,
  at: EpochMs,
  tree: string | null,
  untilStart = false,
): boolean {
  const until = untilStart || readStop(store, worktreeId)?.untilStart === true;
  const mark: StopMark = { at, tree, ...(until ? { untilStart: true } : {}) };
  store.meta.set(stoppedMetaKey(worktreeId), JSON.stringify(mark));
  return until;
}

/** The stop is over: an edit, or `squeal start`. */
export function clearStopped(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(stoppedMetaKey(worktreeId));
}

/**
 * Handoff claimed: from `from` to version `to` at `at`, in one write
 * transaction that reads the claim first: the claim written, or `null` when
 * a live claim for `from` was already there. Throws when the store stays
 * busy past its timeout; the hook then spawns as before (C9).
 */
export function claimHandoff(
  store: Store,
  worktreeId: WorktreeId,
  claim: Pick<HandoffClaim, "from" | "to" | "at">,
): HandoffClaim | null {
  return store.transaction(() => {
    if (liveHandoff(store, worktreeId, claim.from, claim.at) !== null) return null;
    const written = { ...claim, boundAt: (claim.at + HANDOFF_BOUND_MS) as EpochMs };
    store.meta.set(handoffMetaKey(worktreeId), JSON.stringify(written satisfies HandoffClaim));
    return written;
  });
}

/** Handoff ended: its successor registered, or its lock wait ended without the lock. */
export function clearHandoff(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(handoffMetaKey(worktreeId));
}

/** What `endHandoff` reads of the daemon that registers. */
export interface Registering {
  /** Its incarnation, as `handoffFrom` names its record. */
  readonly of: string;
  readonly version: string;
  /** The script it runs, `process.argv[1]`. */
  readonly executable: string;
  readonly at: EpochMs;
}

/**
 * Handoff ended by a registration: the claim ends (row 011-32). When a live
 * claim names a version newer than the daemon's, the handoff ends short:
 * its mark and one note, naming both versions and the executable (row
 * 011-140). Any other registration clears an earlier mark. Call in the
 * registering transaction.
 */
export function endHandoff(store: Store, worktreeId: WorktreeId, daemon: Registering): void {
  const claim = readHandoff(store, worktreeId);
  clearHandoff(store, worktreeId);
  const short =
    claim !== null && daemon.at < claim.boundAt && isNewerVersion(claim.to, daemon.version);
  if (!short) {
    store.meta.delete(shortHandoffMetaKey(worktreeId));
    return;
  }
  const mark: ShortHandoff = {
    of: daemon.of,
    version: daemon.version,
    claimed: claim.to,
    at: daemon.at,
  };
  store.meta.set(shortHandoffMetaKey(worktreeId), JSON.stringify(mark));
  const text =
    `the handoff to Squeal ${claim.to} ended with a ${daemon.version} daemon from ${daemon.executable}; ` +
    `no hook asks it to step down again, and \`squeal start\` of ${claim.to} replaces it`;
  appendNote(store, worktreeId, { at: daemon.at, revision: null, text });
}

/**
 * The stored time moves only once it is this old: a feed on time keeps it under about 45 s plus a
 * pass, and the daemon writes the row at most four times a minute.
 */
export const FEED_STORED_STEP_MS = 15_000;

/**
 * Feed delivered, row 011-200 (C6, C8): the daemon's side of the row. `record` gets each delivered
 * batch's start, outside the feed's queue, and writes it once the stored time is
 * `FEED_STORED_STEP_MS` old. A busy store skips the write and the next delivery writes; any other
 * failure goes to `onError` once, until a write lands.
 */
export class FeedDeliveredRow {
  #stored: EpochMs | null = null;
  #failed = false;

  constructor(
    private readonly store: Store,
    private readonly worktreeId: WorktreeId,
    private readonly onError: (error: Error) => void,
  ) {}

  record(startedAt: EpochMs): void {
    if (this.#stored !== null && startedAt - this.#stored < FEED_STORED_STEP_MS) return;
    try {
      const key = feedDeliveredMetaKey(this.worktreeId);
      withBusySliceSync(0, () => this.store.meta.set(key, String(startedAt)));
      this.#stored = startedAt;
      this.#failed = false;
    } catch (error) {
      if (isBusy(error) || this.#failed) return;
      this.#failed = true;
      this.onError(new Error(`could not store the change feed's last delivery: ${String(error)}`));
    }
  }
}
