import { plural } from "../text.js";
import type { CheckId } from "../types/index.js";

/** Checks counted apart (spec 005 D1; 001 D4: one file-level check per test file). */
export interface CheckCounts {
  readonly tests: number;
  readonly testFiles: number;
}

/** The checks of `checks` counted apart. */
export function countChecks(checks: readonly CheckId[]): CheckCounts {
  const testFiles = checks.filter((check) => check.kind === "file").length;
  return { tests: checks.length - testFiles, testFiles };
}

/**
 * `10 tests, 4 test files loaded`, a part left out when it is zero: the unit
 * of every count of checks Squeal prints (spec 005 D1). `fileLevel` words
 * the file-level checks, `that did not load` for failures.
 */
export function checkPartsText({ tests, testFiles }: CheckCounts, fileLevel = "loaded"): string {
  return [
    ...(tests > 0 ? [plural(tests, "test")] : []),
    ...(testFiles > 0 ? [`${plural(testFiles, "test file")} ${fileLevel}`] : []),
  ].join(", ");
}

/**
 * `14 passed (10 tests, 4 test files loaded)`: `count` checks labelled
 * `label`, `fileLevel` of them file-level. The parts are left out when the
 * count is zero, and when `fileLevel` is not known.
 */
export function countedText(count: number, label: string, fileLevel: number | undefined): string {
  const head = `${count} ${label}`;
  if (count === 0 || fileLevel === undefined) return head;
  const parts = { tests: count - fileLevel, testFiles: fileLevel };
  return `${head} (${checkPartsText(parts)})`;
}

/** `3 (2 tests, 1 test file that did not load)`, or `0`: the count of a `Known failures:` line. */
export function failureCountText(checks: readonly CheckId[]): string {
  if (checks.length === 0) return "0";
  return `${checks.length} (${checkPartsText(countChecks(checks), "that did not load")})`;
}
