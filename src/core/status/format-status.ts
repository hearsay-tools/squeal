import { RECORDED_UNKNOWN_TEXT, recordedText } from "../retry/index.js";
import {
  formatCheck,
  fullSuiteText,
  runnerPartText,
  slowAffectedText,
  slowTierText,
} from "../state/index.js";
import { excludedFilesText, excludedProjectsText, plural } from "../text.js";
import type { EpochMs, StatusResult, StatusSnapshot, StatusUnavailable } from "../types/index.js";
import {
  countedText,
  earlierFailuresLines,
  failureCountText,
  knownFailureCounts,
  notCurrentText,
  splitByValidity,
} from "./checks.js";
import { codeStatusLines, coverageStatusLines } from "./code-status.js";
import { configProblemsLine } from "./config-problems.js";
import { lateLines } from "./feed-late.js";
import { focusedLines } from "./focused.js";
import { holdLines } from "./holds.js";
import { statusRevisionText } from "./identity.js";
import { fromBase } from "./next-step-text.js";
import { outstandingLines } from "./outstanding-text.js";
import { phaseLines } from "./phase-files.js";
import { slowSlotLines } from "./slot-holders.js";
import { detailLines, hiddenParts } from "./status-detail.js";
import { atText } from "./test-frame.js";

export { shortCommit } from "./identity.js";

export interface StatusFormatOptions {
  /** `squeal status --full`: every outstanding group, then the detail block (row 011-29). */
  readonly full?: boolean;
  /** `squeal status --notes`: `--full` with every note in full, none grouped (task 001-222). */
  readonly allNotes?: boolean;
  /**
   * The directory, relative to the worktree root, a printed command names
   * its paths from: the cwd `status` ran in (`fromBase`). Absent, the root.
   */
  readonly base?: string;
}

/**
 * Human rendering of `squeal status`, led by its verdict (011 C6 as amended
 * 2026-10-20, row 011-29). The first lines reproduce the vision example
 * ("The desired experience"): revision, known failures (each listed under
 * the count), affected check counts, and the full-suite checkpoint, worded
 * as a request as delivered headers word it (lessons, surprise 7). Then the
 * outstanding work, a group a line with what advances it, the coverage
 * lines, and a `More:` line naming what `--full` adds after a blank line:
 * the detail block (`detailLines`). `command` is how the text names the CLI
 * (`SQUEAL_COMMAND`, or the Codex command under Codex).
 */
export function formatStatus(
  result: StatusResult,
  now: EpochMs,
  command = "squeal",
  options: StatusFormatOptions = {},
): string {
  if (!result.available) return formatUnavailable(result, command);
  const allNotes = options.allNotes === true;
  const full = allNotes || options.full === true;
  const lines = [
    `Revision: ${statusRevisionText(result)}`,
    // Row 011-73 (C6 as amended 2026-10-21): a hold qualifies everything below it.
    ...holdLines(result.holds, command),
    // Row 011-200 (C6): a late change feed qualifies everything below it, as a hold does.
    ...lateLines(result.daemon, result.revision),
    // Spec 011 C6 as amended (gh-34): only current failures are counted; (gh-45) then what is not current.
    `Known failures: ${failureCountText(splitByValidity(result.knownFailures).current.map((f) => f.check))}${notCurrentText(result)}`,
    ...earlierFailuresLines(knownFailureCounts(result.knownFailures)),
    ...result.knownFailures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...(f.summary === "" ? [] : [`        ${f.summary}`]),
      `        ${[
        ...(f.location === null ? [] : [atText(f.location, f.testFileFrame)]),
        `observed at revision ${f.observedAt}`,
        f.validity,
      ].join(", ")}`,
      ...(f.recorded === undefined
        ? f.recordedUnknown === true
          ? [`        ${RECORDED_UNKNOWN_TEXT}`]
          : []
        : [
            // Row 011-67 (gh-52): a failure recorded under load names its load retry.
            `        ${recordedText(f.recorded, result.worktreeId, now, { command, path: fromBase(options.base, f.check.testPath) })}`,
          ]),
    ]),
    // Row 011-146 (C6 as amended 2026-10-23): focused runs, after the failures, never counted.
    ...focusedLines(result, full),
    `Affected checks: ${affected(result, command)}`,
    `Full-suite checkpoint: ${fullSuiteText(result, command)}`,
    ...owedLine(result),
    ...slowLine(result, command),
    ...slowSlotLines(result),
    // Row 011-58 (gh-61): which files run and which wait, after the vision's lines.
    ...phaseLines(result),
    ...outstandingLines(result, now, command, {
      all: full,
      ...(options.base === undefined ? {} : { base: options.base }),
    }),
    // Spec 015 D6: one line under the test lines.
    ...codeStatusLines(result, command),
    // Spec 015 D9 (row 015-12): while coverage is on.
    ...coverageStatusLines(result, command),
    ...configProblemsLine(result, command),
    ...excludedLine(result),
    ...(full
      ? ["", ...detailLines(result, now, command, allNotes)]
      : [`More: \`${command} status --full\` adds ${listText(hiddenParts(result, command))}`]),
  ];
  return `${lines.join("\n")}\n`;
}

/** `a, b and c`. */
function listText(parts: readonly string[]): string {
  return parts.length < 2
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Spec 004 D8: the slow-tier line, as delivered headers print it, when slow files are declared. */
function slowLine(s: StatusSnapshot, command: string): string[] {
  const text = slowTierText(s, command);
  return text === null ? [] : [text];
}

/**
 * Task 001-349: the Vitest projects Squeal never runs, named so the agent
 * runs them itself; task 004-81: the `vitest.exclude` globs, a line of their own.
 */
function excludedLine(s: StatusSnapshot): string[] {
  const entries = s.vitestExcluded ?? [];
  const globs = s.vitestExcludedFiles ?? [];
  return [
    ...(entries.length === 0
      ? []
      : [`Not run: Vitest ${excludedProjectsText(entries).text}, excluded by squeal.config.json`]),
    ...(globs.length === 0
      ? []
      : [`Not run: ${excludedFilesText(globs)}, excluded by squeal.config.json`]),
  ];
}

/**
 * Task 001-219: the checkpoint a stopped daemon owes the next. One in
 * progress is an outstanding group (row 011-29).
 */
function owedLine(s: StatusSnapshot): string[] {
  const checkpoint = s.checkpoint;
  if (checkpoint === undefined || !checkpoint.owed) return [];
  const what =
    checkpoint.kind === "run-all"
      ? `\`run --all\` requested at revision ${checkpoint.revision}`
      : `the baseline from revision ${checkpoint.revision}`;
  const done = `${checkpoint.done} of ${plural(checkpoint.total, "test file")} done`;
  return [`Checkpoint owed: ${what}, ${done} when its daemon stopped; the next daemon resumes it`];
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
function affected(s: StatusSnapshot, command: string): string {
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
  return `${parts.join(", ")}${slowAffectedText(s.slowPending, command)}${fresh}${runnerPart}`;
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
