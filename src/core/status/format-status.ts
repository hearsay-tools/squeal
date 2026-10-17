import { RECORDED_UNKNOWN_TEXT, recordedText, waitsText } from "../retry/index.js";
import { formatCheck, fullSuiteText, runnerPartText, slowTierText } from "../state/index.js";
import { excludedProjectsText, plural } from "../text.js";
import type {
  DaemonNote,
  EpochMs,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
} from "../types/index.js";
import { countedText, failureCountText, partsSuffix } from "./checks.js";
import { configProblemsLine } from "./config-problems.js";
import { DEATH_CAUSE, deathText } from "./died.js";
import { shortCommit, statusRevisionText, worktreeLine } from "./identity.js";
import { unknownFilesLines } from "./unknown-files.js";

export { shortCommit } from "./identity.js";

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
  if (!result.available) return formatUnavailable(result, command);
  const lines = [
    `Revision: ${statusRevisionText(result)}`,
    `Known failures: ${failureCountText(result.knownFailures.map((f) => f.check))}`,
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
      ...(f.recorded === undefined
        ? f.recordedUnknown === true
          ? [`        ${RECORDED_UNKNOWN_TEXT}`]
          : []
        : [`        ${recordedText(f.recorded, result.worktreeId, now)}`]),
    ]),
    ...retryLines(result),
    `Affected checks: ${affected(result)}`,
    `Full-suite checkpoint: ${fullSuiteText(result, command)}`,
    ...checkpointLine(result, now, command),
    ...slowLine(result, command, options.allNotes === true),
    ...configProblemsLine(result, command),
    ...excludedLine(result),
    "",
    worktreeLine(result),
    daemonLine(result, now, command),
    inheritedLine(result),
    ...result.inherited.sources.map(
      (s) =>
        `  ${s.count}${partsSuffix(s.count, s.fileLevelCount)} from ${s.worktreeRoot ?? s.worktreeId} at ${shortCommit(s.commit)}`,
    ),
    ...(result.breakdown.testFilesWithoutChecks === 0
      ? []
      : [
          `Test files without checks: ${result.testFilesWithoutChecks.pending} pending, ${result.testFilesWithoutChecks.unknown} unknown`,
        ]),
    ...unknownFilesLines(result),
    `Closure method: ${result.closureMethod}`,
    `Store schema: ${result.storeSchemaVersion}`,
    ...notes(result, command, options.allNotes === true),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Spec 001 D6 (001-368): each pending retry and what it waits for, with the
 * load now. Its FAIL is still among the known failures above.
 */
function retryLines(s: StatusSnapshot): string[] {
  const pending = s.pendingRetries;
  if (pending === undefined) return [];
  const load = { oneMinute: pending.loadAverage, cpus: pending.cpus };
  return [
    `Pending retries: ${pending.retries.length}`,
    ...pending.retries.map((r) => {
      const where =
        r.claimedBy === null || r.claimedBy === s.worktreeId
          ? ""
          : ", queued by another worktree's daemon";
      return `  ${r.testFile.path} (${r.reason}): ${waitsText(r.reason, load)}${where}`;
    }),
  ];
}

/** Spec 004 D8: the slow-tier line, as delivered headers print it, when slow files are declared. */
/** With `all` (`status --notes`), the declared artifacts the line counts, each by name (001-413). */
function slowLine(s: StatusSnapshot, command: string, all: boolean): string[] {
  const text = slowTierText(s, command);
  if (text === null) return [];
  const artifact = s.slowTier?.artifact ?? [];
  return all && artifact.length > 1
    ? [text, `  Declared artifacts: ${artifact.join(", ")}`]
    : [text];
}

/** Task 001-349: the Vitest projects Squeal never runs, named so the agent runs them itself. */
function excludedLine(s: StatusSnapshot): string[] {
  const entries = s.vitestExcluded ?? [];
  if (entries.length === 0) return [];
  return [`Not run: Vitest ${excludedProjectsText(entries).text}, excluded by squeal.config.json`];
}

/**
 * Says where current results come from, and at 0 that none was reused, so the
 * line never reads as nothing being current (lessons, defect 27).
 */
