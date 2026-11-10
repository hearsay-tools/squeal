import { stopOf } from "../presence/views.js";
import { awaitingInstallSentence } from "../scheduler/awaiting-install.js";
import { groupTierLines } from "../state/group-text.js";
import { fullSuiteText } from "../state/header.js";
import { revisionText } from "../state/revision-commit.js";
import { slowTierText } from "../state/slow-text.js";
import { countedText, partsSuffix } from "../status/checks.js";
import { DEATH_CAUSE, deathText } from "../status/died.js";
import { delaysText, lateOf } from "../status/feed-late.js";
import { holdLine } from "../status/holds.js";
import {
  holdAcrossEditsText,
  lateHeartbeatDetail,
  untilStartText,
} from "../status/status-detail.js";
import { shortText, stoppingText } from "../status/stopping.js";
import type { Delta } from "../types/delivery.js";
import type { DaemonLiveness, StatusHeader, ValidityCounts } from "../types/status.js";
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
 * What the counts leave out: the listing not done; then, in one sentence (row 011-311), the
 * revision's test files not listed yet, the edits a late change feed has not read, or both. A
 * stopping daemon's own sentence says what it does instead (`livenessSentence`).
 */
function incompleteText(header: StatusHeader): string {
  const listed = header.testFilesListed === false ? ` ${NOT_LISTED_SENTENCE}` : "";
  const late = header.daemon?.stopping === undefined ? lateOf(header.daemon) : undefined;
  const delays = delaysText(header, late);
  return `${listed}${delays === null ? "" : ` ${delays}`}`;
}

/** What both forms end with: daemon liveness, then the install wait or the install sentences. */
function daemonText(header: StatusHeader, command: string): string {
  const awaiting = awaitingInstallText(header);
  return (
    livenessSentence(header.daemon, header.revision, command) +
    (awaiting === null ? installSentences(header) : ` ${awaiting}`)
  );
}

/**
 * The full form's counts: the four validities, the inherited and imported
 * sentences and the test files without checks. Row 011-205: `owed`, the counts a consumer
 * registered before the listing is owed, adds why no unknown one is queued.
 */
function fullCounts(header: StatusHeader, owed: Delta["countsOwed"]): string {
  const { counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files } = header;
  const inheritedCount = header.inheritedCount ?? 0;
  const inherited =
    inheritedCount === 0
      ? ""
      : ` Inherited: ${inheritedCount} of ${counts.current} current${partsSuffix(inheritedCount, header.inheritedFileLevelCount)}.`;
  // Spec 018 D4: beside the inherited count, the imported one.
  const importedCount = header.importedCount ?? 0;
  const imported =
    importedCount === 0 ? "" : ` Imported: ${importedCount} of ${counts.current} current.`;
  const queuedNone =
    owed?.lookupOnly === true && files.unknown > 0
      ? "; the baseline is lookup-only, so it queued none of them"
      : "";
  const withoutChecks =
    files.pending + files.unknown === 0
      ? ""
      : ` Test files without checks: ${files.pending} pending, ${files.unknown} unknown${queuedNone}.`;
  return `${countsText(counts, fileLevel)}.${inherited}${imported}${withoutChecks}`;
}

function fullLine(header: StatusHeader, command: string, owed: Delta["countsOwed"]): string {
  return (
    `Revision ${revisionText(header.revision, header.commit)}${changedText(header)}: ${fullCounts(header, owed)}${incompleteText(header)} ` +
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
 * Task 001-407: the news form drops the current count, the inherited
 * sentence and the checkpoint sentence, and counts only what is not zero:
 * `Revision 12 (changed src/a.ts): 3 pending (2 tests, 1 test file loaded).`
 * Row 011-205: with no such check, the test files without checks alone, so
 * "no check pending, stale or unknown" means that none of them is either.
 * Row 011-262 (gh-105): it names the changed paths as the full form does, so
 * an agent sees why checks re-ran.
 */
function newsLine(header: StatusHeader, command: string, owed: Delta["countsOwed"]): string {
  const { counts, fileLevelCounts: fileLevel, testFilesWithoutChecks: files } = header;
  const revision = `Revision ${revisionText(header.revision, header.commit)}${changedText(header)}: `;
  // Row 011-205: the first delivery after the listing to a consumer registered before it.
  if (owed !== undefined) {
    return `${revision}${fullCounts(header, owed)}${incompleteText(header)}${daemonText(header, command)}`;
  }
  const actionable = ACTIONABLE.filter((v) => counts[v] > 0).map((v) =>
    countedText(counts[v], v, fileLevel?.[v]),
  );
  const without = (["pending", "unknown"] as const)
    .filter((v) => files[v] > 0)
    .map((v) => `${files[v]} ${v}`)
    .join(", ");
  const news =
    actionable.length > 0
      ? `${actionable.join(", ")}.${without === "" ? "" : ` Test files without checks: ${without}.`}`
      : without === ""
        ? "no check pending, stale or unknown."
        : `test files without checks: ${without}.`;
  return `${revision}${news}${incompleteText(header)}${daemonText(header, command)}`;
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
 * `told.slowTierChanged`: the slow tier's state differs from what the
 * consumer was last shown (task 001-407); and the full counts once, when
 * `told.countsOwed` (row 011-205). Row 019-16 (spec 019 D5, D6), with a
 * `checks` key only: a line per configured group not all current, which
 * the news form carries when `told.groupTiersChanged`; then the newest
 * commit report's line, when `told.commitChanged` (status prints it always).
 */
export function headerLines(
  header: StatusHeader,
  command: string,
  form: HeaderForm = "full",
  told: Pick<Delta, "slowTierChanged" | "countsOwed" | "groupTiersChanged" | "commitChanged"> = {},
): string[] {
  const line =
    form === "full"
      ? fullLine(header, command, told.countsOwed)
      : newsLine(header, command, told.countsOwed);
  const slow = form === "full" || told.slowTierChanged ? slowTierText(header, command) : null;
  const groups = form === "full" || told.groupTiersChanged ? groupTierLines(header, command) : [];
  const commit = told.commitChanged === true ? header.commitLine?.text : undefined;
  return [
    line,
    ...(slow === null ? [] : [slow]),
    ...groups,
    ...(commit === undefined ? [] : [commit]),
  ];
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
