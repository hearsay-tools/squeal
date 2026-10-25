import { plural } from "../text.js";
import type {
  CheckId,
  KnownFailureCounts,
  PendingPhase,
  StatusHeader,
  Validity,
  ValidityCounts,
} from "../types/index.js";

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

/**
 * Spec 011 C6 as amended 2026-10-20 (gh-45, row 011-26; `tasks/011-24/design.md`
 * section 2): what is not current, for the end of every `Known failures:`
 * line (status, the registration header, Stop, a wait's verdict line), as
 * `; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20
 * queued, 60 stale)`. File-level checks count as their test files (005 D1),
 * each part only when it is not zero. `all N test files current` only with a
 * live daemon, the test files listed and the revision's runner part done;
 * otherwise the clause says which of those is missing, the down daemon by
 * `as of revision N`, since the header's sentence says why. Empty when the
 * header counts no test files by class.
 */
export function notCurrentText(header: StatusHeader): string {
  const files = header.testFileCounts;
  if (files === undefined) return "";
  if (header.testFilesListed === false) {
    return "; the daemon has not listed this worktree's test files yet";
  }
  const unlisted =
    header.runnerPartPending === true
      ? [`revision ${header.revision} is not listed yet, so test files it adds are not counted`]
      : [];
  return `; ${[filesText(header, files, unlisted.length > 0), ...unlisted].join("; ")}`;
}

function filesText(header: StatusHeader, files: ValidityCounts, unlisted: boolean): string {
  const total = files.current + files.pending + files.stale + files.unknown;
  if (total > files.current) {
    const fileParts = partsText({
      ...splitPending(files.pending, header.testFilesByPhase),
      stale: files.stale,
      unknown: files.unknown,
    });
    const tests = testsText(header);
    return `not current: ${total - files.current} of ${plural(total, "test file")} (${fileParts})${tests}`;
  }
  if (total === 0) return "the daemon listed no test files";
  if (unlisted) return `${plural(total, "test file")} current`;
  // Row 011-200: nor while the live daemon's change feed is late.
  const live = header.daemon?.state === "alive" && header.daemon.late === undefined;
  if (!live || header.awaitingInstall === true) {
    return `${plural(total, "test file")} current as of revision ${header.revision}`;
  }
  return `all ${plural(total, "test file")} current`;
}

/** `, 80 tests (20 queued, 60 stale)`: the tests not current, or empty with none. */
function testsText({ counts, fileLevelCounts: fileLevel, testsByPhase }: StatusHeader): string {
  const tests = (validity: Validity) => counts[validity] - (fileLevel?.[validity] ?? 0);
  const parts = {
    ...splitPending(tests("pending"), testsByPhase),
    stale: tests("stale"),
    unknown: tests("unknown"),
  };
  const total = parts.running + parts.queued + parts.stale + parts.unknown;
  return total === 0 ? "" : `, ${plural(total, "test")} (${partsText(parts)})`;
}

/** `pending` by `phases`, all of it queued when the header has no phases. */
function splitPending(
  pending: number,
  phases: Readonly<Record<PendingPhase, number>> | undefined,
): Record<PendingPhase, number> {
  return phases === undefined ? { running: 0, queued: pending } : { ...phases };
}

const NOT_CURRENT = ["running", "queued", "stale", "unknown"] as const;

/** `2 queued, 6 stale`: C4's pending split by phase, then stale and unknown, zeros left out. */
function partsText(parts: Readonly<Record<(typeof NOT_CURRENT)[number], number>>): string {
  return NOT_CURRENT.filter((part) => parts[part] > 0)
    .map((part) => `${parts[part]} ${part}`)
    .join(", ");
}
