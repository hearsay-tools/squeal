import type {
  DaemonLiveness,
  DaemonRecord,
  EpochMs,
  Liveness,
  WorktreeRecord,
} from "../types/index.js";

/*
 * Row 011-293: the one heartbeat rule of daemon presence. Every reader that
 * asks whether a recorded daemon's heartbeat is on time asks here.
 */

/**
 * A heartbeat counts as live up to this many intervals old, so a daemon that
 * is a little late with its write is not reported down. Spec 001 D10: "no
 * daemon running since <time>" when the heartbeat is older than its interval.
 */
export const HEARTBEAT_GRACE_INTERVALS = 2;

/**
 * Task 001-156: how long a daemon a hook spawned before a registration may
 * go without a first heartbeat while its consumer, told it was starting,
 * hears nothing: two of the daemon's default 5 s heartbeat intervals, the
 * deadline a running daemon's heartbeat has (D10). On a host at load 127 a
 * spawned daemon's first heartbeat came 1.5 s after the spawn.
 */
export const DAEMON_START_GRACE_MS = 10_000;

/** How late a heartbeat of interval `intervalMs` may be and still count (`HEARTBEAT_GRACE_INTERVALS`). */
export function heartbeatGraceMs(intervalMs: number): number {
  return HEARTBEAT_GRACE_INTERVALS * intervalMs;
}

/** How old `record`'s last heartbeat is at `now`. */
export function heartbeatAge(record: DaemonRecord, now: EpochMs): number {
  return now - record.heartbeatAt;
}

/** Whether `record`'s heartbeat is within its grace at `now`. */
export function heartbeatFresh(record: DaemonRecord, now: EpochMs): boolean {
  return heartbeatAge(record, now) <= heartbeatGraceMs(record.heartbeatIntervalMs);
}

/** How old `record`'s heartbeat is at `now` once it is past its grace; `null` while it is fresh. */
export function heartbeatLateBy(record: DaemonRecord, now: EpochMs): number | null {
  return heartbeatFresh(record, now) ? null : heartbeatAge(record, now);
}

/** When `record`'s heartbeat grace ends: past it, the heartbeat is late. */
export function heartbeatGraceEnd(record: DaemonRecord): EpochMs {
  return record.heartbeatAt + heartbeatGraceMs(record.heartbeatIntervalMs);
}

/** Whether `second`, a later reading of the same daemon, records a heartbeat after `first`. */
export function beatBetween(first: DaemonRecord, second: DaemonRecord): boolean {
  return second.heartbeatAt > first.heartbeatAt;
}

/** The last heartbeat `row` records: its daemon's, or the one kept after its record cleared. */
export function lastHeartbeat(row: WorktreeRecord | null | undefined): EpochMs | null {
  return row?.daemon?.heartbeatAt ?? row?.lastHeartbeatAt ?? null;
}

/**
 * The claim's heartbeat rule for the store's queries (C7, `TestFileKeyRepo.claimed`): a
 * claimant's daemon heartbeats within `HEARTBEAT_GRACE_INTERVALS` at `now`.
 */
export function claimLiveness(now: EpochMs): Liveness {
  return { now, graceIntervals: HEARTBEAT_GRACE_INTERVALS };
}

/**
 * Daemon liveness from the heartbeat alone (spec 001 D10): alive while
 * `record`'s heartbeat is fresh, else down since it. With no record,
 * `lastHeartbeatAt` (`WorktreeRecord.lastHeartbeatAt`, kept after `squeal
 * stop`) says since when (review wave 4.5, N5).
 */
export function daemonLiveness(
  record: DaemonRecord | null,
  now: EpochMs,
  lastHeartbeatAt: EpochMs | null = null,
): DaemonLiveness {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (heartbeatFresh(record, now)) return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  return { state: "down", since: record.heartbeatAt };
}

/** `daemonLiveness` of a worktree row, its last heartbeat included; down since nothing without a row. */
export function worktreeLiveness(
  worktree: WorktreeRecord | null | undefined,
  now: EpochMs,
): DaemonLiveness {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
}
