import { formatCheck, fullSuiteText, runnerPartText, slowTierText } from "../state/index.js";
import { cap, plural } from "../text.js";
import type {
  CommitSha,
  DaemonNote,
  EpochMs,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
} from "../types/index.js";

export interface StatusFormatOptions {
  /** `squeal status --notes`: every note in full, none grouped (task 001-222). */
  readonly allNotes?: boolean;
}

/**
 * Human rendering of `squeal status`. The first lines reproduce the vision
 * example ("The desired experience"): revision, known failures (each listed
 * under the count), affected check counts, and the full-suite checkpoint,
 * worded as a request as delivered headers word it (lessons, surprise 7).
 * Details follow after a blank line. `command` is how the text names the CLI
 * (`SQUEAL_COMMAND`, or the Codex command under Codex).
 */
export function formatStatus(
  result: StatusResult,
  now: EpochMs,
  command = "squeal",
  options: StatusFormatOptions = {},
): string {
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
    `Full-suite checkpoint: ${fullSuiteText(result, command)}`,
    ...checkpointLine(result, now, command),
    ...slowLine(result, command),
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
    ...notes(result, command, options.allNotes === true),
  ];
  return `${lines.join("\n")}\n`;
}

/** Spec 004 D8: the slow-tier line, as delivered headers print it, when slow files are declared. */
function slowLine(s: StatusSnapshot, command: string): string[] {
  const text = slowTierText(s, command);
  return text === null ? [] : [text];
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

/**
 * Task 001-217: the checkpoint in progress, with what it has done, and how
 * to wait for it; task 001-219: the one a stopped daemon owes the next.
 */
function checkpointLine(s: StatusSnapshot, now: EpochMs, command: string): string[] {
  const checkpoint = s.checkpoint;
  if (checkpoint === undefined) return [];
  const what =
    checkpoint.kind === "run-all"
      ? `\`run --all\` requested at revision ${checkpoint.revision}`
      : `the baseline from revision ${checkpoint.revision}`;
  const done = `${checkpoint.done} of ${plural(checkpoint.total, "test file")} done`;
  if (checkpoint.owed) {
    return [
      `Checkpoint owed: ${what}, ${done} when its daemon stopped; the next daemon resumes it`,
    ];
  }
  const started = `started ${age(now - checkpoint.startedAt)} ago`;
  return [
    `Checkpoint in progress: ${what}, ${started}: ${done} (\`${command} run --all --wait\` waits for it)`,
  ];
}

/**
 * Status's own notes, then the daemon's with time and revision. Unless
 * `all`, two or more notes of stopped processes of one kind fold into one
 * line counting them by command (task 001-222); 001-212's detail of each
 * stays behind `status --notes`.
 */
function notes(s: StatusSnapshot, command: string, all: boolean): string[] {
  const stamped = (n: DaemonNote) => {
    const at = new Date(n.at).toISOString();
    return n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
  };
  const groups = new Map<string, Stopped[]>();
  const kept: DaemonNote[] = [];
  for (const note of s.daemonNotes) {
    const stopped = all ? null : parseStopped(note);
    if (stopped === null) kept.push(note);
    else groups.set(stopped.what, [...(groups.get(stopped.what) ?? []), stopped]);
  }
  const folded: string[] = [];
  for (const [what, list] of groups) {
    const [only] = list;
    if (list.length === 1 && only !== undefined) kept.push(only.note);
    else folded.push(foldedText(what, list, command));
  }
  kept.sort((a, b) => a.at - b.at);
  const lines = [...s.notes, ...kept.map(stamped), ...folded];
  return lines.length === 0 ? [] : ["Notes:", ...lines.map((note) => `  ${note}`)];
}

/** A note of `describe` in `src/core/daemon/terminate.ts`: the command line of each process. */
interface Stopped {
  readonly note: DaemonNote;
  readonly what: string;
  readonly commands: readonly string[];
}

const STOPPED = /^stopped \d+ process(?:es)? (.+?): (.+)$/;
/** How much of a command line names its group. */
const COMMAND_CHARS = 120;

function parseStopped(note: DaemonNote): Stopped | null {
  const match = STOPPED.exec(note.text);
  if (match === null) return null;
  const [, what = "", list = ""] = match;
  const commands = list.split("; ").map((entry) => {
    const facts = entry.lastIndexOf(" (");
    const process = facts === -1 ? entry : entry.slice(0, facts);
    return cap(process.slice(process.indexOf(" ") + 1), COMMAND_CHARS);
  });
  return { note, what, commands };
}

function foldedText(what: string, list: readonly Stopped[], command: string): string {
  const counts = new Map<string, number>();
  for (const line of list.flatMap((stopped) => stopped.commands)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const byCommand = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([line, n]) => `${n} × ${line}`);
  const since = new Date(Math.min(...list.map((stopped) => stopped.note.at))).toISOString();
  const processes = total === 1 ? "1 process" : `${total} processes`;
  return (
    `stopped ${processes} ${what}, in ${plural(list.length, "note")} since ${since}: ` +
    `${byCommand.join("; ")} (\`${command} status --notes\` lists each)`
  );
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
  // Task 001-217: a baseline over fresh files runs them before any has a check.
  const files = s.testFilesWithoutChecks.pending;
  const running = Math.min(files, s.breakdown.testFilesWithoutChecksRunning ?? 0);
  const fresh =
    files === 0
      ? ""
      : `; ${plural(files, "test file")} without checks yet: ${running} running, ${files - running} queued`;
  const runnerPart =
    s.runnerPartPending === true
      ? `; ${runnerPartText(s.revision)} is pending, so test files it adds are not counted yet`
      : "";
  return `${parts.join(", ")}${fresh}${runnerPart}`;
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
