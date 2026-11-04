import type { DaemonLiveness, EpochMs } from "../types/index.js";
import type { Presence } from "./decide.js";
import { DAEMON_START_GRACE_MS } from "./heartbeat.js";

/*
 * Row 011-293 (decision 1): the presence views. Each says the one decided
 * presence to its audience as `DaemonLiveness`, the shape status, its JSON
 * payload (decision 4: byte for byte as before) and every delivered text
 * read. The rules that differ between views sit side by side here:
 *
 * - status and its JSON payload read no rest: they say no daemon validates
 *   while it rests (`statusView`);
 * - a delivered header says a rest, and the spawn after it as a start
 *   (`headerView`), and a start its consumer was told of (`withToldStart`);
 * - news reads no death, late heartbeat or late change feed, and no rest or
 *   start is news (`newsChange`; C5: a late feed starts no delivery);
 * - the hook's "Not validated" line reads the late heartbeat alone (`editLineView`).
 */

type Down = Extract<DaemonLiveness, { readonly state: "down" }>;
type Alive = Extract<DaemonLiveness, { readonly state: "alive" }>;

/**
 * What a consumer was last told about the daemon (`delivery/liveness.ts`
 * keeps it per consumer): its state, `{ startingSince }` after a
 * registration that said a daemon is starting (task 001-156), or `{ short }`,
 * the incarnation of a daemon that ended its handoff short (row 011-140),
 * told once. A hook before either reads the object as `alive`.
 */
export type ToldLiveness =
  | DaemonLiveness["state"]
  | { readonly startingSince: EpochMs }
  | { readonly short: string };

/**
 * Status, `--full` and the JSON payload's `daemon` (C6, decision 4): the
 * heartbeat, a stop by request, then a start, death or stopping, a short
 * handoff, a late heartbeat and a late change feed. Status reads no rest.
 */
export function statusView(p: Presence): DaemonLiveness {
  if (p.heartbeat.state === "alive") return aliveView(p, p.heartbeat);
  return withLateHeartbeat(p, withRecordFacts(p, withStop(p, p.heartbeat)));
}

/**
 * The delivered header (C8): status's view, but a rest is said (D10 as
 * amended, task 001-415): a daemon a hook spawned after it is starting, and
 * before one is, the daemon rests. With `told`, a start its consumer was
 * told of wins (`withToldStart`).
 */
export function headerView(p: Presence, told?: ToldLiveness): DaemonLiveness {
  if (p.heartbeat.state === "alive") return aliveView(p, p.heartbeat);
  const rested = withRest(p, withStop(p, p.heartbeat));
  const live = withLateHeartbeat(p, withRecordFacts(p, rested));
  return told === undefined ? live : withToldStart(live, told, p.at);
}

/**
 * The hooks' news (C5): the daemon's liveness when it differs from what the
 * consumer was told, else `null`. A daemon still starting is no news, nor
 * its first heartbeat, nor one that rests (`restState`); a rest whose
 * restart is overdue is forgotten (`forgetRest`), so this and every later
 * boundary report the daemon down. Row 011-140: a daemon that ended its
 * handoff short is told once, whatever was told before.
 */
export function newsChange(
  p: Presence,
  told: ToldLiveness,
): { readonly change: DaemonLiveness | null; readonly forgetRest: boolean } {
  const live = newsView(p, told);
  let forgetRest = false;
  if (live.state === "down" && live.stopped !== true) {
    if (live.startingSince !== undefined) return { change: null, forgetRest };
    if (p.rest?.kind === "quiet") return { change: null, forgetRest };
    forgetRest = p.rest?.kind === "overdue";
  }
  if (live.state === "alive" && live.short !== undefined) {
    const same = typeof told === "object" && "short" in told && told.short === live.short.of;
    return { change: same ? null : live, forgetRest };
  }
  const was = typeof told === "object" ? "alive" : told;
  return { change: live.state === was ? null : live, forgetRest };
}

/** The hook's "Not validated" line after an edit (row 011-276): the heartbeat and a late one only. */
export function editLineView(p: Presence): DaemonLiveness {
  const live = p.heartbeat;
  if (live.state === "alive" || p.record === null || p.shutDown) return live;
  return { ...live, heartbeatLate: { ageMs: p.at - p.record.heartbeatAt } };
}

/**
 * `live` as a consumer told `told` reads it (task 001-156): after "a daemon
 * is starting" at `startingSince`, a down daemon that has not heartbeat
 * since is still starting until `DAEMON_START_GRACE_MS` passed. A heartbeat
 * after the spawn ends the start. A starting daemon is not stopped by either
 * stop (row 011-20, review 0.1.357 B1), and its heartbeat is not late (row 011-276).
 */
