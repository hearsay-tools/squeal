import { HANDOFF_BOUND_MS, handoffFrom } from "../delivery/handoff.js";
import { FEED_LATE_MS } from "../status/feed-late.js";
import { lockFileFor } from "../store/paths.js";
import {
  type DaemonDeath,
  type DaemonLiveness,
  type DaemonRecord,
  type DaemonShort,
  type DaemonStopping,
  daemonIncarnation,
  type EpochMs,
  type FeedLate,
  type HeartbeatLate,
  type Store,
  type WorktreeId,
  type WorktreeRecord,
} from "../types/index.js";
import {
  type PresenceFacts,
  readPresenceFacts,
  restAfterHeartbeats,
  type StopMark,
} from "./facts.js";
import { DAEMON_START_GRACE_MS, daemonLiveness, lastHeartbeat } from "./heartbeat.js";
import { type DaemonStart, readLockMarks, startOf } from "./marks.js";

/*
 * Row 011-293 (`research/daemon-presence.md`, decisions 1 and 3): what is
 * known about a worktree's daemon, decided once from its facts. Each finding
 * below is one rule; the views (`views.ts`) say them to their audiences, and
 * `presenceState` (`state.ts`) names the one state they add up to.
 */

/** A rest (`restState`): quiet, with the spawn after it if one came, or overdue. */
export type RestReading =
  | { readonly kind: "quiet"; readonly spawnedAt?: EpochMs }
  | { readonly kind: "overdue" };

/** A start the marks say: `start`, a daemon holds the lock and marked it; `spawn`, a hook spawned one. */
export interface MarkedStart {
  readonly since: EpochMs;
  readonly mark: "start" | "spawn";
}

/** Daemon presence at one moment: the facts, and what each rule decided from them. */
export interface Presence {
  readonly facts: PresenceFacts;
  readonly at: EpochMs;
  /** The recorded daemon, `null` with none. */
  readonly record: DaemonRecord | null;
  /** The heartbeat alone (`daemonLiveness`). */
  readonly heartbeat: DaemonLiveness;
  /** Its shutdown began (`PresenceFacts.shutDown`). */
  readonly shutDown: boolean;
  /** The marks beside the lock with the last heartbeat (row 011-251); `null` without a row. */
  readonly marks: DaemonStart | null;
  /**
   * A start is current: a start mark that names a live process, with any
   * record; a spawn mark within its grace, with the record cleared only, since
   * a busy daemon may hold the lock behind a stale one.
   */
  readonly startCurrent: boolean;
  /** The stop by request that holds by the store alone (`heldStop`), before a current start wins. */
  readonly stop: StopMark | null;
  /** The stop by request said: it holds and no start is current (review 0.1.357 B1). */
  readonly stopped: boolean;
  /** Row 011-34: the recorded daemon stopping, or after it cleared its record, a live claim. */
  readonly stopping: DaemonStopping | null;
  /** Row 011-251: a daemon's start the marks say, while the heartbeat is down. */
  readonly start: MarkedStart | null;
  /** Task 001-415: the daemon rests after it stopped unused; `null` with no rest. */
  readonly rest: RestReading | null;
  /** Row 011-140: an alive daemon that registered older than the claim it ended. */
  readonly short: DaemonShort | null;
  /** Row 011-200: a live daemon's change feed is late. */
  readonly late: FeedLate | null;
  /** Task 001-263: the recorded daemon died without shutting down. Probes the lock at the first call. */
  readonly died: () => DaemonDeath | null;
  /** Row 011-276: a late heartbeat nothing else explains. Probes the lock at the first call. */
  readonly heartbeatLate: () => HeartbeatLate | null;
}

/** The presence of `worktreeId`'s daemon at `now` from the store (`readPresenceFacts`, `decidePresence`). */
export function readPresence(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  row?: WorktreeRecord | null,
): Presence {
  return decidePresence(readPresenceFacts(store, worktreeId, now, row), now);
}

