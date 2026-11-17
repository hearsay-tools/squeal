import { stopOf } from "../presence/views.js";
import { awaitingInstallSentence } from "../scheduler/awaiting-install.js";
import { groupTierLines } from "../state/group-text.js";
import { slowTierText } from "../state/slow-text.js";
import { DEATH_CAUSE, deathText } from "../status/died.js";
import { delaysText, lateOf } from "../status/feed-late.js";
import { holdLine } from "../status/holds.js";
import {
  holdAcrossEditsText,
  lateHeartbeatDetail,
  untilStartText,
} from "../status/status-detail.js";
import { shortText, stoppingText } from "../status/stopping.js";
import { plural } from "../text.js";
import type { Delta, OwnEdits } from "../types/delivery.js";
import type { DaemonLiveness, StatusHeader } from "../types/status.js";
import { lateMaySay } from "./late.js";
import { installSentences } from "./provenance.js";

/*
 * The header a SQUEAL message and a Stop start with (spec 001 D6). Two forms, decided by the
 * human (task 001-407): the registration's at registration and at Stop; a change delivery sends
 * the news, only what needs attention, since the whole block on every tool call buried it (Cezar
 * session 74366d0f's feedback, item 6). Row 005-94 (the human, 2026-11-17, R1 and C2): neither
 * carries the worktree's counts, the inherited and imported counts, the test files without
 * checks, the checkpoint or the commit; `squeal status` prints them, with its own lines.
 */

/** `full`: the registration's form, at registration and Stop. `news`: every other delivery. */
export type HeaderForm = "full" | "news";

/** Row 005-94 (R1): the meaning of "current", said where a hook counts current test files. */
const CURRENT_DEFINED = "(run on the files as they are now)";

/**
 * Row 005-90 (amends 001 D7's "these counts are not complete"): before the daemon lists the
 * worktree's test files, no count is printed, since zeros read as all clear; this says why and
 * which wait gives results. `squeal status` prints it too.
 */
export function noResultsText(command: string): string {
  return (
    "Squeal is still starting in this worktree and has no results yet. " +
    `\`${command} status --wait 60000 <path>...\` waits for the files you change.`
  );
}

/**
 * Row 005-90: the line of either form while the test files are not listed: the sentence, then
 * the daemon's. No counts, no delay sentence and no checkpoint sentence, which name counts. Row
 * 005-94 (texts.md 3): no sentence that results are as of a revision, since none exists; with
 * no daemon running, one sentence says both and what starts one. Row 005-108: with a start
 * past `DAEMON_START_SLOW_MS`, one sentence says since when, and never what starts one.
 */
function unlistedLine(header: StatusHeader, command: string): string | null {
  if (header.testFilesListed !== false) return null;
  const { daemon } = header;
  // Row 005-108: the start the registration said, said once more when slow, and since when.
  if (daemon?.state === "down" && daemon.startSlow === true) {
    return `${revisionPrefix(header)}${slowStartText(daemon)}, and Squeal has no results in this worktree yet.${diedText(daemon)}`;
  }
  if (noneRunning(daemon)) {
    return (
      `${revisionPrefix(header)}Squeal has no results in this worktree yet, and no daemon is ` +
      `running; \`${command} start\` starts one.${diedText(daemon)}`
    );
  }
  return `${revisionPrefix(header)}${noResultsText(command)}${daemonText(header, command, true)}`;
}

/**
 * `Revision 12 (changed src/a.ts): `, which both forms start with. Row 005-94: no `· sha + N,
 * dirty` in a hook; `squeal status` names the commit.
 */
function revisionPrefix(header: StatusHeader): string {
  return `Revision ${header.revision}${changedText(header)}: `;
}

/** Paths a header names before the rest is counted (task 001-85). */
const CHANGED_PATHS_SHOWN = 3;

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
 * `(changed a, b, c and N more)` after the revision number; nothing without
 * a change set. Row 011-262 (gh-105): a path git ignores reads
 * `git-ignored a`, since no `git status` shows the change that moved checks.
 */
function changedText(header: StatusHeader): string {
  const paths = header.changedPaths;
  if (paths === undefined || paths.length === 0) return "";
  const ignored = new Set(header.ignoredPaths);
  const shown = paths
    .slice(0, CHANGED_PATHS_SHOWN)
    .map((path) => (ignored.has(path) ? `git-ignored ${path}` : path))
    .join(", ");
  const more = paths.length - CHANGED_PATHS_SHOWN;
  return ` (changed ${shown}${more > 0 ? ` and ${more} more` : ""})`;
}