function inheritedLine(s: StatusSnapshot): string {
  return s.inherited.count === 0
    ? "Inherited from other worktrees: none (every current result here was run in this worktree)"
    : `Inherited from other worktrees: ${plural(s.inherited.count, "current result")}${partsSuffix(s.inherited.count, s.inheritedFileLevelCount)}`;
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
 * stays behind `status --notes`. So do a daemon's exit notes of one text,
 * one per start of an idle worktree's daemon: the latest is listed with how
 * many there were (task 001-413).
 */
function notes(s: StatusSnapshot, command: string, all: boolean): string[] {
  const exits = new Map<string, DaemonNote[]>();
  for (const note of all ? [] : s.daemonNotes) {
    if (note.exitOf !== undefined) exits.set(note.text, [...(exits.get(note.text) ?? []), note]);
  }
  const stamped = (n: DaemonNote) => {
    const at = new Date(n.at).toISOString();
    const text =
      n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
    const same = n.exitOf === undefined ? [] : (exits.get(n.text) ?? []);
    const [first] = same;
    if (same.length < 2 || first === undefined) return text;
    const since = new Date(first.at).toISOString();
    return `${text} (${same.length} notes since ${since}; \`${command} status --notes\` lists each)`;
  };
  const groups = new Map<string, DaemonNote[]>();
  const kept: DaemonNote[] = [];
  for (const note of s.daemonNotes) {
    const exit = note.exitOf === undefined ? undefined : exits.get(note.text);
    if (exit !== undefined && exit[exit.length - 1] !== note) continue;
    const what = all ? undefined : note.stopped?.what;
    if (what === undefined) kept.push(note);
    else groups.set(what, [...(groups.get(what) ?? []), note]);
  }
  const folded: string[] = [];
  for (const [what, list] of groups) {
    const [only] = list;
    if (list.length === 1 && only !== undefined) kept.push(only);
    else folded.push(foldedText(what, list, command));
  }
  kept.sort((a, b) => a.at - b.at);
  const lines = [...s.notes, ...kept.map(stamped), ...folded];
  return lines.length === 0 ? [] : ["Notes:", ...lines.map((note) => `  ${note}`)];
}

function foldedText(what: string, list: readonly DaemonNote[], command: string): string {
  const counts = new Map<string, number>();
  for (const line of list.flatMap((note) => note.stopped?.commands ?? [])) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const byCommand = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([line, n]) => `${n} × ${line}`);
  const since = new Date(Math.min(...list.map((note) => note.at))).toISOString();
  const processes = total === 1 ? "1 process" : `${total} processes`;
  return (
    `stopped ${processes} ${what}, in ${plural(list.length, "note")} since ${since}: ` +
    `${byCommand.join("; ")} (\`${command} status --notes\` lists each)`
  );
}

export function formatUnavailable(result: StatusUnavailable, command = "squeal"): string {
  const lines = [
    `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}`,
    ...configProblemsLine(result, command),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * "47 passed (40 tests, 7 test files loaded), 3 running (3 tests), 12
 * queued (9 tests, 3 test files loaded)", then skipped, stale and unknown
 * when there are any, each count naming its tests and file-level checks
 * apart (spec 005 D1). Before the daemon listed the test files, zero counts would
 * read as complete, so none are printed (D7 as amended). While the runner
 * part of the revision is pending, the counts say what they leave out (D2 as
 * amended, review wave 4.5 S1).
 */
function affected(s: StatusSnapshot): string {
  if (s.testFilesListed === false) {
    return "none counted; the daemon has not listed this worktree's test files yet";
  }
  const { currentByOutcome, pendingByPhase, fileLevelByOutcome, fileLevelByPhase } = s.breakdown;
  const files = s.fileLevelCounts;
  const parts = [
    countedText(currentByOutcome.pass, "passed", fileLevelByOutcome?.pass),
    countedText(pendingByPhase.running, "running", fileLevelByPhase?.running),
    countedText(pendingByPhase.queued, "queued", fileLevelByPhase?.queued),
  ];
  const unknownFiles =
    files === undefined || fileLevelByOutcome === undefined
      ? undefined
      : files.unknown + fileLevelByOutcome.unknown;
  const optional: [number, string, number | undefined][] = [
    [currentByOutcome.skip, "skipped", fileLevelByOutcome?.skip],
    [s.counts.stale, "stale", files?.stale],
    [s.counts.unknown + currentByOutcome.unknown, "unknown", unknownFiles],
  ];
  for (const [count, label, fileLevel] of optional) {
    if (count > 0) parts.push(countedText(count, label, fileLevel));
  }
  const fresh = freshText(s);
  const runnerPart =
    s.runnerPartPending === true
      ? `; ${runnerPartText(s.revision)} is pending, so test files it adds are not counted yet`
      : "";
  return `${parts.join(", ")}${fresh}${runnerPart}`;
}

/**
 * Task 001-217: a baseline over fresh files runs them before any has a check;
 * the detail line counts them when none runs.
 */
function freshText(s: StatusSnapshot): string {
  const files = s.testFilesWithoutChecks.pending;
  const running = Math.min(files, s.breakdown.testFilesWithoutChecksRunning ?? 0);
  return running === 0
    ? ""
    : `; ${plural(files, "test file")} without checks yet: ${running} running, ${files - running} queued`;
}

function daemonLine(s: StatusSnapshot, now: EpochMs, command: string): string {
  if (s.daemon.state === "alive") {
    return `Daemon: running, last heartbeat ${age(now - s.daemon.lastHeartbeatAt)} ago`;
  }
  // Task 011-08: `squeal stop` holds until the next edit or `squeal start`.
  if (s.daemon.stopped === true) {
    return `Daemon: stopped by request (\`${command} stop\`); a hook starts one at the next edit, or run \`${command} start\``;
  }
  const down =
    s.daemon.since === null
      ? "Daemon: no daemon running"
      : `Daemon: no daemon running since ${new Date(s.daemon.since).toISOString()}`;
  // Task 001-263: a daemon that died without its stop note is named, with what it was running.
  if (s.daemon.died === undefined) return down;
  return `${down}; it ${deathText(s.daemon.died)}. ${DEATH_CAUSE}`;
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
