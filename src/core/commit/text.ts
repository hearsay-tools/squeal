import { plural } from "../text.js";
import { type CommitReport, isFailedReport } from "./report.js";

/** A commit as the report names it: its first 7 characters, as git's short form. */
export const commitText = (commit: string): string => commit.slice(0, 7);

/**
 * Spec 019 D5 step 3: the report's one line, for 019-16 to deliver and show
 * in status. Known failures always; lint while its counts were read; every
 * other part only when it is not zero. For example: `Commit abc1234: 0 known
 * failures; lint 2 findings; 1 test file not determined (unstaged changes);
 * 3 test files still running`. Row 019-28: "(unstaged changes)" names only
 * files staged differently; files not determined only through files the
 * commit does not hold say "(untracked files)".
 */
export function commitReportText(report: CommitReport): string {
  const head = `Commit ${commitText(report.commit)}`;
  if (isFailedReport(report)) return `${head}: no report (${report.failed})`;
  const { tests, lint } = report;
  const parts = [plural(tests.failures, "known failure")];
  if (lint !== undefined) {
    const more = [
      ...(lint.notDetermined > 0 ? [`${plural(lint.notDetermined, "file")} not determined`] : []),
      ...(lint.running > 0 ? [`${plural(lint.running, "file")} still running`] : []),
    ];
    parts.push([`lint ${plural(lint.findings, "finding")}`, ...more].join(", "));
  }
  const untracked = Math.min(tests.untracked ?? 0, tests.notDetermined);
  const unstaged = tests.notDetermined - untracked;
  if (unstaged > 0) {
    parts.push(`${plural(unstaged, "test file")} not determined (unstaged changes)`);
  }
  if (untracked > 0) {
    parts.push(`${plural(untracked, "test file")} not determined (untracked files)`);
  }
  if (tests.running > 0) parts.push(`${plural(tests.running, "test file")} still running`);
  if (tests.unknown > 0) parts.push(`${plural(tests.unknown, "test file")} unknown`);
  return `${head}: ${parts.join("; ")}`;
}