/**
 * What the counts leave out, in one sentence (row 011-311): the revision's test files not listed
 * yet, the edits a late change feed has not read, or both. A stopping daemon's own sentence says
 * what it does instead (`livenessSentence`). The worktree's listing not done is `unlistedLine`.
 */
function incompleteText(header: StatusHeader, command: string): string {
  const late = header.daemon?.stopping === undefined ? lateOf(header.daemon) : undefined;
  const delays = delaysText(header, late, command);
  return delays === null ? "" : ` ${delays}`;
}

/**
 * What both forms end with: daemon liveness, then the install wait or the install sentences.
 * `unlisted`: no result exists, so a starting daemon's sentence is left out (row 005-94).
 */
function daemonText(header: StatusHeader, command: string, unlisted = false): string {
  const awaiting = awaitingInstallText(header);
  const { daemon } = header;
  const liveness =
    unlisted && daemon?.state === "down" && daemon.startingSince !== undefined
      ? diedText(daemon)
      : livenessSentence(daemon, header.revision, command);
  return liveness + (awaiting === null ? installSentences(header) : ` ${awaiting}`);
}

/**
 * Row 005-94 (R1, C2): the registration's and Stop's line after the title, only when it has
 * something to say: the changed paths, a delay, the daemon, an install or a hold. Without one
 * the title names the revision, so `null`. `squeal status` keeps the counts this form leaves out.
 */
function fullLine(header: StatusHeader, command: string): string | null {
  const unlisted = unlistedLine(header, command);
  if (unlisted !== null) return `${unlisted}${holdsText(header, command)}`;
  const rest = `${incompleteText(header, command)}${daemonText(header, command)}${holdsText(header, command)}`;
  const revision = revisionPrefix(header).slice(0, -2);
  if (rest !== "") return `${revision}:${rest}`;
  return changedText(header) === "" ? null : `${revision}.`;
}

/**
 * Row 005-94 (R1): how many test files are current, the word defined in place, and where the
 * rest is counted: `468 of 584 test files are current (run on the files as they are now), and
 * \`squeal status\` counts the rest.`; `all` only while a live daemon has read every edit and
 * listed the revision. `null` while the header counts no test files, or before the listing.
 */
export function currentFilesText(header: StatusHeader, command: string): string | null {
  const files = header.testFileCounts;
  if (files === undefined || header.testFilesListed === false) return null;
  const total = files.current + files.pending + files.stale + files.unknown;
  if (total === 0) return "the daemon listed no test files.";
  // `1 of 2 test files is`, `0 of 1 test file is`, `0 of 5 test files are`.
  const are = (...ns: number[]) => (ns.includes(1) ? "is" : "are");
  if (files.current < total) {
    return (
      `${files.current} of ${plural(total, "test file")} ${are(files.current, total)} current ` +
      `${CURRENT_DEFINED}, and \`${command} status\` counts the rest.`
    );
  }
  const live = header.daemon?.state === "alive" && header.daemon.late === undefined;
  const all = live && header.runnerPartPending !== true && header.awaitingInstall !== true;
  return `${all ? "all " : ""}${plural(total, "test file")} ${are(total)} current ${CURRENT_DEFINED}.`;
}

/**
 * Row 011-73 (C8 as amended 2026-10-21): the full form carries the status
 * line of each hold; a change delivery says a hold's start and end in its
 * title instead (`formatDelta`).
 */
function holdsText(header: StatusHeader, command: string): string {
  return (header.holds ?? []).map((hold) => ` ${holdLine(hold, command)}`).join("");
}

/**
 * Task 001-407: the news form drops the current count, the inherited
 * sentence and the checkpoint sentence. Row 005-93 (c): it counts the test
 * files the consumer's own edits affect in place of the worktree's queue
 * (`Revision 12 (changed src/a.ts): 3 of the 9 test files your edits affect
 * have not run.`); a consumer with no edit since its count began gets no
 * count, so the line ends after the changed paths. The sentences on a late
 * change feed and an unlisted revision stay after it, except while files are
 * owed and a late message may say them (row 005-97, `lateMaySay`). `squeal status` keeps
 * the worktree's counts. Row 011-262 (gh-105): it names the changed paths as
 * the full form does, so an agent sees why checks re-ran.
 */
