import { formatCheck, SUMMARY_MAX_CHARS } from "../state/index.js";
import { cap, plural } from "../text.js";
import type { CheckId } from "../types/index.js";

/*
 * Task 001-91, lessons defect 15: an install that fixes 31 checks printed 31
 * blocks. Up to `LISTED_MAX` recoveries (or retired checks) are listed as
 * before; above it, one summary line and the shorter of two lists, the checks
 * that changed or the checks still failing. A list of more than `LISTED_MAX`
 * names is grouped by test file with counts when that takes fewer lines
 * (review wave 10b, N1: six checks in six files read as six names).
 */

/** Recoveries, retired checks and names listed one by one before they collapse. */
export const LISTED_MAX = 5;

/** Test files a grouped list names before the rest is counted. */
const FILES_SHOWN = 10;

/** One summary line and the lines under it. */
export interface Collapsed {
  readonly head: string;
  readonly lines: readonly string[];
}

/** `squeal why` resolves a capped name by the part before `...`. */
export function checkName(check: CheckId): string {
  return cap(formatCheck(check), SUMMARY_MAX_CHARS);
}

/** A test file as `formatCheck` names it, without the test name. */
const fileName = (check: CheckId) =>
  `${check.project === "" ? "" : `[${check.project}] `}${check.testPath}`;

/**
 * Names one per line, or above `LISTED_MAX` one line per test file, most
 * checks first, when that takes fewer lines than the names.
 */
export function nameLines(checks: readonly CheckId[]): string[] {
  if (checks.length <= LISTED_MAX) return checks.map(checkName);
  const grouped = byFile(checks);
  return grouped.length < checks.length ? grouped : checks.map(checkName);
}

/** One line per test file with its count, the first `FILES_SHOWN`, then the rest counted. */
function byFile(checks: readonly CheckId[]): string[] {
  const byFile = new Map<string, number>();
  for (const check of checks) byFile.set(fileName(check), (byFile.get(fileName(check)) ?? 0) + 1);
  const files = [...byFile].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0));
  const lines = files.slice(0, FILES_SHOWN).map(([file, n]) => `${n} in ${file}`);
  const rest = files.slice(FILES_SHOWN);
  if (rest.length === 0) return lines;
  const count = rest.reduce((sum, [, n]) => sum + n, 0);
  return [...lines, `and ${plural(rest.length, "more test file")} (${plural(count, "check")})`];
}

/**
 * The summary of `changed` checks above `LISTED_MAX`, with the changed list
 * or, when it takes no more lines, the still-failing list; `null` at or
 * below `LISTED_MAX`. `stillFailing` `undefined` is not known: the changed
 * list is shown.
 */
export function collapse(
  head: string,
  changed: readonly CheckId[],
  stillFailing: readonly CheckId[] | undefined,
): Collapsed | null {
  if (changed.length <= LISTED_MAX) return null;
  const changedLines = nameLines(changed);
  if (stillFailing === undefined) return { head, lines: changedLines };
  const failingLines = [`still failing: ${stillFailing.length}`, ...nameLines(stillFailing)];
  return { head, lines: failingLines.length <= changedLines.length ? failingLines : changedLines };
}
