import type { DaemonLiveness, EpochMs } from "../types/index.js";
import { decidePresence, type MarkedStart, type Presence } from "./decide.js";
import type { PresenceFacts } from "./facts.js";
import { DAEMON_START_GRACE_MS } from "./heartbeat.js";
import type { PresenceNote } from "./state.js";
import { alreadyTold, type ToldLiveness, type ToldPresence } from "./told.js";

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
 * - news tells what the header tells, each change once (row 011-295), but
 *   no late change feed (C5: it starts no delivery), no start and no rest,
 *   and a daemon whose heartbeat is current validates, its shutdown begun or
 *   not (`newsChange`, `toldOf`);
 * - the hook's "Not validated" line reads no stop and no start, since a hook
 *   prints it only when it found neither (`editLineView`).
 */

type Down = Extract<DaemonLiveness, { readonly state: "down" }>;
type Alive = Extract<DaemonLiveness, { readonly state: "alive" }>;

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
 * The hooks' news (C5): the daemon's liveness when its presence state, or a
 * note the header says with it, is not what the consumer was told
 * (`alreadyTold`), else `null`. Row 011-295: a late heartbeat and a death
 * are news as the header words them. A daemon still starting is no news,
 * nor its first heartbeat, nor one that rests (`Presence.rest`); a rest
 * whose restart is overdue is forgotten (`forgetRest`), so this and every
 * later boundary report the daemon down. Row 011-140: a daemon that ended
 * its handoff short is told once, whatever was told before.
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
  return { change: alreadyTold(told, toldOf(live)) ? null : live, forgetRest };
}

/**
 * The hook's "Not validated" line (row 011-276), read only when it prints:
 * after an edit, when the hook could neither reach nor start a daemon. Row
 * 011-295: it says what status says there: a stopping daemon, else beside a
 * record no shutdown cleared, its death or its late heartbeat. It reads no
 * stop and no start of its own: that hook found neither (`ensure` returns
 * `stopped` while a stop holds, `spawned` while a start is current).
 */
export function editLineView(facts: PresenceFacts, at: EpochMs): DaemonLiveness {
  const p = decidePresence(facts, at);
  const live = p.heartbeat;
  if (live.state === "alive") return live;
  const stopping = p.stopping;
  if (stopping !== null) return { ...live, stopping };
  const record = p.record;
  if (record === null || p.shutDown) return live;
  const died = p.died();
  return died === null
    ? { ...live, heartbeatLate: { ageMs: at - record.heartbeatAt } }
    : { ...live, died };
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

/**
 * What telling `live` tells (row 011-295), in the header's words
 * (`delivery/header.ts`): its presence state, and the notes the header says
 * with it. The header names a death only beside a start or no daemon, and no
 * late change feed is news (C5). A daemon whose heartbeat is current
 * validates for news, its shutdown begun or not: its stop is news once its
 * heartbeat lapses or its record is cleared, as before.
 */
export function toldOf(live: DaemonLiveness): ToldPresence {
  if (live.state === "alive") {
    const { short } = live;
    return short === undefined
      ? { state: "validating", notes: [] }
      : { state: "validating", notes: ["handoff ended short"], short: short.of };
  }
  const died: readonly PresenceNote[] = live.died === undefined ? [] : ["last one died"];
  if (live.stopping !== undefined) return { state: "stopping", notes: [] };
  if (stopOf(live) !== null) return { state: "stopped by request", notes: [] };
  if (live.startingSince !== undefined) return { state: "starting", notes: died };
  if (live.resting === true) return { state: "resting", notes: [] };
  if (live.heartbeatLate !== undefined) return { state: "heartbeat late", notes: [] };
  return { state: "gone", notes: died };
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
  if (p.facts.row() === null) return live;
  // Each finding is asked for in the order the old layers read it (review 0.1.403-r2 B2).
  if (p.record === null) {
    const stopping = p.stopping;
    if (stopping !== null) return { ...live, stopping };
    if (live.stopped === true || live.startingSince !== undefined) return live;
    return withStart(live, p.start);
  }
  if (!p.shutDown) {
    const start = p.start;
    if (start !== null) return withStart(live, start);
    const died = p.died();
    return died === null ? live : { ...live, died };
  }
  const start = p.start;
  if (start !== null) return withStart(live, start);
  const stopping = p.stopping;
  return stopping === null ? live : { ...live, stopping };
}

/** `live` starting as `start` says, or `live` with none. */
function withStart(live: Down, start: MarkedStart | null): Down {
  return start === null ? live : { ...live, startingSince: start.since, startMark: start.mark };
}

function withLateHeartbeat(p: Presence, live: Down): Down {
  const late = p.heartbeatLate();
  return late === null ? live : { ...live, heartbeatLate: late };
}

/**
 * News's liveness (`livenessChange`): a start the consumer was told of first,
 * then a stop, then what the record says, with no rest. A told start settles
 * what it settles before the marks or the stop are read (review 0.1.403-r2
 * B2), as the old layers did. Row 011-295: beside a record whose shutdown
 * never began and no stop, its death, else its late heartbeat, as the header
 * says them; they are read after the marks, so a start reads no lock.
 */
function newsView(p: Presence, told: ToldLiveness): DaemonLiveness {
  const live = withToldStart(p.heartbeat, told, p.at);
  if (live.state === "alive") return aliveView(p, live, false);
  const stopped = live.startingSince === undefined ? withStop(p, live) : live;
  if (p.facts.row() === null) return stopped;
  if (p.record === null) {
    const stopping = p.stopping;
    if (stopping !== null) return { ...stopped, stopping };
    if (stopped.stopped === true || stopped.startingSince !== undefined) return stopped;
    return withStart(stopped, p.start);
  }
  if (!p.shutDown) {
    if (stopped.startingSince !== undefined) return stopped;
    const marks = p.marks;
    if (marks?.kind === "locked")
      return { ...stopped, startingSince: marks.since, startMark: "start" };
    if (stopped.stopped === true) return stopped;
    const died = p.died();
    return died === null ? withLateHeartbeat(p, stopped) : { ...stopped, died };
  }
  const start = p.start;
  if (start !== null) return withStart(stopped, start);
  const stopping = p.stopping;
  return stopping === null ? stopped : { ...stopped, stopping };
}