function newsLine(
  header: StatusHeader,
  command: string,
  told: Pick<Delta, "countsOwed" | "ownEdits">,
): string {
  const unlisted = unlistedLine(header, command);
  if (unlisted !== null) return unlisted;
  const revision = revisionPrefix(header);
  // Row 011-205: the first delivery after the listing to a consumer registered before it. Row
  // 005-94: how far the results reach, as the registration's `Known failures` line says it.
  if (told.countsOwed !== undefined) {
    const files = currentFilesText(header, command);
    const line = files === null ? `${revision.slice(0, -2)}.` : `${revision}${files}`;
    return `${line}${incompleteText(header, command)}${daemonText(header, command)}`;
  }
  const own = told.ownEdits;
  const line = own === undefined ? `${revision.slice(0, -2)}.` : `${revision}${ownCountText(own)}`;
  const latePart = own !== undefined && own.owed > 0 && lateMaySay(header);
  return `${line}${latePart ? "" : incompleteText(header, command)}${daemonText(header, command)}`;
}

/** `the 9 test files your edits affect`, `the 1 test file your edits affect`. */
function affected(files: number): string {
  return `the ${plural(files, "test file")} your edits affect`;
}

/**
 * `3 of the 9 test files your edits affect have not run`; `the 1 test file your edits affect
 * has not run` when every one is owed. The own count's and the late line's words (row 005-97).
 */
export function notRunText(owed: number, files: number): string {
  const verb = owed === 1 ? "has" : "have";
  return owed === files
    ? `${affected(files)} ${verb} not run`
    : `${owed} of ${affected(files)} ${verb} not run`;
}

/**
 * Row 005-93 (c): the news header's own count, after the revision and its changed paths:
 * `3 of the 9 test files your edits affect have not run.`, or once none is owed,
 * `the 9 test files your edits affect have all run.`; with files that ran with no result,
 * `…; 1 with no result (unknown).` "The test files your edits affect", never "re-keyed".
 */
export function ownCountText({ files, owed, unknown = 0 }: OwnEdits): string {
  const count =
    owed > 0
      ? notRunText(owed, files)
      : `${affected(files)} ${files === 1 ? "has run" : "have all run"}`;
  // Review 0.1.530 B4: a file that ran with no result is said, so "run" never reads as passed.
  return unknown === 0 ? `${count}.` : `${count}; ${unknown} with no result (unknown).`;
}

/** The two parts of a header: its line after the title, and the tier lines after it. */
export interface HeaderParts {
  /** `null` when the registration's form has nothing to say there (`fullLine`). */
  readonly line: string | null;
  readonly tiers: readonly string[];
}

/** The header's lines, the line after the title first (`headerParts`). */
export function headerLines(...args: Parameters<typeof headerParts>): string[] {
  const { line, tiers } = headerParts(...args);
  return line === null ? [...tiers] : [line, ...tiers];
}

/**
 * Spec 004 D8: the slow-tier line, while the repository declares slow files. Row 005-94 (C5):
 * none in a hook while the listing counts no slow file; `squeal status` says so.
 */
function slowLine(header: StatusHeader, command: string): string | null {
  return header.slowTier?.testFiles === 0 ? null : slowTierText(header, command);
}

/**
 * The header line, then the slow-tier line when the repository declares slow
 * files (spec 004 D8). The news form carries the slow-tier line only when
 * `told.slowTierChanged`: the slow tier's state differs from what the
 * consumer was last shown (task 001-407); and the full counts once, when
 * `told.countsOwed` (row 011-205), and else the own count of `told.ownEdits` (row 005-93). Row 019-16 (spec 019 D5, D6), with a
 * `checks` key only: a line per configured group not all current, which
 * the news form carries when `told.groupTiersChanged`; then the newest
 * commit report's line, when `told.commitChanged` (status prints it always).
 */
