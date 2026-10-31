import type { NextStep } from "../core/status/next-step.js";
import { plural, testFileText, timeText } from "../core/text.js";
import type { FileEnd } from "../core/types/index.js";

/*
 * Row 011-274 (gh-111, `research/issue-111.md`; spec 011 C4 step 5, C15):
 * how a named wait words a selected file its runner reported ended while
 * its tier still runs. It says the run's revision, that the file awaits the
 * tier's final checks, and the tier's files not reported ended as of the
 * daemon's last write, which may have ended since. It never says current or
 * passed: the tier's report, stability check and completion barrier decide
 * what is stored, and a late run error stores nothing.
 */

/**
 * `ended at revision 4, awaiting the tier's final checks and 1 file not
 * reported ended as of 06:39:35 (test/slow.test.js)`.
 */
export function fileEndText(end: FileEnd): string {
  const ended = `ended at revision ${end.revision}, awaiting the tier's final checks`;
  const asOf = timeText(end.asOf);
  if (end.unreportedCount === 0) {
    return `${ended} (every file of the tier reported ended as of ${asOf})`;
  }
  const shown = end.unreported.map(testFileText).join(", ");
  const rest = end.unreportedCount - end.unreported.length;
  const more = rest > 0 ? ` and ${rest} more` : "";
  return `${ended} and ${plural(end.unreportedCount, "file")} not reported ended as of ${asOf} (${shown}${more})`;
}

/** `next` of a file that ended: its line and the verdict line's group lead with the end. */
export function withFileEnd(next: NextStep, end: FileEnd | undefined): NextStep {
  if (end === undefined) return next;
  const ended = fileEndText(end);
  return { ...next, reason: `${ended}, ${next.reason}`, short: `${ended}, ${next.short}` };
}

/** What a group's id adds for an end: files share a line only when their ends read alike. */
export function fileEndId(end: FileEnd | undefined): string {
  return end === undefined ? "" : ` ${fileEndText(end)}`;
}
