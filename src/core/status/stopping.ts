import { HANDOFF_BOUND_MS, readHandoff } from "../delivery/handoff.js";
import { readDaemonNotes } from "../notes.js";
import {
  type DaemonLiveness,
  type DaemonStopping,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeRecord,
} from "../types/index.js";
import { daemonGone, shutDown } from "./died.js";

/**
 * Row 011-34 (011 C9 as amended 2026-10-20, design 011-30 section 4, R4):
 * `live` with `stopping` when the recorded daemon's shutdown began (its exit
 * mark or exit note, `shutDown`) and, while its heartbeat is down, it still
 * holds its lock. Such a daemon is neither alive nor down: before this, a
 * stepping daemon's socket said alive while its stopped heartbeat said "no
 * daemon running". With a handoff claim for it (row 011-32), the version
 * that follows and the claim's bound; without one, the bound is
 * `HANDOFF_BOUND_MS` after its shutdown began. A record with no incarnation
 * (a release before task 001-270) leaves no mark to read. Once the old
 * daemon cleared its record, a live claim still says the handoff runs
 * (`claimed`), until the successor registers.
 */
export function withStopping(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  if (worktree === null) return live;
  const record = worktree.daemon;
  if (record === null) return claimed(store, worktree, live, now);
  const self = daemonIncarnation(record);
  if (self === null || !shutDown(store, worktree.id, self)) return live;
  if (live.state === "down" && daemonGone(worktree)) return live;
  // The exit note's time; past the notes' cap, the last heartbeat, which stopped with the timers.
  const note = readDaemonNotes(store, worktree.id).find((n) => n.exitOf === self);
  const since = (note?.at ?? record.heartbeatAt) as EpochMs;
  const claim = readHandoff(store, worktree.id);
  const handoff = claim !== null && claim.from === self ? claim : null;
  const boundAt = handoff?.boundAt ?? since + HANDOFF_BOUND_MS;
  const stopping: DaemonStopping = {
    from: record.squealVersion,
    since,
    ...(handoff === null ? {} : { to: handoff.to, boundAt: handoff.boundAt }),
    overdue: now >= boundAt,
  };
  return { ...live, stopping };
}

/**
 * Between the old daemon's cleared record and its successor's registration,
 * which ends the claim: the old daemon releasing its lock, the lock free
 * while the successor starts, or the successor holding it while it opens the
 * store. The lock is not read: a shutdown of 150 ms let it go 100 ms before
 * the successor's process took it, and status read no daemon between an
 * alive and a handing over (review 0.1.259, the coordinator's decision of
 * 2026-10-22). Its version is the incarnation's (`daemonIncarnation`), its
 * time the claim's; past the bound, or once a timed-out lock wait cleared
 * the claim, nothing.
 */
function claimed(
  store: Store,
  worktree: WorktreeRecord,
  live: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  const claim = readHandoff(store, worktree.id);
  if (claim === null || now >= claim.boundAt) return live;
  const from = claim.from.slice(0, Math.max(0, claim.from.indexOf("@"))) || claim.from;
  const { to, at: since, boundAt } = claim;
  return { ...live, stopping: { from, since, to, boundAt, overdue: false } };
}

/** A handoff's bound in seconds, as the texts name it. */
const BOUND_S = Math.round(HANDOFF_BOUND_MS / 1_000);

/**
 * What every text says of a stopping daemon (C9 as amended 2026-10-20):
 * `handing over from 0.1.223 to 0.1.224 since <time>` with a claim,
 * `stopping since <time>` without, `age` after the time when given, and
 * `, past its 130 s bound` once overdue.
 */
export function stoppingState(stopping: DaemonStopping, age?: string): string {
  const what =
    stopping.to === undefined ? "stopping" : `handing over from ${stopping.from} to ${stopping.to}`;
  const at = new Date(stopping.since).toISOString();
  const past = stopping.overdue ? `, past its ${BOUND_S} s bound` : "";
  return `${what} since ${at}${age === undefined ? "" : ` (${age})`}${past}`;
}

/** What follows it: what it waits for, or past its bound, that `squeal start` finishes it. */
export function stoppingNext(stopping: DaemonStopping, command: string): string {
  if (stopping.overdue) return `\`${command} start\` finishes it`;
  return stopping.to === undefined
    ? "nothing validates until its lock frees"
    : `${stopping.to} serves once the old daemon's lock frees`;
}

/** `stoppingState`, then `stoppingNext`. */
export function stoppingText(stopping: DaemonStopping, command: string, age?: string): string {
  return `${stoppingState(stopping, age)}; ${stoppingNext(stopping, command)}`;
}
