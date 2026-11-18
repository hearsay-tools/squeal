import { stopOf, toldOf } from "../presence/views.js";
import { awaitingInstallSentence } from "../scheduler/awaiting-install.js";
import { DEATH_CAUSE, deathHookText } from "../status/died.js";
import {
  holdAcrossEditsText,
  lateHeartbeatDetail,
  startStoppedText,
  untilStartText,
} from "../status/status-detail.js";
import { shortText, stoppingText } from "../status/stopping.js";
import { utcTimeText } from "../text.js";
import type { DaemonLiveness, StatusHeader } from "../types/status.js";
import { installSentences } from "./provenance.js";

/*
 * Row 005-119: the header's daemon sentences (`header.ts`), in one module. Each reads the state
 * a delivery tells of the daemon (`toldOf`), so the header and the news decide it once.
 */

type Down = DaemonLiveness & { readonly state: "down" };

/**
 * The install wait's sentence (`awaitingInstallSentence`). `null` when not
 * waiting, and when no daemon is live: a daemon killed while waiting left
 * the flag (review wave 11, N5).
 */
function awaitingInstallText(header: StatusHeader): string | null {
  if (header.awaitingInstall !== true || header.daemon?.state === "down") return null;
  return awaitingInstallSentence(header.missingInstalls ?? [], header.installCommand);
}

/**
 * What both forms end with: daemon liveness, then the install wait or the install sentences.
 * `unlisted`: no result exists, so a starting daemon's sentence is left out (row 005-94).
 */
export function daemonText(header: StatusHeader, command: string, unlisted = false): string {
  const awaiting = awaitingInstallText(header);
  const { daemon } = header;
  const liveness =
    unlisted && daemon?.state === "down" && daemon.startingSince !== undefined
      ? diedText(daemon)
      : livenessSentence(daemon, header.revision, command);
  return liveness + (awaiting === null ? installSentences(header) : ` ${awaiting}`);
}

/** Task 011-08: why no daemon validates after `squeal stop`, and what starts one. */
function stoppedText(command: string): string {
  return `The daemon is stopped by request (\`${command} stop\`); a hook starts one at the next edit, or run \`${command} start\``;
}

/**
 * Spec 001 D12, review wave 3 S2: "Dead daemon: hooks still serve status and
 * deltas from the store; status says the daemon is down and since when." A
 * validating daemon adds nothing.
 */
function livenessSentence(
  daemon: DaemonLiveness | undefined,
  revision: number,
  command: string,
): string {
  if (daemon === undefined) return "";
  const asOf = `results are as of revision ${revision}`;
  // Row 011-34: a stopping daemon is neither alive nor down. `toldOf` reads one whose heartbeat
  // is still current as validating, since its stop is no news yet; the header says it.
  if (daemon.stopping !== undefined) {
    return ` The daemon is ${stoppingText(daemon.stopping, command)}; ${asOf}.`;
  }
  // Row 011-140: a daemon that ended its handoff short validates, at its own version. Row
  // 011-311: a late change feed is said after the counts, with the revision's listing.
  if (daemon.state === "alive") {
    return daemon.short === undefined
      ? ""
      : ` The daemon is up: ${shortText(daemon.short, command)}.`;
  }
  // Task 001-263: the daemon that died without its stop note, and what it was running.
  const died = diedText(daemon);
  const { state, notes } = toldOf(daemon);
  switch (state) {
    case "stopped by request":
      // Row 011-254: `squeal stop --until-start` holds until `squeal start` alone; review
      // 0.1.357 B1: a current start wins over either stop (`stopOf`). Task 011-08: `squeal
      // stop` holds until the next edit or `squeal start`.
      return stopOf(daemon) === "until-start"
        ? ` The daemon is ${untilStartText(command)}; no edit or Git operation starts one; ${asOf}.`
        : ` ${stoppedText(command)}; ${asOf}. ${holdAcrossEditsText(command)}`;
    case "starting":
      // Row 005-111: a starting daemon whose process is stopped, said in place of a slow start.
      if (notes.includes("start stopped")) return ` ${stoppedStartText(daemon)}; ${asOf}.${died}`;
      // Row 005-108: a daemon that holds the lock in a start past `DAEMON_START_SLOW_MS`.
      if (notes.includes("start slow")) return ` ${slowStartText(daemon)}; ${asOf}.${died}`;
      // Task 001-156: a daemon a hook just spawned, before its first heartbeat.
      return ` A daemon is starting; ${asOf}.${died}`;
    case "resting":
      // Task 001-415, review 001-417 B2: a daemon that stopped unused rests; it is no warning.
      return ` The daemon stopped while unused; ${asOf}.`;
    case "heartbeat late":
      // Row 011-276: a late heartbeat with no stop or exit recorded is no stopped daemon.
      if (daemon.heartbeatLate !== undefined) {
        return ` The daemon's heartbeat is late: ${lateHeartbeatDetail(daemon.heartbeatLate, daemon.since)}; ${asOf}.`;
      }
      break;
  }
  const since =
    daemon.since === null
      ? "No daemon is running"
      : `No daemon has validated since ${new Date(daemon.since).toISOString()}`;
  // Row 005-116 (review 0.1.554 B2): with no daemon or successor running, the death says what
  // starts one; `notValidatedLine` leaves it out of the same message (`headerRestarts`).
  const restart = died === "" ? "" : ` ${restartText(command)}`;
  return ` ${since}; ${asOf}.${died}${restart}`;
}

/** Row 005-116: what starts a daemon after a death, said once per message. */
const restartText = (command: string) => `\`${command} start\` starts one.`;

/**
 * Row 005-108: `A daemon has been starting since <HH:MM:SS UTC>`, of a start that holds the lock
 * past `DAEMON_START_SLOW_MS`; the hooks' time format (`utcTimeText`, 005-94 C4). Never `squeal
 * start`: the daemon is starting, and a second one would wait for its lock.
 */
export function slowStartText(daemon: Down): string {
  const since =
    daemon.startingSince === undefined ? "" : ` since ${utcTimeText(daemon.startingSince)}`;
  return `A daemon has been starting${since}`;
}

/** Row 005-111: the header's sentence of a start whose process is stopped (`startStoppedText`). */
export function stoppedStartText(daemon: Down): string {
  const text = startStoppedText(daemon.startingSince ?? null, utcTimeText);
  return `${text[0]?.toUpperCase()}${text.slice(1)}`;
}

/**
 * Task 001-263: ` The last daemon died …`, when the daemon died without its stop note. Row
 * 005-116: the hook form, with its test files and the cause, never a run id or revision.
 */
export function diedText(daemon: Down): string {
  return daemon.died === undefined
    ? ""
    : ` The last daemon ${deathHookText(daemon.died)}. ${DEATH_CAUSE}`;
}

/** A down daemon told as gone: no stop, start, rest or late heartbeat recorded (`toldOf`). */
export function noneRunning(daemon: DaemonLiveness | undefined): daemon is Down {
  return daemon?.state === "down" && toldOf(daemon).state === "gone";
}
