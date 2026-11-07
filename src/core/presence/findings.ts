import { FEED_LATE_MS } from "../status/feed-late.js";
import { lockFileFor } from "../store/paths.js";
import type { EpochMs } from "../types/common.js";
import { daemonIncarnation } from "../types/daemon.js";
import type { DaemonLiveness, DaemonShort, DaemonStopping, FeedLate } from "../types/status.js";
import type { DaemonRecord, WorktreeRecord } from "../types/store-records.js";
import type { MarkedStart, RestReading } from "./decide.js";
import { type PresenceFacts, restAfterHeartbeats } from "./facts.js";
import { DAEMON_START_GRACE_MS, daemonLiveness, lastHeartbeat } from "./heartbeat.js";
import { type DaemonStart, readLockMarks, startOf } from "./marks.js";
import { HANDOFF_BOUND_MS, handoffFrom, type StopMark } from "./stored.js";

/*
 * Row 011-293: the rules `decidePresence` decides presence by, one per
 * finding, each reading only the facts it asks for (review 0.1.403 B2).
 */

/** The heartbeat alone, from the row the facts read (`daemonLiveness`). */
export function liveOf(facts: PresenceFacts, at: EpochMs): DaemonLiveness {
  const row = facts.row();
  return daemonLiveness(row?.daemon ?? null, at, row?.lastHeartbeatAt ?? null);
}

/**
 * Row 011-252, the hook spawn's view: whether a daemon's start is current at
 * `now` by the marks beside `row`'s lock alone (`Presence.startCurrent`), so
 * a hook spawns no second daemon. No row read, no start. Reads no store and
 * takes no lock.
 */
export function spawnStartCurrent(row: WorktreeRecord | null | undefined, now: EpochMs): boolean {
  if (row === null || row === undefined) return false;
  const marks = readLockMarks(lockFileFor(row.commonDir, row.id), now);
  return startCurrentOf(startOf(marks, now, lastHeartbeat(row)), row.daemon);
}

/** A start mark that names a live process, with any record; a spawn mark, with the record cleared. */
export function startCurrentOf(marks: DaemonStart | null, record: DaemonRecord | null): boolean {
  return marks?.kind === "locked" || (marks?.kind === "spawned" && record === null);
}

/**
 * The hook spawn's stop (task 011-08): the stop by request that holds by the
 * store alone at `at` (`Presence.stop`), from `facts` without deciding the
 * rest, so it probes no lock.
 */
export function stopHeld(facts: PresenceFacts, at: EpochMs): StopMark | null {
  return heldStop(facts, liveOf(facts, at));
}

/**
 * Task 011-08: the stopped mark while it holds by the store alone: set, the
 * heartbeat down, and no daemon heartbeat since its time (none voids an
 * `untilStart` mark). A worktree with no row keeps its mark too: the mark is
 * keyed by the worktree's id, never by its row (review wave-1.10 B1).
 */
export function heldStop(facts: PresenceFacts, heartbeat: DaemonLiveness): StopMark | null {
  // Review 0.1.403 B1: a fresh heartbeat holds no stop, whatever the mark says.
  if (heartbeat.state === "alive") return null;
  const mark = facts.stop();
  if (mark === null || mark.untilStart === true) return mark;
  const last = lastHeartbeat(facts.row());
  return last !== null && last > mark.at ? null : mark;
}

/**
 * Row 011-34 (C9 as amended 2026-10-20): the recorded daemon's shutdown
 * began and it still holds its lock while its heartbeat is down: the version
 * that follows with a handoff claim for it, and the claim's bound, else
 * `HANDOFF_BOUND_MS` after its exit note (past the notes' cap, its last
 * heartbeat). A start marked in its place is a start, and a free lock is
 * neither (row 011-251, F4). Once it cleared its record, a live claim still
 * says the handoff runs, until the successor registers; the lock is not
 * read then (review 0.1.259). Read in the old order: the claim alone with
 * the record cleared; else the shutdown (exit row, then notes), the marks and
 * the lock while the heartbeat is down, the exit note, then the claim.
 */
