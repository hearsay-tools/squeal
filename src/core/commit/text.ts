import { plural } from "../text.js";
import type { CommitLine } from "../types/status.js";
import {
  type CommitLintCounts,
  type CommitLintToolCounts,
  type CommitReport,
  isFailedReport,
} from "./report.js";

/** A commit as the report names it: its first 7 characters, as git's short form. */
export const commitText = (commit: string): string => commit.slice(0, 7);

/**
 * Spec 019 D5 step 3: the report's one line, for 019-16 to deliver and show
 * in status. Known failures always; lint while its counts were read; every
 * other part only when it is not zero. For example: `Commit abc1234: 0 known
 * failures; lint (oxlint): 2 findings in 7 of 7 files; 1 test file not
 * determined (unstaged changes); 3 test files still running`. Row 019-28: "(unstaged changes)" names only
 * files staged differently; files not determined only through files the
 * commit does not hold say "(untracked files)". Row 019-39 (review 0.1.402
 * B2): files not determined through a file git did not answer for, and
 * through no file staged differently, say "(git did not answer)".
 */
export function commitReportText(report: CommitReport): string {
  const head = `Commit ${commitText(report.commit)}`;
  if (isFailedReport(report)) return `${head}: no report (${report.failed})`;
  const { tests, lint } = report;
  const parts = [plural(tests.failures, "known failure")];
  if (lint !== undefined) parts.push(...lintParts(lint));
  const untracked = Math.min(tests.untracked ?? 0, tests.notDetermined);
  const unanswered = Math.min(tests.unanswered ?? 0, tests.notDetermined - untracked);
  const unstaged = tests.notDetermined - untracked - unanswered;
  if (unstaged > 0) {
    parts.push(`${plural(unstaged, "test file")} not determined (unstaged changes)`);
  }
  if (untracked > 0) {
    parts.push(`${plural(untracked, "test file")} not determined (untracked files)`);
  }
  if (unanswered > 0) {
    parts.push(`${plural(unanswered, "test file")} not determined (git did not answer)`);
  }
  if (tests.running > 0) parts.push(`${plural(tests.running, "test file")} still running`);
  if (tests.unknown > 0) parts.push(`${plural(tests.unknown, "test file")} unknown`);
  return `${head}: ${parts.join("; ")}`;
}

/**
 * Row 017-32 (gh-170, gh-219, gh-237): the lint parts of the line, one per
 * tool that checked a file the commit changed, named by its tool: the tool
 * is the scope, never the repository's other lint commands. The findings
 * lead only when every file is complete, as `lint (oxlint): 0 findings in
 * 7 of 7 files`; otherwise the incomplete files lead, as `lint (oxlint): 4
 * of 7 files still running, 0 findings in the other 3`. With no tool,
 * `lint not run (<reason>)`. A report stored before 017-32 keeps its line.
 */
function lintParts(lint: CommitLintCounts): string[] {
  if (lint.tools === undefined) return [legacyLint(lint)];
  if (lint.tools.length === 0) return [`lint not run (${lint.notRun ?? "no tool checked a file"})`];
  return lint.tools.map(toolPart);
}

function toolPart({ tool, files, findings, notDetermined, running }: CommitLintToolCounts) {
  const of = `of ${plural(files, "file")}`;
  const complete = files - notDetermined - running;
  if (complete === files) return `lint (${tool}): ${plural(findings, "finding")} in ${files} ${of}`;
  const open: string[] = [];
  if (running > 0) open.push(`${running} ${of} still running`);
  if (notDetermined > 0) {
    open.push(`${notDetermined}${running > 0 ? "" : ` ${of}`} not determined`);
  }
  if (complete > 0) open.push(`${plural(findings, "finding")} in the other ${complete}`);
  return `lint (${tool}): ${open.join(", ")}`;
}

/** The line of a report stored before 017-32: its counts are of checks, with no tool. */
function legacyLint({ findings, notDetermined, running }: CommitLintCounts): string {
  const more = [
    ...(notDetermined > 0 ? [`${plural(notDetermined, "file")} not determined`] : []),
    ...(running > 0 ? [`${plural(running, "file")} still running`] : []),
  ];
  return [`lint ${plural(findings, "finding")}`, ...more].join(", ");
}

/**
 * The report as status and a delivery carry it: its line, and (row 019-37,
 * lessons P11) its not-determined test files for `status --full`.
 */
export function commitLine(report: CommitReport): CommitLine {
  const line = { commit: report.commit, text: commitReportText(report) };
  if (isFailedReport(report)) return line;
  const { notDetermined: count, notDeterminedFiles: files = [] } = report.tests;
  return count > 0 && files.length > 0 ? { ...line, notDetermined: { count, files } } : line;
}