export function headerParts(
  header: StatusHeader,
  command: string,
  form: HeaderForm = "full",
  told: Pick<
    Delta,
    "slowTierChanged" | "countsOwed" | "groupTiersChanged" | "commitChanged" | "ownEdits"
  > = {},
): HeaderParts {
  const line = form === "full" ? fullLine(header, command) : newsLine(header, command, told);
  const slow = form === "full" || told.slowTierChanged ? slowLine(header, command) : null;
  const groups =
    form === "full"
      ? groupTierLines(header, command)
      : told.groupTiersChanged === undefined
        ? []
        : groupTierLines(header, command, told.groupTiersChanged);
  const commit = told.commitChanged === true ? header.commitLine?.text : undefined;
  return {
    line,
    tiers: [...(slow === null ? [] : [slow]), ...groups, ...(commit === undefined ? [] : [commit])],
  };
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
  // Row 011-34: a stopping daemon is neither alive nor down.
  if (daemon.stopping !== undefined) {
    return ` The daemon is ${stoppingText(daemon.stopping, command)}; results are as of revision ${revision}.`;
  }
  // Row 011-140: a daemon that ended its handoff short validates, at its own version. Row
  // 011-311: a late change feed is said after the counts, with the revision's listing.
  if (daemon.state === "alive") {
    return daemon.short === undefined
      ? ""
      : ` The daemon is up: ${shortText(daemon.short, command)}.`;
  }
  // Row 011-254: `squeal stop --until-start` holds until `squeal start` alone; review 0.1.357
  // B1: a current start wins over either stop (`stopOf`).
  const stop = stopOf(daemon);
  if (stop === "until-start") {
    return ` The daemon is ${untilStartText(command)}; no edit or Git operation starts one; results are as of revision ${revision}.`;
  }
  // Task 011-08: `squeal stop` holds until the next edit or `squeal start`.
  if (stop === "until-edit")
    return ` ${stoppedText(command)}; results are as of revision ${revision}. ${holdAcrossEditsText(command)}`;
  // Task 001-263: the daemon that died without its stop note, and what it was running.
  const died = diedText(daemon);
  // Row 005-108: a daemon that holds the lock in a start past `DAEMON_START_SLOW_MS`.
  if (daemon.startSlow === true) {
    return ` ${slowStartText(daemon)}; results are as of revision ${revision}.${died}`;
  }
  // Task 001-156: a daemon a hook just spawned, before its first heartbeat.
  if (daemon.startingSince !== undefined) {
    return ` A daemon is starting; results are as of revision ${revision}.${died}`;
  }
  // Task 001-415, review 001-417 B2: a daemon that stopped unused rests; it is no warning.
  if (daemon.resting === true) {
    return ` The daemon stopped while unused; results are as of revision ${revision}.`;
  }
  // Row 011-276: a late heartbeat with no stop or exit recorded is no stopped daemon.
  if (daemon.heartbeatLate !== undefined) {
    return ` The daemon's heartbeat is late: ${lateHeartbeatDetail(daemon.heartbeatLate, daemon.since)}; results are as of revision ${revision}.`;
  }
  const since =
    daemon.since === null
      ? "No daemon is running"
      : `No daemon has validated since ${new Date(daemon.since).toISOString()}`;
  return ` ${since}; results are as of revision ${revision}.${died}`;
}

type Down = DaemonLiveness & { readonly state: "down" };

/**
 * Row 005-108: `A daemon has been starting since <time>`, of a start that holds the lock past
 * `DAEMON_START_SLOW_MS`. Never `squeal start`: the daemon is starting, and a second one would
 * wait for its lock.
 */
function slowStartText(daemon: Down): string {
  const since =
    daemon.startingSince === undefined
      ? ""
      : ` since ${new Date(daemon.startingSince).toISOString()}`;
  return `A daemon has been starting${since}`;
}

/** Task 001-263: ` The last daemon died …`, when the daemon died without its stop note. */
function diedText(daemon: Down): string {
  return daemon.died === undefined
    ? ""
    : ` The last daemon ${deathText(daemon.died)}. ${DEATH_CAUSE}`;
}

/** A down daemon with no stop, start, rest or late heartbeat recorded: none is running. */
function noneRunning(daemon: DaemonLiveness | undefined): daemon is Down {
  return (
    daemon?.state === "down" &&
    daemon.stopping === undefined &&
    stopOf(daemon) === null &&
    daemon.startingSince === undefined &&
    daemon.resting !== true &&
    daemon.heartbeatLate === undefined
  );
}