export function stoppingOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  shutDown: () => boolean,
  heartbeat: DaemonLiveness,
  marks: () => DaemonStart | null,
  at: EpochMs,
): DaemonStopping | null {
  if (facts.row() === null) return null;
  if (record === null) {
    const claim = facts.claim();
    if (claim === null || at >= claim.boundAt) return null;
    const from = claim.from.slice(0, Math.max(0, claim.from.indexOf("@"))) || claim.from;
    return { from, since: claim.at, to: claim.to, boundAt: claim.boundAt, overdue: false };
  }
  if (!shutDown()) return null;
  if (heartbeat.state === "down") {
    const start = marks();
    if (start?.kind === "locked") return null;
    if (start === null && facts.lockFree()) return null;
  }
  const since = (facts.exitNoteAt() ?? record.heartbeatAt) as EpochMs;
  const claim = facts.claim();
  const handoff = claim !== null && claim.from === daemonIncarnation(record) ? claim : null;
  const boundAt = handoff?.boundAt ?? since + HANDOFF_BOUND_MS;
  return {
    from: record.squealVersion,
    since,
    ...(handoff === null ? {} : { to: handoff.to, boundAt: handoff.boundAt }),
    overdue: at >= boundAt,
  };
}

/**
 * Row 011-251: while the heartbeat is down, a daemon starting by the marks:
 * with the record cleared, either mark, unless a handoff is under way (its
 * own words); with a record, only a start mark that names a live process
 * (F4, review 0.1.355 B1), since a busy daemon may hold the lock.
 */
export function startOfMarks(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  down: boolean,
  stopping: () => DaemonStopping | null,
  marks: () => DaemonStart | null,
): MarkedStart | null {
  if (!down || facts.row() === null) return null;
  const start = marks();
  if (start === null) return null;
  const mark = start.kind === "locked" ? "start" : "spawn";
  if (record === null) return stopping() === null ? { since: start.since, mark } : null;
  return start.kind === "locked" ? { since: start.since, mark } : null;
}

/**
 * D10 as amended (task 001-415, the coordinator's bound of 2026-10-15): with
 * the record cleared, a rest later than every heartbeat the row records is
 * quiet until a daemon spawned after it is overdue: no heartbeat within
 * `DAEMON_START_GRACE_MS` of the spawn.
 */
export function restOf(facts: PresenceFacts, at: EpochMs): RestReading | null {
  const row = facts.row();
  if (row === null || row.daemon !== null) return null;
  const rest = restAfterHeartbeats(facts.rest(), row);
  if (rest === null) return null;
  const { spawnedAt } = rest;
  if (spawnedAt === undefined) return { kind: "quiet" };
  return at - spawnedAt <= DAEMON_START_GRACE_MS
    ? { kind: "quiet", spawnedAt }
    : { kind: "overdue" };
}

/** Row 011-140: an alive daemon whose shutdown did not begin, which the short handoff's mark names. */
export function shortOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  shutDown: () => boolean,
  heartbeat: DaemonLiveness,
): DaemonShort | null {
  if (heartbeat.state !== "alive" || record === null || shutDown()) return null;
  const mark = facts.short();
  if (mark === null || mark.of !== handoffFrom(record)) return null;
  const { of, version, claimed, at: since } = mark;
  return { of, version, claimed, since };
}

/**
 * Row 011-200: an alive daemon, not stopping, whose feed delivered no batch
 * for `FEED_LATE_MS`. A time stored before the daemon started is its
 * predecessor's: this one has delivered nothing yet, or stores none.
 */
export function lateOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  heartbeat: DaemonLiveness,
  stopping: () => DaemonStopping | null,
  at: EpochMs,
): FeedLate | null {
  if (heartbeat.state !== "alive" || record === null || stopping() !== null) return null;
  const since = facts.feedDelivered();
  if (since === null || since < record.startedAt || at - since <= FEED_LATE_MS) return null;
  return { since };
}
