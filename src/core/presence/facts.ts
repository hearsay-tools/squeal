import {
  type HandoffClaim,
  readHandoff,
  readShortHandoff,
  type ShortHandoff,
} from "../delivery/handoff.js";
import { readStop, type StopMark } from "../delivery/stopped.js";
import { isRecord } from "../fs/index.js";
import { readDaemonNotes } from "../notes.js";
import { feedDeliveredMetaKey } from "../status/feed-late.js";
import { lockFileFor } from "../store/paths.js";
import {
  daemonExitMetaKey,
  daemonIncarnation,
  daemonRestMetaKey,
  type EpochMs,
  type InFlightRun,
  type Store,
  type WorktreeId,
  type WorktreeRecord,
} from "../types/index.js";
import { type LockMarks, lockFree, readLockMarks } from "./marks.js";

export type { StopMark } from "../delivery/stopped.js";

/*
 * Row 011-293: every stored fact daemon presence is decided from, read once:
 * the worktree's row with its daemon record, the meta marks (exit, rest,
 * stop, handoff claim, short handoff, change feed) and the marks beside the
 * lock. The lock itself is probed only when a rule asks (`lockFree`), and
 * the runs a dead daemon left open only when it died (`inFlight`).
 */

/** D10 as amended (task 001-415): a daemon stopped unused at `at`; a hook spawned one after it at `spawnedAt`. */
export interface RestMark {
  readonly at: EpochMs;
  readonly spawnedAt?: EpochMs;
}

/** What daemon presence is decided from, as one reading stored it. */
export interface PresenceFacts {
  readonly worktreeId: WorktreeId;
  /** The worktree's row; `null` with none (a linked worktree beside a shared store, before its daemon). */
  readonly row: WorktreeRecord | null;
  /**
   * Whether the recorded daemon's shutdown began: its exit row
   * (`daemonExitMetaKey`), or the first note its shutdown writes, which names
   * its incarnation, the only mark a 0.1.121 daemon leaves. A record with no
   * incarnation (a release before task 001-270) has no such mark: `false`.
   */
  readonly shutDown: boolean;
  /** The time of the note that began that shutdown; `null` past the notes' cap or with none. */
  readonly exitNoteAt: EpochMs | null;
  readonly claim: HandoffClaim | null;
  readonly short: ShortHandoff | null;
  readonly rest: RestMark | null;
  readonly stop: StopMark | null;
  /** When the last batch the change feed delivered started, as stored (row 011-200). */
  readonly feedDelivered: EpochMs | null;
  /** The marks beside the worktree's lock; `null` without a row, which names no lock file. */
  readonly marks: LockMarks | null;
  /** Whether no process holds the worktree's lock (`lockFree`); probed at the first call only. */
  readonly lockFree: () => boolean;
  /** The runs with no end the recorded daemon started, oldest first; read at the first call only. */
  readonly inFlight: () => readonly InFlightRun[];
}

/**
 * The facts of `worktreeId`'s daemon at `now`, its row `row` (read from the
 * store when not given). Call inside a read transaction to read them as one.
 */
export function readPresenceFacts(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  row: WorktreeRecord | null | undefined = store.worktrees.get(worktreeId),
): PresenceFacts {
  const worktree = row ?? null;
  const record = worktree?.daemon ?? null;
  const self = daemonIncarnation(record);
  const exitNote =
    self === null ? undefined : readDaemonNotes(store, worktreeId).find((n) => n.exitOf === self);
  const exitMarked = self !== null && store.meta.get(daemonExitMetaKey(worktreeId)) === self;
  const lockFile = worktree === null ? null : lockFileFor(worktree.commonDir, worktree.id);
  return {
    worktreeId,
    row: worktree,
    shutDown: exitMarked || exitNote !== undefined,
    exitNoteAt: (exitNote?.at ?? null) as EpochMs | null,
    claim: readHandoff(store, worktreeId),
    short: readShortHandoff(store, worktreeId),
    rest: readRest(store, worktreeId),
    stop: readStop(store, worktreeId),
    feedDelivered: readFeedDelivered(store, worktreeId),
    marks: lockFile === null ? null : readLockMarks(lockFile, now),
    lockFree: once(() => lockFile !== null && lockFree(lockFile)),
    inFlight: once(() =>
      worktree === null || record === null
        ? []
        : store.runs
            .inFlight(worktree.id, record.startedAt)
            .map((run) => ({ id: run.id, revision: run.revision, testFiles: run.testFiles })),
    ),
  };
}

/** When the last batch the worktree's change feed delivered started, as stored; `null` when none is. */
export function readFeedDelivered(store: Store, worktreeId: WorktreeId): EpochMs | null {
  const raw = store.meta.get(feedDeliveredMetaKey(worktreeId));
  const at = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(at) ? (at as EpochMs) : null;
}

/** The worktree's rest mark; `null` with none or one unreadable. */
export function readRest(store: Store, worktreeId: WorktreeId): RestMark | null {
  const rest = parsed(store.meta.get(daemonRestMetaKey(worktreeId)));
  if (!isRecord(rest) || typeof rest.at !== "number") return null;
  const spawnedAt = typeof rest.spawnedAt === "number" ? { spawnedAt: rest.spawnedAt } : {};
  return { at: rest.at as EpochMs, ...spawnedAt };
}

/**
 * Whether a daemon starting on `row` resumes a rest: read before it
 * registers, the rest mark is later than every heartbeat the row records
 * (spec 011 C9 as amended 2026-10-21, row 011-91).
 */
export function resumesRest(store: Store, row: WorktreeRecord | null): boolean {
  return row !== null && restAfterHeartbeats(readRest(store, row.id), row) !== null;
}

/** `rest` when no heartbeat `row` records came after it, else `null`. */
export function restAfterHeartbeats(rest: RestMark | null, row: WorktreeRecord): RestMark | null {
  const heartbeat = row.daemon?.heartbeatAt ?? row.lastHeartbeatAt ?? Number.POSITIVE_INFINITY;
  return rest === null || rest.at < heartbeat ? null : rest;
}

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function once<T>(read: () => T): () => T {
  let value: { readonly v: T } | null = null;
  return () => {
    value ??= { v: read() };
    return value.v;
  };
}