export function withToldStart(
  live: DaemonLiveness,
  told: ToldLiveness,
  at: EpochMs,
): DaemonLiveness {
  if (live.state === "alive" || typeof told !== "object" || !("startingSince" in told)) return live;
  const { startingSince } = told;
  const heartbeatSince = live.since !== null && live.since >= startingSince;
  if (heartbeatSince || at - startingSince > DAEMON_START_GRACE_MS) return live;
  const { heartbeatLate: _late, ...starting } = withoutStop(live);
  return { ...starting, startingSince };
}

/** A down `live` without a stop: a start a consumer was told of wins over it. */
export function withoutStop(live: Down): Down {
  const { stopped: _stopped, untilStart: _untilStart, ...rest } = live;
  return rest;
}

/** What telling `live` records: its state, or the short handoff's daemon. */
export function toldOf(live: DaemonLiveness): ToldLiveness {
  return live.state === "alive" && live.short !== undefined ? { short: live.short.of } : live.state;
}

/**
 * The stop a reader names for `live`, the one rule every renderer reads:
 * `until-start` (`squeal stop --until-start`), `until-edit` (`squeal stop`),
 * or `null` while none holds or a daemon's start is current. `untilStart` is
 * read only with `stopped` (review 0.1.357 B1).
 */
export function stopOf(live: DaemonLiveness | undefined): "until-start" | "until-edit" | null {
  if (live?.state !== "down" || live.stopped !== true || live.startingSince !== undefined) {
    return null;
  }
  return live.untilStart === true ? "until-start" : "until-edit";
}

/** An alive daemon: stopping once its shutdown began, else its short handoff and, with `late`, a late feed. */
function aliveView(p: Presence, heartbeat: Alive, late = true): Alive {
  let live = heartbeat;
  if (p.stopping !== null) live = { ...live, stopping: p.stopping };
  if (p.short !== null) live = { ...live, short: p.short };
  if (late && p.late !== null) live = { ...live, late: p.late };
  return live;
}

/** A stop by request while it holds and no start is current. */
function withStop(p: Presence, live: Down): Down {
  if (!p.stopped) return live;
  return { ...live, stopped: true, ...(p.stop?.untilStart === true ? { untilStart: true } : {}) };
}

/** A quiet rest, not said over a stop: the spawn after it as a start, else resting. */
function withRest(p: Presence, live: Down): Down {
  if (live.stopped === true || p.rest?.kind !== "quiet") return live;
  const { spawnedAt } = p.rest;
  return spawnedAt === undefined
    ? { ...live, resting: true }
    : { ...live, startingSince: spawnedAt };
}

/**
 * With the record cleared: a handoff under way, else a start the marks say.
 * With a record: a start marked in its place, else its death when its
 * shutdown never began, else its stopping.
 */
function withRecordFacts(p: Presence, live: Down): Down {
  if (p.facts.row === null) return live;
  const { start, stopping } = p;
  if (p.record === null) {
    if (stopping !== null) return { ...live, stopping };
    if (live.stopped === true || live.startingSince !== undefined || start === null) return live;
    return { ...live, startingSince: start.since, startMark: start.mark };
  }
  if (start !== null) return { ...live, startingSince: start.since, startMark: start.mark };
  if (!p.shutDown) {
    const died = p.died();
    return died === null ? live : { ...live, died };
  }
  return stopping === null ? live : { ...live, stopping };
}

function withLateHeartbeat(p: Presence, live: Down): Down {
  const late = p.heartbeatLate();
  return late === null ? live : { ...live, heartbeatLate: late };
}

/**
 * News's liveness (`livenessChange`): a start the consumer was told of first,
 * then a stop, then what the record says, with no death and no rest.
 */
function newsView(p: Presence, told: ToldLiveness): DaemonLiveness {
  const live = withToldStart(p.heartbeat, told, p.at);
  if (live.state === "alive") return aliveView(p, live, false);
  const stopped = live.startingSince === undefined ? withStop(p, live) : live;
  if (p.facts.row === null) return stopped;
  const { start, stopping, marks } = p;
  if (p.record === null) {
    if (stopping !== null) return { ...stopped, stopping };
    if (stopped.stopped === true || stopped.startingSince !== undefined || start === null) {
      return stopped;
    }
    return { ...stopped, startingSince: start.since, startMark: start.mark };
  }
  if (!p.shutDown) {
    if (stopped.startingSince !== undefined || marks?.kind !== "locked") return stopped;
    return { ...stopped, startingSince: marks.since, startMark: "start" };
  }
  if (start !== null) return { ...stopped, startingSince: start.since, startMark: "start" };
  return stopping === null ? stopped : { ...stopped, stopping };
}
