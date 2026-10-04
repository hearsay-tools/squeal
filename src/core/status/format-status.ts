import type {
  CommitSha,
  EpochMs,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
} from "../types/index.js";
import { formatCheck } from "./check-name.js";

/**
 * Human rendering of `squeal status`. The first lines reproduce the vision
 * example ("The desired experience"): revision, known failures (each listed
 * under the count), affected check counts, last full suite, and whether the
 * current revision completed one. Details follow after a blank line.
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
    result.fullSuite.lastCompletedRevision === null
      ? "Last full suite: none recorded"
      : `Last full suite: completed at revision ${result.fullSuite.lastCompletedRevision}`,
    result.fullSuite.atCurrentRevision
      ? "Current revision has completed a full-suite run"
      : "Current revision has not completed a full-suite run",
    "",
    worktreeLine(result),
    daemonLine(result, now),
    `Inherited: ${result.inherited.count} current ${plural(result.inherited.count, "result")}`,
    ...result.inherited.sources.map(
      (s) => `  ${s.count} from ${s.worktreeRoot ?? s.worktreeId} at ${shortCommit(s.commit)}`,
    ),
    ...(result.breakdown.testFilesWithoutChecks === 0
      ? []
      : [`Test files without known checks: ${result.breakdown.testFilesWithoutChecks}`]),
    `Closure method: ${result.closureMethod}`,
    `Store schema: ${result.storeSchemaVersion}`,
    ...result.notes.map((note) => `Note: ${note}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatUnavailable(result: StatusUnavailable): string {
  return `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}\n`;
}

/** "47 passed, 3 running, 12 queued", then skipped, stale and unknown when there are any. */
function affected(s: StatusSnapshot): string {
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
  return parts.join(", ");
}

function worktreeLine(s: StatusSnapshot): string {
  if (s.revision === 0 && s.head === null) return `Worktree: ${s.worktreeRoot}`;
  return `Worktree: ${s.worktreeRoot} (HEAD ${shortCommit(s.head)}, ${s.dirty ? "dirty" : "clean"})`;
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

export function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
