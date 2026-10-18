import { plural } from "../text.js";
import type { CheckId, KnownFailureCounts, Validity } from "../types/index.js";

/** Checks counted apart (spec 005 D1; 001 D4: one file-level check per test file). */
export interface CheckCounts {
  readonly tests: number;
  readonly testFiles: number;
  /** Global setups that failed (task 001-382); absent when none did. */
  readonly setups?: number;
}

/** The checks of `checks` counted apart. */
export function countChecks(checks: readonly CheckId[]): CheckCounts {
  const testFiles = checks.filter((check) => check.kind === "file").length;
  const setups = checks.filter((check) => check.kind === "setup").length;
  return {
    tests: checks.length - testFiles - setups,
    testFiles,
    ...(setups > 0 ? { setups } : {}),
  };
}

/**
 * `10 tests, 4 test files loaded`, a part left out when it is zero: the unit
 * of every count of checks Squeal prints (spec 005 D1). `fileLevel` words
 * the file-level checks, `that did not load` for failures.
 */
export function checkPartsText(
  { tests, testFiles, setups = 0 }: CheckCounts,
  fileLevel = "loaded",
): string {
  return [
    ...(tests > 0 ? [plural(tests, "test")] : []),
    ...(testFiles > 0 ? [`${plural(testFiles, "test file")} ${fileLevel}`] : []),
    ...(setups > 0 ? [plural(setups, "global setup")] : []),
  ].join(", ");
}

/**
 * ` (10 tests, 4 test files loaded)`: the parts of `count` checks,
 * `fileLevel` of them file-level, for after a count. Empty when the count is
 * zero, and when `fileLevel` is not known.
 */
export function partsSuffix(
  count: number,
  fileLevel: number | undefined,
  fileLevelWord?: string,
): string {
  if (count === 0 || fileLevel === undefined) return "";
  return ` (${checkPartsText({ tests: count - fileLevel, testFiles: fileLevel }, fileLevelWord)})`;
}

/**
 * `14 passed (10 tests, 4 test files loaded)`: `count` checks labelled
 * `label`, `fileLevel` of them file-level. The parts are left out when the
 * count is zero, and when `fileLevel` is not known.
 */
export function countedText(count: number, label: string, fileLevel: number | undefined): string {
  return `${count} ${label}${partsSuffix(count, fileLevel)}`;
}

/** `3 checks (2 tests, 1 test file loaded)`: `checks` counted with `noun`, then their parts. */
export function checksText(checks: readonly CheckId[], noun = "check", fileLevel?: string): string {
  const parts = checks.length === 0 ? "" : ` (${checkPartsText(countChecks(checks), fileLevel)})`;
  return `${plural(checks.length, noun)}${parts}`;
}

/** `3 (2 tests, 1 test file that did not load)`, or `0`: the count of a `Known failures:` line. */
export function failureCountText(checks: readonly CheckId[]): string {
  if (checks.length === 0) return "0";
  return `${checks.length} (${checkPartsText(countChecks(checks), "that did not load")})`;
}

/** Failures split as C6 counts them; any validity but `current` and `pending` is stale. */
export interface FailuresByValidity<T> {
  readonly current: readonly T[];
  readonly pending: readonly T[];
  readonly stale: readonly T[];
}

/**
 * Spec 011 C6 as amended 2026-10-18 (gh-34, task 011-15): known failures
 * split by validity, shared by status, the registration header and Stop.
 * Only `current` ones count in `Known failures`; a same-key re-run leaves a
 * failure `current` until its run stores a result (C5).
 */
export function splitByValidity<T extends { readonly validity: Validity }>(
  failures: readonly T[],
): FailuresByValidity<T> {
  return {
    current: failures.filter((f) => f.validity === "current"),
    pending: failures.filter((f) => f.validity === "pending"),
    stale: failures.filter((f) => f.validity !== "current" && f.validity !== "pending"),
  };
}

/** `status --json`'s `knownFailureCounts`. */
export function knownFailureCounts(
  failures: readonly { readonly validity: Validity }[],
): KnownFailureCounts {
  const { current, pending, stale } = splitByValidity(failures);
  return { current: current.length, pending: pending.length, stale: stale.length };
}

/**
 * The line after `Known failures: N`, only when an earlier failure waits
 * for a rerun or is stale, so a zero count never reads as done while reruns
 * are queued.
 */
export function earlierFailuresLines({ pending, stale }: KnownFailureCounts): string[] {
  if (pending + stale === 0) return [];
  return [
    `Earlier failures: ${pending} pending rerun, ${stale} stale (not counted until a rerun fails)`,
  ];
}
