import { awaitingInstallSentence } from "../scheduler/awaiting-install.js";
import { fullSuiteText, revisionText, runnerPartText, slowTierText } from "../state/index.js";
import { countedText, partsSuffix } from "../status/checks.js";
import { DEATH_CAUSE, deathText } from "../status/died.js";
import { holdLine } from "../status/holds.js";
import { shortText, stoppingText } from "../status/stopping.js";
import type { DaemonLiveness, StatusHeader, ValidityCounts } from "../types/index.js";
import { installSentences } from "./provenance.js";

/*
 * The header a SQUEAL message, a Stop and `squeal status` start with (spec
 * 001 D6). Two forms, decided by the human (task 001-407): the full block at
 * registration, at Stop and in status; a change delivery sends the news,
 * only what needs attention, since the whole block on every tool call
 * buried it (Cezar session 74366d0f's feedback, item 6).
 */

/** `full`: registration, Stop and status. `news`: every other delivery. */
export type HeaderForm = "full" | "news";

/** Spec 001 D7 as amended: the daemon has not listed the test files, so zero counts are not complete. */
const NOT_LISTED_SENTENCE =
  "The daemon has not listed this worktree's test files yet; these counts are not complete.";

/** Paths a header names before the rest is counted (task 001-85). */
const CHANGED_PATHS_SHOWN = 3;

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The install wait's sentence (`awaitingInstallSentence`). `null` when not
 * waiting, and when no daemon is live: a daemon killed while waiting left
 * the flag (review wave 11, N5).
 */
function awaitingInstallText(header: StatusHeader): string | null {
  if (header.awaitingInstall !== true || header.daemon?.state === "down") return null;
  return awaitingInstallSentence(header.missingInstalls ?? [], header.installCommand);
}

/** `(changed a, b, c and N more)` after the revision number; nothing without a change set. */
function changedText(paths: readonly string[] | undefined): string {
  if (paths === undefined || paths.length === 0) return "";
  const shown = paths.slice(0, CHANGED_PATHS_SHOWN).join(", ");
  const more = paths.length - CHANGED_PATHS_SHOWN;
  return ` (changed ${shown}${more > 0 ? ` and ${more} more` : ""})`;
}

/** What the counts leave out: the listing not done, the runner part pending. */
function incompleteText(header: StatusHeader): string {
  const listed = header.testFilesListed === false ? ` ${NOT_LISTED_SENTENCE}` : "";
  const runnerPart =
    header.runnerPartPending === true
      ? ` ${capitalize(runnerPartText(header.revision))} is pending; test files it adds are not counted yet.`
      : "";
  return `${listed}${runnerPart}`;
}

/** What both forms end with: daemon liveness, then the install wait or the install sentences. */
function daemonText(header: StatusHeader, command: string): string {
  const awaiting = awaitingInstallText(header);
  return (
    livenessSentence(header.daemon, header.revision, command) +
    (awaiting === null ? installSentences(header) : ` ${awaiting}`)
  );
}

function fullLine(header: StatusHeader, command: string): string {
  const { revision, counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files } = header;
  const inheritedCount = header.inheritedCount ?? 0;
  const inherited =
    inheritedCount === 0
      ? ""
      : ` Inherited: ${inheritedCount} of ${counts.current} current${partsSuffix(inheritedCount, header.inheritedFileLevelCount)}.`;
  const withoutChecks =
    files.pending + files.unknown === 0
      ? ""
      : ` Test files without checks: ${files.pending} pending, ${files.unknown} unknown.`;
  return (
    `Revision ${revisionText(revision, header.commit)}${changedText(header.changedPaths)}: ${countsText(counts, fileLevel)}.${inherited}${withoutChecks}${incompleteText(header)} ` +
    `Full-suite checkpoint: ${fullSuiteText(header, command)}.${daemonText(header, command)}${holdsText(header, command)}`
  );
}

/**
 * Row 011-73 (C8 as amended 2026-10-21): the full form carries the status
 * line of each hold; a change delivery says a hold's start and end in its
 * title instead (`formatDelta`).
 */
function holdsText(header: StatusHeader, command: string): string {
  return (header.holds ?? []).map((hold) => ` ${holdLine(hold, command)}`).join("");
}

/** The validities a news header counts: those that need a run or a wait. */
const ACTIONABLE = ["pending", "stale", "unknown"] as const;

/**
 * Task 001-407: the news form drops the changed paths, the current count,
 * the inherited sentence and the checkpoint sentence, and counts only what
 * is not zero: `Revision 12: 3 pending (2 tests, 1 test file loaded).`
 */
function newsLine(header: StatusHeader, command: string): string {
  const { counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files } = header;
  const actionable = ACTIONABLE.filter((v) => counts[v] > 0).map((v) =>
    countedText(counts[v], v, fileLevel?.[v]),
  );
  const checks =
    actionable.length === 0 ? "no check pending, stale or unknown" : actionable.join(", ");
  const without = (["pending", "unknown"] as const)
    .filter((v) => files[v] > 0)
    .map((v) => `${files[v]} ${v}`);
  const withoutChecks =
    without.length === 0 ? "" : ` Test files without checks: ${without.join(", ")}.`;
  return `Revision ${revisionText(header.revision, header.commit)}: ${checks}.${withoutChecks}${incompleteText(header)}${daemonText(header, command)}`;
}

/**
 * `12 current (9 tests, 3 test files loaded), 3 pending (2 tests, 1 test
 * file loaded), 0 stale, 0 unknown`: each count names its tests and
 * file-level checks apart (spec 005 D1).
 */
function countsText(counts: ValidityCounts, fileLevel: ValidityCounts | undefined): string {
  return (["current", ...ACTIONABLE] as const)
    .map((validity) => countedText(counts[validity], validity, fileLevel?.[validity]))
    .join(", ");
}

/**
 * The header line, then the slow-tier line when the repository declares slow
 * files (spec 004 D8). The news form carries the slow-tier line only when
 * `slowChanged`: the slow tier's state differs from what the consumer was
 * last shown (task 001-407).
 */
export function headerLines(
  header: StatusHeader,
  command: string,
  form: HeaderForm = "full",
  slowChanged = false,
): string[] {
  const line = form === "full" ? fullLine(header, command) : newsLine(header, command);
  const slow = form === "full" || slowChanged ? slowTierText(header, command) : null;
  return slow === null ? [line] : [line, slow];
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
  // Row 011-140: a daemon that ended its handoff short validates, at its own version.
  if (daemon.state === "alive") {
    return daemon.short === undefined
      ? ""
      : ` The daemon is up: ${shortText(daemon.short, command)}.`;
  }
  // Task 011-08: `squeal stop` holds until the next edit or `squeal start`.
  if (daemon.stopped === true)
    return ` ${stoppedText(command)}; results are as of revision ${revision}.`;
  // Task 001-263: the daemon that died without its stop note, and what it was running.
  const died =
    daemon.died === undefined ? "" : ` The last daemon ${deathText(daemon.died)}. ${DEATH_CAUSE}`;
  // Task 001-156: a daemon a hook just spawned, before its first heartbeat.
  if (daemon.startingSince !== undefined) {
    return ` A daemon is starting; results are as of revision ${revision}.${died}`;
  }
  // Task 001-415, review 001-417 B2: a daemon that stopped unused rests; it is no warning.
  if (daemon.resting === true) {
    return ` The daemon stopped while unused; results are as of revision ${revision}.`;
  }
  const since =
    daemon.since === null
      ? "No daemon is running"
      : `No daemon has validated since ${new Date(daemon.since).toISOString()}`;
  return ` ${since}; results are as of revision ${revision}.${died}`;
}
