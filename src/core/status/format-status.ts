import { formatCheck, fullSuiteText, runnerPartText } from "../state/index.js";
import { plural } from "../text.js";
import type {
  CommitSha,
  EpochMs,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
} from "../types/index.js";

/** The CLI that prints status names itself. */
const STATUS_COMMAND = "squeal";

/**
 * Human rendering of `squeal status`. The first lines reproduce the vision
 * example ("The desired experience"): revision, known failures (each listed
 * under the count), affected check counts, and the full-suite checkpoint,
 * worded as a request as delivered headers word it (lessons, surprise 7).
 * Details follow after a blank line.
 */
export function formatStatus(result: StatusResult, now: EpochMs): string {
  if (!result.available) return formatUnavailable(result);
  const lines = [
    `Revision: ${result.revision}`,
    `Known failures: ${result.knownFailures.length}`,
    ...result.knownFailures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...(f.summary === "" ? [] : [`        ${f.summary}`]),
      `        ${[
        ...(f.location === null
          ? []
          : [`at ${f.location.path}:${f.location.line}:${f.location.column}`]),
        `observed at revision ${f.observedAt}`,
        f.validity,
      ].join(", ")}`,
    ]),
    `Affected checks: ${affected(result)}`,
    `Full-suite checkpoint: ${fullSuiteText(result, STATUS_COMMAND)}`,
    "",
    worktreeLine(result),
    daemonLine(result, now),
    inheritedLine(result),
    ...result.inherited.sources.map(
      (s) => `  ${s.count} from ${s.worktreeRoot ?? s.worktreeId} at ${shortCommit(s.commit)}`,
    ),
    ...(result.breakdown.testFilesWithoutChecks === 0
      ? []
      : [
          `Test files without checks: ${result.testFilesWithoutChecks.pending} pending, ${result.testFilesWithoutChecks.unknown} unknown`,
        ]),
    `Closure method: ${result.closureMethod}`,
    `Store schema: ${result.storeSchemaVersion}`,
    ...notes(result),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Says where current results come from, and at 0 that none was reused, so the
 * line never reads as nothing being current (lessons, defect 27).
 */
function inheritedLine(s: StatusSnapshot): string {
  return s.inherited.count === 0
    ? "Inherited from other worktrees: none (every current result here was run in this worktree)"
    : `Inherited from other worktrees: ${plural(s.inherited.count, "current result")}`;
}

/** Status's own notes, then the daemon's with time and revision. */
function notes(s: StatusSnapshot): string[] {
  const daemon = s.daemonNotes.map((n) => {
    const at = new Date(n.at).toISOString();
    return n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
  });
  const all = [...s.notes, ...daemon];
  return all.length === 0 ? [] : ["Notes:", ...all.map((note) => `  ${note}`)];
}

export function formatUnavailable(result: StatusUnavailable): string {
  return `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}\n`;
}

/**
 * "47 passed, 3 running, 12 queued", then skipped, stale and unknown when
 * there are any. Before the daemon listed the test files, zero counts would
 * read as complete, so none are printed (D7 as amended). While the runner
 * part of the revision is pending, the counts say what they leave out (D2 as
 * amended, review wave 4.5 S1).
 */
function affected(s: StatusSnapshot): string {
  if (s.testFilesListed === false) {
    return "none counted; the daemon has not listed this worktree's test files yet";
  }
  const { currentByOutcome, pendingByPhase } = s.breakdown;
  const parts = [
    `${currentByOutcome.pass} passed`,
    `${pendingByPhase.running} running`,
    `${pendingByPhase.queued} queued`,
  ];
  const optional: [number, string][] = [
    [currentByOutcome.skip, "skipped"],
    [s.counts.stale, "stale"],
    [s.counts.unknown + currentByOutcome.unknown, "unknown"],
  ];
  for (const [count, label] of optional) if (count > 0) parts.push(`${count} ${label}`);
  const runnerPart =
    s.runnerPartPending === true
      ? `; ${runnerPartText(s.revision)} is pending, so test files it adds are not counted yet`
      : "";
  return `${parts.join(", ")}${runnerPart}`;
}

/** Spec 001 D7 as amended: the dirty flag is labelled with its revision, not known without a daemon. */
function worktreeLine(s: StatusSnapshot): string {
  const dirty =
    s.dirty !== null
      ? `${s.dirty ? "dirty" : "clean"} at revision ${s.dirtyObservedAt ?? s.revision}`
      : s.daemon.state === "alive"
        ? "dirty state not known: no revision recorded yet"
        : "dirty state not known: no daemon is validating";
  return `Worktree: ${s.worktreeRoot} (HEAD ${shortCommit(s.head)}, ${dirty})`;
}

function daemonLine(s: StatusSnapshot, now: EpochMs): string {
  if (s.daemon.state === "alive") {
    return `Daemon: running, last heartbeat ${age(now - s.daemon.lastHeartbeatAt)} ago`;
  }
  if (s.daemon.since === null) return "Daemon: no daemon running";
  return `Daemon: no daemon running since ${new Date(s.daemon.since).toISOString()}`;
}

export function shortCommit(commit: CommitSha): string {
  return commit === null ? "no commit" : commit.slice(0, 7);
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