/** Decides presence from `facts` at `at`. */
export function decidePresence(facts: PresenceFacts, at: EpochMs): Presence {
  const { row } = facts;
  const record = row?.daemon ?? null;
  const heartbeat = daemonLiveness(record, at, row?.lastHeartbeatAt ?? null);
  const down = heartbeat.state === "down";
  const shutDown = daemonIncarnation(record) !== null && facts.shutDown;
  const marks = facts.marks === null ? null : startOf(facts.marks, at, lastHeartbeat(row));
  const startCurrent = marks?.kind === "locked" || (marks?.kind === "spawned" && record === null);
  const stop = heldStop(facts, heartbeat);
  const stopping = stoppingOf(facts, record, shutDown, heartbeat, marks, at);
  const start = startOfMarks(row, record, down, stopping, marks);
  const died = once((): DaemonDeath | null =>
    down && record !== null && !shutDown && marks === null && facts.lockFree()
      ? { runs: facts.inFlight() }
      : null,
  );
  const stopped = stop !== null && !startCurrent;
  return {
    facts,
    at,
    record,
    heartbeat,
    shutDown,
    marks,
    startCurrent,
    stop,
    stopped,
    stopping,
    start,
    rest: restOf(facts, at),
    short: shortOf(facts, record, shutDown, heartbeat),
    late: lateOf(facts, record, heartbeat, stopping, at),
    died,
    heartbeatLate: once((): HeartbeatLate | null => {
      if (!down || record === null || shutDown || start !== null || stopped) return null;
      return died() === null ? { ageMs: at - record.heartbeatAt } : null;
    }),
  };
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
function startCurrentOf(marks: DaemonStart | null, record: DaemonRecord | null): boolean {
  return marks?.kind === "locked" || (marks?.kind === "spawned" && record === null);
}

/**
 * Task 011-08: the stopped mark while it holds by the store alone: set, the
 * heartbeat down, and no daemon heartbeat since its time (none voids an
 * `untilStart` mark). A worktree with no row keeps its mark too: the mark is
 * keyed by the worktree's id, never by its row (review wave-1.10 B1).
 */
function heldStop(facts: PresenceFacts, heartbeat: DaemonLiveness): StopMark | null {
  const mark = facts.stop;
  if (heartbeat.state === "alive" || mark === null || mark.untilStart === true) return mark;
  const last = lastHeartbeat(facts.row);
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
 * read then (review 0.1.259).
 */
function stoppingOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  shutDown: boolean,
  heartbeat: DaemonLiveness,
  marks: DaemonStart | null,
  at: EpochMs,
): DaemonStopping | null {
  if (facts.row === null) return null;
  const { claim } = facts;
  if (record === null) {
    if (claim === null || at >= claim.boundAt) return null;
    const from = claim.from.slice(0, Math.max(0, claim.from.indexOf("@"))) || claim.from;
    return { from, since: claim.at, to: claim.to, boundAt: claim.boundAt, overdue: false };
  }
  if (!shutDown) return null;
  if (heartbeat.state === "down") {
    if (marks?.kind === "locked") return null;
    if (marks === null && facts.lockFree()) return null;
  }
  const since = (facts.exitNoteAt ?? record.heartbeatAt) as EpochMs;
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
function startOfMarks(
  row: WorktreeRecord | null,
  record: DaemonRecord | null,
  down: boolean,
  stopping: DaemonStopping | null,
  marks: DaemonStart | null,
): MarkedStart | null {
  if (!down || row === null || marks === null) return null;
  const mark = marks.kind === "locked" ? "start" : "spawn";
  if (record === null) return stopping === null ? { since: marks.since, mark } : null;
  return marks.kind === "locked" ? { since: marks.since, mark } : null;
}

/**
 * D10 as amended (task 001-415, the coordinator's bound of 2026-10-15): with
 * the record cleared, a rest later than every heartbeat the row records is
 * quiet until a daemon spawned after it is overdue: no heartbeat within
 * `DAEMON_START_GRACE_MS` of the spawn.
 */
function restOf(facts: PresenceFacts, at: EpochMs): RestReading | null {
  const { row } = facts;
  if (row === null || row.daemon !== null) return null;
  const rest = restAfterHeartbeats(facts.rest, row);
  if (rest === null) return null;
  const { spawnedAt } = rest;
  if (spawnedAt === undefined) return { kind: "quiet" };
  return at - spawnedAt <= DAEMON_START_GRACE_MS
    ? { kind: "quiet", spawnedAt }
    : { kind: "overdue" };
}

/** Row 011-140: an alive daemon whose shutdown did not begin, which the short handoff's mark names. */
function shortOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  shutDown: boolean,
  heartbeat: DaemonLiveness,
): DaemonShort | null {
  const mark = facts.short;
  if (heartbeat.state !== "alive" || record === null || shutDown || mark === null) return null;
  if (mark.of !== handoffFrom(record)) return null;
  const { of, version, claimed, at: since } = mark;
  return { of, version, claimed, since };
}

/**
 * Row 011-200: an alive daemon, not stopping, whose feed delivered no batch
 * for `FEED_LATE_MS`. A time stored before the daemon started is its
 * predecessor's: this one has delivered nothing yet, or stores none.
 */
function lateOf(
  facts: PresenceFacts,
  record: DaemonRecord | null,
  heartbeat: DaemonLiveness,
  stopping: DaemonStopping | null,
  at: EpochMs,
): FeedLate | null {
  if (heartbeat.state !== "alive" || stopping !== null || record === null) return null;
  const since = facts.feedDelivered;
  if (since === null || since < record.startedAt || at - since <= FEED_LATE_MS) return null;
  return { since };
}

function once<T>(read: () => T): () => T {
  let value: { readonly v: T } | null = null;
  return () => {
    value ??= { v: read() };
    return value.v;
  };
}
